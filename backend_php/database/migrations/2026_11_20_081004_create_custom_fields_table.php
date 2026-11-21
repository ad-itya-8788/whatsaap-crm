<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('custom_fields', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('field_name');
            $table->string('field_type')->default('text');
            $table->json('field_options')->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('custom_fields'); }
};
