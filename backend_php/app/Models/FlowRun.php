<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FlowRun extends Model
{
    protected $fillable = [
        'flow_id', 'user_id', 'contact_id', 'conversation_id', 'status',
        'current_node_key', 'last_prompt_message_id', 'vars', 'reprompt_count',
        'transition_seq', 'started_at', 'last_advanced_at', 'ended_at', 'end_reason',
    ];

    protected $casts = [
        'vars' => 'array',
        'reprompt_count' => 'integer',
        'transition_seq' => 'integer',
        'started_at' => 'datetime',
        'last_advanced_at' => 'datetime',
        'ended_at' => 'datetime',
    ];

    public function flow(): BelongsTo
    {
        return $this->belongsTo(Flow::class);
    }

    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class);
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(FlowRunEvent::class)->latest();
    }
}
