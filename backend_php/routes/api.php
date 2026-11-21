<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\TemplateController;
use App\Http\Controllers\Api\WhatsappController;
use App\Http\Controllers\Api\WhatsappWebhookController;
use Illuminate\Support\Facades\Route;

Route::get('/whatsapp/webhook', [WhatsappWebhookController::class, 'verify']);
Route::post('/whatsapp/webhook', [WhatsappWebhookController::class, 'handle']);

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);
Route::post('/forgot-password', [AuthController::class, 'forgotPassword']);
Route::post('/reset-password', [AuthController::class, 'resetPassword']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/logout', [AuthController::class, 'logout']);

    Route::prefix('app')->group(function () {
        Route::apiResource('contacts', ContactController::class)->only(['index', 'store', 'show', 'update', 'destroy']);

        Route::get('/conversations', [ConversationController::class, 'index']);
        Route::post('/conversations/start', [ConversationController::class, 'start']);
        Route::get('/conversations/{conversation}', [ConversationController::class, 'show']);
        Route::post('/conversations/{conversation}/read', [ConversationController::class, 'markRead']);
        Route::get('/conversations/{conversation}/messages', [MessageController::class, 'index']);
        Route::post('/conversations/{conversation}/messages', [MessageController::class, 'store']);

        Route::get('/whatsapp/config', [WhatsappController::class, 'getConfig']);
        Route::get('/whatsapp/health', [WhatsappController::class, 'health']);
        Route::get('/whatsapp/templates', [TemplateController::class, 'index']);

        Route::middleware('role:admin,owner')->group(function () {
            Route::post('/whatsapp/config', [WhatsappController::class, 'saveConfig']);
            Route::post('/whatsapp/config/disconnect', [WhatsappController::class, 'disconnect']);
            Route::post('/whatsapp/templates/sync', [TemplateController::class, 'sync']);
            Route::post('/whatsapp/templates', [TemplateController::class, 'store']);
            Route::patch('/whatsapp/templates/{message_template}', [TemplateController::class, 'update']);
            Route::delete('/whatsapp/templates/{message_template}', [TemplateController::class, 'destroy']);
            Route::post('/whatsapp/templates/{message_template}/submit', [TemplateController::class, 'submit']);
            Route::post('/whatsapp/templates/{message_template}/send', [TemplateController::class, 'send']);
        });
    });
});
