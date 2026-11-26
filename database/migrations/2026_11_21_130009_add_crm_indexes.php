<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $indexes = [
        'conversations' => [
            ['columns' => ['status', 'assigned_agent_id', 'last_message_at'], 'name' => 'conversations_status_agent_last_message_index'],
        ],
        'messages' => [
            ['columns' => ['created_at'], 'name' => 'messages_created_at_index'],
        ],
        'contacts' => [
            ['columns' => ['created_at'], 'name' => 'contacts_created_at_index'],
        ],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $tableName => $definitions) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            foreach ($definitions as $definition) {
                if (Schema::hasIndex($tableName, $definition['columns'])) {
                    continue;
                }

                Schema::table($tableName, function (Blueprint $table) use ($definition) {
                    $table->index($definition['columns'], $definition['name']);
                });
            }
        }
    }

    public function down(): void
    {
        foreach ($this->indexes as $tableName => $definitions) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            foreach ($definitions as $definition) {
                if (! Schema::hasIndex($tableName, $definition['columns'])) {
                    continue;
                }

                Schema::table($tableName, function (Blueprint $table) use ($definition) {
                    $table->dropIndex($definition['name']);
                });
            }
        }
    }
};
