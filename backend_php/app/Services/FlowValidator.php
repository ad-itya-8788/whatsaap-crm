<?php

namespace App\Services;

class FlowValidator
{
    public const STATUSES = ['draft', 'active', 'archived'];
    public const TRIGGERS = ['keyword', 'first_inbound_message', 'manual'];
    public const NODE_TYPES = [
        'start', 'send_message', 'send_buttons', 'send_list', 'send_media',
        'collect_input', 'condition', 'set_tag', 'handoff', 'end',
    ];
    public const AUTO = ['start', 'send_message', 'send_media', 'condition', 'set_tag'];
    public const SUSPENDING = ['send_buttons', 'send_list', 'collect_input'];
    public const TERMINAL = ['handoff', 'end'];

    public function validate(array $flow, array $nodes): array
    {
        $issues = [];
        if (! trim((string) ($flow['name'] ?? ''))) {
            $issues[] = ['severity' => 'error', 'scope' => 'flow', 'message' => 'A name is required.'];
        }
        if (! in_array($flow['trigger_type'] ?? '', self::TRIGGERS, true)) {
            $issues[] = ['severity' => 'error', 'scope' => 'trigger', 'message' => 'Choose a valid trigger.'];
        }
        if ($flow['trigger_type'] === 'keyword') {
            $keywords = array_filter(array_map('trim', (array) data_get($flow, 'trigger_config.keywords', [])), 'strlen');
            if (! $keywords) {
                $issues[] = ['severity' => 'error', 'scope' => 'trigger', 'message' => 'Add at least one keyword.'];
            }
        }

        $keys = [];
        foreach ($nodes as $node) {
            $key = (string) ($node['node_key'] ?? '');
            if (! $key) {
                $issues[] = ['severity' => 'error', 'scope' => 'flow', 'message' => 'Every node needs a key.'];
                continue;
            }
            if (isset($keys[$key])) {
                $issues[] = ['severity' => 'error', 'scope' => 'flow', 'message' => 'Duplicate node key: '.$key];
            }
            $keys[$key] = true;
        }

        $entry = (string) ($flow['entry_node_id'] ?? '');
        if (! $entry || ! isset($keys[$entry])) {
            $issues[] = ['severity' => 'error', 'scope' => 'flow', 'message' => 'Choose an existing entry node.'];
        }
        if (! $nodes) {
            $issues[] = ['severity' => 'error', 'scope' => 'flow', 'message' => 'Add at least one node.'];
        }

        foreach ($nodes as $node) {
            $issues = array_merge($issues, $this->node($node, $keys));
        }

        return $issues;
    }

    private function node(array $node, array $keys): array
    {
        $key = (string) ($node['node_key'] ?? 'unknown');
        $type = (string) ($node['node_type'] ?? '');
        $config = is_array($node['config'] ?? null) ? $node['config'] : [];
        $issues = [];

        $error = fn (string $field, string $message) => [
            'severity' => 'error', 'scope' => 'node', 'node_key' => $key, 'field' => $field, 'message' => $message,
        ];

        if (! in_array($type, self::NODE_TYPES, true)) {
            return [$error('node_type', 'Unknown node type: '.$type)];
        }

        if (in_array($type, ['send_message', 'send_buttons', 'send_list', 'collect_input'], true) && ! trim((string) ($config['text'] ?? ''))) {
            $issues[] = $error('text', 'Enter the message text.');
        }

        if ($type === 'send_media') {
            if (empty($config['media_type'])) {
                $issues[] = $error('media_type', 'Choose a media type.');
            }
            if (empty($config['media_url'])) {
                $issues[] = $error('media_url', 'Enter a Meta media ID.');
            }
            if (mb_strlen((string) ($config['caption'] ?? '')) > 1024) {
                $issues[] = $error('caption', 'Captions must be 1024 characters or fewer.');
            }
        }

        if ($type === 'set_tag' && empty($config['tag_id'])) {
            $issues[] = $error('tag_id', 'Choose a tag.');
        }

        if ($type === 'condition' && (empty($config['field']) || ! array_key_exists('value', $config))) {
            $issues[] = $error('condition', 'Set a field and comparison value.');
        }

        if ($type === 'send_buttons') {
            $buttons = (array) ($config['buttons'] ?? []);
            if (! $buttons || count($buttons) > 3) {
                $issues[] = $error('buttons', 'Use between 1 and 3 buttons.');
            }
            foreach ($buttons as $index => $button) {
                if (mb_strlen((string) ($button['title'] ?? '')) > 20) {
                    $issues[] = $error('buttons.'.$index.'.title', 'Button titles must be 20 characters or fewer.');
                }
                if (! $this->targetExists($button['next_node_key'] ?? null, $keys)) {
                    $issues[] = $error('buttons.'.$index.'.next_node_key', 'Choose an existing target node.');
                }
            }
        }

        if ($type === 'send_list') {
            $rows = [];
            foreach ((array) ($config['sections'] ?? []) as $section) {
                foreach ((array) ($section['rows'] ?? []) as $row) {
                    $rows[] = $row;
                }
            }
            if (! $rows || count($rows) > 10) {
                $issues[] = $error('sections', 'Use between 1 and 10 list rows.');
            }
            foreach ($rows as $index => $row) {
                if (mb_strlen((string) ($row['title'] ?? '')) > 24) {
                    $issues[] = $error('sections.rows.'.$index.'.title', 'Row titles must be 24 characters or fewer.');
                }
                if (! $this->targetExists($row['next_node_key'] ?? null, $keys)) {
                    $issues[] = $error('sections.rows.'.$index.'.next_node_key', 'Choose an existing target node.');
                }
            }
        }

        if (! in_array($type, self::TERMINAL, true)) {
            if ($type === 'collect_input' && ! $this->targetExists($config['next_node_key'] ?? null, $keys)) {
                $issues[] = $error('next_node_key', 'Choose an existing next node.');
            }
            if (in_array($type, self::AUTO, true) && ! $this->targetExists($config['next_node_key'] ?? null, $keys)) {
                $issues[] = $error('next_node_key', 'Choose an existing next node.');
            }
            if ($type === 'condition') {
                if (! $this->targetExists($config['true_next'] ?? null, $keys)) {
                    $issues[] = $error('true_next', 'Choose an existing true branch node.');
                }
                if (! $this->targetExists($config['false_next'] ?? null, $keys)) {
                    $issues[] = $error('false_next', 'Choose an existing false branch node.');
                }
            }
        }

        return $issues;
    }

    private function targetExists(mixed $target, array $keys): bool
    {
        return is_string($target) && isset($keys[$target]);
    }
}
