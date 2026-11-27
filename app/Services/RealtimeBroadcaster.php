<?php

namespace App\Services;

use App\Events\ConversationActivity;
use App\Events\ConversationDeleted;
use App\Events\ConversationUpdated;
use App\Events\MessageCreated;
use App\Events\MessageDeleted;
use App\Events\MessageStatusChanged;
use App\Events\MessageUpdated;
use App\Events\NotificationCreated;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Support\Facades\Log;
use Throwable;

class RealtimeBroadcaster
{
    public function __construct(private RealtimePayload $payload) {}

    public function messageCreated(Message $message): void
    {
        $conversation = $this->conversationFor($message);
        $this->dispatch(new MessageCreated(
            (int) $message->conversation_id,
            $this->payload->message($message),
            $this->payload->conversation($conversation),
            $this->recipients($conversation),
        ));
    }

    public function messageUpdated(Message $message): void
    {
        $fresh = $message->fresh() ?: $message;
        $conversation = $this->conversationFor($fresh);
        $this->dispatch(new MessageUpdated(
            (int) $fresh->conversation_id,
            $this->payload->message($fresh),
            $this->recipients($conversation),
        ));
    }

    public function messageStatusChanged(Message $message): void
    {
        $fresh = $message->fresh() ?: $message;
        $conversation = $this->conversationFor($fresh);
        $this->dispatch(new MessageStatusChanged(
            (int) $fresh->conversation_id,
            $this->payload->message($fresh),
            $this->recipients($conversation),
        ));
    }

    public function messageDeleted(Message $message, Conversation $conversation): void
    {
        $this->dispatch(new MessageDeleted(
            (int) $message->conversation_id,
            (int) $message->id,
            $this->payload->conversation($conversation),
            $this->recipients($conversation),
        ));
    }

    public function conversationUpdated(Conversation $conversation, array $extraRecipients = []): void
    {
        $this->dispatch(new ConversationUpdated(
            $this->payload->conversation($conversation),
            $this->recipients($conversation, $extraRecipients),
        ));
    }

    public function conversationDeleted(int $conversationId, array $recipients = []): void
    {
        $this->dispatch(new ConversationDeleted($conversationId, $recipients));
    }

    public function notificationCreated(Notification $notification): void
    {
        $this->dispatch(new NotificationCreated((int) $notification->user_id, [
            'id' => (int) $notification->id,
            'type' => $notification->type,
            'title' => $notification->title,
            'body' => $notification->body,
            'data' => $notification->data,
            'created_at' => $notification->created_at?->toISOString(),
        ]));
    }

    public function conversationActivity(Conversation $conversation, string $kind, string $key, bool $active, ?User $actor = null): void
    {
        if (config('broadcasting.default') === 'null') {
            return;
        }

        try {
            $recipients = array_values(array_filter(
                $this->recipients($conversation),
                fn ($id) => (int) $id !== (int) $actor?->id,
            ));

            if ($recipients) {
                $this->dispatch(new ConversationActivity($recipients, [
                    'conversation_id' => $conversation->id,
                    'kind' => $kind,
                    'key' => $key,
                    'active' => $active,
                    'name' => $actor?->name,
                ]));
            }
        } catch (Throwable $error) {
            Log::warning('realtime.activity_failed', ['error_type' => $error::class]);
        }
    }

    public function recipients(Conversation $conversation, array $extra = []): array
    {
        try {
            $ids = User::query()->where('is_active', true)
                ->where(fn ($query) => $query
                    ->whereHas('assignedRole', fn ($role) => $role->where('slug', 'owner'))
                    ->orWhere(fn ($assigned) => $assigned->whereKey($conversation->assigned_agent_id)
                        ->whereHas('assignedRole', fn ($role) => $role->whereJsonContains('module_access', 'inbox'))))
                ->pluck('id')
                ->all();

            foreach ($extra as $id) {
                if ($id !== null) {
                    $ids[] = (int) $id;
                }
            }

            return array_values(array_unique(array_map(fn ($id) => (int) $id, $ids)));
        } catch (Throwable $error) {
            Log::warning('realtime.recipients_failed', ['error_type' => $error::class]);

            return [];
        }
    }

    private function conversationFor(Message $message): Conversation
    {
        return $message->conversation ?: $message->conversation()->firstOrFail();
    }

    private function dispatch(ShouldBroadcastNow $event): void
    {
        try {
            event($event);
        } catch (Throwable $error) {
            Log::warning('realtime.broadcast_failed', [
                'event' => $event::class,
                'message' => $error->getMessage(),
            ]);
        }
    }
}
