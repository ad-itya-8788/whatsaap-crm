<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MessagingException;
use App\Http\Controllers\Controller;
use App\Http\Requests\SendTemplateRequest;
use App\Http\Requests\StoreTemplateRequest;
use App\Http\Requests\UploadTemplateMediaRequest;
use App\Models\Conversation;
use App\Models\MessageTemplate;
use App\Models\WhatsappConfig;
use App\Services\MessagingService;
use App\Services\MetaCloudApiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class TemplateController extends Controller
{
    public function __construct(
        private MetaCloudApiService $meta,
        private MessagingService $messaging,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(MessageTemplate::orderByDesc('updated_at')->get());
    }

    public function uploadMedia(UploadTemplateMediaRequest $request): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config || ! $config->access_token || $config->status !== 'connected') {
            return response()->json(['message' => 'Connect WhatsApp before uploading template media.'], 422);
        }

        try {
            $handle = $this->meta->uploadTemplateHeader($config, $request->file('file'));
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['handle' => $handle]);
    }

    public function store(StoreTemplateRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['user_id'] = $request->user()->id;
        $data['status'] = 'DRAFT';
        $data['approval_status'] = 'DRAFT';
        $this->mapHeader($data);

        return response()->json(MessageTemplate::create($data), 201);
    }

    public function update(StoreTemplateRequest $request, MessageTemplate $message_template): JsonResponse
    {
        if ($this->isApproved($message_template)) {
            return response()->json(['message' => 'Approved templates cannot be edited locally. Sync or create a new version in Meta.'], 422);
        }

        $data = $request->validated();
        $this->mapHeader($data);
        $message_template->update($data);

        return response()->json($message_template);
    }

    public function destroy(MessageTemplate $message_template): Response
    {
        $message_template->delete();

        return response()->noContent();
    }

    public function submit(MessageTemplate $message_template): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config || ! $config->waba_id || ! $config->access_token || $config->status !== 'connected') {
            return response()->json(['message' => 'Connect WhatsApp with a WABA ID before submitting templates.'], 422);
        }

        try {
            $response = $this->meta->createTemplate($config, $this->metaPayload($message_template));
        } catch (\Throwable $e) {
            $message_template->update([
                'submission_error' => $e->getMessage(),
                'last_submitted_at' => now(),
            ]);

            return response()->json(['message' => $e->getMessage()], 422);
        }

        $status = strtoupper($response['status'] ?? 'PENDING');
        $message_template->update([
            'meta_template_id' => $response['id'] ?? $message_template->meta_template_id,
            'status' => $status,
            'approval_status' => $status,
            'submission_error' => null,
            'rejection_reason' => null,
            'last_submitted_at' => now(),
        ]);

        return response()->json($message_template);
    }

    public function sync(): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config || ! $config->waba_id || ! $config->access_token) {
            return response()->json(['message' => 'WhatsApp is not configured with a WABA ID.'], 422);
        }

        try {
            $items = $this->meta->fetchTemplates($config);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        foreach ($items as $item) {
            $components = collect($item['components'] ?? []);
            $status = strtoupper($item['status'] ?? 'PENDING');
            $header = $components->firstWhere('type', 'HEADER');
            $body = $components->firstWhere('type', 'BODY');

            MessageTemplate::updateOrCreate(
                ['name' => $item['name'] ?? '', 'language' => $item['language'] ?? 'en_US'],
                [
                    'user_id' => $config->user_id,
                    'category' => $item['category'] ?? 'UTILITY',
                    'status' => $status,
                    'approval_status' => $status,
                    'meta_template_id' => $item['id'] ?? null,
                    'body_text' => $body['text'] ?? null,
                    'header_type' => $header['format'] ?? null,
                    'header_content' => $header['text'] ?? null,
                    'header_handle' => $header['example']['header_handle'][0] ?? null,
                    'footer_text' => $components->firstWhere('type', 'FOOTER')['text'] ?? null,
                    'buttons' => $components->firstWhere('type', 'BUTTONS')['buttons'] ?? null,
                    'sample_values' => isset($body['example']['body_text'])
                        ? array_values($body['example']['body_text'])
                        : null,
                    'rejection_reason' => $item['rejection_reason'] ?? null,
                    'last_synced_at' => now(),
                ],
            );
        }

        return response()->json(['ok' => true, 'count' => count($items)]);
    }

    public function send(SendTemplateRequest $request, MessageTemplate $message_template): JsonResponse
    {
        if (! $this->isApproved($message_template)) {
            return response()->json(['message' => 'Only an approved template can be sent to a contact.'], 422);
        }

        $conversation = Conversation::firstOrCreate(
            ['contact_id' => $request->integer('contact_id')],
            ['user_id' => $request->user()->id, 'status' => 'open'],
        );

        try {
            $message = $this->messaging->send($conversation, [
                'content_type' => 'template',
                'content_text' => $this->renderTemplateBody(
                    (string) $message_template->body_text,
                    $request->input('variables', []),
                ),
                'template_name' => $message_template->name,
                'template_language' => $message_template->language,
                'template_params' => $request->input('variables', []),
                'header_media_type' => $message_template->header_type,
                'header_media_file' => $request->file('header_file'),
                'idempotency_key' => $request->validated('idempotency_key'),
            ], $request->user()->id);
        } catch (MessagingException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'data' => $e->failedMessage,
            ], $e->status);
        }

        return response()->json($message, $message->wasRecentlyCreated ? 201 : 200);
    }

    private function isApproved(MessageTemplate $template): bool
    {
        return strtoupper((string) ($template->approval_status ?: $template->status)) === 'APPROVED';
    }

    private function renderTemplateBody(string $body, array $variables): string
    {
        $isList = array_is_list($variables);

        return preg_replace_callback('/\{\{(\d+)\}\}/', function (array $matches) use ($variables, $isList): string {
            $number = (int) $matches[1];
            $key = $isList ? $number - 1 : $number;

            return array_key_exists($key, $variables)
                ? (string) $variables[$key]
                : $matches[0];
        }, $body);
    }

    private function mapHeader(array &$data): void
    {
        if (array_key_exists('header_data', $data)) {
            $header = $data['header_data'];
            $data['header_type'] = $header['type'] ?? null;
            $data['header_content'] = $header['text'] ?? null;
            $data['header_handle'] = $header['handle'] ?? null;
            unset($data['header_data']);
        }
    }

    private function metaPayload(MessageTemplate $template): array
    {
        $body = ['type' => 'BODY', 'text' => $template->body_text];
        if (! empty($template->sample_values)) {
            $body['example'] = ['body_text' => array_values($template->sample_values)];
        }
        $components = [$body];

        if ($template->header_type) {
            $header = [
                'type' => 'HEADER',
                'format' => strtoupper($template->header_type),
            ];
            if (strtoupper($template->header_type) === 'TEXT') {
                $header['text'] = $template->header_content;
            } elseif ($template->header_handle) {
                $header['example'] = ['header_handle' => [$template->header_handle]];
            }
            $components[] = $header;
        }
        if ($template->footer_text) {
            $components[] = ['type' => 'FOOTER', 'text' => $template->footer_text];
        }
        if (! empty($template->buttons)) {
            $components[] = [
                'type' => 'BUTTONS',
                'buttons' => array_map(
                    fn ($text) => ['type' => 'QUICK_REPLY', 'text' => $text],
                    array_values($template->buttons),
                ),
            ];
        }

        return [
            'name' => $template->name,
            'category' => $template->category,
            'language' => $template->language,
            'components' => $components,
        ];
    }
}
