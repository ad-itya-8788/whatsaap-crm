<?php

namespace App\Support;

use App\Models\User;

class SessionUser
{
    public static function payload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'full_name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'permissions' => app(\App\Auth\Access::class)->effective($user),
            'avatar_url' => $user->avatar_url,
            'email_verified_at' => $user->email_verified_at,
        ];
    }
}
