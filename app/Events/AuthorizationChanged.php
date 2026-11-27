<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class AuthorizationChanged implements ShouldBroadcastNow
{
    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('account.authorization');
    }

    public function broadcastAs(): string
    {
        return 'authorization.changed';
    }

    public function broadcastWith(): array
    {
        return [];
    }
}
