<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class ConversationActivity implements ShouldBroadcastNow
{
    public function __construct(private array $recipients, private array $activity) {}

    public function broadcastOn(): array
    {
        return array_map(fn ($id) => new PrivateChannel("inbox-activity.{$id}"), $this->recipients);
    }

    public function broadcastWith(): array
    {
        return $this->activity;
    }

    public function broadcastAs(): string
    {
        return 'conversation.activity';
    }
}
