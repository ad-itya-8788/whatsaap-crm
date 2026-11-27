<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Role extends Model
{
    public const MODULES = [
        'dashboard' => ['label' => 'Dashboard', 'path' => '/dashboard'],
        'inbox' => ['label' => 'Inbox', 'path' => '/inbox'],
        'notifications' => ['label' => 'Notifications', 'path' => '/notifications'],
        'contacts' => ['label' => 'Contacts', 'path' => '/contacts'],
        'broadcasts' => ['label' => 'Broadcasts', 'path' => '/broadcasts'],
        'ai_agents' => ['label' => 'AI Agents', 'path' => '/agents'],
        'workspace' => ['label' => 'Tags & fields', 'path' => '/workspace'],
        'templates' => ['label' => 'Message Templates', 'path' => '/templates'],
        'reports' => ['label' => 'Reports', 'path' => '/reports'],
        'team' => ['label' => 'Team', 'path' => '/team'],
        'settings' => ['label' => 'Settings', 'path' => '/settings'],
    ];

    protected $fillable = ['name', 'slug', 'module_access'];

    protected function casts(): array
    {
        return ['module_access' => 'array'];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}
