<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        if (! Schema::hasTable('roles')) {
            Schema::create('roles', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('slug')->unique();
                $table->json('module_access');
                $table->timestamps();
            });
        }

        $roles = [];
        foreach (['owner' => [], 'agent' => ['inbox', 'contacts', 'notifications'], 'viewer' => ['dashboard', 'reports']] as $slug => $modules) {
            $roles[$slug] = $this->insertRole($slug, ucfirst($slug), $modules);
        }

        if (! Schema::hasColumn('users', 'role_id')) {
            Schema::table('users', fn (Blueprint $table) => $table->foreignId('role_id')->nullable());
        }

        if (! collect(Schema::getForeignKeys('users'))->contains(fn ($key) => $key['columns'] === ['role_id'] && $key['foreign_table'] === 'roles')) {
            Schema::table('users', fn (Blueprint $table) => $table->foreign('role_id')->references('id')->on('roles')->restrictOnDelete());
        }

        Schema::table('account_invitations', fn (Blueprint $table) => $table->string('role', 255)->change());

        if (! Schema::hasColumn('users', 'role')) {
            return;
        }

        $hasGranularRoles = Schema::hasTable('crm_roles');
        $legacy = DB::table('users')->pluck('role')->merge(DB::table('account_invitations')->pluck('role'))->uniqueStrict();
        $mapping = [];
        foreach ($legacy as $slug) {
            // An earlier attempt may have already converted some invitations.
            if (preg_match('/^legacy-[a-f0-9]{24}$/D', $slug)
                && ($id = DB::table('roles')->where('slug', $slug)->value('id')) !== null) {
                $mapping[$slug] = [$id, $slug];
                continue;
            }

            if ($slug === 'owner' || (! $hasGranularRoles && $slug === 'viewer')) {
                $mapping[$slug] = [$roles[$slug], $slug];
                continue;
            }

            $modules = $hasGranularRoles ? [] : match ($slug) {
                'admin' => ['dashboard', 'inbox', 'notifications', 'contacts', 'broadcasts', 'ai_agents', 'workspace', 'templates', 'reports', 'team', 'settings'],
                'agent' => ['contacts', 'notifications'],
                default => [],
            };
            $newSlug = 'legacy-'.substr(hash('sha256', $slug), 0, 24);
            $mapping[$slug] = [$this->insertRole($newSlug, ucfirst(substr($slug, 0, 230)).' (legacy)', $modules), $newSlug];
        }

        DB::table('users')->select('id', 'role')->chunkById(500, function ($users) use ($mapping) {
            foreach ($users->groupBy('role') as $slug => $members) {
                DB::table('users')->whereIn('id', $members->pluck('id'))->whereNull('role_id')->update(['role_id' => $mapping[$slug][0]]);
            }
        });
        DB::table('account_invitations')->select('id', 'role')->chunkById(500, function ($invitations) use ($mapping) {
            foreach ($invitations->groupBy('role') as $slug => $group) {
                $newSlug = $mapping[$slug][1];
                if ($slug !== $newSlug) {
                    DB::table('account_invitations')->whereIn('id', $group->pluck('id'))->update(['role' => $newSlug]);
                }
            }
        });

        foreach (Schema::getForeignKeys('users') as $foreign) {
            if ($foreign['columns'] === ['role']) {
                Schema::table('users', fn (Blueprint $table) => $table->dropForeign(['role']));
            }
        }
        foreach (Schema::getIndexes('users') as $index) {
            if (in_array('role', $index['columns'], true)) {
                Schema::table('users', fn (Blueprint $table) => $table->dropIndex($index['name']));
            }
        }

        Schema::table('users', function (Blueprint $table) {
            $table->unsignedBigInteger('role_id')->nullable(false)->change();
            $table->dropColumn('role');
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Restore the pre-upgrade backup to roll back role conversion.');
    }

    private function insertRole(string $slug, string $name, array $modules): int
    {
        DB::table('roles')->insertOrIgnore([
            'slug' => $slug,
            'name' => $name,
            'module_access' => json_encode($modules, JSON_THROW_ON_ERROR),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('roles')->where('slug', $slug)->value('id');
    }
};
