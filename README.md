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

For Apache deployments, point the virtual host's document root to this repository's `public/` directory. Set `APP_DEBUG=false` and use HTTPS with `SESSION_SECURE_COOKIE=true`. Use [the production environment example](.env.production.example) when configuring the deployment.

## Database schema

Laravel records migrations in `migrations`. Each of the 34 application tables has its own initial migration. Filenames are ordered by foreign-key dependency. The migration files define the columns, foreign keys, unique constraints, and indexes.

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
| 15 | `consent_events` |
| 16 | `contact_notes` |
| 17 | `whatsapp_configs` |
| 18 | `message_templates` |
| 19 | `conversations` |
| 20 | `messages` |
| 21 | `pending_message_statuses` |
| 22 | `message_reactions` |
| 23 | `conversation_notes` |
| 24 | `quick_replies` |
| 25 | `broadcasts` |
| 26 | `broadcast_recipients` |
| 27 | `ai_configs` |
| 28 | `ai_knowledge_documents` |
| 29 | `ai_knowledge_chunks` |
| 30 | `ai_usage_logs` |
| 31 | `crm_settings` |
| 32 | `notifications` |
| 33 | `api_keys` |
| 34 | `webhook_endpoints` |
