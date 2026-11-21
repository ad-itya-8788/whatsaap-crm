<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Message extends Model
{
    protected $hidden = ['idempotency_key', 'idempotency_hash'];

    protected $fillable = [
        'conversation_id', 'sender_type', 'sender_id', 'content_type', 'content_text', 'media_url', 'media_type',
        'filename', 'template_name', 'message_id', 'status', 'reply_to_message_id', 'interactive_reply_id',
        'interactive_payload', 'error_code', 'error_title', 'error_details', 'provider_timestamp', 'meta',
        'idempotency_key', 'idempotency_hash',
    ];

    protected $casts = [
        'interactive_payload' => 'array',
        'meta' => 'array',
        'provider_timestamp' => 'datetime',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reply_to_message_id');
    }
}
