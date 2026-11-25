<?php

namespace App\Services;

use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Flow;
use App\Models\FlowNode;
use App\Models\FlowRun;
use App\Models\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class FlowEngine
{
    private const MAX_NODES = 50;

    public function __construct(
        private FlowService $flows,
        private MessagingService $messaging,
        private MetaCloudApiService $meta,
    ) {}

    public function dispatchInbound(Message $message): bool
    {
        $conversation = $message->conversation;
        if (! $conversation) {
            return false;
        }
        $contact = $conversation->contact;
        if (! $contact) {
            return false;
        }

        $replyId = (string) ($message->interactive_reply_id
            ?: data_get($message->meta, 'interactive.button_reply.id')
            ?: data_get($message->meta, 'interactive.list_reply.id')
            ?: '');
        $text = (string) ($message->content_text ?? '');
        $firstInbound = $this->isFirstInbound($conversation, $message);

        $run = FlowRun::query()
            ->where('contact_id', $contact->id)
            ->where('status', 'active')
            ->latest('id')
            ->first();

        if ($run) {
            if (! $this->runHealthy($run)) {
                return false;
            }
            $this->handleReply($run, $message, $text, $replyId);
            return true;
        }

        $flows = Flow::query()
            ->where('status', 'active')
            ->whereIn('trigger_type', ['keyword', 'first_inbound_message'])
            ->get();

        foreach ($flows as $flow) {
            if (! $this->triggerMatches($flow, $text, $replyId, $firstInbound)) {
                continue;
            }
            $this->start($flow, $contact, $conversation, $message, $text, $replyId);
            return true;
        }

        return false;
    }

    public function start(Flow $flow, Contact $contact, Conversation $conversation, Message $message, string $text = '', string $replyId = ''): FlowRun
    {
        $run = FlowRun::create([
            'flow_id' => $flow->id,
            'user_id' => $flow->user_id,
            'contact_id' => $contact->id,
            'conversation_id' => $conversation->id,
            'status' => 'active',
            'vars' => [
                'input' => $text,
                'reply_id' => $replyId,
                'contact' => ['name' => $contact->name ?: 'there', 'phone' => $contact->phone_normalized ?: $contact->phone],
            ],
            'started_at' => now(),
            'last_advanced_at' => now(),
        ]);

        $flow->increment('execution_count');
        $flow->forceFill(['last_executed_at' => now()])->save();
        $this->event($run, 'flow_started', null, ['message_id' => $message->id]);
        $this->process($run, (string) $flow->entry_node_id, $message);

        return $run->refresh();
    }

    public function sweepTimeouts(int $limit = 100): int
    {
        $runs = FlowRun::query()->where('status', 'active')->limit($limit)->get();
        $swept = 0;

        foreach ($runs as $run) {
            $hours = (float) (data_get($run->flow, 'fallback_policy.on_timeout_hours', 24) ?: 24);
            $since = $run->last_advanced_at ?: $run->started_at;
            if (! $since || $since->gt(now()->subHours($hours))) {
                continue;
            }
            $run->update([
                'status' => 'timed_out',
                'end_reason' => 'timeout',
                'ended_at' => now(),
            ]);
            $this->event($run, 'timeout', $run->current_node_key, [
                'age_hours' => $since->diffInHours(now()),
                'policy_hours' => $hours,
            ]);
            $swept++;
        }

        return $swept;
    }

    private function handleReply(FlowRun $run, Message $message, string $text, string $replyId): void
    {
        $node = $this->node($run, (string) $run->current_node_key);
        if (! $node) {
            $this->end($run, 'failed', 'node_not_found');
            return;
        }

        $config = is_array($node->config) ? $node->config : [];
        $vars = is_array($run->vars) ? $run->vars : [];
        $vars['input'] = $text;
        $vars['reply_id'] = $replyId;
        $run->update(['vars' => $vars, 'transition_seq' => $run->transition_seq + 1]);

        $target = match ($node->node_type) {
            'collect_input' => $config['next_node_key'] ?? null,
            'send_buttons' => $this->buttonTarget($config['buttons'] ?? [], $replyId, $text),
            'send_list' => $this->listTarget($config['sections'] ?? [], $replyId, $text),
            default => $config['next_node_key'] ?? null,
        };

        if (! $target) {
            if ($this->fallback($run, $node, $message, $text)) {
                return;
            }
            $this->end($run, 'failed', 'missing_next_node');
            return;
        }

        $this->event($run, 'reply_received', $node->node_key, ['text' => $text, 'reply_id' => $replyId]);
        $this->process($run, (string) $target, $message);
    }

    private function process(FlowRun $run, string $nodeKey, Message $message): void
    {
        $flow = $run->flow;
        if (! $flow || $flow->status !== 'active') {
            $this->end($run, 'cancelled', 'flow_not_active');
            return;
        }

        $nodes = $flow->nodes->keyBy('node_key');
        $steps = 0;

        while ($nodeKey && $steps++ < self::MAX_NODES) {
            $node = $nodes->get($nodeKey);
            if (! $node) {
                $this->end($run, 'failed', 'node_not_found');
                return;
            }

            $this->event($run, 'node_entered', $nodeKey);
            $config = is_array($node->config) ? $node->config : [];

            switch ($node->node_type) {
                case 'start':
                    $nodeKey = (string) ($config['next_node_key'] ?? '');
                    break;

                case 'send_message':
                case 'send_media':
                    try {
                        $this->sendNode($run, $node, $config, $message);
                    } catch (Throwable $exception) {
                        $this->event($run, 'error', $nodeKey, ['message' => $exception->getMessage()]);
                        $this->end($run, 'failed', 'send_failed');
                        return;
                    }
                    $nodeKey = (string) ($config['next_node_key'] ?? '');
                    break;

                case 'set_tag':
                    if (! empty($config['tag_id']) && $run->contact_id) {
                        $run->contact?->tags()->syncWithoutDetaching([(int) $config['tag_id']]);
                    }
                    $nodeKey = (string) ($config['next_node_key'] ?? '');
                    break;

                case 'condition':
                    $passed = $this->condition($config, $run);
                    $nodeKey = (string) ($passed ? ($config['true_next'] ?? '') : ($config['false_next'] ?? ''));
                    break;

                case 'send_buttons':
                case 'send_list':
                case 'collect_input':
                    try {
                        $sent = $this->sendNode($run, $node, $config, $message);
                    } catch (Throwable $exception) {
                        $this->event($run, 'error', $nodeKey, ['message' => $exception->getMessage()]);
                        $this->end($run, 'failed', 'send_failed');
                        return;
                    }
                    $run->update([
                        'status' => 'active',
                        'current_node_key' => $nodeKey,
                        'last_prompt_message_id' => $sent?->id,
                        'last_advanced_at' => now(),
                        'transition_seq' => $run->transition_seq + 1,
                    ]);
                    return;

                case 'handoff':
                    $this->event($run, 'handoff', $nodeKey);
                    $this->end($run, 'handed_off', 'handoff');
                    return;

                case 'end':
                    $this->event($run, 'completed', $nodeKey);
                    $this->end($run, 'completed', 'end');
                    return;

                default:
                    $this->end($run, 'failed', 'unknown_node_type');
                    return;
            }

            $run->update([
                'current_node_key' => $nodeKey ?: $node->node_key,
                'last_advanced_at' => now(),
                'transition_seq' => $run->transition_seq + 1,
            ]);
        }

        $this->end($run, 'failed', 'max_nodes_exceeded');
    }

    private function sendNode(FlowRun $run, FlowNode $node, array $config, Message $message, string $suffix = ''): ?Message
    {
        $conversation = $run->conversation;
        if (! $conversation) {
            throw new \RuntimeException('The flow run has no conversation.');
        }

        $body = $this->interpolate((string) ($config['text'] ?? ''), $run);
        $data = [
            'sender_type' => 'bot',
            'content_text' => $body,
            'idempotency_key' => 'flow:'.$run->id.':node:'.$node->node_key.($suffix ? ':'.$suffix : ''),
            'meta' => ['flow_run_id' => $run->id, 'flow_node_key' => $node->node_key],
        ];

        if ($node->node_type === 'send_media') {
            $type = in_array($config['media_type'] ?? '', ['image', 'video', 'audio', 'document'], true) ? $config['media_type'] : 'image';
            $data['content_type'] = $type;
            $caption = $this->interpolate((string) ($config['caption'] ?? ''), $run);
            $data['content_text'] = $caption;
            $data['payload'] = $this->meta->messageMediaPayload(
                $type,
                (string) ($config['media_url'] ?? ''),
                $caption,
                'media',
            );
        } elseif ($node->node_type === 'send_buttons') {
            $data['content_type'] = 'interactive';
            $data['payload'] = $this->meta->buttonsPayload(
                $body,
                collect($config['buttons'] ?? [])->map(fn ($button) => [
                    'id' => (string) ($button['id'] ?? ''),
                    'title' => $this->interpolate((string) ($button['title'] ?? ''), $run),
                ])->all(),
                isset($config['header']) ? ['text' => $this->interpolate((string) $config['header'], $run)] : null,
                isset($config['footer']) ? $this->interpolate((string) $config['footer'], $run) : null,
            );
        } elseif ($node->node_type === 'send_list') {
            $sections = collect($config['sections'] ?? [])->map(fn ($section) => [
                'title' => $this->interpolate((string) ($section['title'] ?? ''), $run),
                'rows' => collect($section['rows'] ?? [])->map(fn ($row) => [
                    'id' => (string) ($row['id'] ?? ''),
                    'title' => $this->interpolate((string) ($row['title'] ?? ''), $run),
                    'description' => isset($row['description']) ? $this->interpolate((string) $row['description'], $run) : null,
                ])->all(),
            ])->all();
            $data['content_type'] = 'interactive';
            $data['payload'] = $this->meta->listPayload(
                $body,
                $this->interpolate((string) ($config['button'] ?? 'Choose an option'), $run),
                $sections,
                isset($config['header']) ? ['text' => $this->interpolate((string) $config['header'], $run)] : null,
                isset($config['footer']) ? $this->interpolate((string) $config['footer'], $run) : null,
            );
        } else {
            $data['content_type'] = 'text';
        }

        $sent = $this->messaging->send($conversation, $data, $run->user_id);
        $this->event($run, 'message_sent', $node->node_key, ['message_id' => $sent->id]);

        return $sent;
    }

    private function fallback(FlowRun $run, FlowNode $node, Message $message, string $text): bool
    {
        $policy = is_array($run->flow?->fallback_policy) ? $run->flow->fallback_policy : [];
        $action = in_array($policy['on_unknown_reply'] ?? 'reprompt', ['reprompt', 'handoff', 'end', 'ignore'], true)
            ? $policy['on_unknown_reply']
            : 'reprompt';
        $max = max(0, (int) ($policy['max_reprompts'] ?? 1));

        if ($action === 'ignore') {
            $this->event($run, 'fallback_ignore', $node->node_key, ['text' => $text]);
            return true;
        }
        if ($action === 'handoff') {
            $this->end($run, 'handed_off', 'unknown_reply');
            return true;
        }
        if ($action === 'end') {
            $this->end($run, 'completed', 'unknown_reply');
            return true;
        }
        if ($run->reprompt_count >= $max) {
            $exhaust = in_array($policy['on_exhaust'] ?? 'handoff', ['handoff', 'end'], true) ? $policy['on_exhaust'] : 'handoff';
            $this->end($run, $exhaust === 'handoff' ? 'handed_off' : 'completed', 'reprompts_exhausted');
            return true;
        }

        $config = is_array($node->config) ? $node->config : [];
        try {
            $this->sendNode($run, $node, $config, $message, 'reprompt:'.$run->reprompt_count);
            $run->increment('reprompt_count');
            $this->event($run, 'reprompt', $node->node_key);
        } catch (Throwable $exception) {
            Log::warning('flow.reprompt.failed', ['run_id' => $run->id, 'error' => $exception->getMessage()]);
            $this->end($run, 'failed', 'reprompt_failed');
        }

        return true;
    }

    private function runHealthy(FlowRun $run): bool
    {
        $flow = $run->flow;
        if (! $flow || $flow->status !== 'active' || $run->current_node_key === null) {
            $this->end($run, 'cancelled', 'flow_not_active');
            return false;
        }
        if (! $this->node($run, $run->current_node_key)) {
            $this->end($run, 'failed', 'node_not_found');
            return false;
        }
        $hours = (float) (data_get($flow, 'fallback_policy.on_timeout_hours', 24) ?: 24);
        $since = $run->last_advanced_at ?: $run->started_at;
        if ($since && $since->lt(now()->subHours($hours))) {
            $this->end($run, 'timed_out', 'timeout');
            return false;
        }

        return true;
    }

    private function triggerMatches(Flow $flow, string $text, string $replyId, bool $firstInbound): bool
    {
        if ($flow->trigger_type === 'first_inbound_message') {
            return $firstInbound;
        }
        if ($flow->trigger_type !== 'keyword') {
            return false;
        }

        $keywords = array_filter(array_map('trim', (array) data_get($flow, 'trigger_config.keywords', [])), 'strlen');
        foreach ($keywords as $keyword) {
            if (str_contains(mb_strtolower($text), mb_strtolower($keyword))
                || str_contains(mb_strtolower($replyId), mb_strtolower($keyword))) {
                return true;
            }
        }

        return false;
    }

    private function buttonTarget(array $buttons, string $replyId, string $text): ?string
    {
        foreach ($buttons as $button) {
            if (($replyId && (string) ($button['id'] ?? '') === $replyId)
                || ($text !== '' && mb_strtolower((string) ($button['title'] ?? '')) === mb_strtolower($text))) {
                return $button['next_node_key'] ?? null;
            }
        }

        return null;
    }

    private function listTarget(array $sections, string $replyId, string $text): ?string
    {
        foreach ($sections as $section) {
            foreach ((array) ($section['rows'] ?? []) as $row) {
                if (($replyId && (string) ($row['id'] ?? '') === $replyId)
                    || ($text !== '' && mb_strtolower((string) ($row['title'] ?? '')) === mb_strtolower($text))) {
                    return $row['next_node_key'] ?? null;
                }
            }
        }

        return null;
    }

    private function condition(array $config, FlowRun $run): bool
    {
        $field = (string) ($config['field'] ?? 'message.text');
        $value = (string) ($config['value'] ?? '');
        $actual = match ($field) {
            'message.text' => (string) data_get($run->vars, 'input', ''),
            'contact.name' => (string) data_get($run->vars, 'contact.name', ''),
            default => (string) data_get($run->vars, $field, ''),
        };

        return match ($config['operator'] ?? 'equals') {
            'contains' => str_contains(mb_strtolower($actual), mb_strtolower($value)),
            'not_equals' => $actual !== $value,
            default => $actual === $value,
        };
    }

    private function interpolate(string $template, FlowRun $run): string
    {
        return preg_replace_callback('/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/', function (array $matches) use ($run) {
            $key = $matches[1];
            $value = str_starts_with($key, 'contact.') ? data_get($run->vars, $key) : data_get($run->vars, $key);
            return is_scalar($value) ? (string) $value : '';
        }, $template) ?: $template;
    }

    private function isFirstInbound(Conversation $conversation, Message $message): bool
    {
        return ! Message::query()
            ->where('conversation_id', $conversation->id)
            ->where('sender_type', 'customer')
            ->where('id', '!=', $message->id)
            ->exists();
    }

    private function node(FlowRun $run, string $key): ?FlowNode
    {
        return $run->flow?->nodes->firstWhere('node_key', $key);
    }

    private function event(FlowRun $run, string $type, ?string $nodeKey, ?array $payload = null): void
    {
        $run->events()->create([
            'event_type' => $type,
            'node_key' => $nodeKey,
            'payload' => $payload,
        ]);
    }

    private function end(FlowRun $run, string $status, string $reason): void
    {
        $run->update([
            'status' => $status,
            'end_reason' => $reason,
            'ended_at' => now(),
        ]);
        $this->event($run, 'run_ended', $run->current_node_key, ['status' => $status, 'reason' => $reason]);
    }
}
