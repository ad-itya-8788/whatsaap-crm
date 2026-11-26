<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiConfig extends Model
{
    protected $fillable = [
        'updated_by',
        'provider',
        'model',
        'base_url',
        'api_key',
        'embeddings_api_key',
        'system_prompt',
        'is_active',
        'auto_reply_enabled',
        'auto_reply_max_per_conversation',
        'handoff_agent_id',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'auto_reply_enabled' => 'boolean',
        'auto_reply_max_per_conversation' => 'integer',
    ];

    protected $hidden = ['api_key', 'embeddings_api_key'];

    public function editor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
