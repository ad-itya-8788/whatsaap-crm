<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class QuickReply extends Model
{
    protected $fillable = ['user_id', 'title', 'body', 'is_global', 'kind', 'interactive_payload'];

    protected $casts = [
        'is_global' => 'boolean',
        'interactive_payload' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
