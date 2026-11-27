<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $role = collect(Schema::getColumns('account_invitations'))->firstWhere('name', 'role');

        if (($role['type'] ?? null) === 'varchar(16)') {
            Schema::table('account_invitations', fn (Blueprint $table) => $table->string('role', 255)->change());
        }
    }

    public function down(): void
    {
        // Keep the wider column because newer invitations can contain longer role slugs.
    }
};
