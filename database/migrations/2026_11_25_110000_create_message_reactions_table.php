<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('message_reactions')) {
            return;
        }

        Schema::create('message_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->string('actor_type', 16);
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->string('emoji', 32);
            $table->timestamps();

            $table->unique(['message_id', 'actor_type', 'actor_id'], 'message_reactions_actor_unique');
            $table->index('conversation_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_reactions');
    }
};
