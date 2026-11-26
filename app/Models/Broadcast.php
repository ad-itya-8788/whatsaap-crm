<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Broadcast extends Model
{
    protected $fillable = [
        'user_id',
        'template_id',
        'name',
        'status',
        'scheduled_at',
        'audience',
        'personalization',
        'total',
        'sent',
        'delivered',
        'read',
        'replied',
        'failed',
    ];

    protected $casts = [
        'scheduled_at' => 'datetime',
        'audience' => 'array',
        'personalization' => 'array',
    ];

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(MessageTemplate::class, 'template_id');
    }

    public function recipients(): HasMany
    {
        return $this->hasMany(BroadcastRecipient::class);
    }
}
