# WhatsApp CRM

Laravel 11 serves the React CRM using Inertia. React, its styles, and Vite configuration live in this Laravel project. CRM requests, session cookies, and application pages use the same origin.

## Local development

Use PHP 8.2 or later, Composer, Node.js 22 LTS, npm, and MySQL. Run the commands from the repository root in PowerShell.

```powershell
Set-Location backend_php
composer install
npm ci
npm run build
php artisan serve --host=127.0.0.1 --port=8000
```

Open `http://127.0.0.1:8000`. For live frontend changes, run `npm run dev` from `backend_php` in a second terminal and continue using the Laravel URL.

Set `APP_URL=http://127.0.0.1:8000` for local development and use your local MySQL connection values. Leave `SESSION_DOMAIN` unset and `SESSION_SECURE_COOKIE=false` for local HTTP. Preserve the existing `.env`, `APP_KEY`, and database when upgrading. On a new installation, copy `.env.example` to `.env`, configure it, then run `php artisan key:generate` and `php artisan migrate`.

## Production deployment

Point the HTTPS web server document root at `backend_php/public` and send application URLs to Laravel's `index.php`. Set `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL` to the public CRM origin, and `SESSION_SECURE_COOKIE=true`. Keep the existing application key, MySQL connection, and WhatsApp settings. A separate frontend URL is optional for legacy clients only.

```bash
cd backend_php
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
npm ci --include=dev
npm run build
php artisan storage:link
php artisan optimize
php artisan queue:restart
```

Run `storage:link` once for each public directory that needs the storage link. Serve the generated `public/build` directory with the release. This integration adds no database migrations.

Keep a supervised queue worker running `php artisan queue:work`. Invoke `php artisan schedule:run` once per minute to dispatch scheduled broadcasts. Continue pointing Meta at `https://<crm-host>/api/whatsapp/webhook`.

## Tests

From `backend_php`, run:

```sh
npm test
npm run build
php artisan route:list
php artisan test
```

The database-backed tests expect a migrated MySQL schema named `wacrm_test` and use transactions. Use test-only credentials and an isolated database.

## Connect Meta WhatsApp Cloud API

1. In Meta's WhatsApp API Setup, obtain the Phone Number ID, WhatsApp Business Account ID, and an access token with the required WhatsApp permissions.
2. In the CRM, open **Settings → WhatsApp**, enter those values and a webhook verify token, then save. The API checks the token and Phone Number ID with Meta and subscribes the app to the WABA before reporting a connection. The access token needs permission to manage the WhatsApp Business Account.
3. Set `META_APP_SECRET` in `backend_php/.env` to the secret for the Meta app that owns the webhook (`WHATSAPP_APP_SECRET` is accepted as a fallback). Webhook POST requests are rejected unless their Meta signature is valid. Then run `php artisan config:clear`.
4. In Meta's Webhooks settings, configure the callback URL as `https://<crm-host>/api/whatsapp/webhook`, use the same verify token, and subscribe to the `messages` field. Meta must be able to reach this HTTPS URL.
5. Create and submit templates in **Message Templates**, or create them in WhatsApp Manager and use **Sync from Meta**. Only templates confirmed as Approved by Meta can be sent to an individual contact.

Keep `.env` private and never commit access tokens, app secrets, or verify tokens. Only message contacts who have opted in. Business-initiated messages require approved templates; free-form replies are subject to Meta's customer-service window and messaging policies.

Message send requests can include an `idempotency_key`. The frontend reuses the same key when a request is retried, so an uncertain provider response cannot cause a second send. If a send is shown as pending after a timeout or provider error, wait for a status webhook or check Meta before submitting a new message.

The WhatsApp Graph API host and version are configurable with `WHATSAPP_BASE_HOST` and `WHATSAPP_API_VERSION`. Update the version when upgrading Meta Graph API versions.
