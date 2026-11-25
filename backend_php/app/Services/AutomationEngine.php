<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\AutomationLog;
use App\Models\AutomationPendingExecution;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageTemplate;
use App\Models\Tag;
use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class AutomationEngine
{
    public function __construct(
        private AutomationService $automations,
        private MessagingService $messaging,
        private MetaCloudApiService $meta,
    ) {}

    public function dispatch(string $trigger, array $event): int
    {
        $ran = 0;
        $query = Automation::query()->where('is_active', true)->where('trigger_type', $trigger);

        $query->each(function (Automation $automation) use ($trigger, $event, &$ran) {
            if (! $this->matches($automation, $trigger, $event)) {
                return;
            }
            $this->run($automation, $trigger, $event);
            $ran++;
        });

        return $ran;
    }

    public function run(Automation $automation, string $trigger, array $event): AutomationLog
    {
        $log = AutomationLog::create([
            'automation_id' => $automation->id,
            'user_id' => $automation->user_id,
            'contact_id' => $event['contact_id'] ?? null,
            'conversation_id' => $event['conversation_id'] ?? null,
            'trigger_event' => $trigger,
            'status' => 'failed',
        ]);

        $context = array_merge($event, [
            'log_id' => $log->id,
            'vars' => [],
            'automation' => ['name' => $automation->name],
            'contact' => $this->contactData($event['contact_id'] ?? null),
            'message' => ['text' => $event['text'] ?? ''],
        ]);

        try {
            $steps = $this->automations->builder($automation)['steps'];
            $result = $this->runScope($automation, $steps, $context, $log);
            $log->update(['status' => $result === 'partial' ? 'partial' : 'success']);
            $automation->increment('execution_count');
            $automation->forceFill(['last_executed_at' => now()])->save();
        } catch (Throwable $exception) {
            Log::error('automation.run.failed', [
                'automation_id' => $automation->id,
                'log_id' => $log->id,
                'error' => $exception->getMessage(),
            ]);
            $log->update(['status' => 'failed', 'error_message' => $exception->getMessage()]);
        }

        return $log->refresh();
    }

    public function resumeAwaitingReply(Contact $contact, Conversation $conversation, Message $message): int
    {
        $pendings = AutomationPendingExecution::query()
            ->where('status', 'awaiting_reply')
            ->where('contact_id', $contact->id)
            ->where('conversation_id', $conversation->id)
            ->orderByDesc('id')
            ->get();

        $resumed = 0;
        foreach ($pendings as $index => $pending) {
            if ($index > 0) {
                $pending->update(['status' => 'superseded']);
                continue;
            }
            $this->resume($pending, $message);
            $resumed++;
        }

        return $resumed;
    }

    public function dispatchPending(int $limit = 50): int
    {
        $rows = AutomationPendingExecution::query()
            ->where('status', 'pending')
            ->where(function ($query) {
                $query->whereNull('run_at')->orWhere('run_at', '<=', now());
            })
            ->where(function ($query) {
                $query->whereNull('claimed_at')->orWhere('claimed_at', '<=', now()->subMinutes(15));
            })
            ->orderBy('id')
            ->limit($limit)
            ->get();

        $count = 0;
        foreach ($rows as $row) {
            $this->resume($row);
            $count++;
        }

        return $count;
    }

    public function expireForAutomation(Automation $automation): int
    {
        return AutomationPendingExecution::query()
            ->where('automation_id', $automation->id)
            ->whereIn('status', ['pending', 'awaiting_reply'])
            ->update(['status' => 'expired', 'claimed_at' => now()]);
    }

    private function resume(AutomationPendingExecution $pending, ?Message $message = null): void
    {
        try {
            $pending->update(['status' => 'running', 'claimed_at' => now()]);
            $automation = Automation::findOrFail($pending->automation_id);

            if (! $automation->is_active) {
                $pending->update(['status' => 'expired']);
                return;
            }

            $context = is_array($pending->context) ? $pending->context : [];
            if ($message) {
                $context['message'] = ['text' => (string) $message->content_text];
                $context['interactive_reply_id'] = $message->interactive_reply_id
                    ?: data_get($message->meta, 'interactive.button_reply.id')
                    ?: data_get($message->meta, 'interactive.list_reply.id');
            }

            $log = $pending->log;
            $steps = $this->automations->builder($automation)['steps'];
            $scope = $this->scopeFor($steps, $pending->parent_step_id, $pending->branch);
            $result = $this->runScope(
                $automation,
                $scope,
                $context,
                $log,
                (int) $pending->next_step_position,
                $pending->parent_step_id,
                $pending->branch,
            );

            $pending->update(['status' => $result === 'partial' ? 'pending' : 'done']);
        } catch (Throwable $exception) {
            Log::error('automation.resume.failed', [
                'pending_id' => $pending->id,
                'error' => $exception->getMessage(),
            ]);
            $pending->update(['status' => 'failed']);
            $pending->log?->update([
                'status' => 'failed',
                'error_message' => $exception->getMessage(),
            ]);
        }
    }

    private function runScope(
        Automation $automation,
        array $steps,
        array $context,
        AutomationLog $log,
        int $start = 0,
        ?int $parentStepId = null,
        ?string $branch = null,
    ): string {
        $executed = is_array($log->steps_executed) ? $log->steps_executed : [];

        foreach (array_values($steps) as $index => $step) {
            if ($index < $start) {
                continue;
            }

            $type = $step['step_type'] ?? '';
            $config = is_array($step['config'] ?? null) ? $step['config'] : [];
            $executed[] = $type;

            if ($type === 'wait') {
                $minutes = max(1, (int) ((float) ($config['amount'] ?? 1) * match ($config['unit'] ?? 'minutes') {
                    'hours' => 60,
                    'days' => 1440,
                    default => 1,
                }));

                AutomationPendingExecution::create([
                    'automation_id' => $automation->id,
                    'user_id' => $automation->user_id,
                    'contact_id' => $context['contact_id'] ?? null,
                    'conversation_id' => $context['conversation_id'] ?? null,
                    'log_id' => $log->id,
                    'parent_step_id' => $parentStepId,
                    'branch' => $branch,
                    'next_step_position' => $index + 1,
                    'parked_step_id' => is_numeric($step['id'] ?? null) ? (int) $step['id'] : null,
                    'context' => $this->serializableContext($context),
                    'status' => 'pending',
                    'run_at' => now()->addMinutes($minutes),
                ]);

                $log->update(['steps_executed' => $executed, 'status' => 'partial']);
                return 'partial';
            }

            if ($type === 'condition') {
                $passed = $this->condition($config, $context);
                $childBranch = $passed ? 'yes' : 'no';
                $result = $this->runScope(
                    $automation,
                    is_array($step[$childBranch] ?? null) ? $step[$childBranch] : [],
                    $context,
                    $log,
                    0,
                    is_numeric($step['id'] ?? null) ? (int) $step['id'] : null,
                    $childBranch,
                );
                $log->update(['steps_executed' => $executed]);
                if ($result === 'partial') {
                    return 'partial';
                }
                continue;
            }

            $this->executeStep($automation, $step, $context, $log, $index, $parentStepId, $branch);
            $log->update(['steps_executed' => $executed]);
        }

        return 'done';
    }

    private function executeStep(
        Automation $automation,
        array $step,
        array $context,
        AutomationLog $log,
        int $index,
        ?int $parentStepId,
        ?string $branch,
    ): void {

        $type = $step['step_type'] ?? '';
        $config = is_array($step['config'] ?? null) ? $step['config'] : [];
        $conversation = $this->conversation($context['conversation_id'] ?? null);
        $contactId = $context['contact_id'] ?? $conversation?->contact_id;
        $key = 'automation:'.$automation->id.':log:'.$log->id.':step:'.($step['id'] ?? 'new');

        switch ($type) {
            case 'send_message':
                $this->send($conversation, [
                    'content_type' => 'text',
                    'content_text' => $this->interpolate((string) ($config['text'] ?? ''), $context),
                    'idempotency_key' => $key,
                ], $automation->user_id);
                break;

            case 'send_template':
                $template = MessageTemplate::query()
                    ->where('name', $config['template_name'] ?? '')
                    ->where(function ($query) {
                        $query->where('approval_status', 'approved')
                            ->orWhere('status', 'approved');
                    })
                    ->firstOrFail();
                $this->send($conversation, [
                    'content_type' => 'template',
                    'template_name' => $template->name,
                    'template_language' => $template->language ?: 'en_US',
                    'template_params' => array_map(fn ($value) => $this->interpolate((string) $value, $context), array_values($config['params'] ?? [])),
                    'idempotency_key' => $key,
                ], $automation->user_id);
                break;

            case 'send_buttons':
                $buttons = collect($config['buttons'] ?? [])->map(fn ($button) => [
                    'id' => (string) ($button['id'] ?? ''),
                    'title' => $this->interpolate((string) ($button['title'] ?? ''), $context),
                ])->all();
                $this->send($conversation, [
                    'content_type' => 'interactive',
                    'content_text' => $this->interpolate((string) ($config['text'] ?? ''), $context),
                    'payload' => $this->meta->buttonsPayload(
                        $this->interpolate((string) ($config['text'] ?? ''), $context),
                        $buttons,
                        isset($config['header']) ? ['text' => $this->interpolate((string) $config['header'], $context)] : null,
                        isset($config['footer']) ? $this->interpolate((string) $config['footer'], $context) : null,
                    ),
                    'idempotency_key' => $key,
                ], $automation->user_id);
                if (! empty($config['wait_for_reply'])) {
                    $this->park($automation, $context, $log, $step, 'awaiting_reply', $index, $parentStepId, $branch);
                }
                break;

            case 'send_list':
                $sections = collect($config['sections'] ?? [])->map(fn ($section) => [
                    'title' => $this->interpolate((string) ($section['title'] ?? ''), $context),
                    'rows' => collect($section['rows'] ?? [])->map(fn ($row) => [
                        'id' => (string) ($row['id'] ?? ''),
                        'title' => $this->interpolate((string) ($row['title'] ?? ''), $context),
                        'description' => isset($row['description']) ? $this->interpolate((string) $row['description'], $context) : null,
                    ])->all(),
                ])->all();
                $this->send($conversation, [
                    'content_type' => 'interactive',
                    'content_text' => $this->interpolate((string) ($config['text'] ?? ''), $context),
                    'payload' => $this->meta->listPayload(
                        $this->interpolate((string) ($config['text'] ?? ''), $context),
                        $this->interpolate((string) ($config['button'] ?? 'Choose an option'), $context),
                        $sections,
                        isset($config['header']) ? ['text' => $this->interpolate((string) $config['header'], $context)] : null,
                        isset($config['footer']) ? $this->interpolate((string) $config['footer'], $context) : null,
                    ),
                    'idempotency_key' => $key,
                ], $automation->user_id);
                if (! empty($config['wait_for_reply'])) {
                    $this->park($automation, $context, $log, $step, 'awaiting_reply', $index, $parentStepId, $branch);
                }
                break;

            case 'add_tag':
                if ($contactId && ! empty($config['tag_id'])) {
                    $contact = Contact::find($contactId);
                    $contact?->tags()->syncWithoutDetaching([(int) $config['tag_id']]);
                }
                break;

            case 'assign_conversation':
                if ($conversation) {
                    $agentId = ($config['mode'] ?? 'any') === 'specific'
                        ? (int) ($config['agent_id'] ?? 0)
                        : User::query()->whereIn('role', ['agent', 'admin', 'owner'])->where('is_active', true)->value('id');
                    if ($agentId) {
                        $conversation->update(['assigned_agent_id' => $agentId]);
                    }
                }
                break;

            case 'update_contact_field':
                if ($contactId) {
                    $contact = Contact::find($contactId);
                    if ($contact) {
                        $field = (string) ($config['field'] ?? '');
                        $value = $this->interpolate((string) ($config['value'] ?? ''), $context);
                        if (str_starts_with($field, 'custom:')) {
                            $contact->customFieldValues();
                            \Illuminate\Support\Facades\DB::table('contact_custom_values')->updateOrInsert(
                                ['contact_id' => $contact->id, 'custom_field_id' => (int) substr($field, 7)],
                                ['value' => $value],
                            );
                        } elseif (in_array($field, ['name', 'email', 'company'], true)) {
                            $contact->update([$field => $value]);
                        }
                    }
                }
                break;

            case 'send_webhook':
                $this->webhook((string) ($config['url'] ?? ''), [
                    'automation' => $automation->name,
                    'contact' => $context['contact'] ?? [],
                    'message' => $context['message'] ?? [],
                    'vars' => $context['vars'] ?? [],
                ]);
                break;
        }
    }

    private function park(
        Automation $automation,
        array $context,
        AutomationLog $log,
        array $step,
        string $status,
        int $index,
        ?int $parentStepId,
        ?string $branch,
    ): void {
        AutomationPendingExecution::create([
            'automation_id' => $automation->id,
            'user_id' => $automation->user_id,
            'contact_id' => $context['contact_id'] ?? null,
            'conversation_id' => $context['conversation_id'] ?? null,
            'log_id' => $log->id,
            'parent_step_id' => $parentStepId,
            'branch' => $branch,
            'next_step_position' => $index + 1,
            'parked_step_id' => is_numeric($step['id'] ?? null) ? (int) $step['id'] : null,
            'context' => $this->serializableContext($context),
            'status' => $status,
            'run_at' => now()->addDay(),
        ]);
    }

    private function send(?Conversation $conversation, array $data, ?int $senderId): void
    {
        if (! $conversation) {
            throw new \RuntimeException('The automation has no conversation to send a message to.');
        }
        $data['sender_type'] = 'bot';
        $this->messaging->send($conversation, $data, $senderId);
    }

    private function condition(array $config, array $context): bool
    {
        $subject = (string) ($config['subject'] ?? '');
        $value = $this->interpolate((string) ($config['value'] ?? ''), $context);
        $actual = match ($subject) {
            'message_content' => (string) data_get($context, 'message.text', ''),
            'contact_field' => (string) data_get($context, 'contact.'.($config['field'] ?? ''), ''),
            'tag_presence' => $this->hasTag($context['contact_id'] ?? null, $config['tag_id'] ?? null),
            'time_of_day' => now()->format('H:i'),
            default => '',
        };

        return match ($config['operator'] ?? 'equals') {
            'contains' => str_contains(mb_strtolower($actual), mb_strtolower($value)),
            'not_equals' => $actual !== $value,
            'starts_with' => str_starts_with(mb_strtolower($actual), mb_strtolower($value)),
            'exists' => (bool) $actual,
            default => $actual === $value,
        };
    }

    private function hasTag(mixed $contactId, mixed $tagId): bool
    {
        if (! $contactId || ! $tagId) {
            return false;
        }

        return \Illuminate\Support\Facades\DB::table('contact_tag')
            ->where('contact_id', $contactId)
            ->where('tag_id', $tagId)
            ->exists();
    }

    private function matches(Automation $automation, string $trigger, array $event): bool
    {
        $config = is_array($automation->trigger_config) ? $automation->trigger_config : [];

        if (! empty($event['flow_consumed']) && in_array($trigger, ['new_message_received', 'keyword_match', 'first_inbound_message', 'interactive_reply'], true)) {
            return false;
        }

        return match ($trigger) {
            'new_message_received' => ! empty($event['text']),
            'first_inbound_message' => ! empty($event['first_inbound']),
            'keyword_match' => $this->keywordMatch((string) ($event['text'] ?? ''), $config),
            'new_contact_created' => ! empty($event['contact_created']),
            'conversation_assigned' => ! empty($event['agent_id']),
            'tag_added' => (string) ($event['tag_id'] ?? '') === (string) ($config['tag_id'] ?? ''),
            'interactive_reply' => in_array((string) ($event['interactive_reply_id'] ?? ''), array_map('strval', (array) ($config['reply_ids'] ?? [])), true),
            'time_based' => (string) ($event['schedule'] ?? '') === (string) ($config['schedule'] ?? ''),
            default => false,
        };
    }

    private function keywordMatch(string $text, array $config): bool
    {
        if ($text === '') {
            return false;
        }
        $keywords = array_filter(array_map('trim', (array) ($config['keywords'] ?? [])), 'strlen');
        $matchType = $config['match_type'] ?? 'contains';

        foreach ($keywords as $keyword) {
            if ($matchType === 'exact' && mb_strtolower(trim($text)) === mb_strtolower($keyword)) {
                return true;
            }
            if ($matchType === 'word' && preg_match('/(?<!\p{L})'.preg_quote($keyword, '/').'(?!\p{L})/iu', $text)) {
                return true;
            }
            if ($matchType === 'contains' && str_contains(mb_strtolower($text), mb_strtolower($keyword))) {
                return true;
            }
        }

        return false;
    }

    private function interpolate(string $template, array $context): string
    {
        return preg_replace_callback('/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/', function (array $matches) use ($context) {
            $value = data_get($context, $matches[1]);
            return is_scalar($value) ? (string) $value : '';
        }, $template) ?: $template;
    }

    private function serializableContext(array $context): array
    {
        return array_filter($context, fn ($value) => ! is_object($value));
    }

    private function scopeFor(array $steps, ?int $parentStepId, ?string $branch): array
    {
        if (! $parentStepId) {
            return $steps;
        }

        foreach ($steps as $step) {
            if ((int) ($step['id'] ?? 0) === $parentStepId && is_array($step[$branch] ?? null)) {
                return $step[$branch];
            }
            foreach (['yes', 'no'] as $childBranch) {
                $found = $this->scopeFor(is_array($step[$childBranch] ?? null) ? $step[$childBranch] : [], $parentStepId, $branch);
                if ($found) {
                    return $found;
                }
            }
        }

        return [];
    }

    private function contactData(mixed $contactId): array
    {
        $contact = $contactId ? Contact::find($contactId) : null;

        return [
            'id' => $contact?->id,
            'name' => $contact?->name ?: 'there',
            'phone' => $contact?->phone_normalized ?: $contact?->phone,
            'email' => $contact?->email,
            'company' => $contact?->company,
        ];
    }

    private function conversation(mixed $id): ?Conversation
    {
        return $id ? Conversation::find($id) : null;
    }

    private function webhook(string $url, array $payload): void
    {
        $parts = parse_url($url);
        if (! $parts || ! in_array($parts['scheme'] ?? null, ['http', 'https'], true) || empty($parts['host'])) {
            throw new \RuntimeException('The automation webhook URL is invalid.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new \RuntimeException('The automation webhook URL must not include credentials.');
        }
        $host = strtolower($parts['host']);
        if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local')) {
            throw new \RuntimeException('Local webhook destinations are not allowed.');
        }
        if (filter_var($host, FILTER_VALIDATE_IP) && ! filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            throw new \RuntimeException('Private webhook destinations are not allowed.');
        }

        try {
            Http::timeout(10)->post($url, $payload)->throw();
        } catch (ConnectionException $exception) {
            throw new \RuntimeException('The automation webhook could not be reached.', 0, $exception);
        }
    }
}
