<?php

namespace App\Services;

use App\Models\AiConfig;
use Illuminate\Support\Facades\Crypt;

class AiConfigService
{
    public const MASK = '••••••••••••••••';

    public function current(): ?AiConfig
    {
        return AiConfig::query()->first();
    }

    public function publicConfig(): array
    {
        $config = $this->current();

        return [
            'configured' => (bool) $config,
            'provider' => $config?->provider ?: 'openai',
            'model' => $config?->model ?: 'gpt-4o-mini',
            'base_url' => $config?->base_url,
            'system_prompt' => $config?->system_prompt,
            'is_active' => (bool) $config?->is_active,
            'auto_reply_enabled' => (bool) $config?->auto_reply_enabled,
            'auto_reply_max_per_conversation' => $config?->auto_reply_max_per_conversation ?? 3,
            'handoff_agent_id' => $config?->handoff_agent_id,
            'has_api_key' => (bool) $config?->api_key,
            'has_embeddings_key' => (bool) $config?->embeddings_api_key,
            'api_key' => $config ? self::MASK : '',
            'embeddings_api_key' => $config?->embeddings_api_key ? self::MASK : '',
            'updated_at' => $config?->updated_at,
        ];
    }

    public function save(array $data, int $userId): AiConfig
    {
        $config = $this->current() ?: new AiConfig();
        $existingKey = $config->api_key;
        $existingEmbeddings = $config->embeddings_api_key;

        $apiKey = $data['api_key'] ?? self::MASK;
        $embeddingsKey = $data['embeddings_api_key'] ?? '';

        $config->fill([
            'updated_by' => $userId,
            'provider' => $data['provider'],
            'model' => $data['model'],
            'base_url' => $data['base_url'] ?? null,
            'api_key' => $apiKey === self::MASK && $existingKey
                ? $existingKey
                : Crypt::encryptString((string) $apiKey),
            'embeddings_api_key' => $embeddingsKey === self::MASK && $existingEmbeddings
                ? $existingEmbeddings
                : ($embeddingsKey === '' || $embeddingsKey === self::MASK ? null : Crypt::encryptString((string) $embeddingsKey)),
            'system_prompt' => $data['system_prompt'] ?? null,
            'is_active' => (bool) ($data['is_active'] ?? true),
            'auto_reply_enabled' => $data['auto_reply_enabled'] ?? $config->auto_reply_enabled ?? false,
            'auto_reply_max_per_conversation' => $data['auto_reply_max_per_conversation'] ?? $config->auto_reply_max_per_conversation ?? 3,
            'handoff_agent_id' => array_key_exists('handoff_agent_id', $data) ? $data['handoff_agent_id'] : $config->handoff_agent_id,
        ]);

        $config->save();

        return $config->refresh();
    }

    public function settings(?AiConfig $config = null): array
    {
        $config ??= $this->current();

        if (! $config) {
            return [];
        }

        return [
            'provider' => $config->provider,
            'model' => $config->model,
            'base_url' => $config->base_url,
            'api_key' => $this->decrypt($config->api_key),
            'embeddings_api_key' => $config->embeddings_api_key ? $this->decrypt($config->embeddings_api_key) : null,
            'system_prompt' => $config->system_prompt,
        ];
    }

    public function decrypt(?string $value): string
    {
        if (! $value) {
            return '';
        }

        try {
            return Crypt::decryptString($value);
        } catch (\Throwable) {
            return '';
        }
    }

    public function delete(): void
    {
        AiConfig::query()->delete();
    }
}
