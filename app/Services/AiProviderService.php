<?php

namespace App\Services;

use App\Exceptions\AiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;

class AiProviderService
{
    public function generate(array $settings, array $messages, array $options = []): array
    {
        $provider = $settings['provider'] ?? 'openai';
        $timeout = max((int) config('ai.timeout_ms', 30000), 1000) / 1000;

        try {
            if ($provider === 'anthropic') {
                $url = $this->endpoint($settings, 'anthropic', '/v1/messages');
                $system = collect($messages)
                    ->where('role', 'system')
                    ->pluck('content')
                    ->implode("\n\n");

                $conversation = collect($messages)
                    ->whereIn('role', ['user', 'assistant'])
                    ->values()
                    ->map(fn (array $message) => [
                        'role' => $message['role'],
                        'content' => $message['content'],
                    ])
                    ->all();

                $response = Http::withHeaders([
                    'x-api-key' => $settings['api_key'],
                    'anthropic-version' => '2023-06-01',
                    'Content-Type' => 'application/json',
                ])->timeout($timeout)->post($url, array_filter([
                    'model' => $settings['model'],
                    'max_tokens' => $options['max_tokens'] ?? (int) config('ai.max_output_tokens', 1024),
                    'system' => $system ?: null,
                    'messages' => $conversation,
                ]))->throw()->json();

                $content = collect($response['content'] ?? [])
                    ->where('type', 'text')
                    ->pluck('text')
                    ->implode('');

                return [
                    'content' => trim($content),
                    'prompt_tokens' => (int) ($response['usage']['input_tokens'] ?? 0),
                    'completion_tokens' => (int) ($response['usage']['output_tokens'] ?? 0),
                    'model' => $response['model'] ?? $settings['model'],
                ];
            }

            $url = $this->endpoint($settings, 'openai', '/v1/chat/completions');
            $response = Http::withToken($settings['api_key'])
                ->timeout($timeout)
                ->post($url, [
                    'model' => $settings['model'],
                    'messages' => array_values($messages),
                    'max_tokens' => $options['max_tokens'] ?? (int) config('ai.max_output_tokens', 1024),
                    'temperature' => 0.3,
                ])
                ->throw()
                ->json();

            return [
                'content' => trim((string) data_get($response, 'choices.0.message.content', '')),
                'prompt_tokens' => (int) ($response['usage']['prompt_tokens'] ?? 0),
                'completion_tokens' => (int) ($response['usage']['completion_tokens'] ?? 0),
                'model' => $response['model'] ?? $settings['model'],
            ];
        } catch (ConnectionException $exception) {
            throw new AiException('The AI provider could not be reached. Check the base URL and try again.', 502);
        } catch (RequestException $exception) {
            $body = $exception->response->json();
            $message = data_get($body, 'error.message') ?: data_get($body, 'message');

            throw new AiException($message ?: 'The AI provider rejected the request.', $exception->response->status());
        }
    }

    public function embed(array $settings, array $texts): ?array
    {
        if (empty($settings['embeddings_api_key']) || ! in_array($settings['provider'] ?? 'openai', ['openai', 'openai_compatible'], true)) {
            return null;
        }

        $timeout = max((int) config('ai.timeout_ms', 30000), 1000) / 1000;
        $url = $this->endpoint($settings, 'openai', '/v1/embeddings');

        try {
            $response = Http::withToken($settings['embeddings_api_key'])
                ->timeout($timeout)
                ->post($url, [
                    'model' => 'text-embedding-3-small',
                    'input' => array_values($texts),
                ])
                ->throw()
                ->json();

            $vectors = collect($response['data'] ?? [])
                ->sortBy('index')
                ->pluck('embedding')
                ->all();

            return count($vectors) === count($texts) ? $vectors : null;
        } catch (ConnectionException|RequestException) {
            return null;
        }
    }

    private function endpoint(array $settings, string $provider, string $path): string
    {
        $defaults = [
            'openai' => 'https://api.openai.com',
            'anthropic' => 'https://api.anthropic.com',
        ];

        $base = rtrim(trim((string) ($settings['base_url'] ?? '')), '/');
        $base = $base ?: ($defaults[$provider] ?? '');
        $parts = parse_url($base);

        if (! $parts || ! in_array($parts['scheme'] ?? null, ['http', 'https'], true) || empty($parts['host'])) {
            throw new AiException('The AI base URL is invalid.', 422);
        }

        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new AiException('The AI base URL must not include credentials.', 422);
        }

        if (($parts['scheme'] === 'http') && ! in_array($parts['host'], config('ai.allowed_private_hosts', []), true)) {
            throw new AiException('Plain HTTP is only allowed for configured local AI providers.', 422);
        }

        $version = '/v1';
        if (str_ends_with($parts['path'] ?? '', $version) && str_starts_with($path, $version.'/')) {
            $path = substr($path, strlen($version));
        }

        return $base.$path;
    }
}
