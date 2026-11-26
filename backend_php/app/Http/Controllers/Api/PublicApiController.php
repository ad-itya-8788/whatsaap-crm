<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MessagingException;
use App\Http\Controllers\Controller;
use App\Models\ApiKey;
use App\Models\Broadcast;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageTemplate;
use App\Models\Tag;
use App\Services\BroadcastService;
use App\Services\MessagingService;
use App\Support\Phone;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PublicApiController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $key = $this->key($request);

        return $this->data([
            'account' => ['id' => 'default', 'name' => config('app.name')],
            'key' => $key->only(['id', 'name', 'scopes']),
        ]);
    }

    public function contacts(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'tag' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = Contact::query()->with('tags:id,name,color')
            ->when($filters['search'] ?? null, function (Builder $query, string $search) {
                $query->where(fn (Builder $row) => $row->where('name', 'like', '%'.$search.'%')
                    ->orWhere('phone', 'like', '%'.$search.'%'));
            })
            ->when($filters['tag'] ?? null, fn (Builder $query, int $id) => $query->whereHas('tags', fn (Builder $tag) => $tag->whereKey($id)));

        return $this->page($request, $query, $this->contact(...));
    }

    public function showContact(Contact $contact): JsonResponse
    {
        return $this->data($this->contact($contact));
    }

    public function storeContact(Request $request): JsonResponse
    {
        $attributes = $request->validate($this->contactRules() + ['phone' => ['required', 'string', 'max:50']]);
        $digits = $this->internationalPhone($attributes['phone']);
        if (! $digits) {
            throw ValidationException::withMessages(['phone' => 'Enter an international phone number beginning with +.']);
        }

        $contact = DB::transaction(function () use ($request, $attributes, $digits) {
            $contact = Contact::firstOrCreate(['phone_normalized' => $digits], [
                'user_id' => $this->key($request)->created_by,
                'phone' => '+'.$digits,
                'name' => $attributes['name'] ?? null,
                'email' => $attributes['email'] ?? null,
                'company' => $attributes['company'] ?? null,
            ]);
            if ($contact->wasRecentlyCreated && isset($attributes['tags'])) {
                $this->syncTags($contact, $attributes['tags']);
            }

            return $contact;
        });

        return $this->data($this->contact($contact), $contact->wasRecentlyCreated ? 201 : 200);
    }

    public function updateContact(Request $request, Contact $contact): JsonResponse
    {
        $attributes = $request->validate($this->contactRules());
        DB::transaction(function () use ($contact, $attributes) {
            $contact->update(array_diff_key($attributes, ['tags' => true]));
            if (array_key_exists('tags', $attributes)) {
                $this->syncTags($contact, $attributes['tags']);
            }
        });

        return $this->data($this->contact($contact));
    }

    public function conversations(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', 'in:open,pending,closed'],
            'contact_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = Conversation::query()->with('contact.tags:id,name,color')->where(array_filter($filters));

        return $this->page($request, $query, $this->conversation(...));
    }

    public function showConversation(Conversation $conversation): JsonResponse
    {
        return $this->data($this->conversation($conversation));
    }

    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        return $this->page($request, $conversation->messages()->getQuery(), fn (Message $message) => $message->only([
            'id', 'conversation_id', 'content_type', 'content_text', 'status', 'template_name', 'created_at',
        ]) + [
            'direction' => $message->sender_type === 'customer' ? 'inbound' : 'outbound',
            'whatsapp_message_id' => $message->message_id,
        ]);
    }

    public function sendMessage(Request $request, MessagingService $messaging): JsonResponse
    {
        $data = $request->validate([
            'to' => ['required', 'string', 'max:50'],
            'type' => ['sometimes', 'in:text,template,image,video,document,audio'],
            'text' => ['required_without:type', 'required_if:type,text', 'nullable', 'string', 'max:4096'],
            'media_url' => ['required_if:type,image,video,document,audio', 'nullable', 'url:https', 'max:2048'],
            'filename' => ['nullable', 'string', 'max:255'],
            'template.name' => ['required_if:type,template', 'string', 'max:255'],
            'template.language' => ['nullable', 'string', 'max:16'],
            'template.params' => ['nullable', 'array', 'max:20'],
        ]);
        $digits = $this->internationalPhone($data['to']);
        if (! $digits) {
            throw ValidationException::withMessages(['to' => 'Enter an international phone number beginning with +.']);
        }

        $key = $this->key($request);
        $contact = Contact::firstOrCreate(['phone_normalized' => $digits], ['phone' => '+'.$digits, 'user_id' => $key->created_by]);
        $conversation = Conversation::firstOrCreate(['contact_id' => $contact->id], ['user_id' => $key->created_by]);
        $type = $data['type'] ?? 'text';
        $params = $data['template']['params'] ?? [];
        $values = array_is_list($params) ? ['body' => $params] : $params;
        $values = validator($values, [
            'body' => ['sometimes', 'array', 'list', 'max:20'],
            'body.*' => ['nullable', 'string', 'max:1024'],
            'headerText' => ['nullable', 'string', 'max:1024'],
            'buttonParams' => ['nullable', 'array', 'max:10'],
            'buttonParams.*' => ['nullable', 'string', 'max:1024'],
        ])->validate();
        $payload = [
            'content_type' => $type,
            'content_text' => $data['text'] ?? null,
            'template_name' => $data['template']['name'] ?? null,
            'template_language' => $data['template']['language'] ?? null,
            'template_params' => $values['body'] ?? [],
            'header_text' => $values['headerText'] ?? null,
            'button_params' => $values['buttonParams'] ?? [],
        ];
        if ($requestId = $request->header('Idempotency-Key')) {
            $payload['idempotency_key'] = 'api:'.$key->id.':'.hash('sha256', $requestId);
        }
        if (in_array($type, ['image', 'video', 'document', 'audio'], true)) {
            $media = ['link' => $data['media_url']];
            if ($type !== 'audio' && ! empty($data['text'])) {
                $media['caption'] = $data['text'];
            }
            if ($type === 'document' && ! empty($data['filename'])) {
                $media['filename'] = $data['filename'];
            }
            $payload['payload'] = ['type' => $type, $type => $media];
            $payload['meta'] = ['external_media_url' => $data['media_url']];
            $payload['filename'] = $data['filename'] ?? null;
        }

        try {
            $message = $messaging->send($conversation, $payload, $key->created_by);
        } catch (MessagingException $error) {
            return response()->json(['error' => [
                'code' => $error->status >= 500 ? 'meta_error' : 'bad_request',
                'message' => $error->getMessage(),
            ]], $error->status);
        }
        if (! $message->message_id) {
            return response()->json(['error' => ['code' => 'pending', 'message' => 'The send is awaiting confirmation.', 'message_id' => $message->id]], 409);
        }

        return $this->data([
            'message_id' => $message->id,
            'whatsapp_message_id' => $message->message_id,
            'conversation_id' => $conversation->id,
            'contact_id' => $contact->id,
            'contact_created' => $contact->wasRecentlyCreated,
        ], $message->wasRecentlyCreated ? 201 : 200);
    }

    public function storeBroadcast(Request $request, BroadcastService $service): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'template_name' => ['required', 'string', 'max:255'],
            'template_language' => ['nullable', 'string', 'max:16'],
            'recipients' => ['required', 'array', 'list', 'max:1000'],
            'recipients.*' => ['array'],
            'recipients.*.to' => ['nullable', 'string', 'max:50'],
            'recipients.*.params' => ['nullable', 'array', 'list', 'max:20'],
            'recipients.*.params.*' => ['nullable', 'string', 'max:1024'],
        ]);
        $template = MessageTemplate::query()->where('name', $data['template_name'])
            ->where('language', $data['template_language'] ?? 'en_US')
            ->whereRaw('UPPER(COALESCE(approval_status, status)) = ?', ['APPROVED'])
            ->first();
        if (! $template) {
            throw ValidationException::withMessages(['template_name' => 'Choose an approved template in the requested language.']);
        }
        $recipients = [];
        foreach ($data['recipients'] as $recipient) {
            $phone = $this->internationalPhone($recipient['to'] ?? '');
            if ($phone && ! array_key_exists($phone, $recipients)) {
                $recipients[$phone] = $recipient['params'] ?? [];
            }
        }
        if (! $recipients) {
            throw ValidationException::withMessages(['recipients' => 'Enter at least one valid recipient.']);
        }

        $broadcast = $service->sendToPhones($template, $data['name'], $recipients, $this->key($request)->created_by);

        return $this->data([
            'broadcast_id' => $broadcast->id,
            'status' => $broadcast->status,
            'total_recipients' => $broadcast->total,
            'accepted' => $broadcast->total,
            'rejected' => count($data['recipients']) - $broadcast->total,
        ], 202);
    }

    public function showBroadcast(Broadcast $broadcast): JsonResponse
    {
        return $this->data([
            'broadcast_id' => $broadcast->id,
            'name' => $broadcast->name,
            'status' => $broadcast->status,
            'total_recipients' => $broadcast->total,
            'sent_count' => $broadcast->sent,
            'delivered_count' => $broadcast->delivered,
            'read_count' => $broadcast->read,
            'failed_count' => $broadcast->failed,
        ]);
    }

    private function key(Request $request): ApiKey
    {
        return $request->attributes->get(ApiKey::class);
    }

    private function page(Request $request, Builder $query, callable $serialize): JsonResponse
    {
        $data = $request->validate(['limit' => ['nullable', 'integer', 'between:1,100'], 'cursor' => ['nullable', 'string', 'max:512']]);
        $page = $query->orderByDesc('id')->cursorPaginate($data['limit'] ?? 50);

        return response()->json(['data' => array_map($serialize, $page->items()), 'meta' => [
            'next_cursor' => $page->nextCursor()?->encode(),
        ]]);
    }

    private function data(mixed $data, int $status = 200): JsonResponse
    {
        return response()->json(['data' => $data], $status);
    }

    private function contact(Contact $contact): array
    {
        return $contact->only(['id', 'phone', 'name', 'email', 'company', 'avatar_url', 'created_at', 'updated_at']) + [
            'tags' => $contact->loadMissing('tags:id,name,color')->tags->map->only(['id', 'name', 'color']),
        ];
    }

    private function conversation(Conversation $conversation): array
    {
        return $conversation->only(['id', 'contact_id', 'status', 'last_message_at', 'last_message_text', 'created_at', 'updated_at']) + [
            'contact' => $this->contact($conversation->loadMissing('contact')->contact),
        ];
    }

    private function contactRules(): array
    {
        return [
            'name' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255'],
            'company' => ['nullable', 'string', 'max:255'],
            'tags' => ['sometimes', 'array', 'list', 'max:100'],
            'tags.*' => ['required', 'string', 'max:60', 'distinct'],
        ];
    }

    private function syncTags(Contact $contact, array $names): void
    {
        $contact->tags()->sync(array_map(fn (string $name) => Tag::firstOrCreate(['name' => $name])->id, $names));
    }

    private function internationalPhone(string $phone): ?string
    {
        $digits = Phone::normalize($phone);

        return preg_match('/\A\+[1-9][0-9 ()-]*\z/', $phone) && $digits && strlen($digits) >= 7 && strlen($digits) <= 15
            ? $digits
            : null;
    }
}
