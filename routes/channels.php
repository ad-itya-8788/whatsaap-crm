<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('inbox-activity.{userId}', function ($user, $userId) {
    return $user->is_active && $user->hasModuleAccess('inbox') && (string) $user->id === (string) $userId;
});
