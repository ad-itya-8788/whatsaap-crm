<?php

use App\Http\Controllers\Api\PublicApiController;
use App\Http\Controllers\Api\WebhookEndpointController;
use App\Http\Middleware\AuthenticateApiKey;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->controller(PublicApiController::class)->group(function () {
    Route::get('/me', 'me')->middleware(AuthenticateApiKey::class);
    Route::get('/contacts', 'contacts')->middleware(AuthenticateApiKey::class.':contacts:read');
    Route::post('/contacts', 'storeContact')->middleware(AuthenticateApiKey::class.':contacts:write');
    Route::get('/contacts/{contact}', 'showContact')->middleware(AuthenticateApiKey::class.':contacts:read');
    Route::patch('/contacts/{contact}', 'updateContact')->middleware(AuthenticateApiKey::class.':contacts:write');
    Route::get('/conversations', 'conversations')->middleware(AuthenticateApiKey::class.':conversations:read');
    Route::get('/conversations/{conversation}', 'showConversation')->middleware(AuthenticateApiKey::class.':conversations:read');
    Route::get('/conversations/{conversation}/messages', 'messages')->middleware(AuthenticateApiKey::class.':messages:read');
    Route::post('/messages', 'sendMessage')->middleware(AuthenticateApiKey::class.':messages:send');
    Route::post('/broadcasts', 'storeBroadcast')->middleware(AuthenticateApiKey::class.':broadcasts:send');
    Route::get('/broadcasts/{broadcast}', 'showBroadcast')->middleware(AuthenticateApiKey::class.':broadcasts:send');
});

Route::prefix('v1')->middleware(AuthenticateApiKey::class.':webhooks:manage')->group(function () {
    Route::apiResource('webhooks', WebhookEndpointController::class)->parameters(['webhooks' => 'webhookEndpoint']);
});
