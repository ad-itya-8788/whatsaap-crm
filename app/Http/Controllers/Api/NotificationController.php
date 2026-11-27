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

    public function popupEvents(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Notification::query()->where('user_id', $user->id);
        if (! $user->hasModuleAccess('notifications')) {
            $query->where('type', 'conversation_assigned');
        }

        $columns = ['id', 'type', 'title', 'body', 'data', 'created_at'];
        if ($request->has('after')) {
            $after = max(0, $request->integer('after'));
            $notifications = $query->where('id', '>', $after)->orderBy('id')->limit(20)->get($columns);
            $latestId = $notifications->last()?->id ?? $after;
            $hasMore = $notifications->count() === 20;
        } else {
            $latestId = 0;
            $notifications = $query->unread()
                ->orderByDesc('id')->limit(4)->get($columns)->reverse()->values();
            $hasMore = false;
        }

        return response()->json([
            'latest_id' => $latestId,
            'has_more' => $hasMore,
            'events' => $notifications->map(fn (Notification $notification) => [
                'id' => $notification->id,
                'type' => $notification->type,
                'title' => $notification->title,
                'body' => $notification->body,
                'data' => $notification->data,
                'created_at' => $notification->created_at,
            ]),
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
        if (! $user->hasModuleAccess('inbox')) {
            return response()->json(['latest_id' => 0, 'events' => []]);
        }
        $query = Message::query()
            ->where('sender_type', 'customer')
            ->whereHas('conversation', function ($query) use ($user) {
                if ($user->isOwner()) {
                    return;
                }

                $query->where('assigned_agent_id', $user->id);
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
