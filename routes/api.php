<?php

use App\Http\Controllers\Api\AiController;
use App\Http\Controllers\Api\ApiKeyController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BroadcastController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\ConversationNoteController;
use App\Http\Controllers\Api\CustomFieldController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\MemberPresenceController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\QuickReplyController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\TagController;
use App\Http\Controllers\Api\TemplateController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\WhatsappController;
use App\Http\Controllers\Api\WhatsappWebhookController;
use Illuminate\Support\Facades\Route;

require __DIR__.'/public_api.php';
require __DIR__.'/invitations.php';

Route::get('/whatsapp/webhook', [WhatsappWebhookController::class, 'verify']);
Route::post('/whatsapp/webhook', [WhatsappWebhookController::class, 'handle'])->middleware('throttle:webhook');

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:password-reset');
Route::post('/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:password-reset');

Route::middleware(['auth:sanctum', 'active'])->group(function () {
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/logout', [AuthController::class, 'logout']);

    Route::prefix('app')->group(function () {
        Route::get('/presence', [MemberPresenceController::class, 'index']);
        Route::put('/presence', [MemberPresenceController::class, 'update'])->middleware('throttle:15,1');
        Route::get('/contacts/export', [ContactController::class, 'export']);
        Route::post('/contacts/import', [ContactController::class, 'import'])->middleware('role:agent,admin,owner');
        Route::post('/profile', [SettingsController::class, 'updateProfile']);
        Route::post('/password', [SettingsController::class, 'updatePassword']);
        Route::get('/sessions', [SettingsController::class, 'sessions']);
        Route::delete('/sessions', [SettingsController::class, 'destroySessions']);
        Route::get('/inbox-settings', [SettingsController::class, 'inboxSettings']);
        Route::patch('/inbox-settings', [SettingsController::class, 'updateInboxSettings'])->middleware('role:admin,owner');

        Route::apiResource('contacts', ContactController::class)->only(['index', 'show']);
        Route::apiResource('contacts', ContactController::class)
            ->only(['store', 'update', 'destroy'])->middleware('role:agent,admin,owner');
        Route::get('/contacts/{contact}/notes', [ContactController::class, 'notes']);
        Route::post('/contacts/{contact}/notes', [ContactController::class, 'storeNote'])->middleware('role:agent,admin,owner');
        Route::delete('/contacts/{contact}/notes/{note}', [ContactController::class, 'destroyNote'])->middleware('role:agent,admin,owner');
        Route::put('/contacts/{contact}/tags', [ContactController::class, 'syncTags'])->middleware('role:agent,admin,owner');

        Route::get('/tags', [TagController::class, 'index']);
        Route::apiResource('tags', TagController::class)
            ->only(['store', 'update', 'destroy'])->middleware('role:admin,owner');

        Route::get('/custom-fields', [CustomFieldController::class, 'index']);

        Route::get('/conversations', [ConversationController::class, 'index']);
        Route::get('/inbox/unread-count', [ConversationController::class, 'unreadCount']);
        Route::post('/conversations/start', [ConversationController::class, 'start'])->middleware('role:agent,admin,owner')->middleware('throttle:send');
        Route::get('/conversations/{conversation}', [ConversationController::class, 'show']);
        Route::delete('/conversations/{conversation}', [ConversationController::class, 'destroy'])->middleware('role:admin,owner');
        Route::post('/conversations/{conversation}/read', [ConversationController::class, 'markRead'])->middleware('role:agent,admin,owner');
        Route::post('/conversations/{conversation}/ai-autoreply', [AiController::class, 'updateAutoreply'])->middleware(['role:agent,admin,owner', 'throttle:send']);
        Route::patch('/conversations/{conversation}/assign', [ConversationController::class, 'assign'])->middleware('role:agent,admin,owner');
        Route::patch('/conversations/{conversation}/status', [ConversationController::class, 'updateStatus'])->middleware('role:agent,admin,owner');
        Route::get('/conversations/{conversation}/notes', [ConversationNoteController::class, 'index']);
        Route::post('/conversations/{conversation}/notes', [ConversationNoteController::class, 'store'])->middleware('role:agent,admin,owner');
        Route::delete('/conversations/{conversation}/notes/{note}', [ConversationNoteController::class, 'destroy'])->middleware('role:agent,admin,owner');
        Route::get('/conversations/{conversation}/messages', [MessageController::class, 'index']);
        Route::post('/conversations/{conversation}/messages', [MessageController::class, 'store'])->middleware('role:agent,admin,owner')->middleware('throttle:send');
        Route::delete('/messages/{message}', [MessageController::class, 'destroy'])->middleware('role:admin,owner');
        Route::get('/messages/{message}/media', [MessageController::class, 'media']);
        Route::post('/messages/{message}/react', [MessageController::class, 'react'])->middleware('role:agent,admin,owner')->middleware('throttle:send');

        Route::get('/agents', [ConversationController::class, 'agents']);
        Route::get('/quick-replies', [QuickReplyController::class, 'index']);
        Route::post('/quick-replies', [QuickReplyController::class, 'store'])->middleware('role:agent,admin,owner');
        Route::patch('/quick-replies/{quick_reply}', [QuickReplyController::class, 'update'])->middleware('role:agent,admin,owner');
        Route::delete('/quick-replies/{quick_reply}', [QuickReplyController::class, 'destroy'])->middleware('role:agent,admin,owner');

        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount']);
        Route::get('/notifications/browser-events', [NotificationController::class, 'browserEvents']);
        Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
        Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead']);

        Route::get('/ai/config', [AiController::class, 'config']);
        Route::post('/ai/playground', [AiController::class, 'playground'])->middleware('role:agent,admin,owner')->middleware('throttle:ai');
        Route::post('/ai/draft', [AiController::class, 'draft'])->middleware('role:agent,admin,owner')->middleware('throttle:ai');
        Route::get('/ai/knowledge', [AiController::class, 'knowledge']);

        Route::middleware('role:admin,owner')->group(function () {
            Route::get('/api-keys', [ApiKeyController::class, 'index']);
            Route::post('/api-keys', [ApiKeyController::class, 'store']);
            Route::delete('/api-keys/{apiKey}', [ApiKeyController::class, 'destroy']);
            Route::post('/ai/config', [AiController::class, 'saveConfig']);
            Route::delete('/ai/config', [AiController::class, 'deleteConfig']);
            Route::post('/ai/test', [AiController::class, 'testConfig'])->middleware('throttle:ai');
            Route::get('/ai/usage', [AiController::class, 'usage']);
            Route::post('/ai/knowledge', [AiController::class, 'storeKnowledge']);
            Route::patch('/ai/knowledge/{document}', [AiController::class, 'updateKnowledge']);
            Route::delete('/ai/knowledge/{document}', [AiController::class, 'deleteKnowledge']);
            Route::post('/ai/knowledge/reindex', [AiController::class, 'reindexKnowledge']);
        });

        Route::get('/broadcasts/options', [BroadcastController::class, 'options']);
        Route::post('/broadcasts/preview', [BroadcastController::class, 'preview'])->middleware('role:agent,admin,owner');
        Route::get('/broadcasts', [BroadcastController::class, 'index']);
        Route::post('/broadcasts', [BroadcastController::class, 'store'])->middleware('role:agent,admin,owner')->middleware('throttle:send');
        Route::get('/broadcasts/{broadcast}', [BroadcastController::class, 'show']);
        Route::get('/broadcasts/{broadcast}/export', [BroadcastController::class, 'export']);
        Route::post('/broadcasts/{broadcast}/send', [BroadcastController::class, 'send'])->middleware('role:agent,admin,owner')->middleware('throttle:send');
        Route::post('/broadcasts/{broadcast}/resume', [BroadcastController::class, 'resume'])->middleware('role:agent,admin,owner')->middleware('throttle:send');
        Route::post('/broadcasts/{broadcast}/retry-pending', [BroadcastController::class, 'retryPending'])->middleware('role:agent,admin,owner')->middleware('throttle:send');
        Route::delete('/broadcasts/{broadcast}', [BroadcastController::class, 'destroy'])->middleware('role:admin,owner');

        Route::prefix('dashboard')->group(function () {
            Route::get('/overview', [DashboardController::class, 'overview']);
            Route::get('/activity', [DashboardController::class, 'activity']);
            Route::get('/campaigns', [DashboardController::class, 'campaigns']);
            Route::get('/hourly-volume', [DashboardController::class, 'hourlyVolume']);
        });

        Route::get('/reports/overview', [ReportController::class, 'overview']);
        Route::get('/reports/agents', [ReportController::class, 'agents']);
        Route::get('/reports/trend', [ReportController::class, 'trend']);

        Route::get('/whatsapp/config', [WhatsappController::class, 'getConfig']);
        Route::get('/whatsapp/config/verify-registration', [WhatsappController::class, 'verifyRegistration'])->middleware('throttle:ai');
        Route::get('/whatsapp/health', [WhatsappController::class, 'health']);
        Route::get('/whatsapp/templates', [TemplateController::class, 'index']);
        Route::post('/whatsapp/templates/{message_template}/send', [TemplateController::class, 'send'])->middleware(['role:agent,admin,owner', 'throttle:send']);

        Route::middleware('role:admin,owner')->group(function () {
            Route::post('/custom-fields', [CustomFieldController::class, 'store']);
            Route::patch('/custom-fields/{custom_field}', [CustomFieldController::class, 'update']);
            Route::delete('/custom-fields/{custom_field}', [CustomFieldController::class, 'destroy']);

            Route::get('/users', [UserController::class, 'index']);
            Route::post('/users', [UserController::class, 'store']);
            Route::patch('/users/{user}', [UserController::class, 'update']);
            Route::post('/users/{user}/transfer-ownership', [UserController::class, 'transferOwnership'])->middleware('role:owner');

            Route::post('/whatsapp/config', [WhatsappController::class, 'saveConfig']);
            Route::patch('/whatsapp/config/mirror-media', [WhatsappController::class, 'updateMirrorMedia']);
            Route::post('/whatsapp/config/disconnect', [WhatsappController::class, 'disconnect']);
            Route::post('/whatsapp/templates/sync', [TemplateController::class, 'sync']);
            Route::post('/whatsapp/templates/media', [TemplateController::class, 'uploadMedia']);
            Route::post('/whatsapp/templates', [TemplateController::class, 'store']);
            Route::patch('/whatsapp/templates/{message_template}', [TemplateController::class, 'update']);
            Route::delete('/whatsapp/templates/{message_template}', [TemplateController::class, 'destroy']);
            Route::post('/whatsapp/templates/{message_template}/submit', [TemplateController::class, 'submit']);

        });
    });
});
