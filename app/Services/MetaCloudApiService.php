<?php

namespace App\Services;

use App\Exceptions\MetaApiException;
use App\Models\WhatsappConfig;
use App\Support\WhatsappMedia;
use Illuminate\Contracts\Encryption\DecryptException;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MetaCloudApiService
{
    public function verifyPhoneNumber(WhatsappConfig $config): ?string
    {
        if (! $config->access_token || ! $config->phone_number_id) {
            return 'WhatsApp credentials are incomplete';
        }

        try {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(20)
                ->get($this->url($config->phone_number_id), ['fields' => 'id']);
        } catch (ConnectionException) {
            return 'Could not reach the Meta Graph API';
        }

        if (! $response->successful()) {
            return $this->errorMessage($response);
        }

        if ((string) $response->json('id') !== (string) $config->phone_number_id) {
            return 'Meta returned a different phone number ID';
        }

        return null;
    }

    public function getDisplayPhoneNumber(WhatsappConfig $config): ?string
    {
        try {
            $accessToken = $config->access_token;
        } catch (DecryptException) {
            Log::warning('whatsapp.phone_number_metadata_unavailable', ['reason' => 'token_decryption_failed']);

            return null;
        }

        if (! $accessToken || ! $config->phone_number_id) {
            return null;
        }

        try {
            $response = Http::withToken($accessToken)
                ->connectTimeout(10)
                ->timeout(20)
                ->get($this->url($config->phone_number_id), [
                    'fields' => 'id,display_phone_number',
                ]);
        } catch (ConnectionException) {
            Log::warning('whatsapp.phone_number_metadata_unavailable', ['reason' => 'connection']);

            return null;
        }

        if (! $response->successful()) {
            Log::warning('whatsapp.phone_number_metadata_unavailable', ['status' => $response->status()]);

            return null;
        }

        if ((string) $response->json('id') !== (string) $config->phone_number_id) {
            Log::warning('whatsapp.phone_number_metadata_unavailable', ['reason' => 'id_mismatch']);

            return null;
        }

        $number = $response->json('display_phone_number');

        return is_string($number) && trim($number) !== '' ? trim($number) : null;
    }

    public function verifyWabaPhoneNumber(WhatsappConfig $config): ?string
    {
        $after = null;

        do {
            try {
                $response = Http::withToken($config->access_token)
                    ->connectTimeout(10)
                    ->timeout(20)
                    ->get($this->url($config->waba_id.'/phone_numbers'), array_filter([
                        'fields' => 'id',
                        'limit' => 100,
                        'after' => $after,
                    ]));
            } catch (ConnectionException) {
                return 'Could not reach the Meta Graph API';
            }

            if (! $response->successful()) {
                return $this->errorMessage($response);
            }

            if (collect($response->json('data', []))->contains(
                fn ($phone) => (string) data_get($phone, 'id') === (string) $config->phone_number_id
            )) {
                return null;
            }

            $next = $response->json('paging.next') ? $response->json('paging.cursors.after') : null;
            if ($after === $next) {
                break;
            }
            $after = $next;
        } while ($after);

        return 'The phone number is not listed under this WhatsApp Business Account.';
    }

    public function registerPhoneNumber(WhatsappConfig $config, string $pin): ?string
    {
        try {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(20)
                ->post($this->url($config->phone_number_id.'/register'), [
                    'messaging_product' => 'whatsapp',
                    'pin' => $pin,
                ]);
        } catch (ConnectionException) {
            return 'Could not reach the Meta Graph API';
        }

        if ($response->successful()) {
            return null;
        }

        $error = $this->errorMessage($response);

        return preg_match('/already.*registered/i', $error) ? null : $error;
    }

    public function verifyAppSubscription(WhatsappConfig $config): ?string
    {
        if (! $config->waba_id) {
            return 'No WhatsApp Business Account ID is configured.';
        }

        try {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(20)
                ->get($this->url($config->waba_id.'/subscribed_apps'));
        } catch (ConnectionException) {
            return 'Could not reach the Meta Graph API';
        }

        if (! $response->successful()) {
            return $this->errorMessage($response);
        }

        $appIds = collect($response->json('data', []))
            ->map(fn ($app) => trim((string) data_get($app, 'whatsapp_business_api_data.id', data_get($app, 'id', ''))))
            ->filter()
            ->unique()
            ->values();

        if ($appIds->isEmpty()) {
            return 'Meta returned no apps subscribed to this WABA. Check the WABA ID, app access to the business account, and the WhatsApp webhook configuration in Meta.';
        }

        $appId = trim((string) config('services.whatsapp.app_id'));
        if ($appId === '' || $appIds->contains($appId)) {
            return null;
        }

        return sprintf(
            'This WABA is subscribed to Meta app ID(s) %s, but META_APP_ID is %s. Set META_APP_ID to the app that issued the WhatsApp access token.',
            $appIds->implode(', '),
            $appId,
        );
    }

    public function subscribeApp(WhatsappConfig $config): ?string
    {
        if (! $config->waba_id) {
            return null;
        }

        try {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(20)
                ->post($this->url($config->waba_id.'/subscribed_apps'));
        } catch (ConnectionException) {
            return 'Could not reach the Meta Graph API';
        }

        return $response->successful() ? null : $this->errorMessage($response);
    }

    public function uploadMessageMedia(WhatsappConfig $config, UploadedFile $file): string
    {
        $stream = Utils::tryFopen($file->getPathname(), 'rb');

        try {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(60)
                ->attach(
                    'file',
                    $stream,
                    $file->getClientOriginalName(),
                    ['Content-Type' => $file->getMimeType()],
                )
                ->post($this->url($config->phone_number_id.'/media'), [
                    'messaging_product' => 'whatsapp',
                    'type' => $file->getMimeType(),
                ]);
        } catch (ConnectionException) {
            throw new MetaApiException('Could not upload the attachment to Meta.', 502);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        if (! $response->successful()) {
            throw $this->metaException($response);
        }

        $mediaId = $response->json('id');
        if (! is_string($mediaId) || $mediaId === '') {
            throw new MetaApiException('Meta did not return an attachment ID.', $response->status());
        }

        return $mediaId;
    }

    public function uploadTemplateHeader(WhatsappConfig $config, UploadedFile $file): string
    {
        $appId = config('services.whatsapp.app_id');
        if (! $appId) {
            throw new \RuntimeException('Set META_APP_ID before uploading template header media.');
        }

        $authorization = ['Authorization' => 'OAuth '.$config->access_token];
        $query = http_build_query([
            'file_length' => $file->getSize(),
            'file_type' => $file->getMimeType(),
            'file_name' => $file->getClientOriginalName(),
        ]);

        try {
            $session = Http::withHeaders($authorization)
                ->connectTimeout(10)
                ->timeout(30)
                ->post($this->url($appId.'/uploads').'?'.$query);
        } catch (ConnectionException) {
            throw new MetaApiException('Could not start the Meta template media upload.', 502);
        }

        if (! $session->successful()) {
            throw $this->metaException($session);
        }

        $sessionId = $session->json('id');
        if (! is_string($sessionId) || $sessionId === '') {
            throw new MetaApiException('Meta did not return a template upload session.', $session->status());
        }

        $stream = Utils::tryFopen($file->getPathname(), 'rb');

        try {
            $upload = Http::withHeaders($authorization + ['file_offset' => '0'])
                ->connectTimeout(10)
                ->timeout(60)
                ->withBody($stream, $file->getMimeType())
                ->post($this->url($sessionId));
        } catch (ConnectionException) {
            throw new MetaApiException('Could not upload the template header to Meta.', 502);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        if (! $upload->successful()) {
            throw $this->metaException($upload);
        }

        $handle = $upload->json('h');
        if (! is_string($handle) || $handle === '') {
            throw new MetaApiException('Meta did not return a template header handle.', $upload->status());
        }

        return $handle;
    }

    public function downloadMessageMedia(WhatsappConfig $config, string $mediaId, string $type, ?int $maxBytes = null): array
    {
        try {
            $metadata = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(20)
                ->get($this->url($mediaId));
        } catch (ConnectionException) {
            throw new MetaApiException('Could not reach Meta to retrieve this attachment.', 502);
        }

        if (! $metadata->successful()) {
            throw $this->metaException($metadata);
        }

        $limit = min(WhatsappMedia::maxBytes($type), $maxBytes ?? PHP_INT_MAX);
        $reportedSize = $metadata->json('file_size');
        if (is_numeric($reportedSize) && (int) $reportedSize > $limit) {
            throw new \RuntimeException('This attachment exceeds the supported download size.');
        }

        $url = $metadata->json('url');
        $parts = is_string($url) ? parse_url($url) : false;
        $host = strtolower((string) ($parts['host'] ?? ''));
        $trustedHost = $host === 'fbsbx.com'
            || str_ends_with($host, '.fbsbx.com')
            || $host === 'fbcdn.net'
            || str_ends_with($host, '.fbcdn.net');

        if (($parts['scheme'] ?? null) !== 'https' || ! $trustedHost) {
            throw new \RuntimeException('Meta returned an invalid attachment URL.');
        }

        try {
            $download = Http::withToken($config->access_token)
                ->withOptions(['allow_redirects' => false])
                ->connectTimeout(10)
                ->timeout(60)
                ->get($url);
        } catch (ConnectionException) {
            throw new MetaApiException('Could not download the attachment from Meta.', 502);
        }

        if (! $download->successful()) {
            throw $this->metaException($download);
        }

        $body = $download->toPsrResponse()->getBody();
        $size = $body->getSize();
        if ($size === null || $size > $limit) {
            $body->close();
            throw new \RuntimeException('This attachment exceeds the supported download size.');
        }
        $body->rewind();

        return [
            'body' => $body,
            'mime_type' => $metadata->json('mime_type') ?: $download->header('Content-Type'),
        ];
    }

    public function sendMessage(WhatsappConfig $config, string $to, array $payload): array
    {
        $response = Http::withToken($config->access_token)
            ->connectTimeout(10)
            ->timeout(30)
            ->post($this->url($config->phone_number_id.'/messages'), array_merge([
                'messaging_product' => 'whatsapp',
                'to' => $to,
            ], $payload));

        if (! $response->successful()) {
            $providerCode = $response->json('error.code');

            throw new MetaApiException(
                $this->errorMessage($response),
                $response->status(),
                $response->status() >= 500,
                is_numeric($providerCode) ? (int) $providerCode : null,
            );
        }

        $wamid = $response->json('messages.0.id');
        if (! $wamid) {
            throw new MetaApiException(
                'WhatsApp accepted the request without returning a message ID',
                $response->status(),
                true,
            );
        }

        return [
            'wamid' => $wamid,
            'timestamp' => $response->json('messages.0.timestamp'),
            'response' => $response->json(),
        ];
    }

    public function createTemplate(WhatsappConfig $config, array $payload): array
    {
        $response = Http::withToken($config->access_token)
            ->connectTimeout(10)
            ->timeout(30)
            ->post($this->url($config->waba_id.'/message_templates'), $payload);

        if (! $response->successful()) {
            throw new \RuntimeException($this->errorMessage($response));
        }

        return $response->json() ?? [];
    }

    public function fetchTemplates(WhatsappConfig $config): array
    {
        $templates = [];
        $after = null;
        for ($page = 0; $page < 20; $page++) {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(30)
                ->get($this->url($config->waba_id.'/message_templates'), array_filter([
                    'limit' => 100,
                    'fields' => 'id,name,language,status,category,components,quality_score',
                    'after' => $after,
                ]));

            if (! $response->successful()) {
                throw new \RuntimeException($this->errorMessage($response));
            }

            array_push($templates, ...($response->json('data') ?? []));
            $next = $response->json('paging.next') ? $response->json('paging.cursors.after') : null;
            if (! $next || $next === $after) {
                break;
            }
            $after = $next;
        }

        return $templates;
    }

    public function textPayload(string $body): array
    {
        return ['type' => 'text', 'text' => ['body' => $body]];
    }

    public function buttonsPayload(string $body, array $buttons, ?array $header = null, ?string $footer = null): array
    {
        $interactive = [
            'type' => 'button',
            'body' => ['text' => $body],
            'action' => [
                'buttons' => collect($buttons)
                    ->take(3)
                    ->map(fn (array $button) => [
                        'type' => 'reply',
                        'id' => (string) ($button['id'] ?? ''),
                        'title' => mb_substr((string) ($button['title'] ?? ''), 0, 20),
                    ])
                    ->values()
                    ->all(),
            ],
        ];

        if ($header && ! empty($header['text'])) {
            $interactive['header'] = ['type' => 'text', 'text' => mb_substr((string) $header['text'], 0, 60)];
        }
        if ($footer) {
            $interactive['footer'] = ['text' => mb_substr($footer, 0, 60)];
        }

        return ['type' => 'interactive', 'interactive' => $interactive];
    }

    public function listPayload(string $body, string $button, array $sections, ?array $header = null, ?string $footer = null): array
    {
        $interactive = [
            'type' => 'list',
            'body' => ['text' => $body],
            'action' => [
                'button' => mb_substr($button, 0, 20),
                'sections' => collect($sections)
                    ->take(10)
                    ->map(fn (array $section) => [
                        'title' => mb_substr((string) ($section['title'] ?? ''), 0, 24),
                        'rows' => collect($section['rows'] ?? [])
                            ->take(10)
                            ->map(fn (array $row) => [
                                'id' => (string) ($row['id'] ?? ''),
                                'title' => mb_substr((string) ($row['title'] ?? ''), 0, 24),
                                ...(empty($row['description']) ? [] : ['description' => mb_substr((string) $row['description'], 0, 72)]),
                            ])
                            ->values()
                            ->all(),
                    ])
                    ->values()
                    ->all(),
            ],
        ];

        if ($header && ! empty($header['text'])) {
            $interactive['header'] = ['type' => 'text', 'text' => mb_substr((string) $header['text'], 0, 60)];
        }
        if ($footer) {
            $interactive['footer'] = ['text' => mb_substr($footer, 0, 60)];
        }

        return ['type' => 'interactive', 'interactive' => $interactive];
    }

    public function messageMediaPayload(string $type, string $mediaId, ?string $caption, string $filename, ?string $mimeType = null): array
    {
        $media = ['id' => $mediaId];
        if ($type === 'document') {
            $media['filename'] = $filename;
        } elseif ($caption !== null && $caption !== '') {
            $media['caption'] = $caption;
        }
        if ($type === 'audio' && $mimeType && str_starts_with(strtolower($mimeType), 'audio/ogg')) {
            $media['voice'] = true;
        }

        return [
            'type' => $type,
            $type => $media,
        ];
    }

    public function templatePayload(string $name, string $language, array $variables, ?array $headerMedia = null, ?array $sendComponents = null): array
    {
        $payload = [
            'type' => 'template',
            'template' => [
                'name' => $name,
                'language' => ['code' => $language],
            ],
        ];

        if ($sendComponents !== null) {
            if ($sendComponents) {
                $payload['template']['components'] = $sendComponents;
            }

            return $payload;
        }

        $components = [];
        if ($headerMedia) {
            $type = strtolower($headerMedia['type']);
            $media = ['id' => $headerMedia['id']];
            if ($type === 'document' && ! empty($headerMedia['filename'])) {
                $media['filename'] = $headerMedia['filename'];
            }

            $components[] = [
                'type' => 'header',
                'parameters' => [[
                    'type' => $type,
                    $type => $media,
                ]],
            ];
        }

        if ($variables) {
            $components[] = [
                'type' => 'body',
                'parameters' => array_map(
                    fn ($value) => ['type' => 'text', 'text' => (string) $value],
                    array_values($variables),
                ),
            ];
        }

        if ($components) {
            $payload['template']['components'] = $components;
        }

        return $payload;
    }

    private function url(string $resource): string
    {
        return sprintf(
            'https://%s/%s/%s',
            config('services.whatsapp.host'),
            config('services.whatsapp.api_version'),
            $resource,
        );
    }

    private function errorMessage(Response $response): string
    {
        return $response->json('error.message') ?: 'Meta request failed (HTTP '.$response->status().')';
    }

    private function metaException(Response $response): MetaApiException
    {
        $providerCode = $response->json('error.code');

        return new MetaApiException(
            $this->errorMessage($response),
            $response->status(),
            $response->status() >= 500,
            is_numeric($providerCode) ? (int) $providerCode : null,
        );
    }
}
