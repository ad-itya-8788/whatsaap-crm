<?php

namespace Tests\Feature;

use App\Models\AccountInvitation;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class TeamAccessTest extends TestCase
{
    use DatabaseTransactions;

    public function test_owner_transfer_checks_actual_roles_and_promotes_the_target_only(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $admin = User::factory()->create(['role' => 'admin']);
        $viewer = User::factory()->create(['role' => 'viewer']);

        $this->actingAs($admin)->patchJson('/api/app/users/'.$owner->id, ['role' => 'agent'])->assertForbidden();
        $this->postJson('/api/app/users/'.$viewer->id.'/transfer-ownership')->assertForbidden();
        $this->actingAs($owner)->postJson('/api/app/users/'.$viewer->id.'/transfer-ownership')->assertOk();

        $this->assertSame('admin', $owner->fresh()->role);
        $this->assertSame('owner', $viewer->fresh()->role);
    }

    public function test_invitation_can_only_be_redeemed_once_and_keeps_the_assigned_role(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $invitation = $this->actingAs($admin)->postJson('/api/app/invitations', [
            'role' => 'viewer',
        ])->assertCreated()->assertJsonMissingPath('invitation.token_hash');
        $token = basename($invitation->json('path'));
        $invitePath = '/api/invitations/'.$token;
        $this->app['auth']->forgetGuards();

        $this->getJson($invitePath.'/peek')->assertOk()->assertJsonPath('role', 'viewer');
        $data = [
            'name' => 'New viewer',
            'email' => 'invite-test@example.test',
            'password' => 'example-password',
            'password_confirmation' => 'example-password',
        ];
        $this->postJson($invitePath.'/redeem', $data)->assertStatus(419);
        config(['sanctum.stateful' => ['localhost']]);
        $this->withHeader('Origin', 'http://localhost')->postJson($invitePath.'/redeem', $data)
            ->assertCreated()->assertJsonPath('user.role', 'viewer');
        $this->getJson('/api/app/contacts')->assertOk();
        $this->postJson('/api/app/contacts', ['name' => 'Forbidden'])->assertForbidden();
        $this->postJson('/api/app/invitations', ['role' => 'admin'])->assertForbidden();
        $this->postJson('/api/logout')->assertNoContent();
        $this->app['auth']->forgetGuards();
        $this->getJson($invitePath.'/peek')->assertNotFound();
        $this->postJson($invitePath.'/redeem', $data)->assertNotFound();
        $this->assertDatabaseHas('account_invitations', ['token_hash' => hash('sha256', $token)]);
    }

    public function test_revoked_and_expired_invitation_links_are_unavailable(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $revoked = $this->actingAs($admin)->postJson('/api/app/invitations', [
            'role' => 'agent',
        ])->assertCreated();
        $this->deleteJson('/api/app/invitations/'.$revoked->json('invitation.id'))->assertNoContent();

        $expired = $this->postJson('/api/app/invitations', [
            'role' => 'agent',
        ])->assertCreated();
        AccountInvitation::findOrFail($expired->json('invitation.id'))->update(['expires_at' => now()->subMinute()]);

        foreach ([$revoked, $expired] as $result) {
            $this->getJson('/api/invitations/'.basename($result->json('path')).'/peek')->assertNotFound();
        }
    }
}
