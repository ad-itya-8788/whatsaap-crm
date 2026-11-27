<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class NotificationCreated implements ShouldBroadcastNow
{
    public function __construct(public int $userId, public array $notification) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("inbox-activity.{$this->userId}")];
    }

    public function broadcastWith(): array
    {
        return [];
    }

    public function broadcastAs(): string
    {
        return 'notification.created';
    }
}
