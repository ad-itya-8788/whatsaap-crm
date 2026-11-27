<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\Message;
use App\Services\RealtimePayload;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RealtimeSyncController extends Controller
{
    public function __construct(private RealtimePayload $payload) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'conversation_id' => ['sometimes', 'integer', 'exists:conversations,id'],
            'after_id' => ['sometimes', 'integer', 'min:0'],
            'since' => ['sometimes', 'date'],
            'through' => ['sometimes', 'date'],
            'oldest_id' => ['sometimes', 'integer', 'min:0'],
            'message_cursor' => ['sometimes', 'integer', 'min:0'],
            'conversation_cursor' => ['sometimes', 'integer', 'min:0'],
            'skip_messages' => ['sometimes', 'boolean'],
            'skip_conversations' => ['sometimes', 'boolean'],
        ]);

        $serverTime = isset($data['through']) ? Carbon::parse($data['through']) : now();
        // Include the boundary second because the database timestamps have second precision.
        $since = isset($data['since']) ? Carbon::parse($data['since'])->startOfSecond() : null;
        $isAdmin = $request->user()->isOwner();
        $userId = $request->user()->id;

        $messages = collect();
        if (! empty($data['conversation_id']) && empty($data['skip_messages'])) {
            $messages = Message::query()
                ->where('conversation_id', $data['conversation_id'])
                ->when(! $isAdmin, fn ($query) => $query->whereHas('conversation', fn ($conversation) => $conversation->where('assigned_agent_id', $userId)))
                ->where('id', '>', $data['message_cursor'] ?? 0)
                ->where(function ($query) use ($data, $since) {
                    if (! $since || ! empty($data['after_id'])) {
                        $query->where('id', '>', $data['after_id'] ?? 0);
                    }
                    if ($since) {
                        $query->orWhere(fn ($changed) => $changed->where('updated_at', '>=', $since)
                            ->where('id', '>=', $data['oldest_id'] ?? 0));
                    }
                })
                ->with([
                    'replyTo:id,content_text,sender_type,content_type,filename',
                    'template:name,body_text',
                    'reactions:id,message_id,actor_type,actor_id,emoji,created_at',
                ])
                ->orderBy('id')
                ->limit(101)
                ->get();
        }

        $conversations = collect();
        if (empty($data['skip_conversations'])) {
            $conversations = Conversation::query()
                ->when(! $isAdmin, fn ($query) => $query->where('assigned_agent_id', $userId))
                ->with(['contact.tags', 'assignedAgent:id,name,avatar_url'])
                ->withCount('notes')
                ->when($since, fn ($query) => $query->where('updated_at', '>=', $since))
                ->when($since, fn ($query) => $query->orderBy('id'), fn ($query) => $query->orderByDesc('updated_at'))
                ->where('id', '>', $data['conversation_cursor'] ?? 0)
                ->limit(101)
                ->get();
        }

        return response()->json([
            'messages' => $messages->take(100)->map(fn (Message $message) => $this->payload->message($message)),
            'conversations' => $conversations->take(100)->map(fn (Conversation $conversation) => $this->payload->conversation($conversation)),
            'next_message_cursor' => $messages->count() > 100 ? $messages[99]->id : null,
            'next_conversation_cursor' => $since && $conversations->count() > 100 ? $conversations[99]->id : null,
            'server_time' => $serverTime->toISOString(),
        ]);
    }
}
