<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->string('category')->default('Marketing');
            $table->string('language')->default('en_US');
            $table->string('header_type')->nullable();
            $table->text('header_content')->nullable();
            $table->string('header_media_url')->nullable();
            $table->text('header_handle')->nullable();
            $table->text('body_text')->nullable();
            $table->text('footer_text')->nullable();
            $table->json('buttons')->nullable();
            $table->json('sample_values')->nullable();
            $table->string('status')->default('DRAFT');
            $table->string('meta_template_id')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->string('quality_score')->nullable();
            $table->text('submission_error')->nullable();
            $table->timestamp('last_submitted_at')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();
            $table->unique(['name', 'language']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_templates');
    }
};
