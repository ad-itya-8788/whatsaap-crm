<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('account.{accountId}', function ($user, $accountId) {
    return $user->is_active && ($accountId === 'authorization'
        || ($accountId === 'default' && app(\App\Auth\Access::class)->can($user, 'inbox.view')));
});
