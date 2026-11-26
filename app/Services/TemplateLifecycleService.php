<?php

namespace App\Services;

use App\Models\MessageTemplate;
use App\Models\WhatsappConfig;
use Illuminate\Support\Facades\Log;

class TemplateLifecycleService
{
    public const WEBHOOK_FIELDS = [
        'message_template_status_update',
        'message_template_quality_update',
        'message_template_components_update',
    ];

    public static function status(string $status): ?string
    {
        $status = strtoupper($status);

        return match ($status) {
            'PENDING_REVIEW' => 'PENDING',
            'REINSTATED' => 'APPROVED',
            'DELETED' => 'PENDING_DELETION',
            'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION' => $status,
            default => null,
        };
    }

    public static function quality(mixed $value): ?string
    {
        $score = is_array($value) ? ($value['score'] ?? null) : $value;
        $score = is_string($score) ? strtoupper($score) : null;

        return in_array($score, ['GREEN', 'YELLOW', 'RED'], true) ? $score : null;
    }

    public function syncFromWebhook(WhatsappConfig $config, string $field, array $value): void
    {
        $id = $value['message_template_id'] ?? null;
        if ((! is_string($id) && ! is_int($id)) || ! ctype_digit((string) $id)) {
            return;
        }

        $id = (string) $id;
        if ($field === 'message_template_components_update') {
            Log::info('whatsapp.template.components_changed', ['template_id' => $id, 'waba_id' => $config->waba_id]);

            return;
        }

        $updates = $this->webhookUpdates($field, $value);
        if ($updates === []) {
            return;
        }

        $name = $value['message_template_name'] ?? null;
        $language = $value['message_template_language'] ?? null;
        $template = MessageTemplate::where('meta_template_id', $id)->first();
        if (! $template && is_string($name) && preg_match('/\A[a-z0-9_]{1,255}\z/', $name)) {
            $template = MessageTemplate::firstOrCreate(
                ['name' => $name, 'language' => $language ?: 'en_US'],
                ['meta_template_id' => $id, 'user_id' => $config->user_id, 'body_text' => '', ...$updates],
            );
        }

        if (! $template || (string) $template->meta_template_id !== $id
            || ($name && $template->name !== $name) || ($language && $template->language !== $language)) {
            return;
        }

        $template->update($updates);
    }

    private function webhookUpdates(string $field, array $value): array
    {
        if ($field === 'message_template_quality_update') {
            return ['quality_score' => self::quality($value['new_quality_score'] ?? null)];
        }

        $status = self::status((string) ($value['event'] ?? ''));
        if ($status === null) {
            return [];
        }

        $updates = ['status' => $status];
        if ($status === 'REJECTED') {
            $updates['rejection_reason'] = $value['reason'] ?? 'Rejected by Meta';
            $updates['submission_error'] = null;
        } elseif (in_array($status, ['APPROVED', 'PENDING'], true)) {
            $updates['rejection_reason'] = null;
            $updates['submission_error'] = null;
        }

        return $updates;
    }
}
