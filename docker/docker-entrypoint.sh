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

if [[ "${RENDER:-}" == true ]]; then
    export APP_DEBUG=false
fi

as_app() {
    setpriv --reuid=www-data --regid=www-data --init-groups -- "$@"
}

mysql_ca="${MYSQL_ATTR_SSL_CA:-}"
if [[ -n "$mysql_ca" ]] && ! as_app php -r '
    $path = $argv[1];
    if (!is_file($path) || !is_readable($path)) exit(1);
    $pem = @file_get_contents($path);
    exit($pem !== false && @openssl_x509_read($pem) !== false ? 0 : 1);
' -- "$mysql_ca"; then
    echo "MYSQL_ATTR_SSL_CA must point to a readable PEM certificate or bundle inside the container." >&2
    echo "On Render, use the provider CA under /etc/secrets or the system trust bundle if your provider specifies it." >&2
    exit 1
fi

printf 'Listen %s\n' "$port" > /etc/apache2/ports.conf
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
