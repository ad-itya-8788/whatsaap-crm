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
            'role' => $user->isOwner() ? 'owner' : $user->assignedRole?->slug,
            'role_id' => $user->role_id,
            'role_name' => $user->assignedRole?->name ?? ($user->isOwner() ? 'Owner' : null),
            'module_access' => $user->allowedModules(),
            'modules' => \App\Models\Role::MODULES,
            'avatar_url' => $user->avatar_url,
            'email_verified_at' => $user->email_verified_at,
        ];
    }
}
