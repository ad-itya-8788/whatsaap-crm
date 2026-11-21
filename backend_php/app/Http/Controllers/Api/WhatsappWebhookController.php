<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\WhatsappConfig;
use App\Services\MessageStatusService;
use App\Support\Phone;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class WhatsappWebhookController extends Controller
{
    public function __construct(private MessageStatusService $statuses) {}

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

        try {
            foreach (($request->input('entry') ?? []) as $entry) {
                foreach (($entry['changes'] ?? []) as $change) {
                    $value = $change['value'] ?? [];

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
                        }
                    }

                    $contacts = collect($value['contacts'] ?? [])->keyBy('wa_id');
                    foreach (($value['messages'] ?? []) as $messageData) {
                        $this->ingestInbound(
                            $messageData,
                            $contacts->get($messageData['from'] ?? ''),
                            $value['metadata']['phone_number_id'] ?? null,
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

    private function ingestInbound(array $data, $metaContact = null, $phoneNumberId = null): void
    {
        $wamid = $data['id'] ?? null;
        if ($wamid && Message::where('message_id', $wamid)->exists()) {
            return;
        }

        $from = $data['from'] ?? null;
        $normalized = Phone::normalize($from);
        $name = data_get($metaContact, 'profile.name');
        [$type, $text, $media] = $this->parseContent($data);

        try {
            DB::transaction(function () use ($wamid, $from, $normalized, $name, $data, $type, $text, $media, $phoneNumberId) {
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
                    return;
                }

                $conversation = Conversation::firstOrCreate(
                    ['contact_id' => $contact->id],
                    ['status' => 'open'],
                );

                Message::create([
                    'conversation_id' => $conversation->id,
                    'sender_type' => 'customer',
                    'content_type' => $type,
                    'content_text' => $text,
                    'media_url' => $media,
                    'media_type' => $data[$type]['mime_type'] ?? null,
                    'filename' => $data[$type]['filename'] ?? null,
                    'message_id' => $wamid,
                    'status' => 'received',
                    'provider_timestamp' => ! empty($data['timestamp'])
                        ? Carbon::createFromTimestamp((int) $data['timestamp'])
                        : null,
                    'meta' => array_merge($data, $phoneNumberId ? ['phone_number_id' => $phoneNumberId] : []),
                ]);

                $conversation->update([
                    'unread_count' => (int) $conversation->unread_count + 1,
                    'last_message_text' => $text ? Str::limit($text, 500, '') : $type,
                    'last_message_at' => now(),
                    'last_inbound_at' => now(),
                    'first_inbound_at' => $conversation->first_inbound_at ?: now(),
                    'status' => 'open',
                ]);
            });
        } catch (QueryException $e) {
            if (! str_contains($e->getMessage(), 'Duplicate entry')) {
                throw $e;
            }
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
