# WhatsApp CRM

Run commands from this repository root. Laravel serves the React pages through Inertia and handles the CRM APIs, authentication, WhatsApp webhooks, queues, and scheduling. Vite builds the React assets for the same application URL.

## Local startup

Create an empty MySQL database and configure the root `.env` to point to it. This migration baseline is for a new database. Set `APP_URL` to the origin you open in the browser. For local HTTP, use `http://127.0.0.1:8000` and set `SESSION_SECURE_COOKIE=false`.

```powershell
composer install
npm.cmd ci
npm.cmd run build
php artisan migrate
php artisan app:make-admin owner@example.com --role=owner
php artisan serve --host=127.0.0.1 --port=8000
```

Run the worker and scheduler in separate terminals against the same application configuration.

```powershell
php artisan queue:work
php artisan schedule:work
```

## Real-time messaging

The inbox uses Laravel Reverb over WebSockets. Laravel broadcasts only after a message or conversation change is saved successfully; the browser listens on the authenticated private `account.default` channel. If Reverb is not configured, the inbox keeps its slower polling fallback.

For local development, copy the Reverb variables from [.env.example](.env.example) into `.env`, use the same `REVERB_APP_ID`, `REVERB_APP_KEY`, and `REVERB_APP_SECRET` values, and set `REVERB_ALLOWED_ORIGINS` to the origin you open in the browser. Then start one extra terminal:

```powershell
php artisan reverb:start
```

The browser receives the public Reverb connection details from Laravel shared props, so no `VITE_REVERB_*` rebuild is required. Keep `BROADCAST_CONNECTION=reverb` on the web process that answers HTTP requests; the Reverb process itself does not need to broadcast to another Reverb server.

On Render, [render.yaml](render.yaml) creates `whatsapp-crm-reverb` as a second always-on web service. Set the same stable `APP_KEY`, `REVERB_APP_ID`, `REVERB_APP_KEY`, and `REVERB_APP_SECRET` on both services. `REVERB_HOST` and `REVERB_ALLOWED_ORIGINS` are filled automatically from the two service hostnames. Use an always-on plan for the WebSocket service; a sleeping free service will disconnect clients.

Key files:

- `config/broadcasting.php` and `config/reverb.php`: server and browser connection settings.
- `routes/channels.php`: private channel authorization for active users in the default workspace.
- `app/Events/`: small broadcast events for created, updated, deleted, and status-changed messages and conversations.
- `app/Services/RealtimePayload.php`: serializes messages and conversations in the same shape as the existing APIs.
- `app/Services/RealtimeBroadcaster.php`: broadcasts after commits and safely logs failures without breaking a send or webhook.
- `app/Http/Controllers/Api/RealtimeSyncController.php`: recovers messages and conversations missed during a disconnect.
- `resources/js/lib/realtime.js`: Laravel Echo setup, private channel subscription, and reconnect detection.
- `resources/js/lib/realtimeChat.js`: duplicate-safe merge helpers used by `resources/js/pages/ChatsPage.jsx`.

Quick verification:

1. Sign in on two tabs and send a text message; it should appear immediately in both tabs without a refresh.
2. Confirm a failed send shows the failure state, and a successful send replaces the optimistic bubble with the saved message.
3. Trigger status webhooks and confirm pending/sent/delivered/read changes appear without waiting for polling.
4. Stop and restart `php artisan reverb:start`; the next reconnect should fill any messages sent while the browser was offline.
5. Keep older-message pagination, search, templates, reactions, and WhatsApp config working as before.

This workspace is single-tenant: auth checks that the user is active and uses the one `default` account channel. If tenant columns are added later, `routes/channels.php` and the event channel names need to be updated together. Recovery restores messages and conversation updates; messages or conversations deleted while disconnected are not replayed because their rows no longer exist.

For Apache deployments, point the virtual host's document root to this repository's `public/` directory. Set `APP_DEBUG=false` and use HTTPS with `SESSION_SECURE_COOKIE=true`. Use [the production environment example](.env.production.example) when configuring the deployment.

## Deploy on Render

1. Create an empty database on an external MySQL provider. Use a database host reachable from Render and allowlist the service's outbound ranges when required by the provider.
2. With your local shell configured for that empty database, run `php artisan migrate --force` and `php artisan app:make-admin owner@example.com --role=owner`. These commands are separate from container startup. Verify the database name before running them.
3. Run `php artisan key:generate --show` and save the resulting `base64:...` value in Render as `APP_KEY`. Reuse the same key on redeploys. When connecting a previously encrypted database, use its original key.
4. Push this branch to GitHub. In Render choose **New → Blueprint** and connect the repository containing [render.yaml](render.yaml). You can also create a **Free Docker Web Service** using the root Dockerfile and set its HTTP health check path to `/up`.
5. Open the HTTPS service URL, sign in, and enter the WhatsApp access token, phone number ID, WABA ID, and verify token in the CRM. In Meta, use `https://<your-service>.onrender.com/api/whatsapp/webhook` and the same verify token.

