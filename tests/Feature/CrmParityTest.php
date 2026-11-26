<?php

namespace Tests\Feature;

use App\Jobs\DeliverOutboundWebhook;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\MessageTemplate;
use App\Models\User;
use App\Models\WebhookEndpoint;
use App\Models\WhatsappConfig;
use App\Services\OutboundWebhookTarget;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CrmParityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_active_session_can_load_data_and_disabled_account_is_rejected(): void
    {
        $agent = User::factory()->create(['role' => 'agent']);
        $this->assertContains('localhost', config('sanctum.stateful'));
        $login = $this->withHeader('Origin', 'http://localhost')->postJson('/api/login', [
            'email' => $agent->email,
            'password' => 'password',
        ])->assertOk()->assertJsonPath('user.id', $agent->id);
        $sessionCookie = config('session.cookie');
        $this->withCredentials()->withUnencryptedCookie($sessionCookie, $login->getCookie($sessionCookie, false)->getValue());
        $this->app['auth']->forgetGuards();
        $contact = Contact::create(['name' => 'Existing contact']);
        $conversation = Conversation::create(['contact_id' => $contact->id, 'unread_count' => 1]);
        $this->getJson('/api/app/contacts?search=Existing%20contact')->assertOk()->assertJsonPath('data.0.conversation_id', $conversation->id);
        $this->getJson('/api/app/conversations/'.$conversation->id)->assertOk()->assertJsonPath('id', $conversation->id);
        $this->getJson('/api/app/inbox/unread-count')->assertOk()->assertJsonStructure(['count']);
        $this->getJson('/api/app/notifications/unread-count')->assertOk()->assertJsonPath('count', 0);
        $this->putJson('/api/app/presence', ['status' => 'online'])->assertNoContent();
        $this->getJson('/api/app/presence')->assertOk()->assertJsonPath($agent->id.'.presence_status', 'online');

        $this->postJson('/api/logout')->assertNoContent();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/app/conversations')->assertUnauthorized();

        $agent->update(['is_active' => false]);
        $this->actingAs($agent)->getJson('/api/app/contacts')->assertUnauthorized();
    }

    public function test_contact_notes_persist_and_are_scoped_to_the_requested_contact(): void
    {
        $agent = User::factory()->create(['role' => 'agent']);
        $contact = Contact::create(['name' => 'One']);
        $otherContact = Contact::create(['name' => 'Two']);
        $path = '/api/app/contacts/'.$contact->id.'/notes';

        $note = $this->actingAs($agent)->postJson($path, ['body' => 'Onboarded'])->assertCreated();
        $this->getJson($path)->assertJsonPath('0.body', 'Onboarded');
        $id = $note->json('id');
        $this->deleteJson('/api/app/contacts/'.$otherContact->id.'/notes/'.$id)->assertNotFound();
        $this->deleteJson($path.'/'.$id)->assertNoContent();
        $this->getJson($path)->assertExactJson([]);
    }

    public function test_scoped_api_keys_do_not_grant_session_access_and_revocation_is_immediate(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $created = $this->actingAs($owner)->postJson('/api/app/api-keys', [
            'name' => 'QA connector',
            'scopes' => ['contacts:read', 'contacts:write'],
        ])->assertCreated()->assertJsonMissingPath('data.key_hash');
        $key = $created->json('token');
        $id = $created->json('data.id');
        $this->getJson('/api/app/api-keys')->assertJsonMissingPath('data.0.key_hash');
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/app/contacts', ['Authorization' => 'Bearer '.$key])->assertUnauthorized();
        $this->getJson('/api/v1/contacts/999999999')->assertUnauthorized();
        $this->withToken($key)->getJson('/api/v1/me')->assertJsonPath('data.key.id', $id);
        $this->getJson('/api/v1/conversations')->assertForbidden();

        $contact = $this->postJson('/api/v1/contacts', ['phone' => '+14155550123', 'name' => 'QA', 'tags' => ['new']])
            ->assertCreated()->assertJsonPath('data.tags.0.name', 'new')->json('data.id');
        $this->getJson('/api/v1/contacts/'.$contact)->assertJsonPath('data.name', 'QA');
        $this->getJson('/api/v1/contacts?limit=1')->assertOk()->assertJsonStructure(['data', 'meta' => ['next_cursor']]);
        $this->patchJson('/api/v1/contacts/'.$contact, ['company' => 'Updated'])->assertJsonPath('data.company', 'Updated');
        $this->postJson('/api/v1/contacts', ['phone' => '14155550123'])->assertStatus(400);

        $this->actingAs($owner)->deleteJson('/api/app/api-keys/'.$id)->assertOk();
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_inbox_message_types_and_reactions_survive_reload(): void
    {
        Http::preventStrayRequests();
        Http::fake(['https://graph.facebook.com/*' => Http::sequence()
            ->push(['messages' => [['id' => 'wamid.qa.interactive']]])
            ->push(['messages' => [['id' => 'wamid.qa.template']]])
            ->push(['messages' => [['id' => 'wamid.qa.reaction']]])
            ->push(['messages' => [['id' => 'wamid.qa.unreact']]])]);

        $agent = User::factory()->create(['role' => 'agent']);
        $contact = Contact::create(['phone' => '+14155550124', 'phone_normalized' => '14155550124']);
        $conversation = Conversation::create(['contact_id' => $contact->id, 'last_inbound_at' => now()]);
        WhatsappConfig::create([
            'status' => 'connected', 'phone_number_id' => '12345', 'access_token' => 'fixture-token',
        ]);
        $template = MessageTemplate::create([
            'name' => 'qa_update', 'language' => 'en_US', 'body_text' => 'Hello {{1}}',
            'category' => 'UTILITY', 'status' => 'APPROVED',
        ]);
        $path = '/api/app/conversations/'.$conversation->id.'/messages';
        $interactive = ['kind' => 'buttons', 'body' => 'Choose a time', 'buttons' => [['id' => 'morning', 'title' => 'Morning']]];
        $this->actingAs($agent)->getJson('/api/app/whatsapp/templates')->assertOk()
            ->assertJsonFragment(['status' => 'APPROVED', 'approval_status' => 'APPROVED']);
        $this->getJson('/api/app/broadcasts/options')->assertOk()->assertJsonFragment(['name' => $template->name]);
        $this->postJson($path, [
            'content_type' => 'interactive', 'content_text' => 'Choose a time', 'interactive_payload' => $interactive,
        ])->assertCreated()->assertJsonPath('message_id', 'wamid.qa.interactive');

        $conversation->update(['last_inbound_at' => now()->subDays(2)]);
        $message = $this->postJson($path, [
            'content_type' => 'template', 'template_name' => $template->name,
            'template_language' => 'en_US', 'template_params' => ['QA'],
        ])->assertCreated()->assertJsonPath('message_id', 'wamid.qa.template')->json('id');
        $reaction = '/api/app/messages/'.$message.'/react';
        $this->postJson($reaction, ['emoji' => '👍'])->assertOk()->assertJsonPath('reactions.0.emoji', '👍');
        $this->getJson($path)->assertJsonPath('data.0.reactions.0.emoji', '👍')
            ->assertJsonPath('data.0.content_text', 'Hello QA')
            ->assertJsonPath('data.1.interactive_payload.buttons.0.id', 'morning');
        $this->postJson($reaction, ['emoji' => ''])->assertOk()->assertExactJson(['reactions' => []]);
        Http::assertSent(fn (Request $request) => $request['type'] === 'template'
            && $request['template']['components'][0]['parameters'][0]['text'] === 'QA');
    }

    public function test_webhook_delivery_signs_the_body_and_rejects_local_destinations(): void
    {
        $target = app(OutboundWebhookTarget::class);
        $this->assertNull($target->resolve('https://127.0.0.1/'));
        $this->assertNull($target->resolve('https://[::ffff:127.0.0.1]/'));
        $this->assertNull($target->resolve('https://10.1.2.3/'));

        Http::preventStrayRequests();
        Http::fake(['https://1.1.1.1/*' => Http::response(null, 204)]);
        $endpoint = WebhookEndpoint::create([
            'url' => 'https://1.1.1.1/hook',
            'secret' => 'fixture-signing-secret',
            'events' => ['conversation.created'],
        ]);
        $event = ['id' => 'fixture-id', 'event' => 'conversation.created', 'data' => ['conversation_id' => 1]];
        (new DeliverOutboundWebhook($endpoint->id, $event))->handle($target);
        Http::assertSent(function (Request $request) {
            $header = $request->header('X-Wacrm-Signature')[0];
            preg_match('/^t=(\d+),v1=([a-f0-9]+)$/', $header, $parts);

            return $request->header('X-Wacrm-Webhook-Id') === ['fixture-id']
                && hash_equals(hash_hmac('sha256', $parts[1].'.'.$request->body(), 'fixture-signing-secret'), $parts[2]);
        });
        $this->assertNotNull($endpoint->refresh()->last_delivery_at);
    }
}
