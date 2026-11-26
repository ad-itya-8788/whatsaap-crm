<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CustomField extends Model
{
    protected $fillable = [
        'name', 'label', 'type', 'options', 'is_active', 'required',
    ];

    protected $casts = [
        'options' => 'array',
        'is_active' => 'boolean',
        'required' => 'boolean',
    ];

    public function contactValues(): HasMany
    {
        return $this->hasMany(ContactCustomValue::class);
    }
}
