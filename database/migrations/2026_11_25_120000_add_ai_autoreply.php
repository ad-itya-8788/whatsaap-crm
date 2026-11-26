<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('ai_configs', 'updated_by')) {
            $this->addColumn('ai_configs', 'updated_by', fn (Blueprint $table) => $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete());
            if (Schema::hasColumn('ai_configs', 'created_by')) {
                DB::table('ai_configs')->update(['updated_by' => DB::raw('created_by')]);
            }
        }

        $this->addColumn('ai_knowledge_documents', 'source', fn (Blueprint $table) => $table->string('source')->nullable());
        $this->addColumn('ai_knowledge_documents', 'is_active', fn (Blueprint $table) => $table->boolean('is_active')->default(true));
        $this->addColumn('ai_usage_logs', 'user_id', fn (Blueprint $table) => $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete());
        $this->addColumn('ai_usage_logs', 'success', fn (Blueprint $table) => $table->boolean('success')->default(true));
        $this->addColumn('ai_usage_logs', 'error', fn (Blueprint $table) => $table->text('error')->nullable());
        $this->addColumn('ai_configs', 'auto_reply_enabled', fn (Blueprint $table) => $table->boolean('auto_reply_enabled')->default(false));
        $this->addColumn('ai_configs', 'auto_reply_max_per_conversation', fn (Blueprint $table) => $table->unsignedInteger('auto_reply_max_per_conversation')->default(3));
        $this->addColumn('ai_configs', 'handoff_agent_id', fn (Blueprint $table) => $table->foreignId('handoff_agent_id')->nullable()->constrained('users')->nullOnDelete());
        $this->addColumn('conversations', 'ai_autoreply_disabled', fn (Blueprint $table) => $table->boolean('ai_autoreply_disabled')->default(false));
        $this->addColumn('conversations', 'ai_reply_count', fn (Blueprint $table) => $table->unsignedInteger('ai_reply_count')->default(0));
        $this->addColumn('conversations', 'ai_handoff_summary', fn (Blueprint $table) => $table->text('ai_handoff_summary')->nullable());
        $this->addColumn('messages', 'ai_generated', fn (Blueprint $table) => $table->boolean('ai_generated')->default(false));
    }

    public function down(): void
    {
        // These columns may predate this migration and contain live inbox state.
    }

    private function addColumn(string $table, string $column, Closure $add): void
    {
        if (! Schema::hasColumn($table, $column)) {
            Schema::table($table, $add);
        }
    }
};
