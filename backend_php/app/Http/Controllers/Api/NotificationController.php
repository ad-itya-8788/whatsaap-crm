<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Message;
use App\Models\Notification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(
            Notification::query()
                ->where('user_id', $request->user()->id)
                ->latest()
                ->paginate(min(max($request->integer('per_page', 50), 1), 100))
        );
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return response()->json([
            'count' => Notification::query()
                ->where('user_id', $request->user()->id)
                ->unread()
                ->count(),
        ]);
    }

    public function markRead(Request $request, Notification $notification): JsonResponse
    {
        if ($notification->user_id !== $request->user()->id) {
            abort(403);
        }

        $notification->update(['read_at' => now()]);

        return response()->json($notification);
    }

    public function browserEvents(Request $request): JsonResponse
    {
        $after = $request->integer('after', 0);

        $messages = Message::query()
            ->where('sender_type', 'customer')
            ->where('id', '>', $after)
            ->with('conversation.contact:id,name,phone')
            ->orderBy('id')
            ->limit(20)
            ->get(['id', 'conversation_id', 'content_text', 'created_at']);

        return response()->json([
            'latest_id' => $messages->last()?->id ?: $after,
            'events' => $messages->map(fn (Message $message) => [
                'id' => $message->id,
                'conversation_id' => $message->conversation_id,
                'contact_name' => $message->conversation?->contact?->name
                    ?: $message->conversation?->contact?->phone
                    ?: 'New message',
                'body' => $message->content_text,
                'created_at' => $message->created_at,
            ]),
        ]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $updated = Notification::query()
            ->where('user_id', $request->user()->id)
            ->unread()
            ->update(['read_at' => now()]);

        return response()->json(['updated' => $updated]);
    }
}
