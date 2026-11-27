<?php

namespace Tests\Feature;

use App\Auth\Access;
use App\Auth\PermissionRegistry;
use App\Events\MessageCreated;
use App\Jobs\SendBroadcastRecipient;
use App\Models\Broadcast;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\MessageTemplate;
use App\Models\User;
use App\Services\BroadcastService;
use App\Services\MessagingService;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Bus;

class AuthorizationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'broadcasting.default' => 'null',
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
        ]);
        $this->artisan('migrate')->assertSuccessful();
    }

    public function test_every_signed_in_crm_api_route_has_a_permission(): void
    {
        foreach (app('router')->getRoutes() as $route) {
            if (str_starts_with($route->uri(), 'api/app/')) {
                $this->assertContains('rbac', $route->gatherMiddleware(), $route->uri());
                $this->assertNotNull(PermissionRegistry::forAction($route->getActionName()), $route->getActionName());
            }
        }

        $this->getJson('/api/app/contacts')->assertUnauthorized();
    }

    public function test_overrides_take_effect_on_the_next_request_for_only_one_user(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $member = User::factory()->create(['role' => 'admin']);
        $other = User::factory()->create(['role' => 'admin']);

        $this->actingAs($member)->getJson('/api/app/contacts')->assertOk();
        $this->putJson('/api/app/authorization/users/'.$member->id, ['overrides' => ['contacts.view' => false]])->assertForbidden();

        $this->actingAs($owner)->putJson('/api/app/authorization/users/'.$member->id, ['overrides' => ['contacts.view' => false]])->assertOk();
        $this->actingAs($member)->getJson('/api/app/contacts')->assertForbidden();
        $this->getJson('/api/app/contacts/export')->assertForbidden();
        $this->actingAs($other)->getJson('/api/app/contacts')->assertOk();

        $this->actingAs($owner)->putJson('/api/app/authorization/users/'.$member->id, ['overrides' => []])->assertOk();
        $this->actingAs($member)->getJson('/api/app/contacts')->assertOk();
        $this->assertDatabaseCount('authorization_audits', 2);
    }

    public function test_owner_access_is_protected_and_requires_activation(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $this->assertTrue(app(Access::class)->can($owner, 'new_module.view'));
        $this->actingAs($owner)->putJson('/api/app/authorization/users/'.$owner->id, ['overrides' => []])->assertForbidden();
        $this->patchJson('/api/app/users/'.$owner->id, ['is_active' => false])->assertForbidden();
        $this->patchJson('/api/app/users/'.$owner->id, ['role' => 'agent'])->assertForbidden();
        $this->assertTrue($owner->fresh()->is_active);
        $owner->is_active = false;
        $this->assertFalse(app(Access::class)->can($owner, 'new_module.view'));
    }

    public function test_custom_role_scopes_inbox_and_blocks_ungranted_actions(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $key = $this->actingAs($owner)->postJson('/api/app/authorization/roles', [
            'name' => 'Read assigned',
            'permissions' => ['inbox.view', 'conversations.view_assigned', 'messages.read'],
        ])->assertOk()->json('key');

        $member = User::factory()->create(['role' => $key]);
        $assigned = $this->conversation('15550000001', $member->id);
        $unassigned = $this->conversation('15550000002');
        $this->actingAs($member)->getJson('/api/app/conversations')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $assigned->id);
        $this->getJson('/api/app/inbox/unread-count')->assertOk()->assertJsonPath('count', 1);
        $this->getJson('/api/app/conversations/'.$assigned->id.'/messages')->assertOk();
        $this->getJson('/api/app/conversations/'.$unassigned->id.'/messages')->assertForbidden();
        $this->getJson('/api/app/realtime/sync?conversation_id='.$unassigned->id)->assertForbidden();
        $this->postJson('/api/app/conversations/'.$assigned->id.'/messages', [])->assertForbidden();
        $this->getJson('/api/app/broadcasts')->assertForbidden();
        $this->assertSame([], (new MessageCreated($assigned->id, ['body' => 'secret'], []))->broadcastWith());

        $this->actingAs($owner)->deleteJson('/api/app/authorization/roles/'.$key)->assertConflict();
    }

    public function test_contact_delete_override_does_not_affect_editing_or_another_admin(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $restricted = User::factory()->create(['role' => 'admin']);
        $unrestricted = User::factory()->create(['role' => 'admin']);
        $contact = Contact::create(['name' => 'Contact', 'phone' => '15550100002', 'phone_normalized' => '15550100002']);

        $this->actingAs($owner)->putJson('/api/app/authorization/users/'.$restricted->id, [
            'overrides' => ['contacts.delete' => false, 'contacts.export' => false],
        ])->assertOk();
        $this->actingAs($restricted)->patchJson('/api/app/contacts/'.$contact->id, ['name' => 'Updated'])->assertOk();
        $this->deleteJson('/api/app/contacts/'.$contact->id)->assertForbidden();
        $this->deleteJson('/api/app/contacts/999999')->assertForbidden();
        $this->getJson('/api/app/contacts/export')->assertForbidden();
        $this->actingAs($unrestricted)->deleteJson('/api/app/contacts/'.$contact->id)->assertNoContent();
    }

    public function test_resource_and_module_revocation_block_media_and_direct_web_navigation(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $agent = User::factory()->create(['role' => 'agent']);
        $conversation = $this->conversation('15550100003', $agent->id);
        $message = $conversation->messages()->create([
            'sender_type' => 'customer', 'content_type' => 'image', 'status' => 'received', 'media_url' => 'meta-media-id',
        ]);
        $this->actingAs($owner)->putJson('/api/app/authorization/users/'.$agent->id, [
            'overrides' => ['messages.download' => false, 'broadcasts.view' => false],
        ])->assertOk();
        $this->actingAs($agent)->getJson('/api/app/messages/'.$message->id.'/media')->assertForbidden();
        $this->getJson('/api/app/broadcasts/options')->assertForbidden();
        $this->get('/broadcasts', ['X-Inertia' => 'true'])->assertForbidden()->assertJsonPath('component', 'AccessDeniedPage');
    }

    public function test_a_queued_workspace_broadcast_rechecks_permission_after_revocation(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $agent = User::factory()->create(['role' => 'agent']);
        $template = MessageTemplate::create(['name' => 'welcome', 'status' => 'APPROVED']);
        $contact = Contact::create(['name' => 'Contact', 'phone' => '15550100004', 'phone_normalized' => '15550100004']);
        $broadcast = Broadcast::create([
            'name' => 'Campaign', 'user_id' => $agent->id, 'template_id' => $template->id,
            'status' => 'scheduled', 'audience' => ['type' => 'all'], 'scheduled_at' => now()->subMinute(),
            'workspace_authorized' => true,
        ]);
        $recipient = $broadcast->recipients()->create(['contact_id' => $contact->id]);

        $this->actingAs($owner)->putJson('/api/app/authorization/users/'.$agent->id, [
            'overrides' => ['broadcasts.send' => false],
        ])->assertOk();
        Bus::fake([SendBroadcastRecipient::class]);
        $broadcasts = app(BroadcastService::class);
        $this->assertSame(1, $broadcasts->dispatchScheduled());
        Bus::assertDispatched(SendBroadcastRecipient::class,
            fn ($job) => $job->actorId === $agent->id && $job->permission === 'broadcasts.schedule');

        $job = new SendBroadcastRecipient($recipient->id, $agent->id, 'broadcasts.schedule');
        $job->handle(app(MessagingService::class), $broadcasts);
        $this->assertSame('failed', $recipient->fresh()->status);
        $this->assertDatabaseCount('messages', 0);
    }

    private function conversation(string $phone, ?int $assignee = null): Conversation
    {
        $contact = Contact::create(['name' => 'Test Contact', 'phone' => $phone, 'phone_normalized' => $phone]);

        return Conversation::create(['contact_id' => $contact->id, 'assigned_agent_id' => $assignee, 'unread_count' => 1]);
    }
}
