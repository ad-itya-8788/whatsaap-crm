# WhatsApp CRM roles and permissions

The Owner manages access from **Roles & permissions** and from **Team → Manage permissions**. Roles define shared grants. Individual overrides support inherit, allow, and deny. A grant takes effect only when its prerequisites are also granted.

## Existing application and authorization audit

Laravel 11 serves Inertia and React, with Sanctum for signed-in workspace APIs. The CRM uses one shared workspace and one conversation per contact. The legacy role was a string on the user account. Route middleware distinguished Agent, Admin, and Owner for some writes. Other operations, including contact export and several read endpoints, relied on sign-in alone. The frontend used a different mix of role checks and disabled controls. A shared Reverb subscription carried customer data even after successful subscription authorization, and conversation lists, message routes, dashboard data, and realtime sync did not use one conversation scope.

The inventory below covers the signed-in CRM API and the UI entry points that call it. Login, password recovery, invitation redemption, and incoming Meta webhooks retain their existing authentication or verification. The separate `/api/v1` integration API retains scoped API keys. Creating or revoking workspace API keys is an Owner operation. Existing API keys remain service credentials and keep their scopes independently of individual login permissions.

## Resolution and data boundaries

`app/Auth/PermissionRegistry.php` defines the permissions, dependencies, Owner-only actions, and initial role grants. `app/Auth/Access.php` checks activation, applies Owner access, resolves explicit denial and allowance before role grants, and applies dependency checks. Unknown grants have no effect. A signed-in API action without a registered permission is rejected. Register each new action centrally and set its initial role band to `none` unless it intentionally belongs in the installation defaults. Existing roles receive new grants only when the Owner modifies a role or override.

The existing one-role-per-member model and explicit denial fit the CRM directly. The implementation uses Laravel middleware, database constraints, and transactions without an additional package. Using a general-purpose RBAC package would still require a custom denial and dependency resolver, conversation scoping, and a migration from the existing role field.

Conversation scope applies to inbox lists, search, unread counts, direct records, message access, private attachment streams, browser notifications, and realtime recovery. Assigned-only users cannot access workspace-wide dashboard or report aggregates. Contacts and campaigns are workspace resources when their own permissions are granted. A contact deletion also checks the attached conversation because the database cascades the deletion. The public integration API and Meta webhook continue to operate as service principals.

Permissions are memoized per request. Mutations take effect after commit, without a shared authorization cache. Reverb broadcasts an empty permission-change signal and the browser fetches `/api/user`. The browser also checks on focus and every eight seconds. On access changes the app cancels in-flight workspace requests, clears cached WhatsApp configuration and Inertia history, and remounts the guarded application state. Reverb sends no customer payload on the workspace inbox channel. A connected client must obtain conversation data through authenticated HTTP even if its subscription has yet to refresh.

## Initial role behavior

| Role | Initial behavior |
| --- | --- |
| Owner | Every permission for an active Owner. No stored grants or editable overrides are required. |
| Admin | Viewer and Agent permissions plus additional workspace administration, reports, setup tools, and team visibility. |
| Agent | Workspace-wide inbox reading for legacy accounts, messaging and media, conversations, contact operations, campaign operations, and AI drafting. |
| Viewer | Read access by default, including only self-scoped account maintenance, presence updates, and notification read receipts as write exceptions. CSV exports are excluded. |
| Custom | Starts with no grants. Assign explicit permissions and their prerequisites. |

Some migration mappings intentionally narrow legacy access. User creation and update, invitation creation and revocation, API key changes, AI provider configuration and testing, and WhatsApp credential changes are reserved for the Owner. Shared quick reply changes require `quick_replies.manage_global`. The legacy inbox-wide grant remains enabled for the three historical non-owner roles. To restrict one member to assigned conversations, deny `conversations.view_all`, allow `conversations.view_assigned`, and grant `inbox.view` and `messages.read` as needed. The other conversation scope grants are opt-in.

## Database and audit history

The additive migration creates `crm_roles`, `user_permission_overrides`, and `authorization_audits`. Existing user IDs and role strings are preserved, with `users.role` referencing the role catalog. Unrecognized legacy roles start with an empty grant set. The role catalog stores a permission-key set per role. Overrides have a composite primary key and a user foreign key. Audit entries retain the actor, affected user or role, action, previous and updated authorization values, and timestamp. The in-app audit view is read-only and excludes credentials, passwords, and invitation secrets.

