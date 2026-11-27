<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('account.{accountId}', function ($user, $accountId) {
    return $user->hasModuleAccess('inbox') && (string) $accountId === 'default';
});
