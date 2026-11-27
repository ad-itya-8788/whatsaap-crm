<?php

namespace App\Auth;

use App\Http\Controllers\Api;

class PermissionRegistry
{
    // Controller actions, minimum legacy role and prerequisites are defined together.
    private const ACTIONS = [
        Api\RealtimeSyncController::class => [
            'index' => ['inbox.view', 'viewer'],
        ],
        Api\MemberPresenceController::class => [
            'index' => ['presence.view', 'viewer'],
            'update' => ['presence.update', 'viewer'],
        ],
        Api\ContactController::class => [
            'index' => ['contacts.view', 'viewer'],
            'show' => ['contacts.details', 'viewer'],
            'store' => ['contacts.create', 'agent'],
            'update' => ['contacts.update', 'agent'],
            'destroy' => ['contacts.delete', 'agent'],
            'notes' => ['contact_notes.view', 'viewer'],
            'storeNote' => ['contact_notes.create', 'agent'],
            'destroyNote' => ['contact_notes.delete', 'agent'],
            'syncTags' => ['contacts.tags', 'agent'],
            'export' => ['contacts.export', 'viewer'],
            'import' => ['contacts.import', 'agent'],
        ],
        Api\SettingsController::class => [
            'updateProfile' => ['account.profile', 'viewer'],
            'updatePassword' => ['account.password', 'viewer'],
            'sessions' => ['account.sessions', 'viewer'],
            'destroySessions' => ['account.revoke_sessions', 'viewer'],
            'inboxSettings' => ['inbox_settings.view', 'viewer'],
            'updateInboxSettings' => ['inbox_settings.update', 'admin'],
        ],
        Api\TagController::class => [
            'index' => ['tags.view', 'viewer'],
            'store' => ['tags.create', 'admin'],
            'update' => ['tags.update', 'admin'],
            'destroy' => ['tags.delete', 'admin'],
        ],
        Api\CustomFieldController::class => [
            'index' => ['custom_fields.view', 'viewer'],
            'store' => ['custom_fields.create', 'admin'],
            'update' => ['custom_fields.update', 'admin'],
            'destroy' => ['custom_fields.delete', 'admin'],
        ],
        Api\ConversationController::class => [
            'index' => ['inbox.view', 'viewer'],
            'unreadCount' => ['inbox.view', 'viewer'],
            'show' => ['inbox.view', 'viewer'],
            'start' => ['conversations.start', 'agent'],
            'destroy' => ['conversations.delete', 'admin'],
            'markRead' => ['conversations.mark_read', 'agent'],
            'assign' => ['conversations.assign', 'agent'],
            'updateStatus' => ['conversations.status', 'agent'],
            'agents' => ['presence.assignment_candidates', 'viewer'],
        ],
        Api\ConversationNoteController::class => [
            'index' => ['conversation_notes.view', 'viewer'],
            'store' => ['conversation_notes.create', 'agent'],
            'destroy' => ['conversation_notes.delete', 'agent'],
        ],
        Api\MessageController::class => [
            'index' => ['messages.read', 'viewer'],
            'store' => ['messages.send', 'agent'],
            'destroy' => ['messages.delete', 'admin'],
            'media' => ['messages.download', 'viewer'],
            'react' => ['messages.react', 'agent'],
        ],
        Api\QuickReplyController::class => [
            'index' => ['quick_replies.view', 'viewer'],
            'store' => ['quick_replies.create', 'agent'],
            'update' => ['quick_replies.update', 'agent'],
            'destroy' => ['quick_replies.delete', 'agent'],
        ],
        Api\NotificationController::class => [
            'index' => ['notifications.view', 'viewer'],
            'unreadCount' => ['notifications.view', 'viewer'],
            'browserEvents' => ['notifications.browser', 'viewer'],
            'markAllRead' => ['notifications.mark_read', 'viewer'],
            'markRead' => ['notifications.mark_read', 'viewer'],
        ],
        Api\AiController::class => [
            'config' => ['ai.view', 'viewer'],
            'playground' => ['ai.playground', 'agent'],
            'draft' => ['messages.ai_draft', 'agent'],
            'knowledge' => ['ai.knowledge', 'viewer'],
            'saveConfig' => ['ai.configure', 'owner'],
            'deleteConfig' => ['ai.disconnect', 'owner'],
            'testConfig' => ['ai.test', 'owner'],
            'usage' => ['ai.usage', 'admin'],
            'storeKnowledge' => ['ai.knowledge_create', 'admin'],
            'updateKnowledge' => ['ai.knowledge_update', 'admin'],
            'deleteKnowledge' => ['ai.knowledge_delete', 'admin'],
            'reindexKnowledge' => ['ai.knowledge_reindex', 'admin'],
            'updateAutoreply' => ['conversations.ai', 'agent'],
        ],
        Api\ApiKeyController::class => [
            'index' => ['api_keys.view', 'admin'],
            'store' => ['api_keys.create', 'owner'],
            'destroy' => ['api_keys.delete', 'owner'],
        ],
        Api\BroadcastController::class => [
            'index' => ['broadcasts.view', 'viewer'],
            'options' => ['broadcasts.options', 'viewer'],
            'preview' => ['broadcasts.preview', 'agent'],
            'store' => ['broadcasts.create', 'agent'],
            'show' => ['broadcasts.recipients', 'viewer'],
            'export' => ['broadcasts.export', 'viewer'],
            'send' => ['broadcasts.send', 'agent'],
            'resume' => ['broadcasts.resume', 'agent'],
            'retryPending' => ['broadcasts.retry', 'agent'],
            'destroy' => ['broadcasts.delete', 'admin'],
        ],
        Api\DashboardController::class => [
            'overview' => ['dashboard.view', 'viewer'],
            'activity' => ['dashboard.activity', 'viewer'],
            'campaigns' => ['dashboard.campaigns', 'viewer'],
            'hourlyVolume' => ['dashboard.hourly', 'viewer'],
        ],
        Api\ReportController::class => [
            'overview' => ['reports.view', 'viewer'],
            'agents' => ['reports.agents', 'viewer'],
            'trend' => ['reports.trend', 'viewer'],
        ],
        Api\WhatsappController::class => [
            'getConfig' => ['whatsapp.view', 'viewer'],
            'verifyRegistration' => ['whatsapp.verify', 'admin'],
            'health' => ['whatsapp.health', 'viewer'],
            'saveConfig' => ['whatsapp.configure', 'owner'],
            'updateMirrorMedia' => ['whatsapp.mirror', 'admin'],
            'disconnect' => ['whatsapp.disconnect', 'admin'],
        ],
        Api\TemplateController::class => [
            'index' => ['templates.view', 'viewer'],
            'send' => ['messages.send_templates', 'agent'],
            'sync' => ['templates.sync', 'admin'],
            'uploadMedia' => ['templates.upload', 'admin'],
            'store' => ['templates.create', 'admin'],
            'update' => ['templates.update', 'admin'],
            'destroy' => ['templates.delete', 'admin'],
            'submit' => ['templates.submit', 'admin'],
        ],
        Api\UserController::class => [
            'index' => ['users.view', 'admin'],
            'store' => ['users.create', 'owner'],
            'update' => ['users.update', 'owner'],
            'transferOwnership' => ['users.transfer', 'owner'],
            'roles' => ['users.view', 'admin'],
        ],
        Api\InvitationController::class => [
            'index' => ['invitations.view', 'admin'],
            'store' => ['invitations.create', 'owner'],
            'destroy' => ['invitations.delete', 'owner'],
        ],
        Api\AuthorizationController::class => [
            'index' => ['roles.manage', 'owner'],
            'saveRole' => ['roles.manage', 'owner'],
            'deleteRole' => ['roles.manage', 'owner'],
            'member' => ['permissions.manage', 'owner'],
            'saveMember' => ['permissions.manage', 'owner'],
            'audit' => ['audit.view', 'owner'],
        ],
    ];

