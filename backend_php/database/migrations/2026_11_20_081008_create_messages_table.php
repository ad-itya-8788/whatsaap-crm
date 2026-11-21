<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->string('sender_type'); // customer|agent|bot|system
            $table->foreignId('sender_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('content_type')->default('text');
            $table->text('content_text')->nullable();
            $table->string('media_url')->nullable();
            $table->string('media_type')->nullable();
            $table->string('filename')->nullable();
            $table->string('template_name')->nullable();
            $table->string('message_id')->nullable()->index(); // Meta wamid
            $table->string('status')->default('sent'); // sending|sent|delivered|read|failed
            $table->foreignId('reply_to_message_id')->nullable()->constrained('messages')->nullOnDelete();
            $table->string('interactive_reply_id')->nullable();
            $table->json('interactive_payload')->nullable();
            $table->boolean('ai_generated')->default(false);
            $table->integer('error_code')->nullable();
            $table->string('error_title')->nullable();
            $table->text('error_details')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
            $table->index(['conversation_id', 'created_at']);
        });
    }
    public function down(): void { Schema::dropIfExists('messages'); }
};
