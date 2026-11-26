<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WebhookEndpoint extends Model
{
    public const EVENTS = ['message.received', 'message.status_updated', 'conversation.created'];

    protected $fillable = ['created_by', 'url', 'secret', 'events', 'is_active'];

    protected $hidden = ['secret'];

    protected $casts = [
        'secret' => 'encrypted',
        'events' => 'array',
        'is_active' => 'boolean',
        'last_delivery_at' => 'datetime',
    ];
}
