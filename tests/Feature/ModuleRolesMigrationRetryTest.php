<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ModuleRolesMigrationRetryTest extends TestCase
{
    public function test_retry_preserves_users_and_finishes_pending_invitation_conversion(): void
    {
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        $migration = 'database/migrations/2026_11_27_000100_create_module_roles.php';
        $previous = glob(base_path('database/migrations/0001_*.php'));
        $this->artisan('migrate', ['--realpath' => true, '--path' => $previous])->assertSuccessful();

        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->json('module_access');
            $table->timestamps();
        });
        Schema::table('users', fn (Blueprint $table) => $table->foreignId('role_id')->nullable()->constrained()->restrictOnDelete());

        $slug = 'legacy-'.substr(hash('sha256', 'agent'), 0, 24);
        $roleId = DB::table('roles')->insertGetId(['name' => 'Agent (legacy)', 'slug' => $slug, 'module_access' => '["contacts","notifications"]']);
        $userId = DB::table('users')->insertGetId([
            'name' => 'Legacy Agent', 'email' => 'agent@example.test', 'password' => 'fixture', 'role' => 'agent', 'role_id' => $roleId,
        ]);
        foreach (['agent', $slug] as $index => $invitationRole) {
            DB::table('account_invitations')->insert([
                'token_hash' => hash('sha256', (string) $index), 'role' => $invitationRole, 'expires_at' => now()->addDay(), 'created_by' => $userId,
            ]);
        }

        $this->artisan('migrate', ['--path' => [$migration]])->assertSuccessful();
        $this->assertFalse(Schema::hasColumn('users', 'role'));
        $this->assertSame($roleId, DB::table('users')->where('id', $userId)->value('role_id'));
        $this->assertSame([$slug, $slug], DB::table('account_invitations')->orderBy('id')->pluck('role')->all());
        $this->assertSame([$userId, $userId], DB::table('account_invitations')->orderBy('id')->pluck('created_by')->all());
        $this->assertSame(4, DB::table('roles')->count());
    }
}
