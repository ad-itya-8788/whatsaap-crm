<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AuthSessionTest extends TestCase
{
    use RefreshDatabase;

    public static function frontendOrigins(): array
    {
        return [
            'localhost' => ['http://localhost:5173'],
            'loopback IP' => ['http://127.0.0.1:5173'],
        ];
    }

    #[DataProvider('frontendOrigins')]
    public function test_login_session_is_available_to_the_frontend(string $origin): void
    {
        $user = User::create([
            'name' => 'Test User',
            'email' => 'login@example.test',
            'password' => Hash::make('test-password'),
            'role' => 'agent',
        ]);

        $this->assertEmpty(config('session.domain'));

        $this->withHeader('Origin', $origin)
            ->postJson('/api/login', [
                'email' => $user->email,
                'password' => 'test-password',
            ])
            ->assertOk();

        $this->withHeader('Origin', $origin)
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.id', $user->id);
    }
}
