<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\Role;
use App\Models\Tag;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase;

class ContactIndexTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
        ]);
        $this->artisan('migrate')->assertSuccessful();
    }

    public function test_index_returns_contact_tags_and_summary_with_pagination(): void
    {
        $owner = User::forceCreate([
            'name' => 'Test Owner',
            'email' => 'owner@example.test',
            'password' => bcrypt('test-password'),
            'role_id' => Role::where('slug', 'owner')->value('id'),
            'is_active' => true,
        ]);
        $tag = Tag::create(['name' => 'Student', 'color' => '#8b5cf6']);
        $contact = Contact::create([
            'user_id' => $owner->id,
            'name' => 'Taylor Student',
            'phone' => '+15551234567',
            'phone_normalized' => '15551234567',
        ]);
        $contact->tags()->attach($tag);

        $this->actingAs($owner)
            ->getJson('/api/app/contacts')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('summary.tags', 1)
            ->assertJsonPath('data.0.tags.0.name', 'Student')
            ->assertJsonPath('data.0.tags_count', 1);
    }
}
