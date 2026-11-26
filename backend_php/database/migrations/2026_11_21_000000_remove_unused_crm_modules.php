<?php

use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        // Keep the migration name for existing installations. Legacy data is retained.
    }

    public function down(): void
    {
        throw new RuntimeException('This migration deletes feature data and cannot be rolled back. Restore a database backup instead.');
    }

};
