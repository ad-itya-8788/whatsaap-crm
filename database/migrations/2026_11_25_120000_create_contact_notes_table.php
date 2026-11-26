<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('contact_notes')) {
            if (Schema::hasColumn('contact_notes', 'note_text') && ! Schema::hasColumn('contact_notes', 'body')) {
                Schema::table('contact_notes', fn (Blueprint $table) => $table->renameColumn('note_text', 'body'));
            }

            return;
        }

        Schema::create('contact_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            $table->timestamps();
            $table->index(['contact_id', 'created_at']);
        });
    }

    public function down(): void
    {
        // The table may contain notes that predate this migration.
    }
};
