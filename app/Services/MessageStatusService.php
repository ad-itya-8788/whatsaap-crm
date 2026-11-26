<?php

namespace App\Services;

use App\Models\BroadcastRecipient;
use App\Models\Message;
use App\Models\PendingMessageStatus;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class MessageStatusService
{
    private const STATUSES = ['sent', 'delivered', 'read', 'failed'];

    public function __construct(private RealtimeBroadcaster $realtime) {}

    public function apply(Message $message, array $statusData): void
    {
        $status = $statusData['status'] ?? null;
        if (! in_array($status, self::STATUSES, true)) {
            return;
        }

        $statusAt = ! empty($statusData['timestamp'])
            ? Carbon::createFromTimestamp((int) $statusData['timestamp'])
            : null;
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

        $changed = DB::transaction(function () use ($message, $updates, $status, $statusAt) {
            $current = Message::query()->lockForUpdate()->find($message->id);
            if (! $current || $current->sender_type === 'customer') {
                return null;
            }

            $rank = ['sent' => 1, 'failed' => 2, 'delivered' => 3, 'read' => 4];
            $currentRank = $rank[$current->status] ?? 0;
            $newRank = $rank[$status];
            $older = $statusAt && $current->provider_timestamp && $statusAt->lt($current->provider_timestamp);
            if ($newRank < $currentRank || ($older && $newRank <= $currentRank)) {
                return null;
            }

            $current->fill($updates);
            if (! $current->isDirty()) {
                return null;
            }

            $current->save();
            $this->syncBroadcastRecipient($current, $status, $updates);

            return $current;
        });

        if ($changed) {
            $this->realtime->messageStatusChanged($changed);
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
                'error_details' => $statusData['errors'][0]['message']
                    ?? ($statusData['errors'][0]['error_data']['details'] ?? null),
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
            PendingMessageStatus::whereKey($item->id)->where('status_at', $item->status_at)->delete();
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