| Render environment variable | Value |
| --- | --- |
| `APP_KEY` | Stable Laravel key from step 3 |
| `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | External MySQL connection details |
| `DB_PORT` | Defaults to `3306`. Override if your provider uses another port. |
| `META_APP_SECRET` | Meta app secret required to validate webhook signatures |
| `META_APP_ID` | Meta app ID required for template header uploads |
| `APP_URL` | Optional for the default Render domain. Set it to the HTTPS origin if using a custom domain. |
| `SANCTUM_STATEFUL_DOMAINS` | Optional for the primary app origin. If serving extra hostnames, set a comma-separated list of hosts without schemes. |
| `MYSQL_ATTR_SSL_CA` | Defaults on Render to `/etc/ssl/certs/ca-certificates.crt` for publicly trusted certificates. If your provider requires a custom CA, upload its PEM as a Render secret file named `mysql-ca.pem` and set the value to `/etc/secrets/mysql-ca.pem`. Set `DB_HOST` to the provider's TLS hostname. |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` | Configure for password reset email. Use an SMTP provider with a permitted port such as `2525`. The container defaults to `MAIL_MAILER=smtp`. |

The image sets `APP_ENV=production`, `APP_DEBUG=false`, `LOG_CHANNEL=stderr`, `DB_CONNECTION=mysql`, `SESSION_DRIVER=database`, `SESSION_SECURE_COOKIE=true`, `CACHE_STORE=database`, and `QUEUE_CONNECTION=database`. It listens on Render's `PORT` with a default of `10000`. Queue processing and the scheduler run inside the web service while it is awake. Set `RENDER_RUN_BACKGROUND=false` if moving them to separate services.

If Render reports `Cannot connect to MySQL using SSL`, check the CA path and filename in **Environment → Secret Files**, and use the provider hostname instead of an IP address. A local Windows path will not exist in the container. When using the individual `DB_*` variables, remove a stale `DB_URL` since it can override the configured host and port. The entrypoint validates the CA as the PHP worker user before starting Apache. PHP keeps server certificate verification enabled. [Render Docker secret files](https://render.com/docs/docker-secrets#accessing-secret-files-at-runtime)

Render free services can sleep after 15 minutes idle. Webhook delivery can be delayed during a cold start, and queues and schedules pause while the service sleeps. MySQL data persists on the external provider. Uploaded avatars and locally mirrored attachments are stored on the container filesystem and can disappear on restart, spin-down, or deploy. For always-on webhook processing or durable local uploads, use a plan and storage configuration that support those requirements. [Render free plan limits](https://render.com/docs/free) · [Outbound IP ranges](https://render.com/docs/outbound-ip-addresses)

## Database schema

Laravel records migrations in `migrations`. The original 34 application tables each have an initial migration; a follow-up migration removes consent tracking, leaving 33 application tables. Filenames are ordered by foreign-key dependency. The migration files define the columns, foreign keys, unique constraints, and indexes.

| Order | Table |
| --- | --- |
| 1 | `users` |
| 2 | `password_reset_tokens` |
| 3 | `sessions` |
| 4 | `personal_access_tokens` |
| 5 | `account_invitations` |
| 6 | `cache` |
| 7 | `cache_locks` |
| 8 | `jobs` |
| 9 | `failed_jobs` |
| 10 | `contacts` |
| 11 | `tags` |
| 12 | `contact_tag` |
| 13 | `custom_fields` |
| 14 | `contact_custom_values` |
| 15 | `contact_notes` |
| 16 | `whatsapp_configs` |
| 17 | `message_templates` |
| 18 | `conversations` |
| 19 | `messages` |
| 20 | `pending_message_statuses` |
| 21 | `message_reactions` |
| 22 | `conversation_notes` |
| 23 | `quick_replies` |
| 24 | `broadcasts` |
| 25 | `broadcast_recipients` |
| 26 | `ai_configs` |
| 27 | `ai_knowledge_documents` |
| 28 | `ai_knowledge_chunks` |
| 29 | `ai_usage_logs` |
| 30 | `crm_settings` |
| 31 | `notifications` |
| 32 | `api_keys` |
| 33 | `webhook_endpoints` |
