<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('whatsapp_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('phone_number_id');
            $table->string('waba_id')->nullable();
            $table->text('access_token'); // encrypted
            $table->text('verify_token')->nullable(); // encrypted
            $table->string('status')->default('disconnected');
            $table->timestamp('connected_at')->nullable();
            $table->timestamp('registered_at')->nullable();
            $table->timestamp('subscribed_apps_at')->nullable();
            $table->text('last_registration_error')->nullable();
            $table->boolean('mirror_inbound_media')->default(true);
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('whatsapp_configs'); }
};
