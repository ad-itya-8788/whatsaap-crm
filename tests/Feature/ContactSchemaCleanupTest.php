<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ContactSchemaCleanupTest extends TestCase
{
    use RefreshDatabase;

    public function test_consent_columns_and_event_table_are_removed(): void
    {
        $this->assertFalse(Schema::hasColumn('contacts', 'consent_status'));
        $this->assertFalse(Schema::hasColumn('contacts', 'consent_at'));
        $this->assertFalse(Schema::hasTable('consent_events'));
    }

    public function test_contact_api_ignores_legacy_consent_status_input(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);

        $this->actingAs($owner)
            ->postJson('/api/app/contacts', [
                'name' => 'Contact without consent tracking',
                'phone' => '+15551234567',
                'consent_status' => 'opted_out',
            ])
            ->assertCreated()
            ->assertJsonMissingPath('consent_status');

        $this->assertDatabaseHas('contacts', ['phone' => '+15551234567']);
    }
}
