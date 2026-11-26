<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Message extends Model
{
    protected $hidden = ['idempotency_hash'];

    protected $fillable = [
        'conversation_id', 'sender_type', 'sender_id', 'content_type', 'content_text', 'media_url', 'media_type',
        'filename', 'template_name', 'message_id', 'status', 'reply_to_message_id', 'interactive_reply_id',
        'interactive_payload', 'error_code', 'error_title', 'error_details', 'provider_timestamp', 'meta',
        'idempotency_key', 'idempotency_hash', 'ai_generated',
    ];

    protected $casts = [
        'interactive_payload' => 'array',
        'meta' => 'array',
        'provider_timestamp' => 'datetime',
        'ai_generated' => 'boolean',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(MessageReaction::class);
    }

    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reply_to_message_id');
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(MessageTemplate::class, 'template_name', 'name');
    }
}
