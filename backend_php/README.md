# WhatsApp CRM

This project uses a Laravel API (`backend_php`) and a React/Vite client (`frontend_react`).

## Local development on Windows

Prerequisites: PHP 8.2+, Composer, Node.js, npm, and MySQL (for example, the XAMPP MySQL service).

1. Create a MySQL database, then copy and configure the backend environment file:

   ```powershell
   Copy-Item backend_php\.env.example backend_php\.env
   ```

   Set the database connection values in `backend_php/.env`.
2. On a new installation only, generate an application key:

   ```powershell
   Set-Location backend_php
   php artisan key:generate
   ```

   Do not generate a new key over an existing installation. Laravel uses it to decrypt saved WhatsApp credentials.
3. Install backend dependencies and migrate the database:

   ```powershell
   Set-Location backend_php
   composer install
   php artisan migrate
   ```

4. In one terminal, run the API:

   ```powershell
   Set-Location backend_php
   php artisan serve --host=127.0.0.1 --port=8000
   ```

5. In another terminal, run the React client:

   ```powershell
   Set-Location frontend_react
   npm install
   npm run dev
   ```

   Open the Vite URL (normally `http://localhost:5173`) and register an account.

## Connect Meta WhatsApp Cloud API

1. In Meta's WhatsApp API Setup, obtain the Phone Number ID, WhatsApp Business Account ID, and an access token with the required WhatsApp permissions.
2. In the CRM, open **Settings → WhatsApp**, enter those values and a webhook verify token, then save. The API checks the token and Phone Number ID with Meta before reporting a connection.
3. Set `META_APP_SECRET` in `backend_php/.env` to the secret for the Meta app that owns the webhook (`WHATSAPP_APP_SECRET` is accepted as a fallback). Webhook POST requests are rejected unless their Meta signature is valid. Then run `php artisan config:clear`.
4. In Meta's Webhooks settings, configure the callback URL as `https://<public-backend-host>/api/whatsapp/webhook`, use the same verify token, and subscribe to the `messages` field. Meta must be able to reach this HTTPS URL.
5. Create and submit templates in **Message Templates**, or create them in WhatsApp Manager and use **Sync from Meta**. Only templates confirmed as Approved by Meta can be sent to an individual contact.

Keep `.env` private and never commit access tokens, app secrets, or verify tokens. Only message contacts who have opted in. Business-initiated messages require approved templates; free-form replies are subject to Meta's customer-service window and messaging policies.

The WhatsApp Graph API host and version are configurable with `WHATSAPP_BASE_HOST` and `WHATSAPP_API_VERSION`. Update the version when upgrading Meta Graph API versions.

## Required environment variable names

`APP_KEY`, `APP_DEBUG`, `APP_URL`, `DB_CONNECTION=mysql`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN`, `WHATSAPP_BASE_HOST`, `WHATSAPP_API_VERSION`, `META_APP_SECRET`, `META_APP_ID` (documentation only), `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID` (bootstrap values only; active credentials are stored encrypted in `whatsapp_configs`).

## Role-based settings

Public registration creates `agent` users. WhatsApp settings, template submission, synchronization, and template sending require an `admin` or `owner` role. Promote a user with `php artisan app:make-admin user@example.com`.

## Checks

Tests use a separate MySQL database (`wacrm_test`) so `RefreshDatabase` never touches application data. Create it once, then run:

```powershell
mysql -u root -e "CREATE DATABASE IF NOT EXISTS wacrm_test"
cd backend_php
php artisan test
cd ../frontend_react
npm run build
```
