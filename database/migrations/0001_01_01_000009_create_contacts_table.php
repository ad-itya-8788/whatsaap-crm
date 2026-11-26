<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); // creator/owner agent (audit)
            $table->string('phone')->nullable();
            $table->string('phone_normalized')->nullable();
            $table->string('wa_user_id')->nullable();
            $table->string('wa_username')->nullable();
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->string('company')->nullable();
            $table->string('avatar_url')->nullable();
            $table->string('consent_status')->default('unknown');
            $table->timestamp('consent_at')->nullable();
            $table->timestamps();
            $table->unique('phone_normalized');
            $table->unique('wa_user_id');
            $table->index('phone');
            $table->index('created_at');
            $table->index(['updated_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
    }
};