The Owner role row serializes authorization management changes. Ownership transfer locks the affected users and atomically promotes an active member while demoting the outgoing Owner. Regular user updates cannot demote or suspend an Owner. The console bootstrap refuses to demote an existing Owner.

New workspace-initiated broadcast jobs recheck the requesting member and permission before sending. Newly scheduled workspace broadcasts persist their authorization context. Previously issued integration credentials and legacy scheduled campaigns retain their service execution path.

## Frontend and verification coverage

Every API entry in the inventory is checked for registry and middleware coverage by `tests/Feature/AuthorizationTest.php`. Direct behavior tests cover selected boundaries as shown below.

| Module | Frontend guard | Backend control | Behavioral test coverage |
| --- | --- | --- | --- |
| Dashboard and reports | Sidebar, routes, activity, campaign, hourly, agent, and trend sections | Scoped permission dependencies and setup-field visibility | Registry and route check |
| Inbox and conversations | Navigation, status tabs, assignment, status, AI controls, notes, and delete actions | Scope query and record checks, state and assignment checks | Assigned-only lists, count, history, sync, and unauthorized sends |
| Messages and media | History, composer, reply, media types, templates, reactions, and downloads | Conversation scope, send payload checks, media endpoint | Read-only composer and realtime UI, direct attachment denial |
| Contacts | Navigation, create, edit, delete, import, export, bulk delete, details and notes | Action permissions, CSV and relation checks, cascade scope | Per-user delete/export denial with editing and another Admin preserved |
| Broadcasts | Navigation, wizard, recipients, export, send, schedule, retry, and delete | Action permissions, payload conditions, job permission recheck | Module denial, direct web route and queued send after revocation |
| Templates | Navigation and create/edit pages, card actions, sync and template send | Action permissions and conversation/media checks on sends | Registry and route check |
| Tags, custom fields, quick replies | Workspace tabs and action buttons | Per-action grants and reply ownership | Registry and route check |
| AI | Agents navigation and tabs, usage and knowledge tools, Inbox drafting and AI controls | Per-action grants, conversation scope and assignment validation | Registry and route check |
| Notifications and presence | Navigation, badge/presence polling, notification mark-read actions | User and conversation scope, active assignment candidates | Browser notification regression tests |
| Account, WhatsApp and API keys | Settings sections, credential tools and key actions | Self-scoped account actions, separate configuration permissions | Registry, route and existing Settings helper checks |
| Team, role editor, member overrides and audit | Team and Owner navigation, Owner controls | Owner checks, locked mutations, role/override validation and audit writes | Role creation, assignment scope, per-user denial, reset and Owner protection |
| Reverb and recovery | Permission and Inbox subscriptions with polling fallback | Active channel auth and empty signals, scoped HTTP snapshots | Payload and scoped recovery tests, notification and Inbox UI tests |

## Migration and deployment

Back up the database and check that at least one existing active user has the exact role key `owner`. Build and deploy application and browser assets together so that browsers understand the payload-free events.

```powershell
npm.cmd ci
npm.cmd run build
php artisan migrate --force
php artisan optimize:clear
php artisan queue:restart
```

Restart long-lived PHP, Reverb, queue and scheduler processes using the deployment's service manager. In a workspace with no active Owner, use the existing console bootstrap `php artisan app:make-admin owner@example.com --role=owner` for the designated account. Apply role changes from the Owner UI after migration. Review active API keys separately when changing integration access.

Run `php artisan test --testsuite=Feature` and `npm.cmd test`. The authorization feature tests use fresh in-memory SQLite databases. Verify the deployment on two signed-in browser sessions and a non-production WhatsApp account. Review the role defaults before rollout.

## Coverage limits

The feature suite passed 7 authorization tests and the frontend suite passed 29 tests. The checked-in WhatsApp realtime regression test passed from a temporary copy of the tracked version. PHP syntax checks, Pint on the new PHP files, and the Vite production build passed. An isolated SQLite upgrade also preserved a legacy user and its contact foreign key while denying grants for the unknown role. A live MariaDB or MySQL upgrade, websocket delivery through production Reverb, and a live Meta sandbox were outside the local test run. The coverage matrix distinguishes route registration tests from behavioral tests. Inbox refresh reconciles the newest message page. Reopen a conversation to reload older pages after remote deletion. Workspace-wide aggregate reports require full conversation scope. No new CRM features were added for unsupported actions in the reference inventory.

