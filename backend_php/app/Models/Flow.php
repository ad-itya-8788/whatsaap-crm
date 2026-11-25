<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Flow extends Model
{
    protected $fillable = [
        'user_id', 'name', 'description', 'status', 'trigger_type',
        'trigger_config', 'entry_node_id', 'fallback_policy',
    ];

    protected $casts = [
        'trigger_config' => 'array',
        'fallback_policy' => 'array',
        'execution_count' => 'integer',
        'last_executed_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function nodes(): HasMany
    {
        return $this->hasMany(FlowNode::class);
    }

    public function runs(): HasMany
    {
        return $this->hasMany(FlowRun::class)->latest();
    }
}
