<?php

namespace App\Services;

use App\Models\BroadcastRecipient;
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

        $statusAt = ! empty($statusData['timestamp'])
            ? Carbon::createFromTimestamp((int) $statusData['timestamp'])
            : null;
        $currentStatus = $message->status;
        $successfulStatuses = ['sent' => 1, 'delivered' => 2, 'read' => 3];

        if ($statusAt && $message->provider_timestamp && $statusAt->lt($message->provider_timestamp)) {
            return;
        }

        if ($currentStatus === 'read' && $status !== 'read') {
            return;
        }

        if (
            isset($successfulStatuses[$currentStatus], $successfulStatuses[$status])
            && $successfulStatuses[$status] < $successfulStatuses[$currentStatus]
        ) {
            return;
        }

        if ($status === 'failed' && isset($successfulStatuses[$currentStatus]) && $currentStatus !== 'sent') {
            return;
        }

        $updates = ['status' => $status];

        if (! empty($statusData['errors'][0])) {
            $updates['error_code'] = $statusData['errors'][0]['code'] ?? null;
            $updates['error_title'] = $statusData['errors'][0]['title'] ?? null;
            $updates['error_details'] = $statusData['errors'][0]['message']
                ?? ($statusData['errors'][0]['error_data']['details'] ?? null);
        } elseif ($status !== 'failed') {
            $updates['error_code'] = null;
            $updates['error_title'] = null;
            $updates['error_details'] = null;
        }

        if ($statusAt) {
            $updates['provider_timestamp'] = $statusAt;
        }

        $message->update($updates);
        $this->syncBroadcastRecipient($message, $status, $updates);

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

    private function syncBroadcastRecipient(Message $message, string $status, array $updates): void
    {
        $recipient = BroadcastRecipient::where('message_id', $message->id)->first();
        if (! $recipient) {
            return;
        }

        $recipient->update([
            'status' => $status,
            'error' => $status === 'failed' ? ($updates['error_title'] ?? 'Delivery failed') : null,
            'provider_error' => $status === 'failed' ? [
                'code' => $updates['error_code'] ?? null,
                'title' => $updates['error_title'] ?? null,
                'details' => $updates['error_details'] ?? null,
            ] : null,
        ]);

        app(BroadcastService::class)->refreshCounters($recipient->broadcast);
    }
}