## API permission inventory

Routes are shown relative to `/api/app`. Every row also requires an authenticated active member. Conditions for payload-dependent and resource-dependent permissions follow the table.

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/agents` | `presence.assignment_candidates` |
| GET | `/ai/config` | `ai.view` |
| POST | `/ai/config` | `ai.configure` |
| DELETE | `/ai/config` | `ai.disconnect` |
| POST | `/ai/draft` | `messages.ai_draft` |
| GET | `/ai/knowledge` | `ai.knowledge` |
| POST | `/ai/knowledge` | `ai.knowledge_create` |
| POST | `/ai/knowledge/reindex` | `ai.knowledge_reindex` |
| PATCH | `/ai/knowledge/{document}` | `ai.knowledge_update` |
| DELETE | `/ai/knowledge/{document}` | `ai.knowledge_delete` |
| POST | `/ai/playground` | `ai.playground` |
| POST | `/ai/test` | `ai.test` |
| GET | `/ai/usage` | `ai.usage` |
| GET | `/api-keys` | `api_keys.view` |
| POST | `/api-keys` | `api_keys.create` |
| DELETE | `/api-keys/{apiKey}` | `api_keys.delete` |
| GET | `/authorization` | `roles.manage` |
| GET | `/authorization/audit` | `audit.view` |
| POST | `/authorization/roles` | `roles.manage` |
| PUT | `/authorization/roles/{key}` | `roles.manage` |
| DELETE | `/authorization/roles/{key}` | `roles.manage` |
| GET | `/authorization/users/{user}` | `permissions.manage` |
| PUT | `/authorization/users/{user}` | `permissions.manage` |
| GET | `/broadcasts` | `broadcasts.view` |
| POST | `/broadcasts` | `broadcasts.create` |
| GET | `/broadcasts/options` | `broadcasts.options` |
| POST | `/broadcasts/preview` | `broadcasts.preview` |
| GET | `/broadcasts/{broadcast}` | `broadcasts.recipients` |
| DELETE | `/broadcasts/{broadcast}` | `broadcasts.delete` |
| GET | `/broadcasts/{broadcast}/export` | `broadcasts.export` |
| POST | `/broadcasts/{broadcast}/resume` | `broadcasts.resume` |
| POST | `/broadcasts/{broadcast}/retry-pending` | `broadcasts.retry` |
| POST | `/broadcasts/{broadcast}/send` | `broadcasts.send` |
| GET | `/contacts` | `contacts.view` |
| POST | `/contacts` | `contacts.create` |
| GET | `/contacts/export` | `contacts.export` |
| POST | `/contacts/import` | `contacts.import` |
| GET | `/contacts/{contact}` | `contacts.details` |
| PUT / PATCH | `/contacts/{contact}` | `contacts.update` |
| DELETE | `/contacts/{contact}` | `contacts.delete` |
| GET | `/contacts/{contact}/notes` | `contact_notes.view` |
| POST | `/contacts/{contact}/notes` | `contact_notes.create` |
| DELETE | `/contacts/{contact}/notes/{note}` | `contact_notes.delete` |
| PUT | `/contacts/{contact}/tags` | `contacts.tags` |
| GET | `/conversations` | `inbox.view` |
| POST | `/conversations/start` | `conversations.start` |
| GET | `/conversations/{conversation}` | `inbox.view` |
| DELETE | `/conversations/{conversation}` | `conversations.delete` |
| POST | `/conversations/{conversation}/ai-autoreply` | `conversations.ai` |
| PATCH | `/conversations/{conversation}/assign` | `conversations.assign` |
| GET | `/conversations/{conversation}/messages` | `messages.read` |
| POST | `/conversations/{conversation}/messages` | `messages.send` |
| GET | `/conversations/{conversation}/notes` | `conversation_notes.view` |
| POST | `/conversations/{conversation}/notes` | `conversation_notes.create` |
| DELETE | `/conversations/{conversation}/notes/{note}` | `conversation_notes.delete` |
| POST | `/conversations/{conversation}/read` | `conversations.mark_read` |
| PATCH | `/conversations/{conversation}/status` | `conversations.status` |
| GET | `/custom-fields` | `custom_fields.view` |
| POST | `/custom-fields` | `custom_fields.create` |
| PATCH | `/custom-fields/{custom_field}` | `custom_fields.update` |
| DELETE | `/custom-fields/{custom_field}` | `custom_fields.delete` |
| GET | `/dashboard/activity` | `dashboard.activity` |
| GET | `/dashboard/campaigns` | `dashboard.campaigns` |
| GET | `/dashboard/hourly-volume` | `dashboard.hourly` |
| GET | `/dashboard/overview` | `dashboard.view` |
| GET | `/inbox-settings` | `inbox_settings.view` |
| PATCH | `/inbox-settings` | `inbox_settings.update` |
| GET | `/inbox/unread-count` | `inbox.view` |
| GET | `/invitations` | `invitations.view` |
| POST | `/invitations` | `invitations.create` |
| DELETE | `/invitations/{invitation}` | `invitations.delete` |
| DELETE | `/messages/{message}` | `messages.delete` |
| GET | `/messages/{message}/media` | `messages.download` |
| POST | `/messages/{message}/react` | `messages.react` |
| GET | `/notifications` | `notifications.view` |
| GET | `/notifications/browser-events` | `notifications.browser` |
| POST | `/notifications/read-all` | `notifications.mark_read` |
| GET | `/notifications/unread-count` | `notifications.view` |
| POST | `/notifications/{notification}/read` | `notifications.mark_read` |
| POST | `/password` | `account.password` |
| GET | `/presence` | `presence.view` |
| PUT | `/presence` | `presence.update` |
| POST | `/profile` | `account.profile` |
| GET | `/quick-replies` | `quick_replies.view` |
| POST | `/quick-replies` | `quick_replies.create` |
| PATCH | `/quick-replies/{quick_reply}` | `quick_replies.update` |
| DELETE | `/quick-replies/{quick_reply}` | `quick_replies.delete` |
| GET | `/realtime/sync` | `inbox.view` |
| GET | `/reports/agents` | `reports.agents` |
| GET | `/reports/overview` | `reports.view` |
| GET | `/reports/trend` | `reports.trend` |
| GET | `/sessions` | `account.sessions` |
| DELETE | `/sessions` | `account.revoke_sessions` |
| GET | `/tags` | `tags.view` |
| POST | `/tags` | `tags.create` |
| PUT / PATCH | `/tags/{tag}` | `tags.update` |
| DELETE | `/tags/{tag}` | `tags.delete` |
| GET | `/users` | `users.view` |
| POST | `/users` | `users.create` |
| GET | `/users/roles` | `users.view` |
| PATCH | `/users/{user}` | `users.update` |
| POST | `/users/{user}/transfer-ownership` | `users.transfer` |
| GET | `/whatsapp/config` | `whatsapp.view` |
| POST | `/whatsapp/config` | `whatsapp.configure` |
| POST | `/whatsapp/config/disconnect` | `whatsapp.disconnect` |
| PATCH | `/whatsapp/config/mirror-media` | `whatsapp.mirror` |
| GET | `/whatsapp/config/verify-registration` | `whatsapp.verify` |
| GET | `/whatsapp/health` | `whatsapp.health` |
| GET | `/whatsapp/templates` | `templates.view` |
| POST | `/whatsapp/templates` | `templates.create` |
| POST | `/whatsapp/templates/media` | `templates.upload` |
| POST | `/whatsapp/templates/sync` | `templates.sync` |
| PATCH | `/whatsapp/templates/{message_template}` | `templates.update` |
| DELETE | `/whatsapp/templates/{message_template}` | `templates.delete` |
| POST | `/whatsapp/templates/{message_template}/send` | `messages.send_templates` |
| POST | `/whatsapp/templates/{message_template}/submit` | `templates.submit` |

## Permission dependencies and default role grants

Every registered permission is available to an active Owner. Initial defaults are stored during migration. A role created in the editor starts with an empty permission set.

| Permission | Viewer | Agent | Admin | Prerequisites |
| --- | --- | --- | --- | --- |
| `account.password` | Yes | Yes | Yes | None |
| `account.profile` | Yes | Yes | Yes | None |
| `account.revoke_sessions` | Yes | Yes | Yes | None |
| `account.sessions` | Yes | Yes | Yes | None |
| `ai.configure` |   |   |   | `ai.view` |
| `ai.disconnect` |   |   |   | `ai.view` |
| `ai.knowledge` | Yes | Yes | Yes | `ai.view` |
| `ai.knowledge_create` |   |   | Yes | `ai.view` |
| `ai.knowledge_delete` |   |   | Yes | `ai.view` |
| `ai.knowledge_reindex` |   |   | Yes | `ai.view` |
| `ai.knowledge_update` |   |   | Yes | `ai.view` |
| `ai.playground` |   | Yes | Yes | `ai.view` |
| `ai.test` |   |   |   | `ai.view` |
| `ai.usage` |   |   | Yes | `ai.view` |
| `ai.view` | Yes | Yes | Yes | None |
| `api_keys.create` |   |   |   | `api_keys.view` |
| `api_keys.delete` |   |   |   | `api_keys.view` |
| `api_keys.view` |   |   | Yes | None |
| `audit.view` |   |   |   | Owner only |
| `broadcasts.create` |   | Yes | Yes | `broadcasts.view`, `broadcasts.options` |
| `broadcasts.delete` |   |   | Yes | `broadcasts.view` |
| `broadcasts.export` |   | Yes | Yes | `broadcasts.view`, `broadcasts.recipients` |
| `broadcasts.options` | Yes | Yes | Yes | `broadcasts.view`, `contacts.view`, `templates.view` |
| `broadcasts.preview` |   | Yes | Yes | `broadcasts.view`, `contacts.view`, `templates.view` |
| `broadcasts.recipients` | Yes | Yes | Yes | `broadcasts.view`, `contacts.view` |
| `broadcasts.resume` |   | Yes | Yes | `broadcasts.view`, `contacts.view`, `templates.view` |
| `broadcasts.retry` |   | Yes | Yes | `broadcasts.view`, `contacts.view`, `templates.view` |
| `broadcasts.schedule` |   | Yes | Yes | `broadcasts.view`, `broadcasts.create`, `broadcasts.send` |
| `broadcasts.send` |   | Yes | Yes | `broadcasts.view`, `contacts.view`, `templates.view` |
| `broadcasts.view` | Yes | Yes | Yes | None |
| `contact_notes.create` |   | Yes | Yes | `contacts.details` |
| `contact_notes.delete` |   | Yes | Yes | `contacts.details` |
| `contact_notes.view` | Yes | Yes | Yes | `contacts.details` |
| `contacts.create` |   | Yes | Yes | `contacts.view` |
| `contacts.custom_values` |   | Yes | Yes | `contacts.view`, `custom_fields.view` |
| `contacts.delete` |   | Yes | Yes | `contacts.view` |
| `contacts.details` | Yes | Yes | Yes | `contacts.view` |
| `contacts.export` |   | Yes | Yes | `contacts.view` |
| `contacts.import` |   | Yes | Yes | `contacts.view`, `contacts.create`, `contacts.update` |
| `contacts.tags` |   | Yes | Yes | `contacts.view`, `tags.view` |
| `contacts.update` |   | Yes | Yes | `contacts.view` |
| `contacts.view` | Yes | Yes | Yes | None |
| `conversation_notes.create` |   | Yes | Yes | `inbox.view` |
| `conversation_notes.delete` |   | Yes | Yes | `inbox.view` |
| `conversation_notes.delete_others` |   |   | Yes | `inbox.view`, `conversation_notes.delete` |
| `conversation_notes.view` | Yes | Yes | Yes | `inbox.view` |
| `conversations.ai` |   | Yes | Yes | `inbox.view`, `ai.view` |
| `conversations.assign` |   | Yes | Yes | `inbox.view`, `presence.assignment_candidates` |
| `conversations.close` |   | Yes | Yes | `inbox.view`, `conversations.status` |
| `conversations.delete` |   |   | Yes | `inbox.view` |
| `conversations.filter_closed` | Yes | Yes | Yes | `inbox.view` |
| `conversations.filter_expiring` | Yes | Yes | Yes | `inbox.view` |
| `conversations.filter_open` | Yes | Yes | Yes | `inbox.view` |
| `conversations.filter_pending` | Yes | Yes | Yes | `inbox.view` |
| `conversations.filter_unassigned` | Yes | Yes | Yes | `inbox.view` |
| `conversations.filter_unread` | Yes | Yes | Yes | `inbox.view` |
| `conversations.filter_waiting` | Yes | Yes | Yes | `inbox.view` |
| `conversations.mark_read` |   | Yes | Yes | `inbox.view` |
| `conversations.reopen` |   | Yes | Yes | `inbox.view`, `conversations.status` |
| `conversations.start` |   | Yes | Yes | `inbox.view`, `contacts.view` |
| `conversations.status` |   | Yes | Yes | `inbox.view` |
| `conversations.view_all` | Yes | Yes | Yes | `inbox.view` |
| `conversations.view_assigned` |   |   |   | `inbox.view` |
| `conversations.view_others` |   |   |   | `inbox.view` |
| `conversations.view_unassigned` |   |   |   | `inbox.view` |
| `custom_fields.create` |   |   | Yes | `custom_fields.view` |
| `custom_fields.delete` |   |   | Yes | `custom_fields.view` |
| `custom_fields.update` |   |   | Yes | `custom_fields.view` |
| `custom_fields.view` | Yes | Yes | Yes | None |
| `dashboard.activity` | Yes | Yes | Yes | `dashboard.view`, `conversations.view_all`, `messages.read` |
| `dashboard.campaigns` | Yes | Yes | Yes | `dashboard.view`, `broadcasts.view` |
| `dashboard.hourly` | Yes | Yes | Yes | `dashboard.view`, `conversations.view_all`, `messages.read` |
| `dashboard.view` | Yes | Yes | Yes | `conversations.view_all`, `messages.read` |
| `inbox.view` | Yes | Yes | Yes | None |
| `inbox_settings.update` |   |   | Yes | `inbox_settings.view` |
| `inbox_settings.view` | Yes | Yes | Yes | None |
| `invitations.create` |   |   |   | `invitations.view` |
| `invitations.delete` |   |   |   | `invitations.view` |
| `invitations.view` |   |   | Yes | `users.view` |
| `messages.ai_draft` |   | Yes | Yes | `inbox.view`, `messages.send` |
| `messages.delete` |   |   | Yes | `inbox.view`, `messages.read` |
| `messages.download` | Yes | Yes | Yes | `inbox.view`, `messages.read` |
| `messages.react` |   | Yes | Yes | `inbox.view`, `messages.read` |
| `messages.read` | Yes | Yes | Yes | `inbox.view` |
| `messages.reply` |   | Yes | Yes | `inbox.view`, `messages.send` |
| `messages.send` |   | Yes | Yes | `inbox.view`, `messages.read` |
| `messages.send_audio` |   | Yes | Yes | `inbox.view`, `messages.send_media` |
| `messages.send_document` |   | Yes | Yes | `inbox.view`, `messages.send_media` |
| `messages.send_image` |   | Yes | Yes | `inbox.view`, `messages.send_media` |
| `messages.send_interactive` |   | Yes | Yes | `inbox.view`, `messages.send` |
| `messages.send_media` |   | Yes | Yes | `inbox.view`, `messages.send` |
| `messages.send_templates` |   | Yes | Yes | `inbox.view`, `templates.view`, `messages.send`, `contacts.view` |
| `messages.send_video` |   | Yes | Yes | `inbox.view`, `messages.send_media` |
| `notifications.browser` | Yes | Yes | Yes | `notifications.view`, `messages.read` |
| `notifications.mark_read` | Yes | Yes | Yes | `notifications.view` |
| `notifications.view` | Yes | Yes | Yes | None |
| `permissions.manage` |   |   |   | Owner only |
| `presence.assignable` |   | Yes | Yes | `inbox.view` |
| `presence.assignment_candidates` | Yes | Yes | Yes | None |
| `presence.update` | Yes | Yes | Yes | None |
| `presence.view` | Yes | Yes | Yes | None |
| `quick_replies.create` |   | Yes | Yes | `quick_replies.view` |
| `quick_replies.delete` |   | Yes | Yes | `quick_replies.view` |
| `quick_replies.manage_global` |   |   | Yes | `quick_replies.view` |
| `quick_replies.update` |   | Yes | Yes | `quick_replies.view` |
| `quick_replies.view` | Yes | Yes | Yes | None |
| `reports.agents` | Yes | Yes | Yes | `reports.view` |
| `reports.trend` | Yes | Yes | Yes | `reports.view` |
| `reports.view` | Yes | Yes | Yes | `conversations.view_all`, `messages.read` |
| `roles.manage` |   |   |   | Owner only |
| `tags.create` |   |   | Yes | `tags.view` |
| `tags.delete` |   |   | Yes | `tags.view` |
| `tags.update` |   |   | Yes | `tags.view` |
| `tags.view` | Yes | Yes | Yes | None |
| `templates.create` |   |   | Yes | `templates.view` |
| `templates.delete` |   |   | Yes | `templates.view` |
| `templates.submit` |   |   | Yes | `templates.view` |
| `templates.sync` |   |   | Yes | `templates.view` |
| `templates.update` |   |   | Yes | `templates.view` |
| `templates.upload` |   |   | Yes | `templates.view` |
| `templates.view` | Yes | Yes | Yes | None |
| `users.activate` |   |   |   | `users.view` |
| `users.assign_role` |   |   |   | `users.view` |
| `users.create` |   |   |   | `users.view` |
| `users.transfer` |   |   |   | `users.view` |
| `users.update` |   |   |   | `users.view` |
| `users.view` |   |   | Yes | None |
| `whatsapp.configure` |   |   |   | `whatsapp.view` |
| `whatsapp.disconnect` |   |   | Yes | `whatsapp.view` |
| `whatsapp.health` | Yes | Yes | Yes | `whatsapp.view` |
| `whatsapp.mirror` |   |   | Yes | `whatsapp.view` |
| `whatsapp.verify` |   |   | Yes | `whatsapp.view` |
| `whatsapp.view` | Yes | Yes | Yes | None |


Bind conversation and message resources before entering the controller, then check them against the requesting member's conversation scope. The conversation index checks requested status tabs separately. Starting a conversation and sending a template to a contact check the actual conversation found or created for that contact. A message reply must reference a message in that same conversation. Media and interactive sends, template sends, contact field and tag writes, campaign send and schedule, and closing or reopening a conversation each evaluate their payload-specific permissions. Reassigning a conversation or handing it to a human member requires an active eligible assignee.

## Implementation files

- Authorization resolution and audit writes live under `app/Auth/`. Middleware in `app/Http/Middleware/` replaces the previous role middleware.
- `routes/api.php`, `routes/invitations.php`, `routes/web.php`, and `routes/channels.php` connect permissions to the normal entry points. API controllers enforce action-specific and record-level constraints.
- `resources/js/context/AuthContext.jsx`, `resources/js/main.jsx`, `resources/js/lib/permissions.js`, and the existing module pages enforce navigation and action visibility. `AuthorizationPage.jsx` and `AccessDeniedPage.jsx` implement management and denied navigation.
- `app/Events/`, `resources/js/lib/realtime.js`, and `resources/js/lib/authorizationRealtime.js` handle signals and reconnection. `app/Services/BroadcastService.php` and `app/Jobs/SendBroadcastRecipient.php` carry and recheck an authorized acting member.
- The authorization migration is `database/migrations/2026_11_27_000000_create_crm_authorization.php`. Automated backend coverage lives in `tests/Feature/AuthorizationTest.php` and Inbox interaction tests in `resources/js/pages/ChatsPage.test.jsx`.

## RBAC change list

| Change | File |
| --- | --- |
| Updated | `README.md` |
| Updated | `app/Console/Commands/MakeAdminUser.php` |
| Updated | `app/Events/ConversationDeleted.php` |
| Updated | `app/Events/ConversationUpdated.php` |
| Updated | `app/Events/MessageCreated.php` |
| Updated | `app/Events/MessageDeleted.php` |
| Updated | `app/Events/MessageStatusChanged.php` |
| Updated | `app/Events/MessageUpdated.php` |
| Updated | `app/Http/Controllers/Api/AiController.php` |
| Updated | `app/Http/Controllers/Api/BroadcastController.php` |
| Updated | `app/Http/Controllers/Api/ContactController.php` |
| Updated | `app/Http/Controllers/Api/ConversationController.php` |
| Updated | `app/Http/Controllers/Api/ConversationNoteController.php` |
| Updated | `app/Http/Controllers/Api/CustomFieldController.php` |
| Updated | `app/Http/Controllers/Api/DashboardController.php` |
| Updated | `app/Http/Controllers/Api/InvitationController.php` |
| Updated | `app/Http/Controllers/Api/MessageController.php` |
| Updated | `app/Http/Controllers/Api/NotificationController.php` |
| Updated | `app/Http/Controllers/Api/QuickReplyController.php` |
| Updated | `app/Http/Controllers/Api/RealtimeSyncController.php` |
| Updated | `app/Http/Controllers/Api/SettingsController.php` |
| Updated | `app/Http/Controllers/Api/TemplateController.php` |
| Updated | `app/Http/Controllers/Api/UserController.php` |
| Removed | `app/Http/Middleware/EnsureRole.php` |
| Updated | `app/Jobs/SendBroadcastRecipient.php` |
| Updated | `app/Models/Broadcast.php` |
| Updated | `app/Models/User.php` |
| Updated | `app/Providers/AppServiceProvider.php` |
| Updated | `app/Services/AiAutoReplyService.php` |
| Updated | `app/Services/BroadcastService.php` |
| Updated | `app/Support/SessionUser.php` |
| Updated | `bootstrap/app.php` |
| Updated | `resources/js/components/ai/AiConfigPanel.jsx` |
| Updated | `resources/js/components/ai/AiKnowledgePanel.jsx` |
| Updated | `resources/js/components/chat/ChatComposer.jsx` |
| Updated | `resources/js/components/chat/ConversationList.jsx` |
| Updated | `resources/js/components/chat/MessageBubble.jsx` |
| Updated | `resources/js/components/common/BrowserNotificationsListener.jsx` |
| Updated | `resources/js/components/common/MemberPresence.jsx` |
| Updated | `resources/js/components/contacts/ContactDetail.jsx` |
| Updated | `resources/js/components/layout/AppLayout.jsx` |
| Updated | `resources/js/components/settings/ApiKeysPanel.jsx` |
| Updated | `resources/js/components/settings/TeamInvitations.jsx` |
| Updated | `resources/js/components/templates/TemplateCard.jsx` |
| Updated | `resources/js/components/templates/TemplatePreviewModal.jsx` |
| Updated | `resources/js/context/AuthContext.jsx` |
| Updated | `resources/js/lib/realtime.js` |
| Updated | `resources/js/lib/whatsappConfig.js` |
| Updated | `resources/js/main.jsx` |
| Updated | `resources/js/pages/AgentsPage.jsx` |
| Updated | `resources/js/pages/AuthPages.jsx` |
| Updated | `resources/js/pages/BroadcastDetailPage.jsx` |
| Updated | `resources/js/pages/BroadcastWizardPage.jsx` |
| Updated | `resources/js/pages/BroadcastsPage.jsx` |
| Updated | `resources/js/pages/ChatsPage.jsx` |
| Updated | `resources/js/pages/ChatsPage.test.jsx` |
| Updated | `resources/js/pages/ContactsPage.jsx` |
| Updated | `resources/js/pages/DashboardPage.jsx` |
| Updated | `resources/js/pages/NotificationsPage.jsx` |
| Updated | `resources/js/pages/ReportsPage.jsx` |
| Updated | `resources/js/pages/SettingsPage.jsx` |
| Updated | `resources/js/pages/TeamPage.jsx` |
| Updated | `resources/js/pages/TemplatesPage.jsx` |
| Updated | `resources/js/pages/WorkspacePage.jsx` |
| Updated | `routes/api.php` |
| Updated | `routes/channels.php` |
| Updated | `routes/invitations.php` |
| Updated | `routes/web.php` |
| Added | `RBAC.md` |
| Added | `app/Auth/Access.php` |
| Added | `app/Auth/AuthorizationAudit.php` |
| Added | `app/Auth/PermissionRegistry.php` |
| Added | `app/Events/AuthorizationChanged.php` |
| Added | `app/Http/Controllers/Api/AuthorizationController.php` |
| Added | `app/Http/Middleware/AuthorizeConversation.php` |
| Added | `app/Http/Middleware/AuthorizeCrm.php` |
| Added | `database/migrations/2026_11_27_000000_create_crm_authorization.php` |
| Added | `resources/js/context/AuthContext.test.jsx` |
| Added | `resources/js/lib/authorizationRealtime.js` |
| Added | `resources/js/lib/permissions.js` |
| Added | `resources/js/pages/AccessDeniedPage.jsx` |
| Added | `resources/js/pages/AuthorizationPage.jsx` |
| Added | `tests/Feature/AuthorizationTest.php` |
