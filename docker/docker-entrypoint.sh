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
    export MYSQL_ATTR_SSL_CA="${MYSQL_ATTR_SSL_CA:-/etc/ssl/certs/ca-certificates.crt}"
fi

as_app() {
    setpriv --reuid=www-data --regid=www-data --init-groups -- "$@"
}

mysql_ca="${MYSQL_ATTR_SSL_CA:-}"
if [[ -n "$mysql_ca" ]]; then
    as_app php -r '
    $path = $argv[1];
    if (!str_starts_with($path, "/")) {
        fwrite(STDERR, "MYSQL_ATTR_SSL_CA must be a Linux absolute path. Enter only the path as the variable value, without quotes.\n");
        exit(1);
    }
    if (!is_file($path)) {
        fwrite(STDERR, "MYSQL_ATTR_SSL_CA file is missing or inaccessible to the PHP worker.\n");
        exit(1);
    }
    $pem = @file_get_contents($path);
    if ($pem === false) {
        fwrite(STDERR, "MYSQL_ATTR_SSL_CA file is unreadable by the PHP worker.\n");
        exit(1);
    }
    if (@openssl_x509_read($pem) === false) {
        fwrite(STDERR, "MYSQL_ATTR_SSL_CA file does not contain a valid PEM certificate.\n");
        exit(1);
    }
' -- "$mysql_ca"
    echo "MySQL TLS CA is readable and contains a PEM certificate."
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
