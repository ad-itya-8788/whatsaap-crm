<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WhatsappConfig;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WhatsappConfigTest extends TestCase
{
    use RefreshDatabase;

    public function test_saving_credentials_marks_whatsapp_connected(): void
    {
        Http::fake([
            'graph.facebook.com/*' => Http::response(['id' => '123456789'], 200),
        ]);

        $this->actingAs($this->createUser())
            ->postJson('/api/app/whatsapp/config', [
                'phone_number_id' => '123456789',
                'waba_id' => '987654321',
                'access_token' => 'test-access-token',
                'verify_token' => 'test-verify-token',
            ])
            ->assertOk()
            ->assertJsonPath('status', 'connected')
            ->assertJsonPath('connection_status', 'connected')
            ->assertJsonPath('has_access_token', true)
            ->assertJsonMissingPath('access_token');

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_contains($request->url(), '/987654321/subscribed_apps'));

        $this->getJson('/api/app/whatsapp/health')
            ->assertOk()
            ->assertJsonPath('status', 'connected');
    }

    public function test_failed_waba_subscription_is_reported_instead_of_claiming_webhook_readiness(): void
    {
        Http::fakeSequence('graph.facebook.com/*')
            ->push(['id' => '123456789'], 200)
            ->push(['error' => ['message' => 'Missing permission']], 400);

        $this->actingAs($this->createUser())
            ->postJson('/api/app/whatsapp/config', [
                'phone_number_id' => '123456789',
                'waba_id' => '987654321',
                'access_token' => 'test-access-token',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('status', 'disconnected')
            ->assertJsonPath('message', 'WhatsApp app could not subscribe to the WABA: Missing permission');

        $this->assertDatabaseHas('whatsapp_configs', [
            'phone_number_id' => '123456789',
            'status' => 'disconnected',
            'last_registration_error' => 'Missing permission',
        ]);
    }

    public function test_saving_existing_credentials_repairs_a_stale_disconnected_status(): void
    {
        Http::fake([
            'graph.facebook.com/*' => Http::response(['id' => '123456789'], 200),
        ]);
        $user = $this->createUser();
        WhatsappConfig::create([
            'user_id' => $user->id,
            'phone_number_id' => '123456789',
            'access_token' => 'previously-saved-token',
            'status' => 'disconnected',
        ]);

        $this->actingAs($user)
            ->postJson('/api/app/whatsapp/config', ['phone_number_id' => '123456789'])
            ->assertOk()
            ->assertJsonPath('status', 'connected')
            ->assertJsonPath('has_access_token', true);
    }

    public function test_invalid_credentials_are_not_reported_as_connected(): void
    {
        Http::fake([
            'graph.facebook.com/*' => Http::response(['error' => ['message' => 'Invalid access token']], 400),
        ]);

        $this->actingAs($this->createUser())
            ->postJson('/api/app/whatsapp/config', [
                'phone_number_id' => '123456789',
                'access_token' => 'invalid-token',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('status', 'disconnected');

        $this->assertDatabaseHas('whatsapp_configs', [
            'phone_number_id' => '123456789',
            'status' => 'disconnected',
            'last_registration_error' => 'Invalid access token',
        ]);
    }

    public function test_agent_cannot_change_whatsapp_settings(): void
    {
        $this->actingAs($this->createUser('agent'))
            ->postJson('/api/app/whatsapp/config', [
                'phone_number_id' => '123456789',
                'access_token' => 'token',
            ])
            ->assertForbidden();
    }

    private function createUser(string $role = 'admin'): User
    {
        return User::create([
            'name' => 'Test User',
            'email' => uniqid('whatsapp-config-', true).'@example.test',
            'password' => Hash::make('test-password'),
            'role' => $role,
        ]);
    }
}
