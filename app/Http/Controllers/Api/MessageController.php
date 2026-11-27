<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MetaApiException;
use App\Exceptions\MessagingException;
use App\Http\Controllers\Controller;
use App\Http\Requests\ReactMessageRequest;
use App\Http\Requests\SendMessageRequest;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageReaction;
use App\Models\WhatsappConfig;
use App\Services\InboundMediaMirror;
use App\Services\MessagingService;
use App\Services\MetaCloudApiService;
use App\Services\RealtimeBroadcaster;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class MessageController extends Controller
{
    public function __construct(
        private MessagingService $messaging,
        private MetaCloudApiService $meta,
        private RealtimeBroadcaster $realtime,
    ) {}

    public function index(Request $request, Conversation $conversation): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 50), 1), 100);
        $search = $request->string('search')->toString();

        $query = $conversation->messages()
            ->with([
                'replyTo:id,content_text,sender_type,content_type,filename',
                'template:name,body_text',
                'reactions:id,message_id,actor_type,actor_id,emoji,created_at',
            ])
            ->orderByDesc('id');

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('content_text', 'like', "%{$search}%")
                    ->orWhere('filename', 'like', "%{$search}%")
                    ->orWhere('template_name', 'like', "%{$search}%");
            });
        }

        return response()->json($query->cursorPaginate($perPage));
    }

    public function store(SendMessageRequest $request, Conversation $conversation): JsonResponse
    {
        try {
            $message = $this->messaging->send($conversation, $request->validated(), $request->user()->id);
        } catch (MessagingException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'data' => $e->failedMessage,
            ], $e->status);
        }

        return response()->json($message, $message->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Message $message, InboundMediaMirror $mediaMirror): JsonResponse
    {
        $result = DB::transaction(function () use ($message) {
            $conversation = Conversation::query()
                ->whereKey($message->conversation_id)
                ->lockForUpdate()
                ->firstOrFail();
            $message = $conversation->messages()
                ->whereKey($message->id)
                ->lockForUpdate()
                ->firstOrFail();

            $mediaMessageId = $message->sender_type === 'customer' && $message->media_url
                ? $message->id
                : null;
            $message->delete();

            $latest = $conversation->messages()->orderByDesc('id')->first([
                'content_text',
                'content_type',
                'template_name',
                'provider_timestamp',
                'created_at',
            ]);
            $preview = $latest
                ? Str::limit($latest->content_text ?: $latest->template_name ?: $latest->content_type, 500, '')
                : null;

            $conversation->forceFill([
                'last_message_text' => $preview,
                'last_message_at' => $latest?->provider_timestamp ?? $latest?->created_at,
            ])->save();

            return ['media_message_id' => $mediaMessageId, 'conversation' => $conversation];
        });

        if ($result['media_message_id'] !== null) {
            $mediaMirror->deleteByMessageId($result['media_message_id']);
        }

        $this->realtime->messageDeleted($message, $result['conversation']);

        return response()->json(['ok' => true]);
    }

    public function react(ReactMessageRequest $request, Message $message): JsonResponse
    {
        $message->loadMissing('conversation.contact');
        $contact = $message->conversation?->contact;
        $phone = $contact?->phone_normalized ?: $contact?->phone;
        $emoji = trim((string) $request->input('emoji'));

        if (! $message->message_id) {
            return response()->json(['message' => 'This message cannot be reacted to yet.'], 422);
        }
        if (! $phone) {
            return response()->json(['message' => 'This contact has no WhatsApp phone number.'], 422);
        }

        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config || $config->status !== 'connected' || ! $config->access_token || ! $config->phone_number_id) {
            return response()->json(['message' => 'WhatsApp is not configured.'], 422);
        }

        try {
            $this->meta->sendMessage($config, $phone, [
                'type' => 'reaction',
                'reaction' => [
                    'message_id' => (string) $message->message_id,
                    'emoji' => $emoji,
                ],
            ]);
        } catch (MetaApiException $e) {
            return response()->json(['message' => 'WhatsApp could not save this reaction: '.$e->getMessage()], min(max($e->httpStatus, 400), 599));
        }

        DB::transaction(function () use ($message, $request, $emoji) {
            Message::query()->whereKey($message->id)->lockForUpdate()->firstOrFail();
            $message->reactions()->where('actor_type', 'agent')->delete();
            if ($emoji !== '') {
                $message->reactions()->create([
                    'actor_type' => 'agent',
                    'actor_id' => $request->user()->id,
                    'emoji' => $emoji,
                ]);
            }
        });

        $this->realtime->messageUpdated($message->fresh());

        return response()->json([
            'reactions' => $message->reactions()->get()
                ->each(fn (MessageReaction $reaction) => $reaction->setAttribute('conversation_id', $message->conversation_id)),
        ]);
    }

    public function media(Message $message, InboundMediaMirror $mediaMirror): StreamedResponse|JsonResponse
    {
        $mediaId = (string) $message->media_url;
        if ($mediaId === '' || ! ctype_digit($mediaId)) {
            return response()->json(['message' => 'Attachment not found.'], 404);
        }

        $type = match (true) {
            str_starts_with((string) $message->media_type, 'image/') => 'image',
            str_starts_with((string) $message->media_type, 'video/') => 'video',
            str_starts_with((string) $message->media_type, 'audio/') => 'audio',
            in_array($message->content_type, ['image', 'video', 'audio', 'document'], true) => $message->content_type,
            default => 'document',
        };

        $asset = $mediaMirror->read($message);
        if ($asset === null) {
            $config = WhatsappConfig::query()->latest('id')->first();
            $phoneNumberId = data_get($message->meta, 'phone_number_id');
            if (! $config || ($phoneNumberId && (string) $config->phone_number_id !== (string) $phoneNumberId)) {
                return response()->json(['message' => 'WhatsApp credentials for this attachment are unavailable.'], 422);
            }

            try {
                $asset = $this->meta->downloadMessageMedia($config, $mediaId, $type);
            } catch (MetaApiException $e) {
                return response()->json(['message' => $e->getMessage()], min(max($e->httpStatus, 400), 599));
            } catch (\RuntimeException $e) {
                return response()->json(['message' => $e->getMessage()], 422);
            }
        }

        $filename = basename($message->filename ?: 'whatsapp-attachment');
        $filename = preg_replace('/[\r\n"\\\\]/', '_', $filename);
        $mimeType = $asset['mime_type'] ?: 'application/octet-stream';
        $previewable = in_array($type, ['image', 'video', 'audio'], true)
            || $mimeType === 'application/pdf'
            || str_starts_with($mimeType, 'text/');
        $disposition = $previewable ? 'inline' : 'attachment';

        $body = $asset['body'];

        return response()->stream(static function () use ($body): void {
            try {
                while (! $body->eof()) {
                    echo $body->read(8192);
                }
            } finally {
                $body->close();
            }
        }, 200, [
            'Content-Type' => $mimeType,
            'Content-Disposition' => $disposition.'; filename="'.$filename.'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
