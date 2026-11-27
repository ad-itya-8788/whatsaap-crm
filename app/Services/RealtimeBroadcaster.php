<?php

namespace App\Services;

use App\Events\ConversationActivity;
use App\Events\ConversationDeleted;
use App\Events\ConversationUpdated;
use App\Events\MessageCreated;
use App\Events\MessageDeleted;
use App\Events\MessageStatusChanged;
use App\Events\MessageUpdated;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Support\Facades\Log;
use Throwable;

class RealtimeBroadcaster
{
    public function __construct(private RealtimePayload $payload) {}

    public function messageCreated(Message $message): void
    {
        $this->dispatch(new MessageCreated(
            (int) $message->conversation_id,
            $this->payload->message($message),
            $this->payload->conversation($this->conversationFor($message)),
        ));
    }

    public function messageUpdated(Message $message): void
    {
        $this->dispatch(new MessageUpdated(
            (int) $message->conversation_id,
            $this->payload->message($message->fresh() ?: $message),
        ));
    }

    public function messageStatusChanged(Message $message): void
    {
        $this->dispatch(new MessageStatusChanged(
            (int) $message->conversation_id,
            $this->payload->message($message->fresh() ?: $message),
        ));
    }

    public function messageDeleted(Message $message, Conversation $conversation): void
    {
        $this->dispatch(new MessageDeleted(
            (int) $message->conversation_id,
            (int) $message->id,
            $this->payload->conversation($conversation),
        ));
    }

    public function conversationUpdated(Conversation $conversation): void
    {
        $this->dispatch(new ConversationUpdated($this->payload->conversation($conversation)));
    }

    public function conversationDeleted(int $conversationId): void
    {
        $this->dispatch(new ConversationDeleted($conversationId));
    }

    public function conversationActivity(Conversation $conversation, string $kind, string $key, bool $active, ?User $actor = null): void
    {
        if (config('broadcasting.default') === 'null') {
            return;
        }

        try {
            $recipients = User::query()->where('is_active', true)
                ->where(fn ($query) => $query
                    ->whereHas('assignedRole', fn ($role) => $role->where('slug', 'owner'))
                    ->orWhere(fn ($assigned) => $assigned->whereKey($conversation->assigned_agent_id)
                        ->whereHas('assignedRole', fn ($role) => $role->whereJsonContains('module_access', 'inbox'))))
                ->pluck('id')->reject(fn ($id) => (int) $id === (int) $actor?->id)->values()->all();

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
