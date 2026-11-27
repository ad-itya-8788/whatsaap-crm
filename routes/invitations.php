<?php

use App\Http\Controllers\Api\InvitationController;
use Illuminate\Support\Facades\Route;

Route::prefix('invitations/{token}')->where(['token' => '[A-Za-z0-9_-]{43}'])
    ->middleware('throttle:10,1,invitations')->group(function () {
        Route::get('/peek', [InvitationController::class, 'peek']);
        Route::post('/redeem', [InvitationController::class, 'redeem']);
    });

Route::prefix('app/invitations')->middleware(['auth:sanctum', 'active', 'module:team', 'role:owner'])->group(function () {
    Route::get('/', [InvitationController::class, 'index']);
    Route::post('/', [InvitationController::class, 'store']);
    Route::delete('/{invitation}', [InvitationController::class, 'destroy']);
});
