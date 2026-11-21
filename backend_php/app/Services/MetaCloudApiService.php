<?php

namespace App\Services;

use App\Models\WhatsappConfig;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
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
            throw new \RuntimeException($this->errorMessage($response));
        }

        $wamid = $response->json('messages.0.id');
        if (! $wamid) {
            throw new \RuntimeException('WhatsApp accepted the request without returning a message ID');
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

    public function templatePayload(string $name, string $language, array $variables): array
    {
        $payload = [
            'type' => 'template',
            'template' => [
                'name' => $name,
                'language' => ['code' => $language],
            ],
        ];

        if ($variables) {
            $payload['template']['components'] = [[
                'type' => 'body',
                'parameters' => array_map(
                    fn ($value) => ['type' => 'text', 'text' => (string) $value],
                    array_values($variables),
                ),
            ]];
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
}
