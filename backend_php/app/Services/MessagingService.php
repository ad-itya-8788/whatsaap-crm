<?php

namespace App\Services;

use App\Exceptions\MessagingException;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\WhatsappConfig;
use Carbon\Carbon;

class MessagingService
{
    public function __construct(
        private MetaCloudApiService $meta,
        private MessageStatusService $statuses,
    ) {}

    public function send(Conversation $conversation, array $data, ?int $senderId): Message
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        $phone = $conversation->contact?->phone_normalized ?: $conversation->contact?->phone;

        if (! $config || $config->status !== 'connected' || ! $config->access_token || ! $config->phone_number_id) {
            throw new MessagingException('WhatsApp is not configured. Connect it in WhatsApp settings before sending.');
        }

        if (! $phone) {
            throw new MessagingException('This contact has no WhatsApp phone number.');
        }

        $type = $data['content_type'] ?? 'text';

        if ($type !== 'template') {
            $lastInbound = $conversation->last_inbound_at;
            if (! $lastInbound || $lastInbound->lt(now()->subHours(24))) {
                throw new MessagingException('The 24-hour customer service window has closed. Send an approved template instead.');
            }
        }

        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'agent',
            'sender_id' => $senderId,
            'content_type' => $type,
            'content_text' => $data['content_text'] ?? null,
            'template_name' => $data['template_name'] ?? null,
            'status' => 'sending',
        ]);

        $conversation->update([
            'last_message_text' => $data['content_text'] ?? ($data['template_name'] ?: $type),
            'last_message_at' => now(),
            'last_reply_at' => now(),
        ]);

        try {
            $payload = $type === 'template'
                ? $this->meta->templatePayload(
                    $data['template_name'],
                    $data['template_language'] ?? 'en_US',
                    $data['template_params'] ?? [],
                )
                : $this->meta->textPayload((string) $data['content_text']);

            $result = $this->meta->sendMessage($config, $phone, $payload);
            $timestamp = $result['timestamp'] ?? null;

            $message->update([
                'status' => 'sent',
                'message_id' => $result['wamid'],
                'provider_timestamp' => is_numeric($timestamp)
                    ? Carbon::createFromTimestamp((int) $timestamp)
                    : null,
            ]);
        } catch (\Throwable $e) {
            $message->update([
                'status' => 'failed',
                'error_title' => 'Send failed',
                'error_details' => $e->getMessage(),
            ]);

            throw new MessagingException(
                'WhatsApp could not send the message: '.$e->getMessage(),
                502,
                $message->fresh(),
            );
        }

        $this->statuses->flushPending($message);

        return $message->fresh();
    }
}
