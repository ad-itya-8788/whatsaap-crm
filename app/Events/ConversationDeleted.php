<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class ConversationDeleted implements ShouldBroadcastNow
{
    public function __construct(public int $conversationId) {}

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
        return 'conversation.deleted';
    }
}
