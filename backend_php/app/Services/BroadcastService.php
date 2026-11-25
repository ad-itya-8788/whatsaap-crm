<?php

namespace App\Services;

use App\Exceptions\MessagingException;
use App\Jobs\SendBroadcastRecipient;
use App\Models\Broadcast;
use App\Models\BroadcastRecipient;
use App\Models\Contact;
use App\Models\MessageTemplate;
use App\Support\Phone;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class BroadcastService
{
    public function create(array $data, int $userId): Broadcast
    {
        return Broadcast::create([
            'user_id' => $userId,
            'template_id' => $data['template_id'],
            'name' => $data['name'],
            'status' => 'draft',
            'scheduled_at' => $data['scheduled_at'] ?? null,
            'audience' => $data['audience'],
            'personalization' => $data['personalization'] ?? [],
        ]);
    }

    public function preview(array $audience, int $limit = 5): array
    {
        $contacts = $this->resolveAudience($audience);

        return [
            'count' => $contacts->count(),
            'sample' => $contacts->take($limit)->map(fn (Contact $contact) => [
                'id' => $contact->id,
                'name' => $contact->name,
                'phone' => $contact->phone,
            ])->values()->all(),
        ];
    }

    public function send(Broadcast $broadcast): Broadcast
    {
        $this->assertApproved($broadcast);
        $broadcast = $this->prepare($broadcast);

        if ($broadcast->status !== 'scheduled') {
            $this->dispatchJobs($broadcast);
        }

        return $broadcast;
    }

    public function dispatchScheduled(): int
    {
        $count = 0;

        Broadcast::query()
            ->where('status', 'scheduled')
            ->whereNotNull('scheduled_at')
            ->where('scheduled_at', '<=', now())
            ->each(function (Broadcast $broadcast) use (&$count) {
                $this->dispatchJobs($broadcast);
                $broadcast->update(['status' => 'sending']);
                $count++;
            });

        return $count;
    }

    public function retry(Broadcast $broadcast, string $status = 'failed'): int
    {
        $recipients = $broadcast->recipients()->where('status', $status)->get();

        foreach ($recipients as $recipient) {
            $recipient->update(['status' => 'pending', 'error' => null, 'provider_error' => null]);
            SendBroadcastRecipient::dispatch($recipient->id);
        }

        $broadcast->update(['status' => 'sending']);
        $this->refreshCounters($broadcast);

        return $recipients->count();
    }

    public function refreshCounters(Broadcast $broadcast): void
    {
        $counts = $broadcast->recipients()
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $broadcast->update([
            'total' => $counts->sum(),
            'sent' => (int) ($counts['sent'] ?? 0) + (int) ($counts['delivered'] ?? 0) + (int) ($counts['read'] ?? 0) + (int) ($counts['replied'] ?? 0),
            'delivered' => (int) ($counts['delivered'] ?? 0) + (int) ($counts['read'] ?? 0) + (int) ($counts['replied'] ?? 0),
            'read' => (int) ($counts['read'] ?? 0) + (int) ($counts['replied'] ?? 0),
            'replied' => (int) ($counts['replied'] ?? 0),
            'failed' => (int) ($counts['failed'] ?? 0),
        ]);

        if ($broadcast->status === 'sending' && ! $counts->get('pending')) {
            $broadcast->update(['status' => 'completed']);
        }
    }

    public function templateVariables(MessageTemplate $template, Contact $contact, array $personalization): array
    {
        $values = [];
        preg_match_all('/\{\{(\d+)\}\}/', (string) $template->body_text, $matches);

        foreach ($matches[1] as $position) {
            $config = $personalization[$position] ?? $personalization[(int) $position] ?? null;
            $values[$position] = $this->resolveVariable($contact, $config);
        }

        ksort($values, SORT_NUMERIC);

        return $values;
    }

    public function assertApproved(Broadcast $broadcast): void
    {
        $template = $broadcast->template;
        if (! $template || strtoupper((string) ($template->approval_status ?: $template->status)) !== 'APPROVED') {
            throw new MessagingException('Only an approved WhatsApp template can be used in a broadcast.', 422);
        }
    }

    private function prepare(Broadcast $broadcast): Broadcast
    {
        $contacts = $this->resolveAudience($broadcast->audience);
        $template = $broadcast->template;
        $personalization = $broadcast->personalization ?: [];

        DB::transaction(function () use ($broadcast, $contacts, $template, $personalization) {
            $broadcast->recipients()->delete();

            foreach ($contacts as $contact) {
                BroadcastRecipient::create([
                    'broadcast_id' => $broadcast->id,
                    'contact_id' => $contact->id,
                    'variables' => $template ? $this->templateVariables($template, $contact, $personalization) : [],
                    'status' => 'pending',
                ]);
            }

            $isScheduled = $broadcast->scheduled_at && $broadcast->scheduled_at->isFuture();

            $broadcast->update([
                'status' => $isScheduled ? 'scheduled' : 'sending',
                'total' => $contacts->count(),
                'sent' => 0,
                'delivered' => 0,
                'read' => 0,
                'replied' => 0,
                'failed' => 0,
            ]);
        });

        return $broadcast->refresh();
    }

    private function dispatchJobs(Broadcast $broadcast): void
    {
        $broadcast->recipients()
            ->where('status', 'pending')
            ->eachById(fn (BroadcastRecipient $recipient) => SendBroadcastRecipient::dispatch($recipient->id));
    }

    private function resolveAudience(array $audience): Collection
    {
        $type = $audience['type'] ?? 'all';

        $query = Contact::query()
            ->where(function ($query) {
                $query->whereNull('consent_status')
                    ->orWhere('consent_status', '!=', 'opted_out');
            });

        if ($type === 'tags') {
            $tagIds = array_values(array_filter($audience['tag_ids'] ?? []));
            $query->whereHas('tags', fn ($query) => $query->whereIn('tags.id', $tagIds));
        } elseif ($type === 'custom_field') {
            $fieldId = $audience['custom_field_id'] ?? null;
            $operator = $audience['operator'] ?? 'is';
            $value = (string) ($audience['value'] ?? '');

            $query->whereHas('customFieldValues', function ($query) use ($fieldId, $operator, $value) {
                $query->where('custom_field_id', $fieldId);
                if ($operator === 'contains') {
                    $query->where('value', 'like', "%{$value}%");
                } elseif ($operator === 'is_not') {
                    $query->where('value', '!=', $value);
                } else {
                    $query->where('value', $value);
                }
            });
        } elseif ($type === 'csv') {
            $phones = $this->parsePhones($audience);
            $query->where(function ($query) use ($phones) {
                $query->whereIn('phone_normalized', $phones)
                    ->orWhereIn('phone', $phones);
            });
        }

        $excludeTagIds = array_values(array_filter($audience['exclude_tag_ids'] ?? []));
        if ($excludeTagIds) {
            $query->whereDoesntHave('tags', fn ($query) => $query->whereIn('tags.id', $excludeTagIds));
        }

        return $query->orderBy('id')->get();
    }

    private function parsePhones(array $audience): array
    {
        $text = (string) ($audience['phones'] ?? '');
        $files = $audience['csv_file'] ?? [];
        $files = $files instanceof UploadedFile ? [$files] : (is_array($files) ? $files : []);

        foreach ($files as $file) {
            if ($file instanceof UploadedFile && $file->isValid()) {
                $text .= "\n".(string) file_get_contents($file->getRealPath());
            }
        }

        return collect(preg_split('/[\r\n,;]+/', $text) ?: [])
            ->map(fn ($phone) => Phone::normalize(trim($phone)))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function resolveVariable(Contact $contact, mixed $config): string
    {
        if (! is_array($config)) {
            return '';
        }

        $source = $config['source'] ?? 'static';

        if ($source === 'static') {
            return (string) ($config['value'] ?? '');
        }

        if ($source === 'field') {
            $field = (string) ($config['value'] ?? '');

            return (string) ($contact->{$field} ?? '');
        }

        if ($source === 'custom_field') {
            $value = $contact->customFieldValues()
                ->where('custom_field_id', $config['value'] ?? null)
                ->value('value');

            return (string) ($value ?? '');
        }

        return '';
    }
}
