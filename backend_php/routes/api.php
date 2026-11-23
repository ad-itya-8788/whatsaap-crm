<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\ConversationNoteController;
use App\Http\Controllers\Api\CustomFieldController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\QuickReplyController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\TagController;
use App\Http\Controllers\Api\TemplateController;
use App\Http\Controllers\Api\UserController;
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
        Route::get('/contacts/export', [ContactController::class, 'export']);
        Route::post('/contacts/import', [ContactController::class, 'import']);
        Route::apiResource('contacts', ContactController::class)->only(['index', 'store', 'show', 'update', 'destroy']);
        Route::put('/contacts/{contact}/tags', [ContactController::class, 'syncTags']);
        Route::post('/contacts/{contact}/consent', [ContactController::class, 'consent']);
        Route::get('/contacts/{contact}/consent', [ContactController::class, 'consentEvents']);

        Route::apiResource('tags', TagController::class)->only(['index', 'store', 'update', 'destroy']);

        Route::get('/custom-fields', [CustomFieldController::class, 'index']);

        Route::get('/conversations', [ConversationController::class, 'index']);
        Route::post('/conversations/start', [ConversationController::class, 'start']);
        Route::get('/conversations/{conversation}', [ConversationController::class, 'show']);
        Route::post('/conversations/{conversation}/read', [ConversationController::class, 'markRead']);
        Route::patch('/conversations/{conversation}/assign', [ConversationController::class, 'assign']);
        Route::patch('/conversations/{conversation}/status', [ConversationController::class, 'updateStatus']);
        Route::get('/conversations/{conversation}/notes', [ConversationNoteController::class, 'index']);
        Route::post('/conversations/{conversation}/notes', [ConversationNoteController::class, 'store']);
        Route::delete('/conversations/{conversation}/notes/{note}', [ConversationNoteController::class, 'destroy']);
        Route::get('/conversations/{conversation}/messages', [MessageController::class, 'index']);
        Route::post('/conversations/{conversation}/messages', [MessageController::class, 'store']);
        Route::get('/messages/{message}/media', [MessageController::class, 'media']);

        Route::get('/agents', [ConversationController::class, 'agents']);
        Route::get('/quick-replies', [QuickReplyController::class, 'index']);
        Route::post('/quick-replies', [QuickReplyController::class, 'store']);
        Route::patch('/quick-replies/{quick_reply}', [QuickReplyController::class, 'update']);
        Route::delete('/quick-replies/{quick_reply}', [QuickReplyController::class, 'destroy']);

        Route::get('/reports/overview', [ReportController::class, 'overview']);
        Route::get('/reports/agents', [ReportController::class, 'agents']);
        Route::get('/reports/trend', [ReportController::class, 'trend']);

        Route::get('/whatsapp/config', [WhatsappController::class, 'getConfig']);
        Route::get('/whatsapp/health', [WhatsappController::class, 'health']);
        Route::get('/whatsapp/templates', [TemplateController::class, 'index']);

        Route::middleware('role:admin,owner')->group(function () {
            Route::post('/custom-fields', [CustomFieldController::class, 'store']);
            Route::patch('/custom-fields/{custom_field}', [CustomFieldController::class, 'update']);
            Route::delete('/custom-fields/{custom_field}', [CustomFieldController::class, 'destroy']);

            Route::get('/users', [UserController::class, 'index']);
            Route::post('/users', [UserController::class, 'store']);
            Route::patch('/users/{user}', [UserController::class, 'update']);

            Route::post('/whatsapp/config', [WhatsappController::class, 'saveConfig']);
            Route::post('/whatsapp/config/disconnect', [WhatsappController::class, 'disconnect']);
            Route::post('/whatsapp/templates/sync', [TemplateController::class, 'sync']);
            Route::post('/whatsapp/templates/media', [TemplateController::class, 'uploadMedia']);
            Route::post('/whatsapp/templates', [TemplateController::class, 'store']);
            Route::patch('/whatsapp/templates/{message_template}', [TemplateController::class, 'update']);
            Route::delete('/whatsapp/templates/{message_template}', [TemplateController::class, 'destroy']);
            Route::post('/whatsapp/templates/{message_template}/submit', [TemplateController::class, 'submit']);
            Route::post('/whatsapp/templates/{message_template}/send', [TemplateController::class, 'send']);
        });
    });
});
