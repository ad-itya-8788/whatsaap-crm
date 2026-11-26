<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('broadcast_recipients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('broadcast_id')->constrained()->cascadeOnDelete();
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->foreignId('message_id')->nullable()->constrained('messages')->nullOnDelete();
            $table->json('variables')->nullable();
            $table->string('status')->default('pending');
            $table->text('error')->nullable();
            $table->json('provider_error')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->unsignedInteger('attempt_version')->default(0);
            $table->timestamps();
            $table->unique(['broadcast_id', 'contact_id']);
            $table->index(['broadcast_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('broadcast_recipients');
    }
};
