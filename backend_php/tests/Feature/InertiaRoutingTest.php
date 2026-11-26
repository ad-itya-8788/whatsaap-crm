<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Testing\AssertableInertia as Assert;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Tests\TestCase;

class InertiaRoutingTest extends TestCase
{
    public function test_guest_page_and_api_responses_have_separate_contracts(): void
    {
        $this->withoutVite();

        $this->get('/settings?tab=appearance')->assertRedirect('/login');
        $this->get('/login')->assertInertia(fn (Assert $page) => $page
            ->component('LoginPage', false)
            ->where('auth.user', null));
        $this->getJson('/api/user')->assertUnauthorized();
        $this->getJson('/api/missing')->assertNotFound();
    }

    public function test_workspace_routes_render_the_existing_pages_and_pass_route_parameters(): void
    {
        $this->withoutVite();
        $this->actingAs(new User(['name' => 'Owner', 'is_active' => true, 'role' => 'owner']));

        $this->get('/login')->assertRedirect('/dashboard');
        $this->get('/chats?conversation=42&filter=waiting')->assertRedirect('/inbox?filter=waiting&c=42');
        $this->get('/broadcasts/new')->assertInertia(fn (Assert $page) => $page
            ->component('BroadcastWizardPage', false)
            ->where('auth.user.role', 'owner')
            ->missing('auth.user.password'));
        $this->get('/broadcasts/42')->assertInertia(fn (Assert $page) => $page
            ->component('BroadcastDetailPage', false)
            ->where('id', '42'));
        $this->get('/templates/17/edit')->assertInertia(fn (Assert $page) => $page
            ->component('TemplatesPage', false)
            ->where('templateId', '17'));
    }

    public function test_invitation_urls_still_open_the_same_page(): void
    {
        $this->withoutVite();
        $token = str_repeat('a', 43);

        $this->get('/signup')->assertRedirect('/login');
        foreach (['/signup?invite='.$token, '/join/'.$token] as $url) {
            $this->get($url)->assertInertia(fn (Assert $page) => $page
                ->component('InviteJoinPage', false)
                ->where('inviteToken', $token));
        }
    }

    public function test_sanctum_recognises_the_integrated_origin_on_its_request_port(): void
    {
        $url = 'http://127.0.0.1:8187/api/login';
        $sameOrigin = Request::create($url, 'POST', server: ['HTTP_REFERER' => 'http://127.0.0.1:8187/login']);
        $crossOrigin = Request::create($url, 'POST', server: ['HTTP_REFERER' => 'https://unrelated.invalid/login']);

        $this->assertTrue(EnsureFrontendRequestsAreStateful::fromFrontend($sameOrigin));
        $this->assertFalse(EnsureFrontendRequestsAreStateful::fromFrontend($crossOrigin));
    }
}
