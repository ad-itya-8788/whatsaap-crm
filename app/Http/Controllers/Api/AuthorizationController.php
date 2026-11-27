<?php

namespace App\Http\Controllers\Api;

use App\Auth\Access;
use App\Auth\AuthorizationAudit;
use App\Auth\PermissionRegistry;
use App\Http\Controllers\Controller;
use App\Models\AccountInvitation;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AuthorizationController extends Controller
{
    public function __construct(private Access $access) {}

    public function index(): JsonResponse
    {
        $counts = User::query()->selectRaw('role, count(*) as total')->groupBy('role')->pluck('total', 'role');
        $roles = DB::table('crm_roles')->orderBy('name')->get()->map(function ($role) use ($counts) {
            $role->permissions = $role->key === 'owner' ? array_keys(PermissionRegistry::all()) : json_decode($role->permissions, true);
            $role->users_count = (int) ($counts[$role->key] ?? 0);

            return $role;
        });

        return response()->json(['roles' => $roles, 'registry' => array_values(PermissionRegistry::all())]);
    }

    public function saveRole(Request $request, ?string $key = null): JsonResponse
    {
        $assignable = array_keys(array_filter(PermissionRegistry::all(), fn ($permission) => ! $permission['owner_only']));
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:1000'],
            'permissions' => ['present', 'array'],
            'permissions.*' => ['required', 'string', 'distinct', Rule::in($assignable)],
        ]);

        return $this->mutate($request, function (User $actor) use ($key, $data) {
            $old = null;
            abort_if($key === 'owner', 403);
            if ($key !== null) {
                $old = DB::table('crm_roles')->where('key', $key)->first();
                abort_unless($old, 404);
            }
            $key ??= 'custom-'.Str::lower((string) Str::ulid());
            sort($data['permissions']);
            DB::table('crm_roles')->updateOrInsert(['key' => $key], [
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'permissions' => json_encode($data['permissions'], JSON_THROW_ON_ERROR),
            ]);
            AuthorizationAudit::record($actor->id, $old ? 'role.updated' : 'role.created', 'role:'.$key,
                $old ? ['name' => $old->name, 'description' => $old->description, 'permissions' => json_decode($old->permissions, true)] : null, $data);

            return response()->json(['key' => $key]);
        });
    }

    public function deleteRole(Request $request, string $key): JsonResponse
    {
        return $this->mutate($request, function (User $actor) use ($key) {
            $role = DB::table('crm_roles')->where('key', $key)->first();
            abort_unless($role, 404);
            abort_if($role->built_in, 403);
            abort_if(User::where('role', $key)->exists() || AccountInvitation::query()->pending()->where('role', $key)->exists(), 409, 'Remove role assignments and invitations before deleting this role.');

            DB::table('crm_roles')->where('key', $key)->delete();
            AuthorizationAudit::record($actor->id, 'role.deleted', 'role:'.$key, (array) $role, null);

            return response()->json(['ok' => true]);
        });
    }

    public function member(User $user): JsonResponse
    {
        return response()->json([
            'user' => $user->only(['id', 'name', 'email', 'avatar_url', 'role', 'is_active']),
            'protected' => $user->role === 'owner',
            'role_permissions' => $this->access->rolePermissions($user),
            'overrides' => (object) $this->access->overrides($user),
            'effective' => $this->access->effective($user),
        ]);
    }

    public function saveMember(Request $request, User $user): JsonResponse
    {
        $data = $request->validate(['overrides' => ['present', 'array'], 'overrides.*' => ['required', 'boolean']]);
        $assignable = array_filter(PermissionRegistry::all(), fn ($permission) => ! $permission['owner_only']);
        abort_if(array_diff_key($data['overrides'], $assignable), 422, 'An override uses an invalid or protected permission.');

        return $this->mutate($request, function (User $actor) use ($user, $data) {
            $member = User::query()->lockForUpdate()->findOrFail($user->id);
            abort_if($member->role === 'owner', 403);
            $before = $this->access->overrides($member);
            $after = array_map(fn ($allowed) => (bool) $allowed, $data['overrides']);
            DB::table('user_permission_overrides')->where('user_id', $member->id)->delete();
            if ($after) {
                $rows = [];
                foreach ($after as $key => $allowed) {
                    $rows[] = ['user_id' => $member->id, 'permission' => $key, 'allowed' => $allowed];
                }
                DB::table('user_permission_overrides')->insert($rows);
            }
            AuthorizationAudit::record($actor->id, 'permissions.updated', 'user:'.$member->id, $before, $after);

            return response()->json(['ok' => true]);
        });
    }

    public function audit(): JsonResponse
    {
        return response()->json(DB::table('authorization_audits')->orderByDesc('id')->paginate(50));
    }

    private function mutate(Request $request, callable $operation): JsonResponse
    {
        return DB::transaction(function () use ($request, $operation) {
            DB::table('crm_roles')->where('key', 'owner')->lockForUpdate()->first();
            $actor = User::query()->lockForUpdate()->findOrFail($request->user()->id);
            abort_unless($this->access->owner($actor), 403);

            return $operation($actor);
        }, 3);
    }
}
