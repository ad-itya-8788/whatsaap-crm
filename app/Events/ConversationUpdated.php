<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class ConversationUpdated implements ShouldBroadcastNow
{
    public function __construct(public array $conversation) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('account.default');
    }

    public function broadcastAs(): string
    {
        return 'conversation.updated';
    }
}
