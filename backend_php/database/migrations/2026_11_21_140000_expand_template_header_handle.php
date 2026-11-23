<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('message_templates', function (Blueprint $table) {
            $table->text('header_handle')->nullable()->change();
        });
    }

    public function down(): void
    {
        if (DB::table('message_templates')->whereRaw('LENGTH(header_handle) > 255')->exists()) {
            throw new \RuntimeException('Cannot shrink header_handle while longer values are stored.');
        }

        Schema::table('message_templates', function (Blueprint $table) {
            $table->string('header_handle')->nullable()->change();
        });
    }
};
