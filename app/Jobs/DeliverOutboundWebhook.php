<?php

namespace App\Jobs;

use App\Models\WebhookEndpoint;
use App\Services\OutboundWebhookTarget;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

class DeliverOutboundWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public int $endpointId, public array $event) {}

    public function handle(OutboundWebhookTarget $target): void
    {
        $endpoint = WebhookEndpoint::find($this->endpointId);
        if (! $endpoint?->is_active || ! in_array($this->event['event'], $endpoint->events ?? [], true)) {
            return;
        }

        $success = false;
        try {
            $curl = $target->resolve($endpoint->url);
            if ($curl !== null && $endpoint->secret) {
                $body = json_encode($this->event, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $timestamp = now()->timestamp;
                $signature = hash_hmac('sha256', $timestamp.'.'.$body, $endpoint->secret);
                $success = Http::connectTimeout(2)->timeout(5)
                    ->withOptions(['allow_redirects' => false, 'proxy' => '', 'curl' => $curl])
                    ->withHeaders([
                        'X-Wacrm-Event' => $this->event['event'],
                        'X-Wacrm-Webhook-Id' => $this->event['id'],
                        'X-Wacrm-Signature' => 't='.$timestamp.',v1='.$signature,
                    ])->withBody($body, 'application/json')->post($endpoint->url)->successful();
            }
        } catch (Throwable) {
            // Delivery is best-effort. Count failures without logging the signing secret or payload.
        }

        DB::transaction(function () use ($endpoint, $success) {
            $current = WebhookEndpoint::query()->lockForUpdate()->find($endpoint->id);
            if (! $current?->is_active || $current->url !== $endpoint->url) {
                return;
            }
            if ($success) {
                $current->last_delivery_at = now();
                $current->failure_count = 0;
            } else {
                $current->failure_count++;
                $current->is_active = $current->failure_count < 10;
            }
            $current->save();
        });
    }
}
