<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $attributes = ['is_active' => true];

    protected $fillable = [
        'name',
        'email',
        'password',
        'role_id',
        'avatar_url',
        'is_active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'last_seen_at' => 'datetime',
        ];
    }

    public function assignedRole(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Role::class, 'role_id');
    }

    public function isOwner(): bool
    {
        return $this->assignedRole?->slug === 'owner';
    }

    public function allowedModules(): array
    {
        if (! $this->is_active) {
            return [];
        }

        return $this->isOwner() ? array_keys(Role::MODULES) : ($this->assignedRole?->module_access ?? []);
    }

    public function hasModuleAccess(string $module): bool
    {
        return $this->is_active && ($this->isOwner() || in_array($module, $this->allowedModules(), true));
    }
}
