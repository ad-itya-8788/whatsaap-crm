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
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('account.default');
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
