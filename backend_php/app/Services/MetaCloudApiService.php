<?php

namespace App\Services;

use App\Exceptions\MetaApiException;
use App\Models\WhatsappConfig;
use App\Support\WhatsappMedia;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;

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
        try {
            $response = Http::withToken($config->access_token)
                ->connectTimeout(10)
                ->timeout(60)
                ->attach(
                    'file',
                    file_get_contents($file->getRealPath()),
                    $file->getClientOriginalName(),
                    ['Content-Type' => $file->getMimeType()],
                )
                ->post($this->url($config->phone_number_id.'/media'), [
                    'messaging_product' => 'whatsapp',
                    'type' => $file->getMimeType(),
                ]);
        } catch (ConnectionException) {
            throw new MetaApiException('Could not upload the attachment to Meta.', 502);
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

        try {
            $upload = Http::withHeaders($authorization + ['file_offset' => '0'])
                ->connectTimeout(10)
                ->timeout(60)
                ->withBody(file_get_contents($file->getRealPath()), $file->getMimeType())
                ->post($this->url($sessionId));
        } catch (ConnectionException) {
            throw new MetaApiException('Could not upload the template header to Meta.', 502);
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

    public function downloadMessageMedia(WhatsappConfig $config, string $mediaId, string $type): array
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

        $limit = WhatsappMedia::maxBytes($type);
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

        $body = $download->body();
        if (strlen($body) > $limit) {
            throw new \RuntimeException('This attachment exceeds the supported download size.');
        }

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
        $response = Http::withToken($config->access_token)
            ->connectTimeout(10)
            ->timeout(30)
            ->get($this->url($config->waba_id.'/message_templates'), ['limit' => 200]);

        if (! $response->successful()) {
            throw new \RuntimeException($this->errorMessage($response));
        }

        return $response->json('data') ?? [];
    }

    public function textPayload(string $body): array
    {
        return ['type' => 'text', 'text' => ['body' => $body]];
    }

    public function templatePayload(string $name, string $language, array $variables, ?array $headerMedia = null): array
    {
        $payload = [
            'type' => 'template',
            'template' => [
                'name' => $name,
                'language' => ['code' => $language],
            ],
        ];

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
