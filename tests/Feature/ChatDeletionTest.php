<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\Conversation;
use App\Models\ConversationNote;
use App\Models\Message;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ChatDeletionTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_delete_a_message_without_deleting_the_contact_or_other_messages(): void
    {
        Storage::fake('local');
        [$owner, $contact, $conversation] = $this->makeConversation();
        $toDelete = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'customer',
            'content_type' => 'image',
            'media_url' => '123456',
        ]);
        Storage::disk('local')->put("whatsapp/inbound/{$toDelete->id}", 'image');
        $remaining = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'agent',
            'sender_id' => $owner->id,
            'content_type' => 'text',
            'content_text' => 'Keep this message',
        ]);
        $conversation->update([
            'last_message_text' => 'Deleted message',
            'last_message_at' => now(),
        ]);

        $this->actingAs($owner)
            ->deleteJson('/api/app/messages/'.$toDelete->id)
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->assertDatabaseMissing('messages', ['id' => $toDelete->id]);
        $this->assertDatabaseHas('messages', ['id' => $remaining->id]);
        $this->assertDatabaseHas('contacts', ['id' => $contact->id]);
        $this->assertDatabaseHas('conversations', [
            'id' => $conversation->id,
            'last_message_text' => 'Keep this message',
        ]);
        Storage::disk('local')->assertMissing("whatsapp/inbound/{$toDelete->id}");
    }

    public function test_owner_can_delete_a_conversation_and_its_history_while_keeping_the_contact(): void
    {
        Storage::fake('local');
        [$owner, $contact, $conversation] = $this->makeConversation();
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'customer',
            'content_type' => 'image',
            'media_url' => '654321',
        ]);
        Storage::disk('local')->put("whatsapp/inbound/{$message->id}", 'image');
        $note = ConversationNote::create([
            'conversation_id' => $conversation->id,
            'user_id' => $owner->id,
            'body' => 'CRM note',
        ]);

        $this->actingAs($owner)
            ->deleteJson('/api/app/conversations/'.$conversation->id)
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->assertDatabaseMissing('conversations', ['id' => $conversation->id]);
        $this->assertDatabaseMissing('messages', ['id' => $message->id]);
        $this->assertDatabaseMissing('conversation_notes', ['id' => $note->id]);
        $this->assertDatabaseHas('contacts', ['id' => $contact->id]);
        Storage::disk('local')->assertMissing("whatsapp/inbound/{$message->id}");
    }

    public function test_agents_cannot_permanently_delete_messages_or_conversations(): void
    {
        [$agent, , $conversation] = $this->makeConversation('agent');
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_type' => 'customer',
            'content_type' => 'text',
            'content_text' => 'Protected history',
        ]);

        $this->actingAs($agent)
            ->deleteJson('/api/app/messages/'.$message->id)
            ->assertForbidden();
        $this->deleteJson('/api/app/conversations/'.$conversation->id)->assertForbidden();
    }

    private function makeConversation(string $role = 'owner'): array
    {
        $user = User::factory()->create(['role' => $role]);
        $contact = Contact::create(['name' => 'Deletion test contact']);
        $conversation = Conversation::create([
            'contact_id' => $contact->id,
            'assigned_agent_id' => $user->id,
        ]);

        return [$user, $contact, $conversation];
    }
}
