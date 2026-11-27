<?php

namespace App\Services;

use App\Models\AiConfig;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use App\Models\WhatsappConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Throwable;

class AiAutoReplyService
{
    public function __construct(
        private AiConfigService $configs,
        private AiService $ai,
        private MessagingService $messaging,
    ) {}

    public function dispatch(Message $inbound): void
    {
        try {
            $config = $this->configs->current();
            $conversation = Conversation::find($inbound->conversation_id);
            if (! $config || ! $conversation || ! $this->eligible($config, $conversation, $inbound)) {
                return;
            }

            $text = RateLimiter::attempt('ai-auto-reply', 30, fn () => $this->ai->autoReply($conversation, $config));
            if ($text === false) {
                return;
            }

            $claimed = DB::transaction(function () use ($inbound, $text): bool {
                $config = $this->configs->current();
                $conversation = Conversation::query()->lockForUpdate()->find($inbound->conversation_id);
                if (! $config || ! $conversation || ! $this->eligible($config, $conversation, $inbound)) {
                    return false;
                }

                if ($text === '' || str_contains($text, '[[HANDOFF]]')) {
                    $this->handoff($config, $conversation, $inbound);

                    return false;
                }

                $conversation->increment('ai_reply_count');

                return true;
            });

            if ($claimed) {
                $this->messaging->send($conversation, [
                    'content_type' => 'text',
                    'content_text' => Str::limit($text, 4096, ''),
                    'sender_type' => 'bot',
                    'ai_generated' => true,
                    'idempotency_key' => 'ai-reply:'.$inbound->id,
                ], $config->updated_by);
            }
        } catch (Throwable $error) {
            Log::warning('ai.auto_reply.failed', ['inbound_id' => $inbound->id, 'error_type' => get_class($error)]);
        }
    }

    private function eligible(AiConfig $config, Conversation $conversation, Message $inbound): bool
    {
        if (! $config->is_active || ! $config->auto_reply_enabled || $conversation->assigned_agent_id
            || $conversation->ai_autoreply_disabled || $conversation->status === 'closed'
            || $conversation->ai_reply_count >= $config->auto_reply_max_per_conversation
            || ! $conversation->last_inbound_at?->gt(now()->subHours(24))) {
            return false;
        }

        $phone = WhatsappConfig::query()->latest('id')->first();
        if (! $phone || $phone->status !== 'connected' || $phone->phone_number_id !== data_get($inbound->meta, 'phone_number_id')) {
            return false;
        }

        return (int) $conversation->messages()->latest('id')->value('id') === $inbound->id;
    }

    private function handoff(AiConfig $config, Conversation $conversation, Message $inbound): void
    {
        $agent = User::query()->where('is_active', true)->whereHas('assignedRole', fn ($role) => $role->where('slug', 'owner')->orWhereJsonContains('module_access', 'inbox'))->find($config->handoff_agent_id);
        $summary = 'The AI assistant requested human follow-up.';
        if ($inbound->content_text) {
            $summary .= ' Latest customer message: '.Str::limit($inbound->content_text, 200);
        }

        $conversation->update([
            'ai_autoreply_disabled' => true,
            'ai_handoff_summary' => $summary,
            'assigned_agent_id' => $agent?->id,
        ]);

        if ($agent) {
            Notification::create([
                'user_id' => $agent->id,
                'type' => 'conversation_assigned',
                'title' => 'Conversation assigned to you',
                'body' => 'The AI assistant requested your help with a conversation.',
                'data' => ['conversation_id' => $conversation->id],
            ]);
        }
    }
}
