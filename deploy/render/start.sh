#!/usr/bin/env bash
set -euo pipefail

port="${PORT:-10000}"
if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
    echo "PORT must be a valid TCP port." >&2
    exit 1
fi

export RENDER_HTTP_PORT="$port"
export APP_URL="${APP_URL:-${RENDER_EXTERNAL_URL:-http://localhost:$port}}"
: "${APP_KEY:?Set a stable Laravel APP_KEY in the service environment}"

printf 'Listen %s\n' "$port" > /etc/apache2/ports.conf

as_app() {
    setpriv --reuid=www-data --regid=www-data --init-groups -- "$@"
}

as_app php artisan config:cache --no-interaction --quiet

if [[ "${RENDER_RUN_BACKGROUND:-true}" != true ]] || [[ "$1" != apache2-foreground ]]; then
    exec "$@"
fi

run_queue() {
    while true; do
        as_app php -d memory_limit=80M artisan queue:work --sleep=5 --timeout=75 \
            --memory=64 --max-time=3600 --no-interaction || true
        sleep 5
    done
}

run_schedule() {
    while true; do
        sleep "$((60 - $(date +%s) % 60))"
        as_app php -d memory_limit=64M artisan schedule:run --no-interaction || true
    done
}

run_queue &
run_schedule &
exec "$@"
