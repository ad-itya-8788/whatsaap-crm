<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class MessageUpdated implements ShouldBroadcastNow
{
    public function __construct(
        public int $conversationId,
        public array $message,
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
        return 'message.updated';
    }
}
