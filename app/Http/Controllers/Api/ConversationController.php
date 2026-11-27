<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\Notification;
use App\Models\User;
use App\Services\InboundMediaMirror;
use App\Services\RealtimeBroadcaster;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ConversationController extends Controller
{
    public function __construct(private RealtimeBroadcaster $realtime) {}

    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 50), 1), 100);
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            'status' => ['sometimes', 'in:all,waiting,unassigned,expiring,unread,open,pending,closed'],
            'assigned' => ['sometimes', 'string', function ($attribute, $value, $fail) {
                if (! in_array($value, ['all', 'me', 'unassigned'], true) && ! ctype_digit((string) $value)) {
                    $fail('The selected assigned filter is invalid.');
                }
            }],
        ]);

        $query = Conversation::query()
            ->with(['contact.tags', 'assignedAgent:id,name,avatar_url'])
            ->withCount('notes');

        if (! $request->user()->isOwner()) {
            $query->where('assigned_agent_id', $request->user()->id);
        }

        if ($search = $request->string('search')->toString()) {
            $query->whereHas('contact', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('phone_normalized', 'like', "%{$search}%");
            });
        }

        $status = $filters['status'] ?? 'all';
        $waitingFirst = false;

        if ($status === 'unread') {
            $query->where('unread_count', '>', 0);
        } elseif ($status === 'waiting' || $status === 'expiring') {
            $query->whereIn('status', ['open', 'pending'])
                ->whereNotNull('last_inbound_at')
                ->where(function ($inner) {
                    $inner->whereNull('last_reply_at')
                        ->orWhereColumn('last_reply_at', '<', 'last_inbound_at');
                });

            if ($status === 'expiring') {
                $query->whereBetween('last_inbound_at', [now()->subDay(), now()->subHours(22)]);
            }

            $waitingFirst = true;
        } elseif ($status === 'unassigned') {
            $query->where('status', 'open')->whereNull('assigned_agent_id');
        } elseif ($status !== 'all') {
            $query->where('status', $status);
        }

        $assigned = $filters['assigned'] ?? 'all';
        if ($assigned === 'me') {
            $query->where('assigned_agent_id', $request->user()->id);
        } elseif ($assigned === 'unassigned') {
            $query->whereNull('assigned_agent_id');
        } elseif (ctype_digit((string) $assigned)) {
            $query->where('assigned_agent_id', (int) $assigned);
        }

        $query = $waitingFirst
            ? $query->orderBy('last_inbound_at')->orderByDesc('updated_at')
            : $query->orderByDesc('last_message_at')->orderByDesc('updated_at');

        return response()->json($query->orderByDesc('id')->paginate($perPage));
    }

    public function show(Conversation $conversation): JsonResponse
    {
        return response()->json($conversation->load(['contact.tags', 'assignedAgent:id,name,avatar_url'])->loadCount('notes'));
    }

    public function destroy(Conversation $conversation, InboundMediaMirror $mediaMirror): JsonResponse
    {
        $mediaMessageIds = DB::transaction(function () use ($conversation) {
            $conversation = Conversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $mediaMessageIds = $conversation->messages()
                ->where('sender_type', 'customer')
                ->whereNotNull('media_url')
                ->pluck('id')
                ->all();

            $conversation->delete();

            return $mediaMessageIds;
        });

        foreach ($mediaMessageIds as $messageId) {
            $mediaMirror->deleteByMessageId($messageId);
        }

        $this->realtime->conversationDeleted((int) $conversation->id);

        return response()->json(['ok' => true]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $query = Conversation::query()->where('unread_count', '>', 0);
        if (! $request->user()->isOwner()) {
            $query->where('assigned_agent_id', $request->user()->id);
        }

        return response()->json(['count' => $query->count()]);
    }

    public function typing(Request $request, Conversation $conversation): \Illuminate\Http\Response
    {
        $user = $request->user();
        $this->realtime->conversationActivity($conversation, 'typing', 'user:'.$user->id, true, $user);

        return response()->noContent();
    }

    public function markRead(Conversation $conversation): JsonResponse
    {
        $changed = Conversation::query()->whereKey($conversation->id)
            ->where('unread_count', '>', 0)->update(['unread_count' => 0]);
        if ($changed) {
            $this->realtime->conversationUpdated($conversation->fresh());
        }

        return response()->json(['ok' => true]);
    }

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['contact_id' => ['required', 'integer', 'exists:contacts,id']]);

        $conversation = Conversation::firstOrCreate(
            ['contact_id' => $data['contact_id']],
            [
                'user_id' => $request->user()->id,
                'status' => 'open',
                'assigned_agent_id' => $request->user()->isOwner() ? null : $request->user()->id,
            ],
        );

        return response()->json($conversation->load('contact'));
    }

    public function agents(Request $request): JsonResponse
    {
        $query = User::query()->orderBy('name');
        if ($request->boolean('assignment_picker') && $request->user()->isOwner()) {
            return response()->json($query->with('assignedRole')->get(['id', 'name', 'is_active', 'role_id'])->map(fn (User $member) => [
                'id' => $member->id,
                'name' => $member->name,
                'unavailable_reason' => match (true) {
                    ! $member->is_active => 'Inactive',
                    ! $member->hasModuleAccess('inbox') => 'Needs Inbox access',
                    default => null,
                },
            ]));
        }

        return response()->json($query->where('is_active', true)
            ->whereHas('assignedRole', fn ($role) => $role->where('slug', 'owner')->orWhereJsonContains('module_access', 'inbox'))
            ->get(['id', 'name']));
    }

    public function assign(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'assignee_id' => ['nullable', 'integer', 'exists:users,id'],
        ]);

        if (! empty($data['assignee_id'])) {
            abort_unless(User::find($data['assignee_id'])?->hasModuleAccess('inbox'), 422, 'Select an active member with Inbox access.');
        }

        DB::transaction(function () use ($conversation, $data, $request) {
            $conversation->update(['assigned_agent_id' => $data['assignee_id'] ?? null]);

            if (! empty($data['assignee_id']) && (int) $data['assignee_id'] !== $request->user()->id) {
                $contact = $conversation->contact;
                $label = $contact?->name ?: $contact?->phone ?: 'a contact';
                $actor = $request->user()->name;

                Notification::create([
                    'user_id' => (int) $data['assignee_id'],
                    'type' => 'conversation_assigned',
                    'title' => 'New chat assigned to you',
                    'body' => "{$actor} assigned you {$label} chat.",
                    'data' => [
                        'conversation_id' => $conversation->id,
                        'actor_name' => $actor,
                        'contact_name' => $label,
                    ],
                ]);
            }
        });

        $this->realtime->conversationUpdated($conversation->fresh());

        return response()->json($conversation->load(['contact', 'assignedAgent']));
    }

    public function updateStatus(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:open,pending,closed'],
        ]);

        $conversation->update([
            'status' => $data['status'],
            'closed_at' => $data['status'] === 'closed' ? now() : null,
        ]);
        $this->realtime->conversationUpdated($conversation->fresh());

        return response()->json($conversation->load(['contact', 'assignedAgent']));
    }
}
