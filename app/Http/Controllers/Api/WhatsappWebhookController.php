<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageReaction;
use App\Models\WhatsappConfig;
use App\Services\AiAutoReplyService;
use App\Services\InboundMediaMirror;
use App\Services\MessageStatusService;
use App\Services\RealtimeBroadcaster;
use App\Services\TemplateLifecycleService;
use App\Support\Phone;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

use function Illuminate\Support\defer;

class WhatsappWebhookController extends Controller
{
    public function __construct(
        private MessageStatusService $statuses,
        private InboundMediaMirror $mediaMirror,
        private AiAutoReplyService $aiAutoReply,
        private TemplateLifecycleService $templates,
        private RealtimeBroadcaster $realtime,
    ) {}

    public function verify(Request $request): JsonResponse|Response
    {
        $mode = $request->query('hub_mode') ?? $request->query('hub.mode');
        $token = $request->query('hub_verify_token') ?? $request->query('hub.verify_token');
        $challenge = $request->query('hub_challenge') ?? $request->query('hub.challenge');
        $config = WhatsappConfig::query()->latest('id')->first();
        $expected = $config?->verify_token;

        if ($mode === 'subscribe' && $expected && hash_equals((string) $expected, (string) $token)) {
            return response($challenge, 200)->header('Content-Type', 'text/plain');
        }

        return response()->json(['error' => 'Verification failed'], 403);
    }

    public function handle(Request $request): JsonResponse
    {
        $appSecret = config('services.whatsapp.app_secret');
        if (! $appSecret) {
            return response()->json(['error' => 'Webhook verification is not configured'], 503);
        }

        $signature = $request->header('X-Hub-Signature-256');
        $expected = 'sha256='.hash_hmac('sha256', $request->getContent(), $appSecret);
        if (! $signature || ! hash_equals($expected, $signature)) {
            return response()->json(['error' => 'Invalid webhook signature'], 403);
        }

        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config || $config->status !== 'connected') {
            return response()->json(['ok' => true]);
        }

