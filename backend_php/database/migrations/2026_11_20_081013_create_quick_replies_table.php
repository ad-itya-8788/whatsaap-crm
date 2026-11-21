<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('quick_replies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title');
            $table->string('kind')->default('text'); // text|interactive
            $table->text('content_text')->nullable();
            $table->json('interactive_payload')->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('quick_replies'); }
};
