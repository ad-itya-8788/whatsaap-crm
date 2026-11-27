<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MessagingException;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreBroadcastRequest;
use App\Models\Broadcast;
use App\Models\CustomField;
use App\Models\MessageTemplate;
use App\Models\Tag;
use App\Services\BroadcastService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class BroadcastController extends Controller
{
    public function __construct(private BroadcastService $broadcasts) {}

    public function index(): JsonResponse
    {
        return response()->json(
            Broadcast::query()
                ->with(['creator:id,name', 'template:id,name,language'])
                ->latest()
                ->paginate(min(max(request()->integer('per_page', 50), 1), 100))
        );
    }

    public function options(): JsonResponse
    {
        return response()->json([
            'templates' => MessageTemplate::query()
                ->approved()
                ->get(['id', 'name', 'language', 'body_text', 'header_type']),
            'tags' => Tag::query()->orderBy('name')->get(['id', 'name']),
            'custom_fields' => CustomField::query()->where('is_active', true)->orderBy('label')->get(['id', 'name', 'label', 'type']),
        ]);
    }

    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'audience' => ['required', 'array'],
            'audience.type' => ['required', 'in:all,tags,custom_field,csv'],
            'audience.tag_ids' => ['nullable', 'array'],
            'audience.exclude_tag_ids' => ['nullable', 'array'],
            'audience.custom_field_id' => ['nullable', 'exists:custom_fields,id'],
            'audience.operator' => ['nullable', 'in:is,is_not,contains'],
            'audience.value' => ['nullable', 'string'],
            'audience.phones' => ['nullable', 'string'],
            'audience.csv_file' => ['nullable', 'file', 'mimes:txt,csv', 'max:2048'],
        ]);

        return response()->json($this->broadcasts->preview($this->audience($request, $data['audience'])));
    }

    public function store(StoreBroadcastRequest $request): JsonResponse
    {
        $broadcast = $this->broadcasts->create([
            'name' => $request->validated('name'),
            'template_id' => $request->validated('template_id'),
            'scheduled_at' => $request->validated('scheduled_at'),
            'audience' => $this->audience($request, $request->validated('audience')),
            'personalization' => $request->validated('personalization', []),
        ], $request->user()->id);

        if ($request->boolean('send_now') || $broadcast->scheduled_at) {
            try {
                $broadcast = $this->broadcasts->send($broadcast);
            } catch (MessagingException $exception) {
                return response()->json(['message' => $exception->getMessage()], $exception->status);
            }
        }

        return response()->json($broadcast->load('template'), Response::HTTP_CREATED);
    }

    public function show(Broadcast $broadcast): JsonResponse
    {
        $status = request()->string('status')->toString();
        $recipients = $broadcast->recipients()
            ->with('contact:id,name,phone,phone_normalized')
            ->when($status !== '', fn ($query) => $query->where('status', $status))
            ->latest()
            ->paginate(min(max(request()->integer('per_page', 50), 1), 100));

        return response()->json([
            'broadcast' => $broadcast->load(['creator:id,name', 'template'])
                ->loadCount(['recipients as pending' => fn ($query) => $query->where('status', 'pending')]),
            'recipients' => $recipients,
        ]);
    }

    public function send(Broadcast $broadcast): JsonResponse
    {
        try {
            $broadcast = $this->broadcasts->send($broadcast);
        } catch (MessagingException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->status);
        }

        return response()->json($broadcast);
    }

    public function resume(Broadcast $broadcast): JsonResponse
    {
        return $this->retry($broadcast, 'failed');
    }

    public function retryPending(Broadcast $broadcast): JsonResponse
    {
        return $this->retry($broadcast, 'pending');
    }

    private function retry(Broadcast $broadcast, string $status): JsonResponse
    {
        try {
            return response()->json(['queued' => $this->broadcasts->retry($broadcast, $status)]);
        } catch (MessagingException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->status);
        }
    }

    public function destroy(Broadcast $broadcast): JsonResponse
    {
        $deleted = Broadcast::query()->whereKey($broadcast->id)->where('status', '!=', 'sending')->delete();
        if (! $deleted) {
            return response()->json(['message' => 'A broadcast that is sending cannot be deleted.'], 409);
        }

        return response()->json(['ok' => true]);
    }

    public function export(Broadcast $broadcast): StreamedResponse
    {
        $filename = 'broadcast-'.$broadcast->id.'.csv';

        return response()->streamDownload(function () use ($broadcast) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['Contact', 'Phone', 'Status', 'Error', 'Sent at']);

            $broadcast->recipients()
                ->with('contact:id,name,phone')
                ->orderBy('id')
                ->each(function ($recipient) use ($handle) {
                    fputcsv($handle, [
                        $recipient->contact?->name,
                        $recipient->contact?->phone,
                        $recipient->status,
                        $recipient->error,
                        $recipient->sent_at?->toDateTimeString(),
                    ]);
                });

            fclose($handle);
        }, $filename, ['Content-Type' => 'text/csv']);
    }

    private function audience(Request $request, array $audience): array
    {
        if ($request->hasFile('audience.csv_file')) {
            $audience['csv_file'] = $request->file('audience.csv_file');
        }

        return $audience;
    }
}
