<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::disableForeignKeyConstraints();

        try {
            foreach ([
                'flow_run_events',
                'flow_runs',
                'flow_nodes',
                'flows',
                'automation_pending_executions',
                'automation_logs',
                'automation_steps',
                'automations',
                'ai_knowledge_chunks',
                'ai_usage_logs',
                'ai_knowledge_documents',
                'ai_configs',
                'webhook_endpoints',
                'api_keys',
                'deals',
                'pipeline_stages',
                'pipelines',
                'contact_custom_values',
                'contact_notes',
                'custom_fields',
                'app_settings',
            ] as $table) {
                Schema::dropIfExists($table);
            }

            $this->dropColumns('conversations', [
                'ai_autoreply_disabled',
                'ai_reply_count',
                'ai_handoff_summary',
            ]);
            $this->dropColumns('messages', ['ai_generated']);
        } finally {
            Schema::enableForeignKeyConstraints();
        }
    }

    public function down(): void
    {
        throw new RuntimeException('This migration deletes feature data and cannot be rolled back. Restore a database backup instead.');
    }

    private function dropColumns(string $tableName, array $columns): void
    {
        if (!Schema::hasTable($tableName)) {
            return;
        }

        $columns = array_values(array_filter(
            $columns,
            fn (string $column): bool => Schema::hasColumn($tableName, $column),
        ));

        if ($columns) {
            Schema::table($tableName, fn (Blueprint $table) => $table->dropColumn($columns));
        }
    }
};
