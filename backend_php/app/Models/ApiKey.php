<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApiKey extends Model
{
    public const SCOPES = [
        'messages:send', 'messages:read', 'contacts:read', 'contacts:write',
        'conversations:read', 'broadcasts:send', 'webhooks:manage',
    ];

    protected $fillable = ['created_by', 'name', 'key_prefix', 'key_hash', 'scopes', 'expires_at'];

    protected $hidden = ['key_hash'];

    protected $casts = [
        'scopes' => 'array',
        'last_used_at' => 'datetime',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];
}