    private const EXTRA = [
        'conversations.view_all' => 'viewer',
        'conversations.view_assigned' => 'none',
        'conversations.view_unassigned' => 'none',
        'conversations.view_others' => 'none',
        'presence.assignable' => 'agent',
        'conversations.filter_unread' => 'viewer',
        'conversations.filter_waiting' => 'viewer',
        'conversations.filter_unassigned' => 'viewer',
        'conversations.filter_expiring' => 'viewer',
        'conversations.filter_open' => 'viewer',
        'conversations.filter_pending' => 'viewer',
        'conversations.filter_closed' => 'viewer',
        'messages.send_media' => 'agent',
        'messages.send_image' => 'agent',
        'messages.send_video' => 'agent',
        'messages.send_audio' => 'agent',
        'messages.send_document' => 'agent',
        'messages.reply' => 'agent',
        'messages.send_interactive' => 'agent',
        'conversations.close' => 'agent',
        'conversations.reopen' => 'agent',
        'conversation_notes.delete_others' => 'admin',
        'quick_replies.manage_global' => 'admin',
        'contacts.custom_values' => 'agent',
        'users.activate' => 'owner',
        'users.assign_role' => 'owner',
        'broadcasts.schedule' => 'agent',
    ];

    private const PARENTS = [
        'contacts' => 'contacts.view', 'contact_notes' => 'contacts.details',
        'tags' => 'tags.view', 'custom_fields' => 'custom_fields.view',
        'conversations' => 'inbox.view', 'conversation_notes' => 'inbox.view',
        'messages' => 'inbox.view', 'quick_replies' => 'quick_replies.view',
        'notifications' => 'notifications.view', 'ai' => 'ai.view',
        'api_keys' => 'api_keys.view', 'broadcasts' => 'broadcasts.view',
        'dashboard' => 'dashboard.view', 'reports' => 'reports.view',
        'whatsapp' => 'whatsapp.view', 'templates' => 'templates.view',
        'users' => 'users.view', 'invitations' => 'invitations.view',
        'inbox_settings' => 'inbox_settings.view',
    ];

