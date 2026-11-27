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
use App\Http\Controllers\Api\RealtimeSyncController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\RoleController;
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
        Route::get('/realtime/sync', [RealtimeSyncController::class, 'index'])->middleware('module:inbox');
        Route::get('/presence', [MemberPresenceController::class, 'index'])->middleware('module:inbox,team');
        Route::put('/presence', [MemberPresenceController::class, 'update'])->middleware('throttle:15,1')->middleware('module:inbox,team');
        Route::get('/contacts/export', [ContactController::class, 'export'])->middleware('module:contacts');
        Route::post('/contacts/import', [ContactController::class, 'import'])->middleware('module:contacts');
        Route::post('/profile', [SettingsController::class, 'updateProfile'])->middleware('module:settings');
        Route::post('/password', [SettingsController::class, 'updatePassword'])->middleware('module:settings');
        Route::get('/sessions', [SettingsController::class, 'sessions'])->middleware('module:settings');
        Route::delete('/sessions', [SettingsController::class, 'destroySessions'])->middleware('module:settings');
        Route::get('/inbox-settings', [SettingsController::class, 'inboxSettings'])->middleware('module:settings,inbox');
        Route::patch('/inbox-settings', [SettingsController::class, 'updateInboxSettings'])->middleware('module:settings');

        Route::apiResource('contacts', ContactController::class)->middleware('module:contacts')->only(['index', 'show']);
        Route::apiResource('contacts', ContactController::class)->middleware('module:contacts')
            ->only(['store', 'update', 'destroy']);
        Route::get('/contacts/{contact}/notes', [ContactController::class, 'notes'])->middleware('module:contacts');
        Route::post('/contacts/{contact}/notes', [ContactController::class, 'storeNote'])->middleware('module:contacts');
        Route::delete('/contacts/{contact}/notes/{note}', [ContactController::class, 'destroyNote'])->middleware('module:contacts');
        Route::put('/contacts/{contact}/tags', [ContactController::class, 'syncTags'])->middleware('module:contacts');

        Route::put('/conversations/{conversation}/tags', [ContactController::class, 'syncConversationTags'])->middleware(['module:inbox', 'conversation.access']);
        Route::get('/whatsapp/status', [WhatsappController::class, 'status'])->middleware('module:dashboard,settings');
        Route::get('/tags', [TagController::class, 'index'])->middleware('module:workspace,inbox,contacts');
        Route::apiResource('tags', TagController::class)->middleware('module:workspace')
            ->only(['store', 'update', 'destroy']);

        Route::get('/custom-fields', [CustomFieldController::class, 'index'])->middleware('module:workspace,contacts');

        Route::get('/conversations', [ConversationController::class, 'index'])->middleware('module:inbox');
        Route::get('/inbox/unread-count', [ConversationController::class, 'unreadCount'])->middleware('module:inbox');
        Route::post('/conversations/start', [ConversationController::class, 'start'])->middleware('throttle:send')->middleware('module:inbox');
        Route::middleware('conversation.access')->group(function () {
            Route::get('/conversations/{conversation}', [ConversationController::class, 'show'])->middleware('module:inbox');
            Route::delete('/conversations/{conversation}', [ConversationController::class, 'destroy'])->middleware('module:inbox');
            Route::post('/conversations/{conversation}/read', [ConversationController::class, 'markRead'])->middleware('module:inbox');
            Route::post('/conversations/{conversation}/ai-autoreply', [AiController::class, 'updateAutoreply'])->middleware(['throttle:send'])->middleware('module:inbox');
            Route::patch('/conversations/{conversation}/assign', [ConversationController::class, 'assign'])->middleware('module:inbox');
            Route::patch('/conversations/{conversation}/status', [ConversationController::class, 'updateStatus'])->middleware('module:inbox');
            Route::get('/conversations/{conversation}/notes', [ConversationNoteController::class, 'index'])->middleware('module:inbox');
            Route::post('/conversations/{conversation}/notes', [ConversationNoteController::class, 'store'])->middleware('module:inbox');
            Route::delete('/conversations/{conversation}/notes/{note}', [ConversationNoteController::class, 'destroy'])->middleware('module:inbox');
            Route::get('/conversations/{conversation}/messages', [MessageController::class, 'index'])->middleware('module:inbox')->middleware('conversation.access');
            Route::post('/conversations/{conversation}/messages', [MessageController::class, 'store'])->middleware('throttle:send')->middleware('module:inbox')->middleware('conversation.access');
        });
        Route::delete('/messages/{message}', [MessageController::class, 'destroy'])->middleware('module:inbox')->middleware('conversation.access');
        Route::get('/messages/{message}/media', [MessageController::class, 'media'])->middleware('module:inbox')->middleware('conversation.access');
        Route::post('/messages/{message}/react', [MessageController::class, 'react'])->middleware('throttle:send')->middleware('module:inbox')->middleware('conversation.access');

        Route::get('/agents', [ConversationController::class, 'agents'])->middleware('module:inbox,ai_agents');
        Route::get('/quick-replies', [QuickReplyController::class, 'index'])->middleware('module:workspace,inbox');
        Route::post('/quick-replies', [QuickReplyController::class, 'store'])->middleware('module:workspace,inbox');
        Route::patch('/quick-replies/{quick_reply}', [QuickReplyController::class, 'update'])->middleware('module:workspace');
        Route::delete('/quick-replies/{quick_reply}', [QuickReplyController::class, 'destroy'])->middleware('module:workspace');

        Route::get('/notifications', [NotificationController::class, 'index'])->middleware('module:notifications');
        Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount'])->middleware('module:notifications');
        Route::get('/notifications/browser-events', [NotificationController::class, 'browserEvents'])->middleware('module:notifications');
        Route::get('/notifications/popup-events', [NotificationController::class, 'popupEvents'])->middleware('module:notifications');
        Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead'])->middleware('module:notifications');
        Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead'])->middleware('module:notifications');

        Route::get('/ai/config', [AiController::class, 'config'])->middleware('module:ai_agents,inbox');
        Route::post('/ai/playground', [AiController::class, 'playground'])->middleware('throttle:ai')->middleware('module:ai_agents');
        Route::post('/ai/draft', [AiController::class, 'draft'])->middleware('throttle:ai')->middleware('module:inbox');
        Route::get('/ai/knowledge', [AiController::class, 'knowledge'])->middleware('module:ai_agents');

        Route::get('/api-keys', [ApiKeyController::class, 'index'])->middleware('module:settings')->middleware('role:owner');
        Route::post('/api-keys', [ApiKeyController::class, 'store'])->middleware('module:settings')->middleware('role:owner');
        Route::delete('/api-keys/{apiKey}', [ApiKeyController::class, 'destroy'])->middleware('module:settings')->middleware('role:owner');
        Route::post('/ai/config', [AiController::class, 'saveConfig'])->middleware('module:ai_agents')->middleware('role:owner');
        Route::delete('/ai/config', [AiController::class, 'deleteConfig'])->middleware('module:ai_agents')->middleware('role:owner');
        Route::post('/ai/test', [AiController::class, 'testConfig'])->middleware('throttle:ai')->middleware('module:ai_agents')->middleware('role:owner');
        Route::get('/ai/usage', [AiController::class, 'usage'])->middleware('module:ai_agents');
        Route::post('/ai/knowledge', [AiController::class, 'storeKnowledge'])->middleware('module:ai_agents');
        Route::patch('/ai/knowledge/{document}', [AiController::class, 'updateKnowledge'])->middleware('module:ai_agents');
        Route::delete('/ai/knowledge/{document}', [AiController::class, 'deleteKnowledge'])->middleware('module:ai_agents');
        Route::post('/ai/knowledge/reindex', [AiController::class, 'reindexKnowledge'])->middleware('module:ai_agents');

        Route::get('/broadcasts/options', [BroadcastController::class, 'options'])->middleware('module:broadcasts');
        Route::post('/broadcasts/preview', [BroadcastController::class, 'preview'])->middleware('module:broadcasts');
        Route::get('/broadcasts', [BroadcastController::class, 'index'])->middleware('module:broadcasts');
        Route::post('/broadcasts', [BroadcastController::class, 'store'])->middleware('throttle:send')->middleware('module:broadcasts');
        Route::get('/broadcasts/{broadcast}', [BroadcastController::class, 'show'])->middleware('module:broadcasts');
        Route::get('/broadcasts/{broadcast}/export', [BroadcastController::class, 'export'])->middleware('module:broadcasts');
        Route::post('/broadcasts/{broadcast}/send', [BroadcastController::class, 'send'])->middleware('throttle:send')->middleware('module:broadcasts');
        Route::post('/broadcasts/{broadcast}/resume', [BroadcastController::class, 'resume'])->middleware('throttle:send')->middleware('module:broadcasts');
        Route::post('/broadcasts/{broadcast}/retry-pending', [BroadcastController::class, 'retryPending'])->middleware('throttle:send')->middleware('module:broadcasts');
        Route::delete('/broadcasts/{broadcast}', [BroadcastController::class, 'destroy'])->middleware('module:broadcasts');

        Route::prefix('dashboard')->group(function () {
            Route::get('/overview', [DashboardController::class, 'overview'])->middleware('module:dashboard');
            Route::get('/activity', [DashboardController::class, 'activity'])->middleware('module:dashboard');
            Route::get('/campaigns', [DashboardController::class, 'campaigns'])->middleware('module:dashboard');
            Route::get('/hourly-volume', [DashboardController::class, 'hourlyVolume'])->middleware('module:dashboard');
        });

        Route::get('/reports/overview', [ReportController::class, 'overview'])->middleware('module:reports');
        Route::get('/reports/agents', [ReportController::class, 'agents'])->middleware('module:reports');
        Route::get('/reports/trend', [ReportController::class, 'trend'])->middleware('module:reports');

        Route::get('/whatsapp/config', [WhatsappController::class, 'getConfig'])->middleware('module:settings');
        Route::get('/whatsapp/config/verify-registration', [WhatsappController::class, 'verifyRegistration'])->middleware('throttle:ai')->middleware('module:settings');
        Route::get('/whatsapp/health', [WhatsappController::class, 'health'])->middleware('module:settings');
        Route::get('/whatsapp/template-contacts', [TemplateController::class, 'contacts'])->middleware('module:templates');
        Route::get('/whatsapp/templates', [TemplateController::class, 'index'])->middleware('module:templates,inbox');
        Route::post('/whatsapp/templates/{message_template}/send', [TemplateController::class, 'send'])->middleware(['throttle:send'])->middleware('module:templates');

        Route::post('/custom-fields', [CustomFieldController::class, 'store'])->middleware('module:workspace');
        Route::patch('/custom-fields/{custom_field}', [CustomFieldController::class, 'update'])->middleware('module:workspace');
        Route::delete('/custom-fields/{custom_field}', [CustomFieldController::class, 'destroy'])->middleware('module:workspace');

        Route::apiResource('roles', RoleController::class)->except('show')->middleware(['module:team', 'role:owner']);
        Route::get('/users', [UserController::class, 'index'])->middleware('module:team');
        Route::post('/users', [UserController::class, 'store'])->middleware('module:team')->middleware('role:owner');
        Route::patch('/users/{user}', [UserController::class, 'update'])->middleware('module:team')->middleware('role:owner');
        Route::post('/users/{user}/transfer-ownership', [UserController::class, 'transferOwnership'])->middleware('module:team')->middleware('role:owner');

        Route::post('/whatsapp/config', [WhatsappController::class, 'saveConfig'])->middleware('module:settings')->middleware('role:owner');
        Route::patch('/whatsapp/config/mirror-media', [WhatsappController::class, 'updateMirrorMedia'])->middleware('module:settings')->middleware('role:owner');
        Route::post('/whatsapp/config/disconnect', [WhatsappController::class, 'disconnect'])->middleware('module:settings')->middleware('role:owner');
        Route::post('/whatsapp/templates/sync', [TemplateController::class, 'sync'])->middleware('module:templates');
        Route::post('/whatsapp/templates/media', [TemplateController::class, 'uploadMedia'])->middleware('module:templates');
        Route::post('/whatsapp/templates', [TemplateController::class, 'store'])->middleware('module:templates');
        Route::patch('/whatsapp/templates/{message_template}', [TemplateController::class, 'update'])->middleware('module:templates');
        Route::delete('/whatsapp/templates/{message_template}', [TemplateController::class, 'destroy'])->middleware('module:templates');
        Route::post('/whatsapp/templates/{message_template}/submit', [TemplateController::class, 'submit'])->middleware('module:templates');

    });
});
