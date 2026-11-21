<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ContactTest extends TestCase
{
    use RefreshDatabase;

    public function test_contact_can_be_created_edited_searched_and_deleted(): void
    {
        $user = $this->createUser();
        $this->actingAs($user)
            ->postJson('/api/app/contacts', [
                'name' => 'Jane Doe',
                'phone' => '+1 555 123 4567',
            ])
            ->assertCreated()
            ->assertJsonPath('phone_normalized', '15551234567');

        $id = Contact::firstOrFail()->id;

        $this->getJson('/api/app/contacts?search=555')
            ->assertOk()
            ->assertJsonPath('total', 1);

        $this->patchJson("/api/app/contacts/{$id}", ['name' => 'Jane Smith'])
            ->assertOk()
            ->assertJsonPath('name', 'Jane Smith');

        $this->deleteJson("/api/app/contacts/{$id}")->assertNoContent();
        $this->assertDatabaseCount('contacts', 0);
    }

    public function test_duplicate_phone_numbers_are_rejected(): void
    {
        $this->actingAs($this->createUser())
            ->postJson('/api/app/contacts', ['name' => 'Jane', 'phone' => '+1 555 123 4567'])
            ->assertCreated();

        $this->postJson('/api/app/contacts', ['name' => 'John', 'phone' => '15551234567'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'A contact with this phone number already exists.');

        $this->assertDatabaseCount('contacts', 1);
    }

    private function createUser(): User
    {
        return User::create([
            'name' => 'Test User',
            'email' => uniqid('contacts-', true).'@example.test',
            'password' => Hash::make('test-password'),
            'role' => 'agent',
        ]);
    }
}
