<?php

namespace App\Services;

use App\Models\MessageTemplate;
use RuntimeException;

class TemplateSendBuilder
{
    public function components(MessageTemplate $template, array $params = [], ?array $headerMedia = null): array
    {
        $components = [];
        $header = $this->headerComponent($template, $params, $headerMedia);
        if ($header) {
            $components[] = $header;
        }

        $body = $this->bodyComponent($template, $params);
        if ($body) {
            $components[] = $body;
        }

        foreach ((array) ($template->buttons ?? []) as $index => $button) {
            if (! is_array($button)) {
                continue;
            }

            $component = $this->buttonComponent($button, (int) $index, $params['button_params'][$index] ?? $params['button_params'][(string) $index] ?? null);
            if ($component) {
                $components[] = $component;
            }
        }

        return $components;
    }

    private function headerComponent(MessageTemplate $template, array $params, ?array $headerMedia): ?array
    {
        $type = strtolower((string) ($template->header_type ?? ''));
        if ($type === '') {
            return null;
        }

        if ($type === 'text') {
            $count = $this->variableCount((string) ($template->header_content ?? ''));
            if ($count === 0) {
                return null;
            }

            $value = trim((string) ($params['header_text'] ?? ''));
            if ($value === '') {
                throw new RuntimeException('Enter a value for the header text variable.');
            }

            return [
                'type' => 'header',
                'parameters' => [['type' => 'text', 'text' => $value]],
            ];
        }

        if (! in_array($type, ['image', 'video', 'document'], true)) {
            return null;
        }

        $media = [];
        if ($headerMedia && ! empty($headerMedia['id'])) {
            $media['id'] = (string) $headerMedia['id'];
        } elseif ($headerMedia && ! empty($headerMedia['url'])) {
            $media['link'] = (string) $headerMedia['url'];
        } elseif ($template->header_media_url) {
            $media['link'] = (string) $template->header_media_url;
        } else {
            throw new RuntimeException('This template needs a media header for this send.');
        }

        if ($type === 'document' && $headerMedia && ! empty($headerMedia['filename'])) {
            $media['filename'] = (string) $headerMedia['filename'];
        }

        return [
            'type' => 'header',
            'parameters' => [[
                'type' => $type,
                $type => $media,
            ]],
        ];
    }

    private function bodyComponent(MessageTemplate $template, array $params): ?array
    {
        $count = $this->variableCount((string) ($template->body_text ?? ''));
        $values = array_values((array) ($params['body'] ?? []));
        if ($count === 0 && $values === []) {
            return null;
        }
        if (count($values) < $count) {
            throw new RuntimeException("This template needs {$count} body value(s), got ".count($values).'.');
        }

        return [
            'type' => 'body',
            'parameters' => array_map(
                fn ($value) => ['type' => 'text', 'text' => (string) $value],
                array_slice($values, 0, $count),
            ),
        ];
    }

    private function buttonComponent(array $button, int $index, mixed $override): ?array
    {
        $type = strtoupper((string) ($button['type'] ?? ''));
        $override = $override === null || $override === '' ? null : (string) $override;

        if ($type === 'URL') {
            if (! $override) {
                throw new RuntimeException("Enter a URL suffix for button ".($index + 1).'.');
            }

            return $this->button('url', $index, [['type' => 'text', 'text' => $override]]);
        }

        if ($type === 'COPY_CODE') {
            $code = $override ?: (string) ($button['example'] ?? '');
            if ($code === '') {
                throw new RuntimeException("Enter a coupon code for button ".($index + 1).'.');
            }

            return $this->button('copy_code', $index, [['type' => 'coupon_code', 'coupon_code' => $code]]);
        }

        if ($type === 'QUICK_REPLY' && $override) {
            return $this->button('quick_reply', $index, [['type' => 'payload', 'payload' => $override]]);
        }

        return null;
    }

    private function button(string $subType, int $index, array $parameters): array
    {
        return [
            'type' => 'button',
            'sub_type' => $subType,
            'index' => (string) $index,
            'parameters' => $parameters,
        ];
    }

    private function variableCount(string $text): int
    {
        if (! preg_match_all('/\{\{\s*(\d+)\s*\}\}/', $text, $matches)) {
            return 0;
        }

        return max(array_map('intval', $matches[1]));
    }
}
