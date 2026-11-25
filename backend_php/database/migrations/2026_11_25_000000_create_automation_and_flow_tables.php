<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['flow_run_events', 'flow_runs', 'flow_nodes', 'flows', 'automation_pending_executions', 'automation_logs', 'automation_steps', 'automations'] as $table) {
            Schema::dropIfExists($table);
        }

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
            $table->foreignId('parent_step_id')->nullable()->constrained('automation_steps')->nullOnDelete();
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
            $table->foreignId('conversation_id')->nullable()->constrained()->nullOnDelete();
            $table->string('trigger_event');
            $table->json('steps_executed')->nullable();
            $table->string('status')->default('failed');
            $table->text('error_message')->nullable();
            $table->timestamps();
            $table->index(['automation_id', 'created_at']);
        });

        Schema::create('automation_pending_executions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('automation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('conversation_id')->nullable()->constrained()->nullOnDelete();
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

        Schema::create('flows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('status')->default('draft');
            $table->string('trigger_type');
            $table->json('trigger_config')->nullable();
            $table->string('entry_node_id')->nullable();
            $table->json('fallback_policy')->nullable();
            $table->unsignedInteger('execution_count')->default(0);
            $table->timestamp('last_executed_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'trigger_type']);
        });

        Schema::create('flow_nodes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('flow_id')->constrained()->cascadeOnDelete();
            $table->string('node_key');
            $table->string('node_type');
            $table->json('config')->nullable();
            $table->integer('position_x')->default(0);
            $table->integer('position_y')->default(0);
            $table->timestamps();
            $table->unique(['flow_id', 'node_key']);
        });

        Schema::create('flow_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('flow_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('conversation_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status')->default('active');
            $table->string('current_node_key')->nullable();
            $table->foreignId('last_prompt_message_id')->nullable()->constrained('messages')->nullOnDelete();
            $table->json('vars')->nullable();
            $table->unsignedInteger('reprompt_count')->default(0);
            $table->unsignedInteger('transition_seq')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('last_advanced_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->string('end_reason')->nullable();
            $table->timestamps();
            $table->index(['flow_id', 'started_at']);
            $table->index(['contact_id', 'status']);
        });

        Schema::create('flow_run_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('flow_run_id')->constrained()->cascadeOnDelete();
            $table->string('event_type');
            $table->string('node_key')->nullable();
            $table->json('payload')->nullable();
            $table->timestamps();
            $table->index(['flow_run_id', 'created_at']);
        });
    }

    public function down(): void
    {
        foreach (['flow_run_events', 'flow_runs', 'flow_nodes', 'flows', 'automation_pending_executions', 'automation_logs', 'automation_steps', 'automations'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
