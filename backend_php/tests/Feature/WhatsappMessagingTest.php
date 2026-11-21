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
