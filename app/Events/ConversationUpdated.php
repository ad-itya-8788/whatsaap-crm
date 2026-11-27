<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class ConversationUpdated implements ShouldBroadcastNow
{
    public function __construct(public array $conversation, public array $recipients = []) {}

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
        return 'conversation.updated';
    }
}
