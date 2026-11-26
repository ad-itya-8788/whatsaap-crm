<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RealtimePayload;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Models\Conversation;
use App\Models\Message;

class RealtimeSyncController extends Controller
{
    public function __construct(private RealtimePayload $payload) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'conversation_id' => ['sometimes', 'integer', 'exists:conversations,id'],
            'after_id' => ['sometimes', 'integer', 'min:0'],
            'since' => ['sometimes', 'date'],
        ]);

        $messages = [];
        if (! empty($data['conversation_id'])) {
            $messages = Message::query()
                ->where('conversation_id', $data['conversation_id'])
                ->where('id', '>', (int) ($data['after_id'] ?? 0))
                ->with([
                    'replyTo:id,content_text,sender_type,content_type,filename',
                    'template:name,body_text',
                    'reactions:id,message_id,actor_type,actor_id,emoji,created_at',
                ])
                ->orderBy('id')
                ->limit(100)
                ->get()
                ->map(fn (Message $message) => $this->payload->message($message))
                ->all();
        }

        $conversations = Conversation::query()
            ->with(['contact.tags', 'assignedAgent:id,name,avatar_url'])
            ->withCount('notes')
            ->when(! empty($data['since']), fn ($query) => $query->where('updated_at', '>', Carbon::parse($data['since'])))
            ->orderByDesc('updated_at')
            ->limit(100)
            ->get()
            ->map(fn (Conversation $conversation) => $this->payload->conversation($conversation))
            ->all();

        return response()->json([
            'messages' => $messages,
            'conversations' => $conversations,
            'server_time' => now()->toISOString(),
        ]);
    }
}
