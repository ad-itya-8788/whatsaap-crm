<?php

namespace Tests\Feature;

use App\Events\MessageCreated;
use App\Events\MessageStatusChanged;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Models\WhatsappConfig;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;

class RealtimeMessagingTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
            'services.whatsapp.app_secret' => 'test-webhook-secret',
        ]);
        $this->artisan('migrate')->assertSuccessful();
        WhatsappConfig::create([
            'phone_number_id' => '123',
            'access_token' => 'test-token',
            'status' => 'connected',
        ]);
    }

    public function test_webhook_send_and_reconnect_keep_the_same_message_and_its_latest_status(): void
    {
        Event::fake([MessageCreated::class, MessageStatusChanged::class]);
        $inbound = [
            'id' => 'wamid.inbound',
            'from' => '15551234567',
            'timestamp' => (string) now()->timestamp,
            'type' => 'text',
            'text' => ['body' => 'Hello'],
        ];
        $this->webhook(['messages' => [$inbound]])->assertOk();
        $this->webhook(['messages' => [$inbound]])->assertOk();
        $thread = Conversation::sole();
        $this->assertSame(1, $thread->unread_count);
        $this->assertSame('Hello', $thread->last_message_text);
        $this->assertDatabaseCount('messages', 1);
        Event::assertDispatchedTimes(MessageCreated::class, 1);

        $user = User::forceCreate([
            'name' => 'Test Owner',
            'email' => 'owner@example.test',
            'password' => bcrypt('test-password'),
            'role' => 'owner',
            'is_active' => true,
        ]);
        $this->actingAs($user);
        $this->getJson('/api/app/notifications/browser-events?after=0')
            ->assertOk()->assertJsonCount(1, 'events');

        Http::fake(['*' => Http::response(['messages' => [['id' => 'wamid.outbound']]])]);
        $payload = ['content_type' => 'text', 'content_text' => 'Reply', 'idempotency_key' => 'test-send-key'];
        $url = "/api/app/conversations/{$thread->id}/messages";
        $this->webhook(['statuses' => [$this->providerStatus('delivered')]])->assertOk();
        $sent = $this->postJson($url, $payload)->assertSuccessful()->assertJsonPath('status', 'delivered');
        $messageId = $sent->json('id');
        $this->postJson($url, $payload)->assertSuccessful()->assertJsonPath('id', $messageId);
        Http::assertSentCount(1);
        $this->assertDatabaseCount('messages', 2);
        Event::assertDispatchedTimes(MessageCreated::class, 2);
        $this->assertDatabaseMissing('pending_message_statuses', ['wamid' => 'wamid.outbound']);

        $this->webhook(['statuses' => [$this->providerStatus('read')]])->assertOk();
        $this->webhook(['statuses' => [$this->providerStatus('sent'), $this->providerStatus('read')]])->assertOk();
        $this->assertSame('read', Message::findOrFail($messageId)->status);
        $this->assertSame('received', Message::where('message_id', 'wamid.inbound')->sole()->status);
        Event::assertDispatched(MessageStatusChanged::class, fn ($event) => $event->message['id'] === $messageId
            && $event->message['status'] === 'read');
        Event::assertDispatchedTimes(MessageStatusChanged::class, 3);
        $this->webhook(['messages' => [array_replace($inbound, [
            'id' => 'wamid.missed',
            'timestamp' => (string) $thread->fresh()->last_message_at->timestamp,
            'text' => ['body' => 'While offline'],
        ])]])->assertOk();
        $this->getJson('/api/app/realtime/sync?'.http_build_query([
            'conversation_id' => $thread->id,
            'after_id' => $messageId,
            'since' => Message::findOrFail($messageId)->updated_at->toISOString(),
        ]))->assertOk()
            ->assertJsonFragment(['id' => $messageId, 'status' => 'read'])
            ->assertJsonFragment(['message_id' => 'wamid.missed'])
            ->assertJsonPath('conversations.0.last_message_text', 'While offline')
            ->assertJsonPath('conversations.0.unread_count', 2);
        $this->getJson('/api/app/notifications/browser-events?after=0')
            ->assertOk()->assertJsonCount(2, 'events');

        // A failure receipt for a different provider ID must leave the read message alone.
        $failed = Message::create([
            'conversation_id' => $thread->id,
            'message_id' => 'wamid.failed',
            'sender_type' => 'agent',
            'content_type' => 'text',
            'status' => 'sent',
        ]);
        $this->webhook(['statuses' => [[
            'id' => 'wamid.failed',
            'status' => 'failed',
            'timestamp' => (string) now()->timestamp,
            'errors' => [['code' => 131026, 'title' => 'Undeliverable']],
        ]]])->assertOk();
        $this->assertSame('read', Message::findOrFail($messageId)->status);
        $this->assertSame('failed', $failed->refresh()->status);
        Event::assertDispatched(MessageStatusChanged::class, fn ($event) => $event->message['id'] === $failed->id
            && $event->message['status'] === 'failed');
    }

    private function providerStatus(string $status): array
    {
        return ['id' => 'wamid.outbound', 'status' => $status, 'timestamp' => (string) now()->timestamp];
    }

    private function webhook(array $value)
    {
        $body = json_encode(['entry' => [['changes' => [[
            'field' => 'messages',
            'value' => ['metadata' => ['phone_number_id' => '123']] + $value,
        ]]]]], JSON_THROW_ON_ERROR);

        return $this->call('POST', '/api/whatsapp/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, 'test-webhook-secret'),
        ], $body);
    }
}

