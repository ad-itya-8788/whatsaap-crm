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
        $user = $request->user();
        $query = Message::query()
            ->where('sender_type', 'customer')
            ->whereHas('conversation', function ($query) use ($user) {
                if (in_array($user->role, ['admin', 'owner'], true)) {
                    return;
                }

                $query->where('user_id', $user->id)
                    ->orWhere('assigned_agent_id', $user->id);
            });

        if (! $request->has('after')) {
            return response()->json(['latest_id' => (int) $query->max('id'), 'events' => []]);
        }

        $after = max(0, $request->integer('after'));
        $messages = $query->where('id', '>', $after)
            ->with('conversation.contact:id,name,wa_username,phone')
            ->orderBy('id')
            ->limit(20)
            ->get(['id', 'conversation_id', 'content_type', 'content_text', 'created_at']);

        return response()->json([
            'latest_id' => $messages->last()?->id ?: $after,
            'events' => $messages->map(fn (Message $message) => [
                'id' => $message->id,
                'conversation_id' => $message->conversation_id,
                'contact_name' => $this->browserContactName($message),
                'content_type' => $message->content_type,
                'body' => $message->content_text,
                'created_at' => $message->created_at,
            ]),
        ]);
    }

    private function browserContactName(Message $message): string
    {
        $contact = $message->conversation?->contact;
        $name = trim((string) $contact?->name);
        $username = trim((string) $contact?->wa_username);

        return $name ?: ($username !== '' ? '@'.$username : (trim((string) $contact?->phone) ?: 'New message'));
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
