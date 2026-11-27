<?php

use App\Auth\PermissionRegistry;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // SQLite must be able to toggle foreign keys during the users table rebuild.
    public $withinTransaction = false;

    public function up(): void
    {
        Schema::create('crm_roles', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('permissions');
            $table->boolean('built_in')->default(false);
        });

        foreach (['owner', 'admin', 'agent', 'viewer'] as $role) {
            DB::table('crm_roles')->insert([
                'key' => $role,
                'name' => ucfirst($role),
                'permissions' => json_encode(PermissionRegistry::defaults($role), JSON_THROW_ON_ERROR),
                'built_in' => true,
            ]);
        }

        // Unknown legacy role values remain assigned but start with no privileges.
        $legacyRoles = DB::table('users')->distinct()->pluck('role')->diff(['owner', 'admin', 'agent', 'viewer']);
        foreach ($legacyRoles as $role) {
            DB::table('crm_roles')->insertOrIgnore(['key' => $role, 'name' => $role, 'permissions' => '[]']);
        }

        Schema::create('user_permission_overrides', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('permission', 100);
            $table->boolean('allowed');
            $table->primary(['user_id', 'permission']);
        });

        Schema::create('authorization_audits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action');
            $table->string('subject')->index();
            $table->json('previous')->nullable();
            $table->json('updated')->nullable();
            $table->timestamp('created_at');
        });

        Schema::table('broadcasts', fn (Blueprint $table) => $table->boolean('workspace_authorized')->default(false));
        Schema::table('users', function (Blueprint $table) {
            $table->index(['role', 'is_active']);
            $table->foreign('role')->references('key')->on('crm_roles')->restrictOnDelete();
        });
        Schema::table('account_invitations', fn (Blueprint $table) => $table->index('role'));
    }

    public function down(): void
    {
        Schema::table('broadcasts', fn (Blueprint $table) => $table->dropColumn('workspace_authorized'));
        Schema::table('account_invitations', fn (Blueprint $table) => $table->dropIndex(['role']));
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['role']);
            $table->dropIndex(['role', 'is_active']);
        });
        Schema::dropIfExists('authorization_audits');
        Schema::dropIfExists('user_permission_overrides');
        Schema::dropIfExists('crm_roles');
    }
};
