FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY vite.config.js ./
COPY resources ./resources
RUN npm run build

FROM php:8.3-apache-bookworm AS php-base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini util-linux \
    && docker-php-ext-install -j2 pdo_mysql opcache pcntl \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /var/www/html

FROM composer:2 AS composer-bin
FROM php-base AS dependencies
COPY --from=composer-bin /usr/bin/composer /usr/local/bin/composer
RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip \
    && rm -rf /var/lib/apt/lists/*
ENV COMPOSER_ALLOW_SUPERUSER=1
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --no-progress
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-scripts --no-interaction \
    && composer check-platform-reqs --no-dev

FROM php-base AS runtime
ENV APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr \
    LOG_LEVEL=info \
    DB_CONNECTION=mysql \
    SESSION_DRIVER=database \
    SESSION_SECURE_COOKIE=true \
    CACHE_STORE=database \
    QUEUE_CONNECTION=database \
    MAIL_MAILER=smtp \
    PORT=10000

COPY --from=dependencies /var/www/html /var/www/html
COPY --from=frontend /build/public/build /var/www/html/public/build
COPY deploy/render/apache.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/render/php.ini /usr/local/etc/php/conf.d/99-render.ini
COPY --chmod=755 deploy/render/start.sh /usr/local/bin/crm-start

RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && mkdir -p bootstrap/cache storage/app/private storage/app/public \
        storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && chown -R www-data:www-data bootstrap/cache storage \
    && chmod -R u+rwX,go-rwx bootstrap/cache storage \
    && mkdir -p /var/run/apache2 \
    && RENDER_HTTP_PORT=10000 apache2ctl configtest

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/crm-start"]
CMD ["apache2-foreground"]
