<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AutomationStep extends Model
{
    protected $fillable = ['automation_id', 'parent_step_id', 'branch', 'step_type', 'step_config', 'position'];

    protected $casts = [
        'step_config' => 'array',
        'position' => 'integer',
    ];

    public function automation(): BelongsTo
    {
        return $this->belongsTo(Automation::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_step_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_step_id')->orderBy('position');
    }
}