    private const REQUIRES = [
        'messages.send' => ['messages.read'],
        'presence.assignable' => ['inbox.view'],
        'messages.send_media' => ['messages.send'],
        'messages.send_image' => ['messages.send_media'],
        'messages.send_video' => ['messages.send_media'],
        'messages.send_audio' => ['messages.send_media'],
        'messages.send_document' => ['messages.send_media'],
        'messages.send_interactive' => ['messages.send'],
        'messages.reply' => ['messages.send'],
        'messages.send_templates' => ['templates.view', 'messages.send', 'contacts.view'],
        'messages.download' => ['messages.read'],
        'messages.delete' => ['messages.read'],
        'messages.react' => ['messages.read'],
        'messages.ai_draft' => ['messages.send'],
        'notifications.browser' => ['messages.read'],
        'conversations.start' => ['contacts.view'],
        'conversations.assign' => ['presence.assignment_candidates'],
        'conversations.ai' => ['ai.view'],
        'invitations.view' => ['users.view'],
        'broadcasts.create' => ['broadcasts.options'],
        'conversations.close' => ['conversations.status'],
        'conversations.reopen' => ['conversations.status'],
        'conversation_notes.delete_others' => ['conversation_notes.delete'],
        'broadcasts.schedule' => ['broadcasts.create', 'broadcasts.send'],
        'contacts.import' => ['contacts.create', 'contacts.update'],
        'contacts.tags' => ['tags.view'],
        'contacts.custom_values' => ['custom_fields.view'],
        'broadcasts.recipients' => ['contacts.view'],
        'broadcasts.send' => ['contacts.view', 'templates.view'],
        'broadcasts.resume' => ['contacts.view', 'templates.view'],
        'broadcasts.retry' => ['contacts.view', 'templates.view'],
        'broadcasts.options' => ['contacts.view', 'templates.view'],
        'broadcasts.preview' => ['contacts.view', 'templates.view'],
        'broadcasts.export' => ['broadcasts.recipients'],
        'dashboard.activity' => ['conversations.view_all', 'messages.read'],
        'dashboard.hourly' => ['conversations.view_all', 'messages.read'],
        'dashboard.view' => ['conversations.view_all', 'messages.read'],
        'dashboard.campaigns' => ['broadcasts.view'],
        'reports.view' => ['conversations.view_all', 'messages.read'],
    ];

    private const DESCRIPTIONS = [
        'conversations.view_all' => 'Read conversations regardless of assignment.',
        'conversations.view_assigned' => 'Read conversations assigned to this member.',
        'conversations.view_unassigned' => 'Read conversations with no assigned member.',
        'conversations.view_others' => 'Read conversations assigned to other members.',
        'presence.assignable' => 'Appear as a candidate for conversation assignment and AI handoff.',
        'contacts.export' => 'Download the workspace contact directory as CSV.',
        'broadcasts.schedule' => 'Schedule a template campaign for delivery by the queue.',
        'messages.download' => 'Open or download message attachments in accessible conversations.',
        'quick_replies.manage_global' => 'Create or maintain replies shared with the workspace.',
        'roles.manage' => 'Create and configure roles or remove unused custom roles.',
        'permissions.manage' => 'Review and override inherited permissions for an individual member.',
    ];

    public static function forAction(string $action): ?string
    {
        [$controller, $method] = array_pad(explode('@', $action, 2), 2, null);

        return self::ACTIONS[$controller][$method][0] ?? null;
    }

    public static function all(): array
    {
        static $registry = null;
        if ($registry !== null) {
            return $registry;
        }

        $keys = self::EXTRA;
        foreach (self::ACTIONS as $entries) {
            foreach ($entries as [$key, $minimum]) {
                $keys[$key] = $minimum;
            }
        }

        ksort($keys);
        $registry = [];
        foreach ($keys as $key => $minimum) {
            [$module, $action] = explode('.', $key);
            $parent = self::PARENTS[$module] ?? null;
            $label = ucfirst(str_replace('_', ' ', $action));
            $group = ucfirst(str_replace('_', ' ', $module));
            $registry[$key] = [
                'key' => $key,
                'label' => $label,
                'module' => $group,
                'description' => self::DESCRIPTIONS[$key] ?? "$label in $group.",
                'dependencies' => array_values(array_filter([$parent !== $key ? $parent : null, ...(self::REQUIRES[$key] ?? [])])),
                'owner_only' => $minimum === 'owner',
                'minimum' => $minimum,
            ];
        }

        return $registry;
    }

    public static function defaults(string $role): array
    {
        $levels = match ($role) {
            'admin' => ['viewer', 'agent', 'admin'],
            'agent' => ['viewer', 'agent'],
            'viewer' => ['viewer'],
            default => [],
        };

        return array_keys(array_filter(self::all(), fn ($permission) => in_array($permission['minimum'], $levels, true)
            && ($role !== 'viewer' || ! in_array($permission['key'], ['contacts.export', 'broadcasts.export'], true))));
    }
}
