<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->string('status')->default('open'); // open|pending|closed
            $table->foreignId('assigned_agent_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('last_message_text')->nullable();
            $table->timestamp('last_message_at')->nullable();
            $table->unsignedInteger('unread_count')->default(0);
            $table->timestamp('last_inbound_at')->nullable();
            $table->timestamp('last_reply_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('first_inbound_at')->nullable();
            $table->boolean('ai_autoreply_disabled')->default(false);
            $table->unsignedInteger('ai_reply_count')->default(0);
            $table->text('ai_handoff_summary')->nullable();
            $table->timestamps();
            $table->index(['status']);
            $table->index(['contact_id']);
            $table->unique(['contact_id']); // one conversation per contact in single-org
        });
    }
    public function down(): void { Schema::dropIfExists('conversations'); }
};
