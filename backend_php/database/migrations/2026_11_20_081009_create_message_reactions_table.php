<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('message_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->string('actor_type'); // customer|agent
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('emoji');
            $table->timestamps();
            $table->unique(['message_id', 'actor_type', 'actor_id']);
            $table->index('conversation_id');
        });
    }
    public function down(): void { Schema::dropIfExists('message_reactions'); }
};
