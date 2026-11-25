<?php

namespace App\Services;

class AutomationValidator
{
    public const TRIGGERS = [
        'new_message_received', 'first_inbound_message', 'keyword_match',
        'new_contact_created', 'conversation_assigned', 'tag_added',
        'time_based', 'interactive_reply',
    ];

    public const STEPS = [
        'send_message', 'send_buttons', 'send_list', 'send_template',
        'add_tag', 'assign_conversation', 'update_contact_field',
        'wait', 'condition', 'send_webhook',
    ];

    public function validate(array $automation, array $steps): array
    {
        $issues = [];
        if (! trim((string) ($automation['name'] ?? ''))) {
            $issues[] = ['path' => 'name', 'message' => 'A name is required.'];
        }
        if (! in_array($automation['trigger_type'] ?? '', self::TRIGGERS, true)) {
            $issues[] = ['path' => 'trigger_type', 'message' => 'Choose a valid trigger.'];
        }
        $issues = array_merge($issues, $this->trigger($automation['trigger_type'] ?? '', $automation['trigger_config'] ?? []));

        if (! empty($automation['is_active']) && ! $steps) {
            $issues[] = ['path' => 'steps', 'message' => 'Add at least one step before activating.'];
        }

        foreach ($steps as $index => $step) {
            $issues = array_merge($issues, $this->step($step, 'steps['.$index.']'));
        }

        return $issues;
    }

    private function trigger(string $type, mixed $config): array
    {
        $config = is_array($config) ? $config : [];
        $issues = [];

        if ($type === 'keyword_match') {
            $keywords = array_filter(array_map('trim', (array) ($config['keywords'] ?? [])), 'strlen');
            if (! $keywords) {
                $issues[] = ['path' => 'trigger_config.keywords', 'message' => 'Add at least one keyword.'];
            }
            if (! in_array($config['match_type'] ?? 'contains', ['contains', 'word', 'exact'], true)) {
                $issues[] = ['path' => 'trigger_config.match_type', 'message' => 'Choose a valid match type.'];
            }
        }

        if ($type === 'tag_added' && empty($config['tag_id'])) {
            $issues[] = ['path' => 'trigger_config.tag_id', 'message' => 'Choose a tag.'];
        }
        if ($type === 'interactive_reply' && ! array_filter((array) ($config['reply_ids'] ?? []), 'strlen')) {
            $issues[] = ['path' => 'trigger_config.reply_ids', 'message' => 'Add at least one reply ID.'];
        }
        if ($type === 'time_based' && empty($config['schedule'])) {
            $issues[] = ['path' => 'trigger_config.schedule', 'message' => 'Choose a schedule.'];
        }

        return $issues;
    }

    private function step(array $step, string $path): array
    {
        $type = $step['step_type'] ?? '';
        $config = is_array($step['config'] ?? null) ? $step['config'] : [];
        $issues = [];

        if (! in_array($type, self::STEPS, true)) {
            $issues[] = ['path' => $path.'.step_type', 'message' => 'Unknown step type: '.$type];

            return $issues;
        }

        $required = match ($type) {
            'send_message' => ['text'],
            'send_template' => ['template_name'],
            'add_tag' => ['tag_id'],
            'assign_conversation' => [],
            'update_contact_field' => ['field', 'value'],
            'wait' => ['amount', 'unit'],
            'send_webhook' => ['url'],
            default => [],
        };

        foreach ($required as $field) {
            if (! array_key_exists($field, $config) || $config[$field] === '' || $config[$field] === null) {
                $issues[] = ['path' => $path.'.'.$field, 'message' => 'This field is required.'];
            }
        }

        if ($type === 'wait') {
            if (! is_numeric($config['amount'] ?? null) || (float) $config['amount'] <= 0) {
                $issues[] = ['path' => $path.'.amount', 'message' => 'Wait amount must be a positive number.'];
            }
            if (! in_array($config['unit'] ?? '', ['minutes', 'hours', 'days'], true)) {
                $issues[] = ['path' => $path.'.unit', 'message' => 'Choose minutes, hours, or days.'];
            }
        }

        if ($type === 'assign_conversation' && ($config['mode'] ?? 'any') === 'specific' && empty($config['agent_id'])) {
            $issues[] = ['path' => $path.'.agent_id', 'message' => 'Choose an agent.'];
        }

        if ($type === 'send_webhook' && ! empty($config['url'])) {
            $parts = parse_url((string) $config['url']);
            if (! $parts || ! in_array($parts['scheme'] ?? null, ['http', 'https'], true) || empty($parts['host'])) {
                $issues[] = ['path' => $path.'.url', 'message' => 'Enter a valid HTTP or HTTPS URL.'];
            }
        }

        if ($type === 'condition') {
            if (empty($config['subject'])) {
                $issues[] = ['path' => $path.'.subject', 'message' => 'Choose a condition subject.'];
            }
            if (empty($config['operator'])) {
                $issues[] = ['path' => $path.'.operator', 'message' => 'Choose an operator.'];
            }
            if (! array_key_exists('value', $config)) {
                $issues[] = ['path' => $path.'.value', 'message' => 'Enter a comparison value.'];
            }
            foreach (['yes', 'no'] as $branch) {
                foreach (is_array($step[$branch] ?? null) ? $step[$branch] : [] as $index => $child) {
                    $issues = array_merge($issues, $this->step($child, $path.'.'.$branch.'.steps['.$index.']'));
                }
            }
        }

        return $issues;
    }
}
