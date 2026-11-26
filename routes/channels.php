<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('account.{accountId}', function ($user, $accountId) {
    return $user->is_active && (string) $accountId === 'default';
});
