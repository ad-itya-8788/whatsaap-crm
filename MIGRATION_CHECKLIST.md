# Migration parity checklist

Target: React + Vite + Laravel 11 + MySQL. Reference (read-only): Next.js + PostgreSQL/Supabase.

## Verified working target features (preserve)
- Sanctum session login/logout and protected routes
- Contacts CRUD, CSV import/export, tags, consent, custom fields
- Inbox conversations, messages, notes, assignment/status, quick replies, media
- Broadcasts, templates, AI config/playground/draft/knowledge
- Dashboard, reports, team, notifications, browser notifications polling

## P0 fixes
- [x] Inbox canonical deep link `?c=` and `/chats` redirect preservation
- [x] Waiting / unassigned / expiring inbox filters and `?filter=` deep links
- [x] Scope browser notification events to the authenticated user
- [x] Dependency audit: no Supabase or Next.js runtime references in target source/manifests

## P1 parity
- [x] Forgot/reset password UI wired to existing Laravel endpoints
- [x] Dashboard range `1`, default `7`, failed-message attention dialog
- [ ] Inbox template picker and interactive message support
- [ ] Outbound message reactions and reaction persistence
- [ ] Contact detail workflow and contact template send
- [x] Settings rail/sections; profile, password, inbox settings
- [ ] AI auto-reply dispatch and takeover/resume UI
- [ ] Public API v1, API keys, webhook endpoint registry/delivery

## P2 parity
- [ ] Interactive quick replies and preset tag colors
- [ ] WhatsApp registration verification and mirror-media toggle
- [ ] Presence heartbeat and presence indicators
- [ ] Browser notification labels/dedupe/visibility handling
- [x] No-flash theme boot script

## Verification
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `php artisan route:list`
- [ ] `php artisan migrate --pretend` against safe database config
- [ ] API smoke checks
- [ ] Review logs for errors
