<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->createTableIfMissing('ai_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('provider')->default('openai');
            $table->string('model')->default('gpt-4o-mini');
            $table->string('base_url')->nullable();
            $table->text('api_key');
            $table->text('embeddings_api_key')->nullable();
            $table->longText('system_prompt')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        $this->createTableIfMissing('ai_knowledge_documents', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->longText('content');
            $table->string('source')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        $this->createTableIfMissing('ai_knowledge_chunks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')->constrained('ai_knowledge_documents')->cascadeOnDelete();
            $table->unsignedInteger('chunk_index');
            $table->text('content');
            $table->longText('embedding')->nullable();
            $table->timestamps();
            $table->index(['document_id', 'chunk_index']);
        });

        $this->createTableIfMissing('ai_usage_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('mode');
            $table->string('provider')->nullable();
            $table->string('model')->nullable();
            $table->unsignedInteger('prompt_tokens')->default(0);
            $table->unsignedInteger('completion_tokens')->default(0);
            $table->unsignedInteger('total_tokens')->default(0);
            $table->foreignId('conversation_id')->nullable()->constrained()->nullOnDelete();
            $table->boolean('success')->default(true);
            $table->text('error')->nullable();
            $table->timestamps();
            $table->index(['created_at', 'mode']);
        });
    }

    public function down(): void
    {
        // Tables can already exist in installations upgraded from the earlier schema.
    }

    private function createTableIfMissing(string $name, Closure $definition): void
    {
        if (! Schema::hasTable($name)) {
            Schema::create($name, $definition);
        }
    }
};
