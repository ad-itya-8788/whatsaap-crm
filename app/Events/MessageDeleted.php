<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class MessageDeleted implements ShouldBroadcastNow
{
    public function __construct(
        public int $conversationId,
        public int $message_id,
        public array $conversation,
        public array $recipients = [],
    ) {}

    public function broadcastOn(): array
    {
        return array_map(fn ($id) => new PrivateChannel("inbox-activity.{$id}"), $this->recipients);
    }

    public function broadcastWith(): array
    {
        return [];
    }

    public function broadcastAs(): string
    {
        return 'message.deleted';
    }
}
