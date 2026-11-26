<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $missing = [
            'body' => ! Schema::hasColumn('quick_replies', 'body'),
            'is_global' => ! Schema::hasColumn('quick_replies', 'is_global'),
            'kind' => ! Schema::hasColumn('quick_replies', 'kind'),
            'interactive_payload' => ! Schema::hasColumn('quick_replies', 'interactive_payload'),
        ];
        Schema::table('quick_replies', function (Blueprint $table) use ($missing) {
            if ($missing['body']) {
                $table->text('body')->nullable();
            }
            if ($missing['is_global']) {
                $table->boolean('is_global')->default(false);
            }
            if ($missing['kind']) {
                $table->string('kind', 16)->default('text');
            }
            if ($missing['interactive_payload']) {
                $table->json('interactive_payload')->nullable();
            }
        });

        if (! Schema::hasColumn('quick_replies', 'content_text')) {
            return;
        }

        DB::table('quick_replies')->whereNull('body')->eachById(function (object $reply): void {
            $payload = json_decode($reply->interactive_payload ?? 'null', true);
            DB::table('quick_replies')->where('id', $reply->id)->update([
                'body' => $reply->content_text ?? $payload['body'] ?? '',
                'is_global' => true,
            ]);
        });
    }

    public function down(): void
    {
        // Existing installations may already have these columns and stored replies.
    }
};
