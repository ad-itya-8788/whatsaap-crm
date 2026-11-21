<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\MessageTemplate;
use App\Models\User;
use App\Models\WhatsappConfig;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class TemplateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        WhatsappConfig::create([
            'waba_id' => '987654321',
            'phone_number_id' => '123456789',
            'access_token' => 'test-access-token',
            'status' => 'connected',
        ]);
    }

    public function test_template_is_saved_as_draft_without_contacting_meta(): void
    {
        $this->actingAs($this->createUser())
            ->postJson('/api/app/whatsapp/templates', $this->templateData())
            ->assertCreated()
            ->assertJsonPath('status', 'DRAFT')
            ->assertJsonPath('approval_status', 'DRAFT');

        Http::assertNothingSent();
    }

    public function test_submission_records_the_status_returned_by_meta(): void
    {
        $template = MessageTemplate::create(array_merge($this->templateModelData(), [
            'user_id' => $this->createUser()->id,
            'status' => 'DRAFT',
            'approval_status' => 'DRAFT',
        ]));
        Http::fake([
            'graph.facebook.com/*' => Http::response(['id' => 'tpl_1', 'status' => 'PENDING'], 200),
        ]);

        $this->actingAs($this->createUser())
            ->postJson("/api/app/whatsapp/templates/{$template->id}/submit")
            ->assertOk()
            ->assertJsonPath('status', 'PENDING')
            ->assertJsonPath('approval_status', 'PENDING')
            ->assertJsonPath('meta_template_id', 'tpl_1');

        Http::assertSent(fn ($request) => str_contains($request->url(), '/message_templates')
            && $request['name'] === 'order_update'
            && $request['components'][0]['type'] === 'BODY'
        );
    }

    public function test_sync_only_marks_approved_when_meta_confirms_it(): void
    {
        Http::fake([
            'graph.facebook.com/*' => Http::response([
                'data' => [[
                    'id' => 'tpl_1',
                    'name' => 'order_update',
                    'language' => 'en_US',
                    'category' => 'UTILITY',
                    'status' => 'APPROVED',
                    'components' => [
                        ['type' => 'HEADER', 'format' => 'TEXT', 'text' => 'Order update'],
                        ['type' => 'BODY', 'text' => 'Hi {{1}}'],
                    ],
                ]],
            ], 200),
        ]);

        $this->actingAs($this->createUser())
            ->postJson('/api/app/whatsapp/templates/sync')
            ->assertOk()
            ->assertJsonPath('count', 1);

        $this->assertDatabaseHas('message_templates', [
            'name' => 'order_update',
            'status' => 'APPROVED',
            'approval_status' => 'APPROVED',
            'meta_template_id' => 'tpl_1',
            'header_type' => 'TEXT',
            'header_content' => 'Order update',
        ]);
        $this->assertNotNull(MessageTemplate::firstOrFail()->last_synced_at);
    }

    public function test_template_media_upload_returns_meta_header_handle(): void
    {
        config(['services.whatsapp.app_id' => 'app-123']);
        Http::fakeSequence('graph.facebook.com/*')
            ->push(['id' => 'upload:session-1'], 200)
            ->push(['h' => 'header-handle-1'], 200);

        $this->actingAs($this->createUser())
            ->post('/api/app/whatsapp/templates/media', [
                'type' => 'IMAGE',
                'file' => UploadedFile::fake()->image('header.jpg'),
            ])
            ->assertOk()
            ->assertJsonPath('handle', 'header-handle-1');

        Http::assertSent(fn ($request) => str_contains($request->url(), '/app-123/uploads?')
            && str_contains($request->url(), 'file_length=')
        );
        Http::assertSent(fn ($request) => str_contains($request->url(), '/upload:session-1')
            && $request->hasHeader('file_offset')
        );
    }

    public function test_media_template_header_handle_is_submitted_to_meta(): void
    {
        $user = $this->createUser();
        $this->actingAs($user)
            ->postJson('/api/app/whatsapp/templates', array_merge($this->templateData(), [
                'header_data' => ['type' => 'IMAGE', 'handle' => 'header-handle-1'],
            ]))
            ->assertCreated();

        $template = MessageTemplate::where('name', 'order_update')->firstOrFail();
        $this->assertSame('IMAGE', $template->header_type);
        $this->assertSame('header-handle-1', $template->header_handle);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['id' => 'tpl_media_1', 'status' => 'PENDING'], 200),
        ]);

        $this->actingAs($user)
            ->postJson("/api/app/whatsapp/templates/{$template->id}/submit")
            ->assertOk();

        Http::assertSent(fn ($request) => collect($request['components'])
            ->firstWhere('type', 'HEADER')['example']['header_handle'][0] === 'header-handle-1'
        );
    }

    public function test_draft_template_cannot_be_sent_to_a_contact(): void
    {
        $template = MessageTemplate::create(array_merge($this->templateModelData(), [
            'user_id' => $this->createUser()->id,
            'status' => 'DRAFT',
            'approval_status' => 'DRAFT',
        ]));
        $contact = Contact::create([
            'name' => 'Jane',
            'phone' => '15551234567',
            'phone_normalized' => '15551234567',
        ]);

        $this->actingAs($this->createUser())
            ->postJson("/api/app/whatsapp/templates/{$template->id}/send", [
                'contact_id' => $contact->id,
                'variables' => ['Jane'],
            ])
            ->assertUnprocessable();
    }

    public function test_approved_template_can_be_sent_outside_the_24_hour_window(): void
    {
        $template = MessageTemplate::create(array_merge($this->templateModelData(), [
            'user_id' => $this->createUser()->id,
            'status' => 'APPROVED',
            'approval_status' => 'APPROVED',
        ]));
        $contact = Contact::create([
            'name' => 'Jane',
            'phone' => '15551234567',
            'phone_normalized' => '15551234567',
        ]);
        Http::fake([
            'graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.template-1']]], 200),
        ]);

        $this->actingAs($this->createUser())
            ->postJson("/api/app/whatsapp/templates/{$template->id}/send", [
                'contact_id' => $contact->id,
                'variables' => ['Jane'],
            ])
            ->assertCreated()
            ->assertJsonPath('status', 'sent')
            ->assertJsonPath('message_id', 'wamid.template-1');

        Http::assertSent(fn ($request) => $request['type'] === 'template'
            && $request['template']['name'] === 'order_update'
            && $request['template']['components'][0]['parameters'][0]['text'] === 'Jane'
        );
    }

    private function templateData(): array
    {
        return [
            'name' => 'order_update',
            'category' => 'UTILITY',
            'language' => 'en_US',
            'body_text' => 'Hi {{1}}, your order is ready.',
            'header_data' => ['type' => 'TEXT', 'text' => 'Order update'],
            'footer_text' => 'Thanks for shopping with us.',
            'buttons' => ['View order'],
            'sample_values' => ['Jane'],
        ];
    }

    private function templateModelData(): array
    {
        $data = $this->templateData();
        $data['header_type'] = $data['header_data']['type'];
        $data['header_content'] = $data['header_data']['text'];
        unset($data['header_data']);

        return $data;
    }

    private function createUser(): User
    {
        return User::create([
            'name' => 'Test Admin',
            'email' => uniqid('template-', true).'@example.test',
            'password' => Hash::make('test-password'),
            'role' => 'admin',
        ]);
    }
}
