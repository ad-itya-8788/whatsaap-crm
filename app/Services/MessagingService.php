<?php

namespace App\Services;

use App\Exceptions\MessagingException;
use App\Exceptions\MetaApiException;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageTemplate;
use App\Models\WhatsappConfig;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class MessagingService
{
    public function __construct(
        private MetaCloudApiService $meta,
        private MessageStatusService $statuses,
        private TemplateSendBuilder $templateBuilder,
    ) {}

    public function send(Conversation $conversation, array $data, ?int $senderId): Message
    {
        $conversation->loadMissing('contact');
        $contact = $conversation->contact;

        if ($contact && $contact->consent_status === 'opted_out') {
            throw new MessagingException(
                'This contact has opted out of WhatsApp messages. Update their consent before sending.',
                422,
            );
        }

        $type = $data['content_type'] ?? 'text';
        $senderType = $data['sender_type'] ?? 'agent';
        if (! in_array($senderType, ['agent', 'bot', 'system'], true)) {
            $senderType = 'agent';
        }
        $file = $data['file'] ?? $data['header_file'] ?? $data['header_media_file'] ?? null;
        $fileHash = $file instanceof UploadedFile ? hash_file('sha256', $file->getRealPath()) : null;
        $idempotencyKey = $data['idempotency_key'] ?? null;
        $replyTo = null;
        if (! empty($data['reply_to_message_id'])) {
            $replyTo = Message::query()
                ->where('id', $data['reply_to_message_id'])
                ->where('conversation_id', $conversation->id)
                ->first();

            if (! $replyTo) {
                throw new MessagingException('The message you are replying to is not part of this conversation.', 422);
            }
        }
        $idempotencyHash = hash('sha256', json_encode([
            'conversation_id' => $conversation->id,
            'sender_id' => $senderId,
            'sender_type' => $senderType,
            'content_type' => $type,
            'content_text' => $data['content_text'] ?? null,
            'template_name' => $data['template_name'] ?? null,
            'template_params' => $data['template_params'] ?? [],
            'template_language' => $data['template_language'] ?? null,
            'header_text' => $data['header_text'] ?? null,
            'button_params' => $data['button_params'] ?? [],
            'interactive_payload' => $data['interactive_payload'] ?? null,
            'media_type' => $data['header_media_type'] ?? $type,
            'file_hash' => $fileHash,
            'reply_to_message_id' => $replyTo?->id,
            'interactive_reply_id' => $data['interactive_reply_id'] ?? null,
            'payload' => $data['payload'] ?? null,
        ], JSON_THROW_ON_ERROR));

        if ($idempotencyKey) {
            $existing = Message::where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                return $this->replay($existing, $conversation, $idempotencyHash);
            }
        }

        $config = WhatsappConfig::query()->latest('id')->first();
        $phone = $conversation->contact?->phone_normalized ?: $conversation->contact?->phone;

        if (! $config || $config->status !== 'connected' || ! $config->access_token || ! $config->phone_number_id) {
            throw new MessagingException('WhatsApp is not configured. Connect it in WhatsApp settings before sending.');
        }

        if (! $phone) {
            throw new MessagingException('This contact has no WhatsApp phone number.');
        }

        $template = null;
        if ($type === 'template') {
            $template = MessageTemplate::query()
                ->where('name', $data['template_name'] ?? '')
                ->when($data['template_language'] ?? null, fn ($query, $language) => $query->where('language', $language))
                ->first();
            if (! $template || strtoupper((string) ($template->approval_status ?: $template->status)) !== 'APPROVED') {
                throw new MessagingException('Choose an approved template in the requested language.', 422);
            }

            $parameters = $data['template_params'] ?? [];
            $data['content_text'] ??= preg_replace_callback('/\{\{\s*(\d+)\s*\}\}/', function (array $match) use ($parameters) {
                return (string) ($parameters[(int) $match[1] - 1] ?? $match[0]);
            }, $template->body_text);
        }

        if ($type !== 'template') {
            $lastInbound = $conversation->last_inbound_at;
            if (! $lastInbound || $lastInbound->lt(now()->subHours(24))) {
                throw new MessagingException('The 24-hour customer service window has closed. Send an approved template instead.');
            }
        }

        try {
            $message = DB::transaction(function () use ($conversation, $senderId, $senderType, $type, $data, $idempotencyKey, $idempotencyHash, $replyTo) {
                $message = Message::create([
                    'conversation_id' => $conversation->id,
                    'sender_type' => $senderType,
                    'sender_id' => $senderId,
                    'ai_generated' => (bool) ($data['ai_generated'] ?? false),
                    'content_type' => $type,
                    'content_text' => $data['content_text'] ?? null,
                    'template_name' => $data['template_name'] ?? null,
                    'status' => 'sending',
                    'reply_to_message_id' => $replyTo?->id,
                    'interactive_reply_id' => $data['interactive_reply_id'] ?? null,
                    'interactive_payload' => $data['interactive_payload'] ?? null,
                    'meta' => $data['meta'] ?? null,
                    'filename' => $data['filename'] ?? null,
                    'idempotency_key' => $idempotencyKey,
                    'idempotency_hash' => $idempotencyKey ? $idempotencyHash : null,
                ]);

                $conversation->update([
                    'last_message_text' => ($data['content_text'] ?? '') ?: (($data['template_name'] ?? '') ?: $this->mediaLabel($type)),
                    'last_message_at' => now(),
                    'last_reply_at' => now(),
                ]);

                return $message;
            });
        } catch (QueryException $e) {
            $existing = $idempotencyKey
                ? Message::where('idempotency_key', $idempotencyKey)->first()
                : null;

            if (! $existing) {
                throw $e;
            }

            return $this->replay($existing, $conversation, $idempotencyHash);
        }

        try {
            $mediaId = null;
            $mediaType = $data['header_media_type'] ?? strtolower($template?->header_type ?? $type);
            if ($file instanceof UploadedFile) {
                $mediaId = $this->meta->uploadMessageMedia($config, $file);
                $message->update([
                    'media_url' => $mediaId,
                    'media_type' => $file->getMimeType(),
                    'filename' => $file->getClientOriginalName(),
                ]);
            }

            if (is_array($data['payload'] ?? null)) {
                $payload = $data['payload'];
            } elseif ($type === 'interactive') {
                $interactive = $data['interactive_payload'];
                $payload = ($interactive['kind'] ?? '') === 'list'
                    ? $this->meta->listPayload(
                        (string) $data['content_text'],
                        (string) ($interactive['button_label'] ?? 'View options'),
                        (array) ($interactive['sections'] ?? []),
                        $interactive['header'] ?? null,
                        $interactive['footer'] ?? null,
                    )
                    : $this->meta->buttonsPayload(
                        (string) $data['content_text'],
                        (array) ($interactive['buttons'] ?? []),
                        $interactive['header'] ?? null,
                        $interactive['footer'] ?? null,
                    );
            } elseif ($type === 'template') {
                $headerMedia = $mediaId ? [
                    'id' => $mediaId,
                    'url' => null,
                    'type' => $mediaType,
                    'filename' => $file->getClientOriginalName(),
                ] : null;
                $components = $this->templateBuilder->components($template, [
                    'body' => $data['template_params'] ?? [],
                    'header_text' => $data['header_text'] ?? null,
                    'button_params' => $data['button_params'] ?? [],
                ], $headerMedia);
                $payload = $this->meta->templatePayload(
                    $template->name,
                    $data['template_language'] ?? $template->language ?? 'en_US',
                    [],
                    null,
                    $components,
                );
            } elseif ($mediaId) {
                $payload = $this->meta->messageMediaPayload(
                    $type,
                    $mediaId,
                    $data['content_text'] ?? null,
                    $file->getClientOriginalName(),
                    $file->getMimeType(),
                );
            } else {
                $payload = $this->meta->textPayload((string) $data['content_text']);
            }

            if ($replyTo?->message_id) {
                $payload['context'] = ['message_id' => $replyTo->message_id];
            }

            $result = $this->meta->sendMessage($config, $phone, $payload);
            $timestamp = $result['timestamp'] ?? null;

            $message->update([
                'status' => 'sent',
                'message_id' => $result['wamid'],
                'provider_timestamp' => is_numeric($timestamp)
                    ? Carbon::createFromTimestamp((int) $timestamp)
                    : null,
            ]);
        } catch (ConnectionException) {
            $message->update([
                'status' => 'pending',
                'error_title' => 'Delivery unconfirmed',
                'error_details' => 'The provider response was not received. Check the message status before retrying.',
            ]);

            Log::warning('whatsapp.message.outcome_unknown', [
                'conversation_id' => $conversation->id,
                'message_record_id' => $message->id,
            ]);

            throw new MessagingException(
                'WhatsApp did not confirm whether this message was sent. It remains pending; do not retry yet.',
                502,
                $message->fresh(),
            );
        } catch (MetaApiException $e) {
            $status = $e->acceptanceUnknown ? 'pending' : 'failed';
            $message->update([
                'status' => $status,
                'error_code' => $e->providerCode ?? $e->httpStatus,
                'error_title' => $e->acceptanceUnknown ? 'Delivery unconfirmed' : 'Send failed',
                'error_details' => $e->getMessage(),
            ]);

            throw new MessagingException(
                $e->acceptanceUnknown
                    ? 'WhatsApp did not confirm whether this message was sent. It remains pending; do not retry yet.'
                    : 'WhatsApp could not send the message: '.$e->getMessage(),
                502,
                $message->fresh(),
            );
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

        return $message;
    }

    private function mediaLabel(string $type): string
    {
        return match ($type) {
            'image' => 'Photo',
            'video' => 'Video',
            'audio' => 'Audio',
            'document' => 'Document',
            default => 'Message',
        };
    }

    private function replay(Message $message, Conversation $conversation, string $requestHash): Message
    {
        if (
            (int) $message->conversation_id !== (int) $conversation->id
            || ! $message->idempotency_hash
            || ! hash_equals($message->idempotency_hash, $requestHash)
        ) {
            throw new MessagingException('This idempotency key was already used for a different message.', 409);
        }

        if ($message->status === 'failed') {
            throw new MessagingException(
                $message->error_details ?: 'This message attempt already failed. Submit a new message to retry.',
                502,
                $message,
            );
        }

        return $message;
    }
}
