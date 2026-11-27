<?php

namespace App\Auth;

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class Access
{
    private array $resolved = [];

    private ?Request $request = null;

    public function owner(?User $user): bool
    {
        return $user?->is_active && $user->role === 'owner';
    }

    public function can(?User $user, string $permission): bool
    {
        if (! $user?->is_active) {
            return false;
        }

        return $this->owner($user) || in_array($permission, $this->effective($user), true);
    }

    public function allowsFresh(?User $user, string $permission): bool
    {
        if (! $user?->is_active) {
            return false;
        }

        return $this->owner($user) || in_array($permission, $this->resolve(
            PermissionRegistry::all(), $this->rolePermissions($user), $this->overrides($user)
        ), true);
    }

    public function rolePermissions(User $user): array
    {
        $role = DB::table('crm_roles')->where('key', $user->role)->first(['key', 'permissions']);

        return $role?->key === $user->role ? json_decode($role->permissions, true, flags: JSON_THROW_ON_ERROR) : [];
    }

    public function overrides(User $user): array
    {
        return DB::table('user_permission_overrides')->where('user_id', $user->id)
            ->pluck('allowed', 'permission')->map(fn ($allowed) => (bool) $allowed)->all();
    }

    public function effective(User $user): array
    {
        if (! $user->is_active) {
            return [];
        }

        $registry = PermissionRegistry::all();
        if ($this->owner($user)) {
            return array_keys($registry);
        }

        if ($this->request !== request()) {
            $this->request = request();
            $this->resolved = [];
        }

        return $this->resolved[$user->id.':'.$user->role] ??= $this->resolve($registry, $this->rolePermissions($user), $this->overrides($user));
    }

    public function assignableUsers(): Collection
    {
        $users = User::query()->where('is_active', true)->orderBy('name')->get();
        $roles = DB::table('crm_roles')->pluck('permissions', 'key');
        $overrides = DB::table('user_permission_overrides')->whereIntegerInRaw('user_id', $users->modelKeys())
            ->get()->groupBy('user_id');
        $registry = PermissionRegistry::all();

        return $users->filter(function (User $user) use ($roles, $overrides, $registry) {
            if ($this->owner($user)) {
                return true;
            }
            $role = json_decode($roles[$user->role] ?? '[]', true, flags: JSON_THROW_ON_ERROR);
            $individual = ($overrides[$user->id] ?? collect())->pluck('allowed', 'permission')
                ->map(fn ($allowed) => (bool) $allowed)->all();
            $permissions = $this->resolve($registry, $role, $individual);

            return $this->assignable($permissions);
        });
    }

    public function canBeAssigned(?User $user): bool
    {
        return $user && $this->assignable($this->effective($user));
    }

    private function assignable(array $permissions): bool
    {
        return in_array('presence.assignable', $permissions, true)
            && (in_array('conversations.view_all', $permissions, true) || in_array('conversations.view_assigned', $permissions, true));
    }

    private function resolve(array $registry, array $role, array $overrides): array
    {
        $granted = [];
        foreach ($registry as $key => $definition) {
            if (! $definition['owner_only'] && ($overrides[$key] ?? in_array($key, $role, true))) {
                $granted[$key] = $definition['dependencies'];
            }
        }

        // A prerequisite must resolve first. Cycles and missing dependencies fail closed.
        $effective = [];
        do {
            $count = count($effective);
            foreach ($granted as $key => $dependencies) {
                if (! array_diff($dependencies, $effective)) {
                    $effective[] = $key;
                    unset($granted[$key]);
                }
            }
        } while (count($effective) > $count);

        sort($effective);

        return $effective;
    }

    public function conversationQuery(Builder $query, User $user): Builder
    {
        if ($this->can($user, 'conversations.view_all')) {
            return $query;
        }

        return $query->where(function (Builder $scope) use ($user) {
            $scope->whereRaw('1 = 0');
            if ($this->can($user, 'conversations.view_assigned')) {
                $scope->orWhere('assigned_agent_id', $user->id);
            }
            if ($this->can($user, 'conversations.view_unassigned')) {
                $scope->orWhereNull('assigned_agent_id');
            }
            if ($this->can($user, 'conversations.view_others')) {
                $scope->orWhere('assigned_agent_id', '!=', $user->id);
            }
        });
    }

    public function authorizeConversation(User $user, Conversation $conversation): void
    {
        abort_unless($this->can($user, 'inbox.view') && $this->conversationQuery(
            Conversation::query()->whereKey($conversation->id), $user
        )->exists(), 403);
    }

    public function redactConversation(Conversation $conversation, User $user): Conversation
    {
        if (! $this->can($user, 'messages.read')) {
            $conversation->makeHidden(['last_message_text', 'ai_handoff_summary']);
        }
        if (! $this->can($user, 'conversation_notes.view')) {
            $conversation->makeHidden(['notes_count']);
        }
        if (! $this->can($user, 'ai.view')) {
            $conversation->makeHidden(['ai_autoreply_disabled', 'ai_reply_count', 'ai_handoff_summary']);
        }
        if (! $this->can($user, 'tags.view') && $conversation->relationLoaded('contact')) {
            $conversation->contact?->makeHidden(['tags']);
        }

        return $conversation;
    }

    public function conversationForContact(User $user, int $contactId): Conversation
    {
        return DB::transaction(function () use ($user, $contactId) {
            $conversation = Conversation::firstOrCreate(
                ['contact_id' => $contactId],
                ['user_id' => $user->id, 'assigned_agent_id' => ($this->can($user, 'conversations.view_all') || $this->can($user, 'conversations.view_unassigned')) ? null : $user->id, 'status' => 'open'],
            );
            $this->authorizeConversation($user, $conversation);

            return $conversation;
        });
    }
}
