<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Schema;

class ModuleRolesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
            'broadcasting.default' => 'null',
        ]);
        $this->artisan('migrate')->assertSuccessful();
    }

    public function test_migration_creates_three_defaults_and_one_user_role_relationship(): void
    {
        $this->assertSame(['agent', 'owner', 'viewer'], Role::orderBy('slug')->pluck('slug')->all());
        $this->assertTrue(Schema::hasColumn('users', 'role_id'));
        $this->assertFalse(Schema::hasColumn('users', 'role'));
        $owner = $this->member('owner');
        $this->assertSame(array_keys(Role::MODULES), $owner->allowedModules());
        $this->assertTrue($owner->hasModuleAccess('future-module'));
        $this->getJson('/api/app/roles')->assertUnauthorized();
    }

    public function test_owner_can_manage_and_assign_custom_roles(): void
    {
        $owner = $this->member('owner');
        $agent = $this->member('agent');

        $this->actingAs($owner);
        $roleId = $this->postJson('/api/app/roles', ['name' => 'Contacts', 'module_access' => ['contacts']])->assertCreated()->json('id');
        $this->patchJson('/api/app/users/'.$agent->id, ['role_id' => $roleId])->assertOk();
        $this->assertSame($roleId, $agent->fresh()->role_id);
        $this->deleteJson('/api/app/roles/'.$roleId)->assertConflict();

        $this->actingAs($agent->fresh());
        $this->getJson('/api/user')->assertOk()->assertJsonPath('user.module_access', ['contacts']);
        $this->postJson('/api/app/contacts', ['name' => 'Customer', 'phone' => '15550000055'])->assertCreated();
        $this->getJson('/api/app/broadcasts')->assertForbidden();
        $this->get('/broadcasts', ['X-Inertia' => 'true'])->assertForbidden()->assertJsonPath('component', 'AccessDeniedPage');
        $this->patchJson('/api/app/users/'.$agent->id, ['role_id' => $owner->role_id])->assertForbidden();

        $this->actingAs($owner)->patchJson('/api/app/roles/'.$roleId, ['name' => 'Tags', 'module_access' => ['workspace']])->assertOk();
        $this->actingAs($agent->fresh())->getJson('/api/app/contacts')->assertForbidden();
        $this->getJson('/api/app/tags')->assertOk();
        $this->postJson('/api/app/tags', ['name' => 'Priority', 'color' => '#345678'])->assertCreated();

        $this->actingAs($owner)->patchJson('/api/app/users/'.$agent->id, ['role_id' => Role::where('slug', 'viewer')->value('id')])->assertOk();
        $this->deleteJson('/api/app/roles/'.$roleId)->assertNoContent();
    }

    public function test_team_access_cannot_modify_roles_and_owner_is_protected(): void
    {
        $owner = $this->member('owner');
        $role = Role::create(['name' => 'Team', 'slug' => 'test-team', 'module_access' => ['team']]);
        $member = User::factory()->create(['role_id' => $role->id]);
        $this->actingAs($member)->getJson('/api/app/users')->assertOk();
        $this->getJson('/api/app/roles')->assertForbidden();
        $this->postJson('/api/app/roles', ['name' => 'New', 'module_access' => ['team']])->assertForbidden();

        $this->actingAs($owner)->patchJson('/api/app/roles/'.$owner->role_id, ['name' => 'Removed', 'module_access' => []])->assertForbidden();
        $this->deleteJson('/api/app/roles/'.$owner->role_id)->assertForbidden();
        $this->patchJson('/api/app/users/'.$owner->id, ['is_active' => false])->assertForbidden();
        $this->patchJson('/api/app/users/'.$owner->id, ['role_id' => $role->id])->assertForbidden();
        $this->postJson('/api/app/users/'.$member->id.'/transfer-ownership')->assertOk();
        $this->assertTrue($member->fresh()->isOwner());
        $this->assertFalse($owner->fresh()->isOwner());
    }

    public function test_web_session_refresh_and_explicit_sign_in_use_the_web_guard(): void
    {
        $this->getJson('/session/user')->assertUnauthorized();
        $member = $this->member('owner');

        $this->actingAs($member)->getJson('/session/user')->assertOk()->assertJsonPath('user.id', $member->id);
        $this->get('/login')->assertRedirect('/');
        $this->withoutVite()->get('/login?reauth=1')->assertOk()->assertSee('LoginPage');
    }

    public function test_same_origin_api_requests_work_with_referrer_stripped(): void
    {
        $middleware = \App\Http\Middleware\StartStatefulApiSession::class;
        $request = \Illuminate\Http\Request::create('https://crm.example.test/api/user');
        $request->headers->set('Sec-Fetch-Site', 'same-origin');
        $this->assertTrue($middleware::fromFrontend($request));

        $request->headers->set('Origin', 'https://other.example.test');
        config(['sanctum.stateful' => ['crm.example.test']]);
        $this->assertFalse($middleware::fromFrontend($request));
    }

    public function test_legacy_owner_can_open_dashboard_before_role_migration(): void
    {
        $owner = new User;
        $owner->setRawAttributes(['id' => 123, 'role' => 'owner', 'is_active' => true], true);

        $this->actingAs($owner)->withoutVite()->get('/dashboard')->assertOk()->assertSee('DashboardPage');
        $this->getJson('/session/user')
            ->assertOk()
            ->assertJsonPath('user.role', 'owner')
            ->assertJsonPath('user.module_access', array_keys(Role::MODULES));

        $owner->setRawAttributes(['id' => 123, 'role' => 'owner', 'role_id' => null, 'is_active' => true], true);
        $this->assertFalse($owner->hasModuleAccess('dashboard'));
        $owner->setRawAttributes(['id' => 123, 'role' => 'admin', 'is_active' => true], true);
        $this->assertFalse($owner->hasModuleAccess('dashboard'));
    }

    private function member(string $slug): User
    {
        return User::factory()->create(['role_id' => Role::where('slug', $slug)->value('id')]);
    }
}
