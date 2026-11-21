<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $tables = [
        'broadcast_recipients',
        'broadcasts',
        'contact_tag',
        'tags',
        'quick_replies',
        'notifications',
        'message_reactions',
    ];

    public function up(): void
    {
        foreach ($this->tables as $table) {
            Schema::dropIfExists($table);
        }
    }

    public function down(): void {}
};
