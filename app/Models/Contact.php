<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Contact extends Model
{
    protected $fillable = [
        'user_id', 'phone', 'phone_normalized', 'wa_user_id', 'wa_parent_user_id', 'wa_username',
        'name', 'email', 'company', 'avatar_url', 'consent_status', 'consent_at',
    ];

    protected $casts = [
        'consent_at' => 'datetime',
    ];

    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class);
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'contact_tag');
    }

    public function customFieldValues(): HasMany
    {
        return $this->hasMany(ContactCustomValue::class);
    }

    public function consentEvents(): HasMany
    {
        return $this->hasMany(ConsentEvent::class);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(ContactNote::class);
    }
}
