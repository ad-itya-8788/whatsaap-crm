<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('provider')->default('openai');
            $table->string('model')->default('gpt-4o-mini');
            $table->string('base_url')->nullable();
            $table->text('api_key');
            $table->text('embeddings_api_key')->nullable();
            $table->longText('system_prompt')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('auto_reply_enabled')->default(false);
            $table->unsignedInteger('auto_reply_max_per_conversation')->default(3);
            $table->foreignId('handoff_agent_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_configs');
    }
};
