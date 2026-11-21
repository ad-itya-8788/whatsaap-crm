<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('broadcasts')) {
            Schema::create('broadcasts', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
                $table->string('name');
                $table->string('template_name');
                $table->string('template_language')->default('en_US');
                $table->json('template_variables')->nullable();
                $table->json('template_params')->nullable();
                $table->json('audience_filter')->nullable();
                $table->timestamp('scheduled_at')->nullable();
                $table->string('status')->default('draft');
                $table->unsignedInteger('total_recipients')->default(0);
                $table->unsignedInteger('sent_count')->default(0);
                $table->unsignedInteger('delivered_count')->default(0);
                $table->unsignedInteger('read_count')->default(0);
                $table->unsignedInteger('replied_count')->default(0);
                $table->unsignedInteger('failed_count')->default(0);
                $table->timestamps();
                $table->index(['status', 'created_at']);
            });
        }

        if (!Schema::hasTable('broadcast_recipients')) {
            Schema::create('broadcast_recipients', function (Blueprint $table) {
                $table->id();
                $table->foreignId('broadcast_id')->constrained()->cascadeOnDelete();
                $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
                $table->string('phone')->nullable();
                $table->string('whatsapp_message_id')->nullable()->index();
                $table->string('status')->default('pending');
                $table->text('error_message')->nullable();
                $table->json('resolved_params')->nullable();
                $table->timestamp('delivery_locked_at')->nullable();
                $table->timestamp('sent_at')->nullable();
                $table->timestamp('delivered_at')->nullable();
                $table->timestamp('read_at')->nullable();
                $table->timestamps();
                $table->index(['broadcast_id', 'status']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('broadcast_recipients');
        Schema::dropIfExists('broadcasts');
    }
};
