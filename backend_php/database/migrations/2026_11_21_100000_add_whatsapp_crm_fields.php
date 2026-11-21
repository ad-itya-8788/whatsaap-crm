<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->timestamp('provider_timestamp')->nullable()->after('error_details');
            $table->unique('message_id', 'messages_message_id_unique');
        });

        Schema::table('message_templates', function (Blueprint $table) {
            $table->string('approval_status')->nullable()->after('status');
            $table->timestamp('last_synced_at')->nullable()->after('last_submitted_at');
        });

        DB::table('message_templates')
            ->whereNull('approval_status')
            ->update(['approval_status' => DB::raw('status')]);
    }

    public function down(): void
    {
        Schema::table('message_templates', function (Blueprint $table) {
            $table->dropColumn(['approval_status', 'last_synced_at']);
        });

        Schema::table('messages', function (Blueprint $table) {
            $table->dropUnique('messages_message_id_unique');
            $table->dropColumn('provider_timestamp');
        });
    }
};