        try {
            foreach (($request->input('entry') ?? []) as $entry) {
                foreach (($entry['changes'] ?? []) as $change) {
                    $value = $change['value'] ?? [];
                    $field = $change['field'] ?? '';
                    if (in_array($field, TemplateLifecycleService::WEBHOOK_FIELDS, true)) {
                        if ($config->waba_id && (string) ($entry['id'] ?? '') === (string) $config->waba_id) {
                            $this->templates->syncFromWebhook($config, $field, $value);
                        }

                        continue;
                    }

                    if ((string) data_get($value, 'metadata.phone_number_id') !== (string) $config->phone_number_id) {
                        continue;
                    }

                    foreach (($value['statuses'] ?? []) as $statusData) {
                        $wamid = $statusData['id'] ?? null;
                        if (! $wamid) {
                            continue;
                        }
                        $message = Message::where('message_id', $wamid)->first();
                        if ($message) {
                            $this->statuses->apply($message, $statusData);
                        } else {
                            $this->statuses->buffer($wamid, $statusData);

                            // The send request may have saved the provider ID while we buffered the event.
                            $message = Message::where('message_id', $wamid)->first();
                            if ($message) {
                                $this->statuses->flushPending($message);
                            }
                        }
                    }

                    $contacts = collect($value['contacts'] ?? [])->keyBy('wa_id');
                    foreach (($value['messages'] ?? []) as $messageData) {
                        $this->ingestInbound(
                            $messageData,
                            $contacts->get($messageData['from'] ?? ''),
                            $config,
                        );
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('whatsapp.webhook.error', ['message' => $e->getMessage()]);

            return response()->json(['error' => 'Webhook processing failed'], 500);
        }

        return response()->json(['ok' => true]);
    }

    private function ingestReaction(array $data): void
    {
        $from = $data['from'] ?? null;
        $normalized = Phone::normalize($from);
        $targetId = data_get($data, 'reaction.message_id');
        $emoji = trim((string) (data_get($data, 'reaction.emoji') ?? ''));

        $contact = Contact::where('phone_normalized', $normalized)->first()
            ?: ($from ? Contact::where('wa_user_id', $from)->first() : null);
        if (! $contact || ! $targetId) {
            return;
        }

        $message = Message::query()
            ->where('message_id', $targetId)
            ->whereHas('conversation', fn ($query) => $query->where('contact_id', $contact->id))
            ->first();
        if (! $message) {
            return;
        }

        $query = MessageReaction::query()
            ->where('message_id', $message->id)
            ->where('actor_type', 'customer')
            ->where('actor_id', $contact->id);

        if ($emoji === '') {
            $query->delete();
            $this->realtime->messageUpdated($message->fresh());

            return;
        }

        MessageReaction::query()->updateOrCreate(
            [
                'message_id' => $message->id,
                'actor_type' => 'customer',
                'actor_id' => $contact->id,
            ],
            [
                'emoji' => $emoji,
            ],
        );
        $this->realtime->messageUpdated($message->fresh());
    }

    private function ingestInbound(array $data, ?array $metaContact, WhatsappConfig $config): void
    {
        $wamid = $data['id'] ?? null;
        if ($wamid && Message::where('message_id', $wamid)->exists()) {
            return;
        }

        if (($data['type'] ?? null) === 'reaction') {
            $this->ingestReaction($data);

            return;
        }

        $from = $data['from'] ?? null;
        $normalized = Phone::normalize($from);
        $name = data_get($metaContact, 'profile.name');
        [$type, $text, $media] = $this->parseContent($data);
        $replyId = data_get($data, 'interactive.button_reply.id') ?: data_get($data, 'interactive.list_reply.id');
        $inboundAt = ! empty($data['timestamp']) && is_numeric($data['timestamp'])
            ? Carbon::createFromTimestamp((int) $data['timestamp'])
            : now();

        try {
            $message = DB::transaction(function () use ($wamid, $from, $normalized, $name, $data, $type, $text, $media, $replyId, $config, $inboundAt): ?Message {
                $contact = Contact::where('phone_normalized', $normalized)->first()
                    ?: ($from ? Contact::where('wa_user_id', $from)->first() : null);

                if (! $contact && $from) {
                    $contact = Contact::create([
                        'phone' => $from,
                        'phone_normalized' => $normalized,
                        'name' => $name ?: $from,
                        'wa_user_id' => $from,
                    ]);
                } elseif ($contact && $name && ! $contact->name) {
                    $contact->update(['name' => $name]);
                }

                if (! $contact) {
                    return null;
                }

                $conversation = Conversation::firstOrCreate(['contact_id' => $contact->id], ['status' => 'open']);
                $conversation = Conversation::query()->lockForUpdate()->findOrFail($conversation->id);

                $message = Message::create([
                    'conversation_id' => $conversation->id,
                    'sender_type' => 'customer',
                    'content_type' => $type,
                    'content_text' => $text,
                    'media_url' => $media,
                    'media_type' => $data[$type]['mime_type'] ?? null,
                    'filename' => $data[$type]['filename'] ?? null,
                    'message_id' => $wamid,
                    'status' => 'received',
                    'provider_timestamp' => $inboundAt,
                    'interactive_reply_id' => $replyId,
                    'interactive_payload' => $data['interactive'] ?? null,
                    'meta' => array_merge($data, ['phone_number_id' => $config->phone_number_id]),
                ]);

                $conversation->increment('unread_count');
                $updates = ['status' => 'open'];

                if (! $conversation->last_message_at || $inboundAt->gt($conversation->last_message_at)) {
                    $updates['last_message_text'] = $text ? Str::limit($text, 500, '') : $type;
                    $updates['last_message_at'] = $inboundAt;
                }

                if (! $conversation->last_inbound_at || $inboundAt->gt($conversation->last_inbound_at)) {
                    $updates['last_inbound_at'] = $inboundAt;
                }

                if (! $conversation->first_inbound_at || $inboundAt->lt($conversation->first_inbound_at)) {
                    $updates['first_inbound_at'] = $inboundAt;
                }

                $conversation->update($updates);

                return $message;
            });
        } catch (QueryException $e) {
            if (! $wamid || ! Message::where('message_id', $wamid)->exists()) {
                throw $e;
            }

            return;
        }

        if ($message) {
            $this->realtime->messageCreated($message->fresh());
        }

        if ($message && $text) {
            defer(fn () => $this->aiAutoReply->dispatch($message))->always();
        }

        if ($message && $media && $config->mirror_inbound_media !== false) {
            defer(fn () => $this->mediaMirror->store($message, $config))->always();
        }
    }

    private function parseContent(array $data): array
    {
        $type = $data['type'] ?? 'text';
        $text = null;
        $media = null;

        if ($type === 'text') {
            $text = data_get($data, 'text.body');
        } elseif (in_array($type, ['image', 'video', 'audio', 'document', 'sticker'], true)) {
            $text = data_get($data, "{$type}.caption");
            $media = data_get($data, "{$type}.id");
        } elseif ($type === 'interactive') {
            $text = data_get($data, 'interactive.button_reply.title') ?? data_get($data, 'interactive.list_reply.title');
        } elseif ($type === 'button') {
            $text = data_get($data, 'button.text');
        } elseif ($type === 'reaction') {
            $text = data_get($data, 'reaction.emoji');
        } elseif ($type === 'location') {
            $text = trim((data_get($data, 'location.name') ?? '').' '.(data_get($data, 'location.address') ?? ''));
        }

        return [$type, $text, $media];
    }
}
