<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('consent_events');

        $columns = array_values(array_filter(
            ['consent_status', 'consent_at'],
            fn (string $column) => Schema::hasColumn('contacts', $column),
        ));
        if ($columns) {
            Schema::table('contacts', fn (Blueprint $table) => $table->dropColumn($columns));
        }
    }

    public function down(): void
    {
        $columns = [];
        if (! Schema::hasColumn('contacts', 'consent_status')) {
            $columns[] = 'consent_status';
        }
        if (! Schema::hasColumn('contacts', 'consent_at')) {
            $columns[] = 'consent_at';
        }
        if ($columns) {
            Schema::table('contacts', function (Blueprint $table) use ($columns) {
                if (in_array('consent_status', $columns, true)) {
                    $table->string('consent_status')->default('unknown');
                }
                if (in_array('consent_at', $columns, true)) {
                    $table->timestamp('consent_at')->nullable();
                }
            });
        }

        if (! Schema::hasTable('consent_events')) {
            Schema::create('consent_events', function (Blueprint $table) {
                $table->id();
                $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
                $table->string('status');
                $table->string('source')->nullable();
                $table->text('note')->nullable();
                $table->foreignId('changed_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->index(['contact_id', 'created_at']);
            });
        }
    }
};
