<?php

namespace App\Http\Controllers\Api;

use App\Auth\Access;
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
    public function __construct(private RealtimeBroadcaster $realtime, private Access $access) {}

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

        $query = $this->access->conversationQuery(Conversation::query(), $request->user())
            ->with(['contact.tags', 'assignedAgent:id,name,avatar_url'])
            ->withCount('notes');

        if ($search = $request->string('search')->toString()) {
            $query->whereHas('contact', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('phone_normalized', 'like', "%{$search}%");
            });
        }

        $status = $filters['status'] ?? 'all';
        $waitingFirst = false;
        if ($status !== 'all') {
            abort_unless($this->access->can($request->user(), 'conversations.filter_'.$status), 403);
        }

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

        return response()->json($query->orderByDesc('id')->paginate($perPage)
            ->through(fn (Conversation $row) => $this->access->redactConversation($row, $request->user())));
    }

    public function show(Request $request, Conversation $conversation): JsonResponse
    {
        return response()->json($this->access->redactConversation(
            $conversation->load(['contact.tags', 'assignedAgent:id,name,avatar_url'])->loadCount('notes'), $request->user()
        ));
    }

    public function destroy(Conversation $conversation, InboundMediaMirror $mediaMirror): JsonResponse
    {
        $mediaMessageIds = DB::transaction(function () use ($conversation) {
            $conversation = Conversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $this->access->authorizeConversation(request()->user(), $conversation);
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
        return response()->json(['count' => $this->access->conversationQuery(Conversation::query(), $request->user())->where('unread_count', '>', 0)->count()]);
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

        $conversation = $this->access->conversationForContact($request->user(), $data['contact_id']);

        return response()->json($this->access->redactConversation($conversation->load('contact'), $request->user()));
    }

    public function agents(): JsonResponse
    {
        $agents = $this->access->assignableUsers()->map->only(['id', 'name'])->values();

        return response()->json($agents);
    }

    public function assign(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'assignee_id' => ['nullable', 'integer', 'exists:users,id'],
        ]);

        $conversation = DB::transaction(function () use ($conversation, $data, $request) {
            $conversation = Conversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $this->access->authorizeConversation($request->user(), $conversation);
            if (isset($data['assignee_id'])) {
                $assignee = User::find($data['assignee_id']);
                abort_unless($this->access->canBeAssigned($assignee), 422, 'Select an eligible active assignee.');
            }
            $conversation->update(['assigned_agent_id' => $data['assignee_id'] ?? null]);

            if (! empty($data['assignee_id']) && (int) $data['assignee_id'] !== $request->user()->id) {
                $contact = $conversation->contact;
                $label = $contact?->name ?: $contact?->phone ?: 'a contact';

                Notification::create([
                    'user_id' => (int) $data['assignee_id'],
                    'type' => 'conversation_assigned',
                    'title' => 'Conversation assigned to you',
                    'body' => "{$label} was assigned to you.",
                    'data' => ['conversation_id' => $conversation->id],
                ]);
            }
            return $conversation;
        }, 3);

        $this->realtime->conversationUpdated($conversation->fresh());

        return response()->json($this->access->redactConversation(
            $conversation->load(['contact', 'assignedAgent:id,name,avatar_url']), $request->user()
        ));
    }

    public function updateStatus(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:open,pending,closed'],
        ]);

        if ($data['status'] === 'closed') {
            abort_unless($this->access->can($request->user(), 'conversations.close'), 403);
        } elseif ($conversation->status === 'closed') {
            abort_unless($this->access->can($request->user(), 'conversations.reopen'), 403);
        }

        $conversation->update([
            'status' => $data['status'],
            'closed_at' => $data['status'] === 'closed' ? now() : null,
        ]);
        $this->realtime->conversationUpdated($conversation->fresh());

        return response()->json($this->access->redactConversation(
            $conversation->load(['contact', 'assignedAgent:id,name,avatar_url']), $request->user()
        ));
    }
}
