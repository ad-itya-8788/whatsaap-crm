<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::dropIfExists('automation_pending_executions');
        Schema::dropIfExists('automation_logs');
        Schema::dropIfExists('automation_steps');
        Schema::dropIfExists('automations');
        Schema::create('automations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('trigger_type');
            $table->json('trigger_config')->nullable();
            $table->boolean('is_active')->default(false);
            $table->unsignedInteger('execution_count')->default(0);
            $table->timestamp('last_executed_at')->nullable();
            $table->timestamps();
            $table->index(['trigger_type', 'is_active']);
        });
        Schema::create('automation_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('automation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parent_step_id')->nullable()->constrained('automation_steps')->cascadeOnDelete();
            $table->string('branch')->nullable();
            $table->string('step_type');
            $table->json('step_config')->nullable();
            $table->integer('position')->default(0);
            $table->timestamps();
            $table->index(['automation_id', 'parent_step_id', 'branch', 'position'], 'auto_steps_scope_idx');
        });
        Schema::create('automation_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('automation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->string('trigger_event');
            $table->json('steps_executed')->nullable();
            $table->string('status');
            $table->text('error_message')->nullable();
            $table->timestamps();
            $table->index(['automation_id', 'created_at']);
        });
        Schema::create('automation_pending_executions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('automation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('log_id')->nullable()->constrained('automation_logs')->cascadeOnDelete();
            $table->foreignId('parent_step_id')->nullable()->constrained('automation_steps')->nullOnDelete();
            $table->string('branch')->nullable();
            $table->unsignedInteger('next_step_position')->default(0);
            $table->foreignId('parked_step_id')->nullable()->constrained('automation_steps')->nullOnDelete();
            $table->json('context')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('run_at')->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'run_at']);
            $table->index(['contact_id', 'status']);
        });
    }
    public function down(): void {
        Schema::dropIfExists('automation_pending_executions');
        Schema::dropIfExists('automation_logs');
        Schema::dropIfExists('automation_steps');
        Schema::dropIfExists('automations');
    }
};
