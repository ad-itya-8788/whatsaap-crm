<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('contacts', function (Blueprint $table) {
            if (! Schema::hasColumn('contacts', 'consent_status')) {
                $table->string('consent_status')->default('unknown');
            }
            if (! Schema::hasColumn('contacts', 'consent_at')) {
                $table->timestamp('consent_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('contacts', function (Blueprint $table) {
            if (Schema::hasColumn('contacts', 'consent_at')) {
                $table->dropColumn('consent_at');
            }
            if (Schema::hasColumn('contacts', 'consent_status')) {
                $table->dropColumn('consent_status');
            }
        });
    }
};
