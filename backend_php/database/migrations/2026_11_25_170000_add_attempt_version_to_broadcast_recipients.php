<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('broadcast_recipients', function (Blueprint $table) {
            $table->unsignedInteger('attempt_version')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('broadcast_recipients', fn (Blueprint $table) => $table->dropColumn('attempt_version'));
    }
};
