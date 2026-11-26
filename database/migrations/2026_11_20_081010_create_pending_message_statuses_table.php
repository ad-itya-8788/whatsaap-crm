<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('pending_message_statuses', function (Blueprint $table) {
            $table->id();
            $table->string('wamid');
            $table->string('status');
            $table->integer('error_code')->nullable();
            $table->string('error_title')->nullable();
            $table->text('error_details')->nullable();
            $table->timestamp('status_at')->nullable();
            $table->timestamps();
            $table->unique(['wamid', 'status']);
            $table->index('created_at');
        });
    }
    public function down(): void { Schema::dropIfExists('pending_message_statuses'); }
};
