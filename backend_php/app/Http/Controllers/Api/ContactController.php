<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\ContactRequest;
use App\Models\Contact;
use App\Models\ConsentEvent;
use App\Models\CustomField;
use App\Models\Tag;
use App\Services\AutomationEngine;
use App\Services\ConsentService;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use SplFileObject;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ContactController extends Controller
{
    public function __construct(private ConsentService $consent) {}

    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 25), 1), 100);
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tag_ids' => ['sometimes', 'array'],
            'tag_ids.*' => ['integer'],
            'consent_status' => ['sometimes', 'in:opted_in,opted_out,unknown'],
            'field_id' => ['sometimes', 'required_with:field_value', 'integer', 'exists:custom_fields,id'],
            'field_value' => ['sometimes', 'required_with:field_id', 'nullable', 'string', 'max:1000'],
        ]);

        $query = Contact::query()
            ->with(['tags', 'customFieldValues.customField'])
            ->withCount('tags');

        if ($search = $request->string('search')->toString()) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('phone_normalized', 'like', "%{$search}%")
                    ->orWhere('wa_user_id', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhere('company', 'like', "%{$search}%");
            });
        }

        if (! empty($filters['tag_ids'])) {
            $query->whereHas('tags', fn ($q) => $q->whereIn('tags.id', $filters['tag_ids']));
        }

        if (isset($filters['consent_status'])) {
            $query->where('consent_status', $filters['consent_status']);
        }

        if (array_key_exists('field_id', $filters)) {
            $query->whereHas('customFieldValues', function ($q) use ($filters) {
                $q->where('custom_field_id', $filters['field_id'])
                    ->where('value', $filters['field_value'] ?? '');
            });
        }

        $paginator = $query->orderByDesc('updated_at')->paginate($perPage);
        $paginator->setCollection(
            $paginator->getCollection()->map(fn (Contact $contact) => $this->contactPayload($contact))
        );

        $stats = Contact::query()
            ->selectRaw("
                COUNT(*) AS total,
                SUM(CASE WHEN consent_status = 'opted_in' THEN 1 ELSE 0 END) AS opted_in,
                SUM(CASE WHEN consent_status = 'opted_out' THEN 1 ELSE 0 END) AS opted_out,
                SUM(CASE WHEN consent_status NOT IN ('opted_in', 'opted_out') OR consent_status IS NULL THEN 1 ELSE 0 END) AS unknown
            ")
            ->first();

        return response()->json([
            ...$paginator->toArray(),
            'stats' => [
                'total' => (int) $stats->total,
                'opted_in' => (int) $stats->opted_in,
                'opted_out' => (int) $stats->opted_out,
                'unknown' => (int) $stats->unknown,
            ],
        ]);
    }

    public function store(ContactRequest $request): JsonResponse
    {
        $data = $request->validated();
        $customValues = $request->customFieldValues();
        $tagIds = $data['tags'] ?? null;
        unset($data['tags'], $data['custom_fields']);

        $data['phone_normalized'] = Phone::normalize($data['phone']);
        $data['user_id'] = $request->user()->id;

        if (! $data['phone_normalized']) {
            return response()->json(['message' => 'A valid phone number is required.'], 422);
        }

        if (Contact::where('phone_normalized', $data['phone_normalized'])->exists()) {
            return response()->json([
                'message' => 'A contact with this phone number already exists.',
                'errors' => ['phone' => ['This phone number is already saved.']],
            ], 422);
        }

        $contact = Contact::create($data);
        $this->syncCustomValues($contact, $customValues);

        if ($tagIds !== null) {
            $contact->tags()->sync($tagIds);
        }

        app(AutomationEngine::class)->dispatch('new_contact_created', [
            'contact_id' => $contact->id,
            'contact_created' => true,
        ]);

        return response()->json($this->contactPayload($contact), 201);
    }

    public function show(Contact $contact): JsonResponse
    {
        return response()->json($this->contactPayload($contact));
    }

    public function update(ContactRequest $request, Contact $contact): JsonResponse
    {
        $data = $request->validated();
        $hasCustomFields = array_key_exists('custom_fields', $data);
        $customValues = $request->customFieldValues();
        $tagIds = array_key_exists('tags', $data) ? $data['tags'] : null;
        unset($data['tags'], $data['custom_fields']);

        if (array_key_exists('phone', $data)) {
            $data['phone_normalized'] = Phone::normalize($data['phone']);
            if (! $data['phone_normalized']) {
                return response()->json(['message' => 'A valid phone number is required.'], 422);
            }
            if (Contact::where('phone_normalized', $data['phone_normalized'])->whereKeyNot($contact->id)->exists()) {
                return response()->json([
                    'message' => 'A contact with this phone number already exists.',
                    'errors' => ['phone' => ['This phone number is already saved.']],
                ], 422);
            }
        }

        $contact->update($data);

        if ($hasCustomFields) {
            $this->syncCustomValues($contact, $customValues);
        }

        if ($tagIds !== null) {
            $contact->tags()->sync($tagIds);
        }

        return response()->json($this->contactPayload($contact));
    }

    public function destroy(Contact $contact): Response
    {
        $contact->delete();

        return response()->noContent();
    }

    public function syncTags(Request $request, Contact $contact): JsonResponse
    {
        $data = $request->validate([
            'tags' => ['present', 'array'],
            'tags.*' => ['integer', 'exists:tags,id'],
        ]);

        $before = $contact->tags()->pluck('tags.id')->all();
        $contact->tags()->sync($data['tags']);
        $added = array_diff(array_map('intval', $data['tags']), array_map('intval', $before));

        foreach ($added as $tagId) {
            app(AutomationEngine::class)->dispatch('tag_added', [
                'contact_id' => $contact->id,
                'conversation_id' => $contact->conversations()->value('id'),
                'tag_id' => $tagId,
            ]);
        }

        return response()->json(['tags' => $contact->load('tags')->tags]);
    }

    public function consent(Request $request, Contact $contact): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:opted_in,opted_out,unknown'],
            'source' => ['nullable', 'string', 'max:100'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $event = $this->consent->change(
            $contact,
            $data['status'],
            $data['source'] ?? null,
            $data['note'] ?? null,
            $request->user()->id,
        );

        return response()->json([
            'contact' => $this->contactPayload($contact->refresh()),
            'event' => $event->load('changedBy'),
        ]);
    }

    public function consentEvents(Contact $contact): JsonResponse
    {
        return response()->json(
            $contact->consentEvents()->with('changedBy')->latest()->limit(20)->get()
        );
    }

    public function export(): StreamedResponse
    {
        $fields = CustomField::query()->where('is_active', true)->orderBy('id')->get(['id', 'name']);

        $headers = ['name', 'phone', 'email', 'company', 'tags', 'consent_status'];
        foreach ($fields as $field) {
            $headers[] = 'field:'.$field->name;
        }

        $filename = 'contacts-'.now()->toDateString().'.csv';

        return response()->streamDownload(function () use ($fields, $headers) {
            $handle = fopen('php://output', 'w+');
            fputcsv($handle, $headers);

            Contact::query()
                ->select(['id', 'name', 'phone', 'email', 'company', 'consent_status'])
                ->orderBy('id')
                ->chunkById(250, function ($contacts) use ($handle, $fields) {
                    $contacts->load(['tags', 'customFieldValues']);

                    foreach ($contacts as $contact) {
                        $values = $contact->customFieldValues->pluck('value', 'custom_field_id');
                        $row = [
                            $contact->name,
                            $contact->phone,
                            $contact->email,
                            $contact->company,
                            $contact->tags->pluck('name')->implode('; '),
                            $contact->consent_status,
                        ];

                        foreach ($fields as $field) {
                            $row[] = $values->get($field->id, '');
                        }

                        fputcsv($handle, $row);
                    }
                });

            fclose($handle);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function import(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:2048', 'extensions:csv,txt'],
            'dry_run' => ['sometimes', 'boolean'],
        ]);

        $dryRun = (bool) ($validated['dry_run'] ?? false);
        $csv = new SplFileObject($validated['file']->getRealPath());
        $csv->setFlags(SplFileObject::READ_CSV | SplFileObject::SKIP_EMPTY);

        $headers = $csv->fgetcsv();
        if (! is_array($headers) || ! in_array('phone', array_map(fn ($h) => mb_strtolower(trim((string) $h)), $headers), true)) {
            return response()->json(['message' => 'The CSV file must include a phone column.'], 422);
        }

        $headers = array_map(fn ($h) => mb_strtolower(trim((string) $h)), $headers);
        $columns = array_flip($headers);

        $activeFields = CustomField::query()->where('is_active', true)->get(['id', 'name'])
            ->keyBy(fn (CustomField $field) => mb_strtolower($field->name));

        $fieldColumns = [];
        foreach ($headers as $index => $header) {
            if (! str_starts_with($header, 'field:')) {
                continue;
            }
            $field = $activeFields->get(mb_strtolower(trim(substr($header, 6))));
            if ($field) {
                $fieldColumns[$index] = $field->id;
            }
        }

        $result = ['total' => 0, 'imported' => 0, 'updated' => 0, 'skipped' => 0];
        $errors = [];
        $seen = [];
        $rowNumber = 1;

        while (! $csv->eof()) {
            if ($result['total'] >= 500) {
                break;
            }

            $row = $csv->fgetcsv();
            $rowNumber++;

            if (! is_array($row)) {
                continue;
            }

            $row = array_map(fn ($cell) => is_string($cell) ? trim($cell) : $cell, $row);
            if (! array_filter($row, fn ($cell) => $cell !== null && $cell !== '')) {
                continue;
            }

            $result['total']++;
            $get = fn (string $name) => isset($columns[$name]) ? ($row[$columns[$name]] ?? null) : null;

            try {
                $this->importRow(
                    $row,
                    $get,
                    $fieldColumns,
                    $seen,
                    $result,
                    $errors,
                    $rowNumber,
                    $dryRun,
                    $request->user()->id,
                );
            } catch (\Throwable $e) {
                $result['skipped']++;
                if (count($errors) < 20) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Could not import this row: '.$e->getMessage()];
                }
            }
        }

        $result['errors'] = $errors;

        return response()->json($result);
    }

    private function contactPayload(Contact $contact): array
    {
        $contact->loadMissing(['tags', 'customFieldValues.customField']);

        $data = $contact->toArray();
        $customFields = [];
        foreach ($contact->customFieldValues as $value) {
            if ($value->customField) {
                $customFields[(string) $value->custom_field_id] = $value->value;
            }
        }
        $data['custom_fields'] = (object) $customFields;

        return $data;
    }

    private function syncCustomValues(Contact $contact, array $values): void
    {
        foreach ($values as $fieldId => $value) {
            if (is_bool($value)) {
                $value = $value ? '1' : '';
            }

            DB::table('contact_custom_values')->updateOrInsert(
                ['contact_id' => $contact->id, 'custom_field_id' => $fieldId],
                ['value' => is_null($value) ? null : (string) $value],
            );
        }
    }

    private function importRow(
        array $row,
        callable $get,
        array $fieldColumns,
        array &$seen,
        array &$result,
        array &$errors,
        int $rowNumber,
        bool $dryRun,
        int $userId,
    ): void {
        $phoneRaw = $get('phone');
        $normalized = Phone::normalize($phoneRaw);

        if (! $normalized || strlen($normalized) < 8 || strlen($normalized) > 15) {
            $this->importError($result, $errors, $rowNumber, 'Missing or invalid phone number.');
            return;
        }

        if (isset($seen[$normalized])) {
            $this->importError($result, $errors, $rowNumber, 'Duplicate phone number in import file.');
            return;
        }
        $seen[$normalized] = true;

        $status = mb_strtolower((string) ($get('consent_status') ?: 'unknown'));
        if (! in_array($status, ['opted_in', 'opted_out', 'unknown'], true)) {
            $this->importError($result, $errors, $rowNumber, 'Invalid consent_status.');
            return;
        }

        $attributes = [
            'phone' => $phoneRaw,
            'phone_normalized' => $normalized,
            'name' => $get('name') ?: $phoneRaw,
            'email' => $get('email') ?: null,
            'company' => $get('company') ?: null,
            'consent_status' => $status,
        ];

        $existing = Contact::where('phone_normalized', $normalized)->first();
        $statusChanged = ! $existing || $existing->consent_status !== $status;
        if ($statusChanged) {
            $attributes['consent_at'] = $status === 'unknown' ? null : now();
        }

        $tagNames = preg_split('/[;,|]/', (string) ($get('tags') ?: '')) ?: [];
        $tagNames = array_values(array_unique(array_filter(array_map('trim', $tagNames))));

        $fieldValues = [];
        foreach ($fieldColumns as $index => $fieldId) {
            $value = $row[$index] ?? null;
            if ($value !== null && $value !== '') {
                $fieldValues[$fieldId] = (string) $value;
            }
        }

        if ($dryRun) {
            $existing ? $result['updated']++ : $result['imported']++;
            return;
        }

        DB::transaction(function () use ($attributes, $existing, $tagNames, $fieldValues, $status, $statusChanged, $userId) {
            if ($existing) {
                $contact = $existing;
                $contact->update($attributes);
            } else {
                $contact = Contact::create($attributes + ['user_id' => $userId]);
            }

            if ($tagNames) {
                $tagIds = [];
                foreach ($tagNames as $name) {
                    $tagIds[] = Tag::firstOrCreate(['name' => mb_substr($name, 0, 255)])->id;
                }
                $existing ? $contact->tags()->syncWithoutDetaching($tagIds) : $contact->tags()->sync($tagIds);
            }

            foreach ($fieldValues as $fieldId => $value) {
                DB::table('contact_custom_values')->updateOrInsert(
                    ['contact_id' => $contact->id, 'custom_field_id' => $fieldId],
                    ['value' => $value],
                );
            }

            if ($statusChanged) {
                ConsentEvent::create([
                    'contact_id' => $contact->id,
                    'status' => $status,
                    'source' => 'import',
                    'changed_by' => $userId,
                ]);
            }
        });

        $existing ? $result['updated']++ : $result['imported']++;
    }

    private function importError(array &$result, array &$errors, int $rowNumber, string $message): void
    {
        $result['skipped']++;

        if (count($errors) < 20) {
            $errors[] = ['row' => $rowNumber, 'message' => $message];
        }
    }
}
