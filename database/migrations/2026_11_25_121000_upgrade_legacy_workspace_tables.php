<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->upgradeNotifications();
        $this->upgradeBroadcasts();
        $this->upgradeRecipients();
        $this->upgradeFieldsAndTags();
    }

    private function upgradeNotifications(): void
    {
        if (! Schema::hasColumn('notifications', 'conversation_id')) {
            return;
        }

        Schema::whenTableDoesntHaveColumn('notifications', 'data', function (Blueprint $table) {
            $table->json('data')->nullable();
        });

        DB::table('notifications')->whereNull('data')->eachById(function (object $notification): void {
            $data = array_filter([
                'conversation_id' => $notification->conversation_id,
                'contact_id' => $notification->contact_id,
                'actor_user_id' => $notification->actor_user_id,
            ], fn ($value) => $value !== null);

            DB::table('notifications')->where('id', $notification->id)->update([
                'data' => json_encode((object) $data, JSON_THROW_ON_ERROR),
            ]);
        });
    }

    private function upgradeBroadcasts(): void
    {
        if (! Schema::hasColumn('broadcasts', 'template_name')) {
            return;
        }

        Schema::whenTableDoesntHaveColumn('broadcasts', 'template_id', function (Blueprint $table) {
            $table->foreignId('template_id')->nullable()->constrained('message_templates')->nullOnDelete();
        });
        Schema::whenTableDoesntHaveColumn('broadcasts', 'audience', function (Blueprint $table) {
            $table->json('audience')->nullable();
        });
        Schema::whenTableDoesntHaveColumn('broadcasts', 'personalization', function (Blueprint $table) {
            $table->json('personalization')->nullable();
        });

        $counts = [
            'total' => 'total_recipients',
            'sent' => 'sent_count',
            'delivered' => 'delivered_count',
            'read' => 'read_count',
            'replied' => 'replied_count',
            'failed' => 'failed_count',
        ];
        foreach (array_keys($counts) as $column) {
            Schema::whenTableDoesntHaveColumn('broadcasts', $column, function (Blueprint $table) use ($column) {
                $table->unsignedInteger($column)->default(0);
            });
        }

        Schema::table('broadcasts', fn (Blueprint $table) => $table->string('template_name')->nullable()->change());

        DB::table('broadcasts')->whereNotNull('template_name')->whereNull('audience')
            ->eachById(function (object $broadcast) use ($counts): void {
                $templateId = DB::table('message_templates')
                    ->where('name', $broadcast->template_name)
                    ->where('language', $broadcast->template_language)
                    ->orderBy('id')
                    ->value('id');
                $data = [
                    'template_id' => $templateId,
                    'audience' => json_encode($this->migrateAudience($broadcast->audience_filter), JSON_THROW_ON_ERROR),
                    'personalization' => json_encode($this->migratePersonalization($broadcast), JSON_THROW_ON_ERROR),
                ];
                foreach ($counts as $column => $oldColumn) {
                    $data[$column] = $broadcast->{$oldColumn};
                }

                DB::table('broadcasts')->where('id', $broadcast->id)->update($data);
            });
    }

    private function migrateAudience(?string $encoded): array
    {
        $filter = json_decode($encoded ?? 'null', true);
        $type = $filter['type'] ?? 'csv';
        if (! in_array($type, ['all', 'tags', 'custom_field', 'csv'], true)) {
            return ['type' => 'csv', 'phones' => ''];
        }
        $exclude = $filter['exclude_tag_ids'] ?? $filter['excludeTagIds'] ?? [];
        $audience = match ($type) {
            'all' => [],
            'tags' => ['tag_ids' => $filter['tag_ids'] ?? $filter['tagIds'] ?? []],
            'custom_field' => [
                'custom_field_id' => $filter['custom_field_id'] ?? $filter['customField']['fieldId'] ?? null,
                'operator' => $filter['operator'] ?? $filter['customField']['operator'] ?? 'is',
                'value' => $filter['value'] ?? $filter['customField']['value'] ?? '',
            ],
            'csv' => [
                'phones' => $filter['phones'] ?? implode("\n", array_column($filter['csvContacts'] ?? [], 'phone')),
            ],
        };

        return $audience + ['type' => $type, 'exclude_tag_ids' => $exclude];
    }

    private function migratePersonalization(object $broadcast): array
    {
        $variables = json_decode($broadcast->template_variables ?? $broadcast->template_params ?? 'null', true);
        if (! is_array($variables)) {
            return [];
        }

        $personalization = [];
        $list = array_is_list($variables);
        foreach ($variables as $key => $variable) {
            $position = $list ? $key + 1 : $key;
            if (is_array($variable)) {
                $personalization[$position] = [
                    'source' => $variable['source'] ?? $variable['type'] ?? 'static',
                    'value' => $variable['value'] ?? '',
                ];
            } elseif (is_scalar($variable)) {
                $personalization[$position] = ['source' => 'static', 'value' => (string) $variable];
            }
        }

        return $personalization;
    }

    private function upgradeRecipients(): void
    {
        if (! Schema::hasColumn('broadcast_recipients', 'whatsapp_message_id')) {
            return;
        }

        Schema::whenTableDoesntHaveColumn('broadcast_recipients', 'message_id', function (Blueprint $table) {
            $table->foreignId('message_id')->nullable()->constrained('messages')->nullOnDelete();
        });
        Schema::whenTableDoesntHaveColumn('broadcast_recipients', 'variables', fn (Blueprint $table) => $table->json('variables')->nullable());
        Schema::whenTableDoesntHaveColumn('broadcast_recipients', 'error', fn (Blueprint $table) => $table->text('error')->nullable());
        Schema::whenTableDoesntHaveColumn('broadcast_recipients', 'provider_error', fn (Blueprint $table) => $table->json('provider_error')->nullable());

        DB::table('broadcast_recipients')->eachById(function (object $recipient): void {
            $data = [];
            if ($recipient->whatsapp_message_id && ! $recipient->message_id) {
                $data['message_id'] = DB::table('messages')
                    ->where('message_id', $recipient->whatsapp_message_id)
                    ->orderBy('id')
                    ->value('id');
            }
            if ($recipient->resolved_params && ! $recipient->variables) {
                $variables = json_decode($recipient->resolved_params, true);
                if (is_array($variables) && $variables !== []) {
                    $data['variables'] = json_encode(array_is_list($variables) ? array_combine(range(1, count($variables)), $variables) : $variables, JSON_THROW_ON_ERROR);
                }
            }
            if ($recipient->error_message && ! $recipient->error) {
                $data['error'] = $recipient->error_message;
            }
            if ($data !== []) {
                DB::table('broadcast_recipients')->where('id', $recipient->id)->update($data);
            }
        });
    }

    private function upgradeFieldsAndTags(): void
    {
        foreach (['field_name' => 'name', 'field_type' => 'type', 'field_options' => 'options'] as $old => $new) {
            if (Schema::hasColumn('custom_fields', $old) && ! Schema::hasColumn('custom_fields', $new)) {
                Schema::table('custom_fields', fn (Blueprint $table) => $table->renameColumn($old, $new));
            }
        }
        Schema::whenTableDoesntHaveColumn('custom_fields', 'label', fn (Blueprint $table) => $table->string('label')->nullable());
        Schema::whenTableDoesntHaveColumn('custom_fields', 'is_active', fn (Blueprint $table) => $table->boolean('is_active')->default(true));
        Schema::whenTableDoesntHaveColumn('custom_fields', 'required', fn (Blueprint $table) => $table->boolean('required')->default(false));
        DB::table('custom_fields')->whereNull('label')->update(['label' => DB::raw('name')]);

        if (Schema::hasColumn('tags', 'user_id')) {
            Schema::table('tags', fn (Blueprint $table) => $table->string('color')->nullable()->default('#3b82f6')->change());
        }
    }

    public function down(): void
    {
        // Keep legacy records and the columns they were upgraded into.
    }
};
