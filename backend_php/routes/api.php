<?php

use App\Http\Controllers\Api\AiController;
use App\Http\Controllers\Api\AutomationController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BroadcastController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\ConversationNoteController;
use App\Http\Controllers\Api\CustomFieldController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\FlowController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\QuickReplyController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\TagController;
use App\Http\Controllers\Api\TemplateController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\WhatsappController;
use App\Http\Controllers\Api\WhatsappWebhookController;
use Illuminate\Support\Facades\Route;

Route::get('/whatsapp/webhook', [WhatsappWebhookController::class, 'verify']);
Route::post('/whatsapp/webhook', [WhatsappWebhookController::class, 'handle'])->middleware('throttle:webhook');

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:password-reset');
Route::post('/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:password-reset');

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
        Route::post('/conversations/start', [ConversationController::class, 'start'])->middleware('throttle:send');
        Route::get('/conversations/{conversation}', [ConversationController::class, 'show']);
        Route::post('/conversations/{conversation}/read', [ConversationController::class, 'markRead']);
        Route::patch('/conversations/{conversation}/assign', [ConversationController::class, 'assign']);
        Route::patch('/conversations/{conversation}/status', [ConversationController::class, 'updateStatus']);
        Route::get('/conversations/{conversation}/notes', [ConversationNoteController::class, 'index']);
        Route::post('/conversations/{conversation}/notes', [ConversationNoteController::class, 'store']);
        Route::delete('/conversations/{conversation}/notes/{note}', [ConversationNoteController::class, 'destroy']);
        Route::get('/conversations/{conversation}/messages', [MessageController::class, 'index']);
        Route::post('/conversations/{conversation}/messages', [MessageController::class, 'store'])->middleware('throttle:send');
        Route::get('/messages/{message}/media', [MessageController::class, 'media']);

        Route::get('/agents', [ConversationController::class, 'agents']);
        Route::get('/quick-replies', [QuickReplyController::class, 'index']);
        Route::post('/quick-replies', [QuickReplyController::class, 'store']);
        Route::patch('/quick-replies/{quick_reply}', [QuickReplyController::class, 'update']);
        Route::delete('/quick-replies/{quick_reply}', [QuickReplyController::class, 'destroy']);

        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount']);
        Route::get('/notifications/browser-events', [NotificationController::class, 'browserEvents']);
        Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
        Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead']);

        Route::get('/ai/config', [AiController::class, 'config']);
        Route::post('/ai/playground', [AiController::class, 'playground'])->middleware('throttle:ai');
        Route::post('/ai/draft', [AiController::class, 'draft'])->middleware('throttle:ai');
        Route::get('/ai/knowledge', [AiController::class, 'knowledge']);

        Route::middleware('role:admin,owner')->group(function () {
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
        Route::post('/broadcasts/preview', [BroadcastController::class, 'preview']);
        Route::get('/broadcasts', [BroadcastController::class, 'index']);
        Route::post('/broadcasts', [BroadcastController::class, 'store'])->middleware('throttle:send');
        Route::get('/broadcasts/{broadcast}', [BroadcastController::class, 'show']);
        Route::get('/broadcasts/{broadcast}/export', [BroadcastController::class, 'export']);
        Route::post('/broadcasts/{broadcast}/send', [BroadcastController::class, 'send'])->middleware('throttle:send');
        Route::post('/broadcasts/{broadcast}/resume', [BroadcastController::class, 'resume'])->middleware('throttle:send');
        Route::post('/broadcasts/{broadcast}/retry-pending', [BroadcastController::class, 'retryPending'])->middleware('throttle:send');
        Route::delete('/broadcasts/{broadcast}', [BroadcastController::class, 'destroy'])->middleware('role:admin,owner');

        Route::get('/automations/options', [AutomationController::class, 'options']);
        Route::get('/automations', [AutomationController::class, 'index']);
        Route::get('/automations/{automation}', [AutomationController::class, 'show']);
        Route::get('/automations/{automation}/logs', [AutomationController::class, 'logs']);
        Route::get('/flows/templates', [FlowController::class, 'templates']);
        Route::get('/flows', [FlowController::class, 'index']);
        Route::get('/flows/{flow}', [FlowController::class, 'show']);
        Route::get('/flows/{flow}/runs', [FlowController::class, 'runs']);

        Route::middleware('role:admin,owner')->group(function () {
            Route::post('/automations', [AutomationController::class, 'store']);
            Route::patch('/automations/{automation}', [AutomationController::class, 'update']);
            Route::delete('/automations/{automation}', [AutomationController::class, 'destroy']);
            Route::post('/automations/{automation}/duplicate', [AutomationController::class, 'duplicate']);
            Route::post('/automations/{automation}/test', [AutomationController::class, 'test'])->middleware('throttle:send');

            Route::post('/flows', [FlowController::class, 'store']);
            Route::put('/flows/{flow}', [FlowController::class, 'update']);
            Route::delete('/flows/{flow}', [FlowController::class, 'destroy']);
            Route::post('/flows/{flow}/activate', [FlowController::class, 'activate']);
        });

        Route::prefix('dashboard')->group(function () {
            Route::get('/overview', [DashboardController::class, 'overview']);
            Route::get('/attention', [DashboardController::class, 'attention']);
            Route::get('/activity', [DashboardController::class, 'activity']);
            Route::get('/campaigns', [DashboardController::class, 'campaigns']);
            Route::get('/team', [DashboardController::class, 'team']);
            Route::get('/setup', [DashboardController::class, 'setup']);
            Route::get('/volume', [DashboardController::class, 'volume']);
        });

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
            Route::post('/whatsapp/templates/{message_template}/send', [TemplateController::class, 'send'])->middleware('throttle:send');
        });
    });
});
