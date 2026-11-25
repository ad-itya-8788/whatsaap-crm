<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AutomationPendingExecution extends Model
{
    protected $table = 'automation_pending_executions';

    protected $fillable = [
        'automation_id', 'user_id', 'contact_id', 'conversation_id', 'log_id',
        'parent_step_id', 'branch', 'next_step_position', 'parked_step_id',
        'context', 'status', 'run_at', 'claimed_at',
    ];

    protected $casts = [
        'context' => 'array',
        'next_step_position' => 'integer',
        'run_at' => 'datetime',
        'claimed_at' => 'datetime',
    ];

    public function automation(): BelongsTo
    {
        return $this->belongsTo(Automation::class);
    }

    public function log(): BelongsTo
    {
        return $this->belongsTo(AutomationLog::class, 'log_id');
    }
}
