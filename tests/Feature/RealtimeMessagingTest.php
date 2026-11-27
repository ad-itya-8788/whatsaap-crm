<?php

namespace Tests\Feature;

use App\Events\ConversationActivity;
use App\Events\MessageCreated;
use App\Events\MessageStatusChanged;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Notification;
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
            'role_id' => \App\Models\Role::where('slug', 'owner')->value('id'),
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
        $this->getJson('/api/app/realtime/sync?'.http_build_query([
            'conversation_id' => $thread->id,
            'after_id' => $messageId,
            'since' => Message::findOrFail($messageId)->updated_at->toISOString(),
        ]))->assertOk()->assertJsonFragment(['id' => $messageId, 'status' => 'read']);
        $this->getJson('/api/app/notifications/browser-events?after=0')
            ->assertOk()->assertJsonCount(1, 'events');
    }

    public function test_owner_sees_all_conversations_and_agent_sees_only_transferred_conversations(): void
    {
        Event::fake();
        foreach (['15551111111', '15552222222'] as $phone) {
            $this->webhook(['messages' => [[
                'id' => 'wamid.'.$phone,
                'from' => $phone,
                'timestamp' => (string) now()->timestamp,
                'type' => 'text',
                'text' => ['body' => 'Hello'],
            ]]])->assertOk();
        }

        [$mine, $other] = Conversation::orderBy('id')->get()->all();
        $owner = User::forceCreate([
            'name' => 'Inbox Owner',
            'email' => 'inbox-owner@example.test',
            'password' => bcrypt('test-password'),
            'role_id' => \App\Models\Role::where('slug', 'owner')->value('id'),
            'is_active' => true,
        ]);
        $agent = User::forceCreate([
            'name' => 'Inbox Agent',
            'email' => 'inbox-agent@example.test',
            'password' => bcrypt('test-password'),
            'role_id' => \App\Models\Role::where('slug', 'agent')->value('id'),
            'is_active' => true,
        ]);
        $agent->assignedRole->update(['module_access' => ['inbox', 'dashboard']]);
        $viewer = User::forceCreate([
            'name' => 'New Workspace Member',
            'email' => 'new-member@example.test',
            'password' => bcrypt('test-password'),
            'role_id' => \App\Models\Role::where('slug', 'viewer')->value('id'),
            'is_active' => true,
        ]);
        $viewer->assignedRole->update(['module_access' => ['dashboard']]);

        $this->actingAs($owner)->getJson('/api/app/conversations')
            ->assertOk()->assertJsonCount(2, 'data');
        $this->getJson('/api/app/agents?assignment_picker=1')->assertOk()->assertJsonFragment([
            'name' => $viewer->name, 'unavailable_reason' => 'Needs Inbox access',
        ])->assertJsonFragment(['name' => $agent->name, 'unavailable_reason' => null]);
        $this->actingAs($agent)->getJson('/api/app/conversations')
            ->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($owner)->patchJson("/api/app/conversations/{$mine->id}/assign", ['assignee_id' => $agent->id])
            ->assertOk();
        $notification = Notification::where('user_id', $agent->id)->sole();
        $this->assertSame('New chat assigned to you', $notification->title);
        $this->assertStringContainsString('Inbox Owner assigned you', $notification->body);
        Notification::create(['user_id' => $agent->id, 'type' => 'payment_failed', 'title' => 'Restricted alert', 'body' => 'Restricted alert']);
        $this->actingAs($agent)->getJson('/api/app/notifications/popup-events')
            ->assertOk()->assertJsonCount(1, 'events')->assertJsonPath('events.0.data.conversation_id', $mine->id);
        $this->getJson('/api/app/notifications')->assertForbidden();
        $this->actingAs($agent)->getJson('/api/app/notifications/popup-events?after=0')
            ->assertOk()->assertJsonCount(1, 'events')->assertJsonPath('events.0.title', 'New chat assigned to you');
        $this->actingAs($agent)->getJson('/api/app/conversations')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mine->id);
        $this->getJson("/api/app/conversations/{$mine->id}/messages")->assertOk()->assertJsonFragment(['content_text' => 'Hello']);
        $this->getJson("/api/app/conversations/{$other->id}")->assertNotFound();
        $this->postJson("/api/app/conversations/{$other->id}/typing")->assertNotFound();
        Event::assertNotDispatched(ConversationActivity::class);

        config(['broadcasting.default' => 'log']);
        $this->postJson("/api/app/conversations/{$mine->id}/typing", ['name' => 'Spoofed name'])->assertNoContent();
        Event::assertDispatched(ConversationActivity::class, function (ConversationActivity $event) use ($owner, $agent, $mine) {
            return array_map(fn ($channel) => $channel->name, $event->broadcastOn()) === ['private-inbox-activity.'.$owner->id]
                && $event->broadcastWith() === [
                    'conversation_id' => $mine->id,
                    'kind' => 'typing',
                    'key' => 'user:'.$agent->id,
                    'active' => true,
                    'name' => $agent->name,
                ];
        });
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

