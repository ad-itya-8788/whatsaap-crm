<?php

namespace App\Http\Controllers\Api;

use App\Auth\Access;
use App\Http\Controllers\Controller;
use App\Http\Requests\ContactRequest;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\CustomField;
use App\Models\Tag;
use App\Models\User;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use SplFileObject;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ContactController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 25), 1), 100);
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tag_ids' => ['sometimes', 'array'],
            'tag_ids.*' => ['integer'],
            'field_id' => ['sometimes', 'required_with:field_value', 'integer', 'exists:custom_fields,id'],
            'field_value' => ['sometimes', 'required_with:field_id', 'nullable', 'string', 'max:1000'],
        ]);

        $access = app(Access::class);
        if (! empty($filters['tag_ids'])) {
            abort_unless($access->can($request->user(), 'tags.view'), 403);
        }
        if (! empty($filters['field_id'])) {
            abort_unless($access->can($request->user(), 'custom_fields.view'), 403);
        }

        $query = Contact::query()
            ->with(['tags', 'customFieldValues.customField'])
            ->withCount('tags')
            ->addSelect([
                'conversation_id' => app(Access::class)->conversationQuery(Conversation::query(), $request->user())
                    ->select('id')->whereColumn('contact_id', 'contacts.id')->limit(1),
                'last_interaction_at' => app(Access::class)->conversationQuery(Conversation::query(), $request->user())
                    ->select('last_message_at')->whereColumn('contact_id', 'contacts.id')
                    ->orderByDesc('last_message_at')->limit(1),
            ]);

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

        if (array_key_exists('field_id', $filters)) {
            $query->whereHas('customFieldValues', function ($q) use ($filters) {
                $q->where('custom_field_id', $filters['field_id'])
                    ->where('value', $filters['field_value'] ?? '');
            });
        }

        $paginator = $query->orderByDesc('updated_at')->orderByDesc('id')->paginate($perPage);
        $summary = [
            'total' => Contact::count(),
            'with_conversation' => Contact::whereHas('conversations', fn ($query) => app(Access::class)->conversationQuery($query, $request->user()))->count(),
            'recently_added' => Contact::where('created_at', '>=', now()->subDays(7))->count(),
            'tags' => $access->can($request->user(), 'tags.view') ? Tag::count() : 0,
        ];
        $paginator->setCollection(
            $paginator->getCollection()->map(fn (Contact $contact) => $this->contactPayload($contact))
        );

        return response()->json($paginator->toArray() + ['summary' => $summary]);
    }

    public function store(ContactRequest $request): JsonResponse
    {
        $data = $request->validated();
        $customValues = $request->customFieldValues();
        $tagIds = $data['tags'] ?? null;
        if ($tagIds !== null) {
            abort_unless(app(Access::class)->can($request->user(), 'contacts.tags'), 403);
        }
        if (array_key_exists('custom_fields', $data)) {
            abort_unless(app(Access::class)->can($request->user(), 'contacts.custom_values'), 403);
        }
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

        $contact = DB::transaction(function () use ($data, $customValues, $tagIds) {
            $contact = Contact::create($data);
            $this->syncCustomValues($contact, $customValues);
            if ($tagIds !== null) {
                $contact->tags()->sync($tagIds);
            }

            return $contact;
        }, 3);

        return response()->json($this->contactPayload($contact), 201);
    }

    public function show(Contact $contact): JsonResponse
    {
        return response()->json($this->contactPayload($contact));
    }

    public function notes(Contact $contact): JsonResponse
    {
        return response()->json($contact->notes()->with('user:id,name')->latest()->get());
    }

    public function storeNote(Request $request, Contact $contact): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'max:5000']]);
        $note = $contact->notes()->create($data + ['user_id' => $request->user()->id]);

        return response()->json($note->load('user:id,name'), 201);
    }

    public function destroyNote(Contact $contact, int $note): Response
    {
        $contact->notes()->findOrFail($note)->delete();

        return response()->noContent();
    }

    public function update(ContactRequest $request, Contact $contact): JsonResponse
    {
        $data = $request->validated();
        $hasCustomFields = array_key_exists('custom_fields', $data);
        $customValues = $request->customFieldValues();
        $tagIds = array_key_exists('tags', $data) ? $data['tags'] : null;
        if ($tagIds !== null) {
            abort_unless(app(Access::class)->can($request->user(), 'contacts.tags'), 403);
        }
        if (array_key_exists('custom_fields', $data)) {
            abort_unless(app(Access::class)->can($request->user(), 'contacts.custom_values'), 403);
        }
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

        DB::transaction(function () use ($contact, $data, $hasCustomFields, $customValues, $tagIds) {
            $contact->update($data);
            if ($hasCustomFields) {
                $this->syncCustomValues($contact, $customValues);
            }
            if ($tagIds !== null) {
                $contact->tags()->sync($tagIds);
            }
        }, 3);

        return response()->json($this->contactPayload($contact));
    }

    public function destroy(Contact $contact): Response
    {
        DB::transaction(function () use ($contact) {
            $locked = Contact::query()->lockForUpdate()->findOrFail($contact->id);
            $conversation = Conversation::where('contact_id', $locked->id)->lockForUpdate()->first();
            if ($conversation) {
                app(Access::class)->authorizeConversation(request()->user(), $conversation);
            }
            $locked->delete();
        }, 3);

        return response()->noContent();
    }

    public function syncTags(Request $request, Contact $contact): JsonResponse
    {
        $data = $request->validate([
            'tags' => ['present', 'array'],
            'tags.*' => ['integer', 'exists:tags,id'],
        ]);

        $contact->tags()->sync($data['tags']);

        return response()->json(['tags' => $contact->load('tags')->tags]);
    }

    public function export(): StreamedResponse
    {
        $user = request()->user();
        $access = app(Access::class);
        $withTags = $access->can($user, 'tags.view');
        $fields = $access->can($user, 'custom_fields.view')
            ? CustomField::query()->where('is_active', true)->orderBy('id')->get(['id', 'name'])
            : collect();

        $headers = ['name', 'phone', 'email', 'company'];
        if ($withTags) {
            $headers[] = 'tags';
        }
        foreach ($fields as $field) {
            $headers[] = 'field:'.$field->name;
        }

        $filename = 'contacts-'.now()->toDateString().'.csv';

        return response()->streamDownload(function () use ($fields, $headers, $withTags) {
            $handle = fopen('php://output', 'w+');
            fputcsv($handle, $headers);

            Contact::query()
                ->select(['id', 'name', 'phone', 'email', 'company'])
                ->orderBy('id')
                ->chunkById(250, function ($contacts) use ($handle, $fields, $withTags) {
                    if ($withTags) {
                        $contacts->load('tags');
                    }
                    if ($fields->isNotEmpty()) {
                        $contacts->load('customFieldValues');
                    }

                    foreach ($contacts as $contact) {
                        $values = $fields->isEmpty() ? collect() : $contact->customFieldValues->pluck('value', 'custom_field_id');
                        $row = [
                            $contact->name,
                            $contact->phone,
                            $contact->email,
                            $contact->company,
                        ];
                        if ($withTags) {
                            $row[] = $contact->tags->pluck('name')->implode('; ');
                        }

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
                    $request->user(),
                );
            } catch (\Throwable $error) {
                report($error);
                $result['skipped']++;
                if (count($errors) < 20) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Could not import this row.'];
                }
            }
        }

        $result['errors'] = $errors;

        return response()->json($result);
    }

    private function contactPayload(Contact $contact): array
    {
        $access = app(Access::class);
        $user = request()->user();
        if ($access->can($user, 'tags.view')) {
            $contact->loadMissing('tags');
        } else {
            $contact->makeHidden(['tags', 'tags_count']);
        }
        if (! $access->can($user, 'custom_fields.view')) {
            return $contact->makeHidden('customFieldValues')->toArray();
        }

        $contact->loadMissing('customFieldValues.customField');
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
        User $user,
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

        $attributes = [
            'phone' => $phoneRaw,
            'phone_normalized' => $normalized,
            'name' => $get('name') ?: $phoneRaw,
            'email' => $get('email') ?: null,
            'company' => $get('company') ?: null,
        ];

        $existing = Contact::where('phone_normalized', $normalized)->first();

        $tagNames = preg_split('/[;,|]/', (string) ($get('tags') ?: '')) ?: [];
        $tagNames = array_values(array_unique(array_filter(array_map('trim', $tagNames))));

        $fieldValues = [];
        foreach ($fieldColumns as $index => $fieldId) {
            $value = $row[$index] ?? null;
            if ($value !== null && $value !== '') {
                $fieldValues[$fieldId] = (string) $value;
            }
        }

        $access = app(Access::class);
        if (($tagNames && ! $access->can($user, 'contacts.tags'))
            || ($fieldValues && ! $access->can($user, 'contacts.custom_values'))) {
            $this->importError($result, $errors, $rowNumber, 'You do not have permission to import tags or custom field values in this row.');

            return;
        }
        $tagIds = [];
        if ($tagNames && ! $access->can($user, 'tags.create')) {
            $tagIds = Tag::query()->whereIn('name', $tagNames)->pluck('id')->all();
            if (count($tagIds) !== count($tagNames)) {
                $this->importError($result, $errors, $rowNumber, 'You do not have permission to create new tags.');

                return;
            }
        }

        if ($dryRun) {
            $existing ? $result['updated']++ : $result['imported']++;
            return;
        }

        DB::transaction(function () use ($attributes, $existing, $tagNames, $tagIds, $fieldValues, $user) {
            if ($existing) {
                $contact = $existing;
                $contact->update($attributes);
            } else {
                $contact = Contact::create($attributes + ['user_id' => $user->id]);
            }

            if ($tagNames) {
                if (! $tagIds) {
                    foreach ($tagNames as $name) {
                        $tagIds[] = Tag::firstOrCreate(['name' => mb_substr($name, 0, 255)])->id;
                    }
                }
                $existing ? $contact->tags()->syncWithoutDetaching($tagIds) : $contact->tags()->sync($tagIds);
            }

            foreach ($fieldValues as $fieldId => $value) {
                DB::table('contact_custom_values')->updateOrInsert(
                    ['contact_id' => $contact->id, 'custom_field_id' => $fieldId],
                    ['value' => $value],
                );
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
