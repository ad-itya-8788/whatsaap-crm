<?php

namespace App\Services;

use App\Models\ConsentEvent;
use App\Models\Contact;

class ConsentService
{
    public function change(
        Contact $contact,
        string $status,
        ?string $source = null,
        ?string $note = null,
        ?int $changedBy = null,
    ): ConsentEvent {
        $contact->update([
            'consent_status' => $status,
            'consent_at' => $status === 'unknown' ? null : now(),
        ]);

        return ConsentEvent::create([
            'contact_id' => $contact->id,
            'status' => $status,
            'source' => $source,
            'note' => $note,
            'changed_by' => $changedBy,
        ]);
    }
}
