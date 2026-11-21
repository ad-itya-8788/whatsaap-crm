<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Models\WhatsappConfig;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class WhatsappMessagingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.whatsapp.app_secret' => 'test-app-secret']);
    }

    public function test_text_reply_is_sent_inside_the_24_hour_window(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()]);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.reply-test']]], 200),
        ]);

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", [
                'content_type' => 'text',
                'content_text' => 'Hello',
            ])
            ->assertCreated()
            ->assertJsonPath('status', 'sent')
            ->assertJsonPath('message_id', 'wamid.reply-test');

        Http::assertSent(fn ($request) => str_contains($request->url(), '/'.config('services.whatsapp.api_version').'/123456789/messages')
            && $request['to'] === '15551234567'
            && $request['text']['body'] === 'Hello'
        );
    }

    public function test_free_form_message_is_blocked_outside_the_24_hour_window(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()->subHours(25)]);

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", [
                'content_type' => 'text',
                'content_text' => 'Hello',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The 24-hour customer service window has closed. Send an approved template instead.');

        $this->assertDatabaseMissing('messages', ['conversation_id' => $conversation->id, 'content_text' => 'Hello']);
    }

    public function test_failed_send_is_recorded_and_returned(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()]);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['error' => ['message' => 'Invalid parameter']], 400),
        ]);

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", [
                'content_type' => 'text',
                'content_text' => 'Hello',
            ])
            ->assertStatus(502)
            ->assertJsonPath('data.status', 'failed');

        $this->assertDatabaseHas('messages', [
            'conversation_id' => $conversation->id,
            'status' => 'failed',
            'error_details' => 'Invalid parameter',
        ]);
    }

    public function test_repeated_send_with_the_same_idempotency_key_does_not_send_twice(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()]);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.once']]], 200),
        ]);
        $payload = [
            'content_type' => 'text',
            'content_text' => 'Hello once',
            'idempotency_key' => 'message-attempt-once',
        ];

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", $payload)
            ->assertCreated()
            ->assertJsonPath('message_id', 'wamid.once');

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", $payload)
            ->assertOk()
            ->assertJsonPath('message_id', 'wamid.once');

        $this->assertDatabaseCount('messages', 1);
        Http::assertSentCount(1);
    }

    public function test_idempotency_key_cannot_be_reused_for_different_message_content(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()]);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.once']]], 200),
        ]);
        $payload = [
            'content_type' => 'text',
            'content_text' => 'Original',
            'idempotency_key' => 'message-attempt-reused',
        ];

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", $payload)
            ->assertCreated();

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", array_merge($payload, [
                'content_text' => 'Changed',
            ]))
            ->assertStatus(409);

        $this->assertDatabaseCount('messages', 1);
        Http::assertSentCount(1);
    }

    public function test_ambiguous_provider_failure_stays_pending_and_is_not_resent(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()]);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['error' => ['message' => 'Temporary provider error']], 503),
        ]);
        $payload = [
            'content_type' => 'text',
            'content_text' => 'Potentially delivered',
            'idempotency_key' => 'message-attempt-uncertain',
        ];

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", $payload)
            ->assertStatus(502)
            ->assertJsonPath('data.status', 'pending');

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", $payload)
            ->assertOk()
            ->assertJsonPath('status', 'pending');

        $this->assertDatabaseCount('messages', 1);
        Http::assertSentCount(1);
    }

    public function test_message_is_not_saved_as_sent_when_whatsapp_is_disconnected(): void
    {
        $user = $this->createUser();
        $contact = $this->contact($user);
        $conversation = Conversation::create([
            'user_id' => $user->id,
            'contact_id' => $contact->id,
            'status' => 'open',
            'last_inbound_at' => now(),
        ]);

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", [
                'content_type' => 'text',
                'content_text' => 'Hello',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'WhatsApp is not configured. Connect it in WhatsApp settings before sending.');

        $this->assertDatabaseMissing('messages', ['conversation_id' => $conversation->id, 'content_text' => 'Hello']);
    }

    public function test_inbound_webhook_creates_contact_conversation_and_message_once(): void
    {
        $payload = $this->inboundPayload();
        $this->postSignedWebhook($payload)->assertOk();
        $this->postSignedWebhook($payload)->assertOk();

        $this->assertDatabaseHas('contacts', [
            'phone_normalized' => '15551234567',
            'name' => 'Jane',
        ]);
        $conversation = Conversation::firstOrFail();
        $this->assertSame(1, (int) $conversation->unread_count);
        $this->assertSame('Hello from Meta', $conversation->last_message_text);
        $this->assertSame(1, Message::where('message_id', 'wamid.inbound-1')->count());
    }

    public function test_image_attachment_is_uploaded_and_sent_to_meta(): void
    {
        [$user, $conversation] = $this->workspace();
        $conversation->update(['last_inbound_at' => now()]);
        Http::fake([
            '*' => Http::sequence()
                ->push(['id' => 'media-1'], 200)
                ->push(['messages' => [['id' => 'wamid.media-1']]], 200),
        ]);

        $this->actingAs($user)
            ->post("/api/app/conversations/{$conversation->id}/messages", [
                'content_type' => 'image',
                'content_text' => 'Order photo',
                'file' => UploadedFile::fake()->createWithContent('order.jpg', 'image-bytes')->mimeType('image/jpeg'),
                'idempotency_key' => 'image-attachment-1',
            ])
            ->assertCreated()
            ->assertJsonPath('content_type', 'image')
            ->assertJsonPath('media_url', 'media-1');

        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/123456789/media')
            && $request->method() === 'POST'
        );
        Http::assertSent(fn ($request) => ($request['image']['id'] ?? null) === 'media-1'
            && ($request['image']['caption'] ?? null) === 'Order photo'
        );
        $this->assertDatabaseHas('messages', [
            'conversation_id' => $conversation->id,
            'content_type' => 'image',
            'media_url' => 'media-1',
            'filename' => 'order.jpg',
        ]);
    }

    public function test_saved_media_can_be_downloaded_through_authenticated_route(): void
    {
        [$user, $conversation] = $this->workspace();
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'customer',
            'content_type' => 'image',
            'content_text' => 'A picture',
            'media_url' => '22',
            'media_type' => 'image/jpeg',
            'filename' => 'picture.jpg',
            'status' => 'received',
        ]);
        Http::fake([
            'graph.facebook.com/*' => Http::response([
                'url' => 'https://lookaside.fbsbx.com/whatsapp/media-22',
                'mime_type' => 'image/jpeg',
                'file_size' => 12,
            ], 200),
            'lookaside.fbsbx.com/*' => Http::response('image-bytes', 200, ['Content-Type' => 'image/jpeg']),
        ]);

        $this->actingAs($user)
            ->get("/api/app/messages/{$message->id}/media")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg')
            ->assertSee('image-bytes', false);
    }

    public function test_inbound_webhook_uses_provider_timestamp_for_conversation_window(): void
    {
        $receivedAt = now()->subHours(25)->startOfSecond();
        $payload = $this->inboundPayload();
        $payload['entry'][0]['changes'][0]['value']['messages'][0]['timestamp'] = (string) $receivedAt->timestamp;

        $this->postSignedWebhook($payload)->assertOk();

        $conversation = Conversation::firstOrFail();
        $this->assertSame($receivedAt->timestamp, $conversation->last_inbound_at->timestamp);
        $this->assertSame($receivedAt->timestamp, $conversation->first_inbound_at->timestamp);
    }

    public function test_delayed_inbound_webhook_does_not_extend_free_form_window(): void
    {
        [$user, $conversation] = $this->workspace();
        $receivedAt = now()->subHours(25)->startOfSecond();
        $payload = $this->inboundPayload();
        $payload['entry'][0]['changes'][0]['value']['messages'][0]['timestamp'] = (string) $receivedAt->timestamp;
        $this->postSignedWebhook($payload)->assertOk();
        Http::preventStrayRequests();

        $this->actingAs($user)
            ->postJson("/api/app/conversations/{$conversation->id}/messages", [
                'content_type' => 'text',
                'content_text' => 'This reply is outside the customer service window.',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The 24-hour customer service window has closed. Send an approved template instead.');

        Http::assertNothingSent();
    }

    public function test_status_webhook_updates_message_idempotently(): void
    {
        [$user, $conversation] = $this->workspace();
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'agent',
            'sender_id' => $user->id,
            'content_type' => 'text',
            'content_text' => 'Hello',
            'message_id' => 'wamid.out-1',
            'status' => 'sent',
        ]);
        $payload = $this->statusPayload('wamid.out-1', 'read');

        $this->postSignedWebhook($payload)->assertOk();
        $this->postSignedWebhook($payload)->assertOk();

        $this->assertSame('read', $message->fresh()->status);
        $this->assertNotNull($message->fresh()->provider_timestamp);
    }

    public function test_late_status_webhook_does_not_regress_delivery_status(): void
    {
        [$user, $conversation] = $this->workspace();
        $deliveredAt = now()->subMinute()->startOfSecond();
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'agent',
            'sender_id' => $user->id,
            'content_type' => 'text',
            'content_text' => 'Hello',
            'message_id' => 'wamid.out-of-order',
            'status' => 'delivered',
            'provider_timestamp' => $deliveredAt,
        ]);
        $payload = $this->statusPayload('wamid.out-of-order', 'sent');
        $payload['entry'][0]['changes'][0]['value']['statuses'][0]['timestamp'] = (string) $deliveredAt->copy()->subMinute()->timestamp;

        $this->postSignedWebhook($payload)->assertOk();

        $this->assertSame('delivered', $message->fresh()->status);
        $this->assertSame($deliveredAt->timestamp, $message->fresh()->provider_timestamp->timestamp);
    }

    public function test_message_history_starts_with_the_latest_page(): void
    {
        [$user, $conversation] = $this->workspace();
        $created = collect(range(1, 60))->map(fn ($number) => Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => $number % 2 ? 'customer' : 'agent',
            'content_type' => 'text',
            'content_text' => "Message {$number}",
            'status' => 'sent',
        ]));

        $response = $this->actingAs($user)
            ->getJson("/api/app/conversations/{$conversation->id}/messages?per_page=50")
            ->assertOk();

        $this->assertSame($created->last()->id, $response->json('data.0.id'));
        $this->assertSame(50, count($response->json('data')));
        $this->assertNotEmpty($response->json('next_cursor'));

        $cursor = $response->json('next_cursor');
        $olderResponse = $this->getJson('/api/app/conversations/'.$conversation->id.'/messages?'.http_build_query([
            'per_page' => 50,
            'cursor' => $cursor,
        ]))->assertOk();

        $this->assertSame(10, count($olderResponse->json('data')));
        $this->assertLessThan($response->json('data.49.id'), $olderResponse->json('data.0.id'));
    }

    public function test_webhook_rejects_an_invalid_signature(): void
    {
        $this->postJson('/api/whatsapp/webhook', ['entry' => [['changes' => []]]])
            ->assertForbidden();
    }

    private function workspace(): array
    {
        $user = $this->createUser();
        $contact = $this->contact($user);
        $conversation = Conversation::create([
            'user_id' => $user->id,
            'contact_id' => $contact->id,
            'status' => 'open',
        ]);
        WhatsappConfig::create([
            'user_id' => $user->id,
            'phone_number_id' => '123456789',
            'access_token' => 'test-access-token',
            'status' => 'connected',
        ]);

        return [$user, $conversation];
    }

    private function createUser(): User
    {
        return User::create([
            'name' => 'Test User',
            'email' => uniqid('whatsapp-', true).'@example.test',
            'password' => Hash::make('test-password'),
            'role' => 'agent',
        ]);
    }

    private function contact(User $user): Contact
    {
        return Contact::create([
            'user_id' => $user->id,
            'name' => 'Test Contact',
            'phone' => '+1 555 123 4567',
            'phone_normalized' => '15551234567',
        ]);
    }

    private function inboundPayload(): array
    {
        return [
            'entry' => [[
                'changes' => [[
                    'value' => [
                        'metadata' => ['phone_number_id' => '123456789'],
                        'contacts' => [[
                            'wa_id' => '15551234567',
                            'profile' => ['name' => 'Jane'],
                        ]],
                        'messages' => [[
                            'from' => '15551234567',
                            'id' => 'wamid.inbound-1',
                            'timestamp' => (string) now()->timestamp,
                            'type' => 'text',
                            'text' => ['body' => 'Hello from Meta'],
                        ]],
                    ],
                ]],
            ]],
        ];
    }

    private function statusPayload(string $wamid, string $status): array
    {
        return [
            'entry' => [[
                'changes' => [[
                    'value' => [
                        'statuses' => [[
                            'id' => $wamid,
                            'status' => $status,
                            'timestamp' => (string) now()->timestamp,
                        ]],
                    ],
                ]],
            ]],
        ];
    }

    private function postSignedWebhook(array $payload)
    {
        $body = json_encode($payload);

        return $this->call('POST', '/api/whatsapp/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, 'test-app-secret'),
        ], $body);
    }
}
