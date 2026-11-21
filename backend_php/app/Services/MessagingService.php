<?php

namespace App\Services;

use App\Exceptions\MessagingException;
use App\Exceptions\MetaApiException;
use App\Models\Conversation;
use App\Models\Message;
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
    ) {}

    public function send(Conversation $conversation, array $data, ?int $senderId): Message
    {
        $type = $data['content_type'] ?? 'text';
        $file = $data['file'] ?? $data['header_media_file'] ?? null;
        $fileHash = $file instanceof UploadedFile ? hash_file('sha256', $file->getRealPath()) : null;
        $idempotencyKey = $data['idempotency_key'] ?? null;
        $idempotencyHash = hash('sha256', json_encode([
            'conversation_id' => $conversation->id,
            'sender_id' => $senderId,
            'content_type' => $type,
            'content_text' => $data['content_text'] ?? null,
            'template_name' => $data['template_name'] ?? null,
            'template_language' => $data['template_language'] ?? null,
            'template_params' => array_values($data['template_params'] ?? []),
            'media_type' => $data['header_media_type'] ?? $type,
            'file_hash' => $fileHash,
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

        if ($type !== 'template') {
            $lastInbound = $conversation->last_inbound_at;
            if (! $lastInbound || $lastInbound->lt(now()->subHours(24))) {
                throw new MessagingException('The 24-hour customer service window has closed. Send an approved template instead.');
            }
        }

        try {
            $message = DB::transaction(function () use ($conversation, $senderId, $type, $data, $idempotencyKey, $idempotencyHash) {
                $message = Message::create([
                    'conversation_id' => $conversation->id,
                    'sender_type' => 'agent',
                    'sender_id' => $senderId,
                    'content_type' => $type,
                    'content_text' => $data['content_text'] ?? null,
                    'template_name' => $data['template_name'] ?? null,
                    'status' => 'sending',
                    'idempotency_key' => $idempotencyKey,
                    'idempotency_hash' => $idempotencyKey ? $idempotencyHash : null,
                ]);

                $conversation->update([
                    'last_message_text' => ($data['content_text'] ?? '') ?: ($data['template_name'] ?: $this->mediaLabel($type)),
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
            $mediaType = $data['header_media_type'] ?? $type;
            if ($file instanceof UploadedFile) {
                $mediaId = $this->meta->uploadMessageMedia($config, $file);
                $message->update([
                    'media_url' => $mediaId,
                    'media_type' => $file->getMimeType(),
                    'filename' => $file->getClientOriginalName(),
                ]);
            }

            if ($type === 'template') {
                $headerMedia = $mediaId ? [
                    'id' => $mediaId,
                    'type' => $mediaType,
                    'filename' => $file->getClientOriginalName(),
                ] : null;
                $payload = $this->meta->templatePayload(
                    $data['template_name'],
                    $data['template_language'] ?? 'en_US',
                    $data['template_params'] ?? [],
                    $headerMedia,
                );
            } elseif ($mediaId) {
                $payload = $this->meta->messageMediaPayload(
                    $type,
                    $mediaId,
                    $data['content_text'] ?? null,
                    $file->getClientOriginalName(),
                );
            } else {
                $payload = $this->meta->textPayload((string) $data['content_text']);
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
