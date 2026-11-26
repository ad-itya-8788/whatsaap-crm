<?php

namespace App\Services;

use App\Jobs\DeliverOutboundWebhook;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\WebhookEndpoint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class OutboundWebhookEvents
{
    public function conversationCreated(Conversation $conversation): void
    {
        $this->emit('conversation.created', [
            'conversation_id' => $conversation->id,
            'contact_id' => $conversation->contact_id,
        ]);
    }

    public function messageCreated(Message $message): void
    {
        if ($message->sender_type === 'customer' && $message->message_id) {
            $this->emit('message.received', [
                'conversation_id' => $message->conversation_id,
                'contact_id' => $message->conversation?->contact_id,
                'whatsapp_message_id' => $message->message_id,
                'content_type' => $message->content_type,
                'text' => $message->content_text,
            ]);
        }
    }

    public function messageUpdated(Message $message): void
    {
        if ($message->wasChanged('status') && $message->sender_type !== 'customer' && $message->message_id) {
            $this->emit('message.status_updated', [
                'whatsapp_message_id' => $message->message_id,
                'conversation_id' => $message->conversation_id,
                'status' => $message->status,
            ]);
        }
    }

    private function emit(string $event, array $data): void
    {
        DB::afterCommit(function () use ($event, $data) {
            try {
                WebhookEndpoint::query()->where('is_active', true)->whereJsonContains('events', $event)
                    ->eachById(function (WebhookEndpoint $endpoint) use ($event, $data) {
                        DeliverOutboundWebhook::dispatch($endpoint->id, [
                            'id' => (string) Str::uuid(),
                            'event' => $event,
                            'occurred_at' => now()->toISOString(),
                            'account_id' => 'default',
                            'data' => $data,
                        ]);
                    });
            } catch (Throwable) {
                Log::warning('Could not enqueue CRM webhook delivery.', ['event' => $event]);
            }
        });
    }
}
