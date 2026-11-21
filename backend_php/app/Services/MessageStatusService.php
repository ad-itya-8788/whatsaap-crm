<?php

namespace App\Services;

use App\Models\Message;
use App\Models\PendingMessageStatus;
use Carbon\Carbon;

class MessageStatusService
{
    private const STATUSES = ['sent', 'delivered', 'read', 'failed'];

    public function apply(Message $message, array $statusData): void
    {
        $status = $statusData['status'] ?? null;
        if (! in_array($status, self::STATUSES, true)) {
            return;
        }

        $updates = ['status' => $status];

        if (! empty($statusData['errors'][0])) {
            $updates['error_code'] = $statusData['errors'][0]['code'] ?? null;
            $updates['error_title'] = $statusData['errors'][0]['title'] ?? null;
            $updates['error_details'] = $statusData['errors'][0]['message']
                ?? ($statusData['errors'][0]['error_data']['details'] ?? null);
        }

        if (! empty($statusData['timestamp'])) {
            $updates['provider_timestamp'] = Carbon::createFromTimestamp((int) $statusData['timestamp']);
        }

        $message->update($updates);

        if ($message->message_id) {
            PendingMessageStatus::where('wamid', $message->message_id)
                ->where('status', $status)
                ->delete();
        }
    }

    public function buffer(string $wamid, array $statusData): void
    {
        $status = $statusData['status'] ?? null;
        if (! in_array($status, self::STATUSES, true)) {
            return;
        }

        PendingMessageStatus::updateOrCreate(
            ['wamid' => $wamid, 'status' => $status],
            [
                'status_at' => ! empty($statusData['timestamp'])
                    ? Carbon::createFromTimestamp((int) $statusData['timestamp'])
                    : now(),
                'error_code' => $statusData['errors'][0]['code'] ?? null,
                'error_title' => $statusData['errors'][0]['title'] ?? null,
                'error_details' => $statusData['errors'][0]['message'] ?? null,
            ],
        );
    }

    public function flushPending(Message $message): void
    {
        if (! $message->message_id) {
            return;
        }

        $pending = PendingMessageStatus::where('wamid', $message->message_id)
            ->orderBy('status_at')
            ->get();

        foreach ($pending as $item) {
            $this->apply($message, [
                'status' => $item->status,
                'timestamp' => $item->status_at?->timestamp,
                'errors' => [[
                    'code' => $item->error_code,
                    'title' => $item->error_title,
                    'message' => $item->error_details,
                ]],
            ]);
        }
    }
}
