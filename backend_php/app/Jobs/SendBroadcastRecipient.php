<?php

namespace App\Jobs;

use App\Exceptions\MessagingException;
use App\Models\BroadcastRecipient;
use App\Models\Conversation;
use App\Services\BroadcastService;
use App\Services\MessagingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

class SendBroadcastRecipient implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $backoff = 30;

    public function __construct(public int $recipientId) {}

    public function handle(MessagingService $messaging, BroadcastService $broadcasts): void
    {
        $recipient = BroadcastRecipient::with(['broadcast.template', 'contact'])->find($this->recipientId);

        if (! $recipient || ! in_array($recipient->status, ['pending', 'failed'], true)) {
            return;
        }

        $broadcast = $recipient->broadcast;
        $template = $broadcast?->template;
        $contact = $recipient->contact;

        if (! $broadcast || ! $template || ! $contact) {
            $recipient->update(['status' => 'failed', 'error' => 'Broadcast, template, or contact is no longer available.']);
            return;
        }

        try {
            $broadcasts->assertApproved($broadcast);
            $variables = array_values($recipient->variables ?: []);

            $conversation = Conversation::firstOrCreate(
                ['contact_id' => $contact->id],
                ['user_id' => $broadcast->user_id, 'status' => 'open'],
            );

            $message = $messaging->send($conversation, [
                'content_type' => 'template',
                'content_text' => $this->renderBody($template->body_text, $recipient->variables ?: []),
                'template_name' => $template->name,
                'template_language' => $template->language,
                'template_params' => $variables,
                'idempotency_key' => 'broadcast:'.$broadcast->id.':recipient:'.$recipient->id,
            ], $broadcast->user_id);

            $recipient->update([
                'status' => 'sent',
                'message_id' => $message->id,
                'sent_at' => now(),
                'error' => null,
                'provider_error' => null,
            ]);

            $broadcasts->refreshCounters($broadcast);
        } catch (MessagingException $exception) {
            $failed = $exception->failedMessage;

            $recipient->update([
                'status' => 'failed',
                'error' => $exception->getMessage(),
                'provider_error' => $failed ? [
                    'code' => $failed->error_code,
                    'title' => $failed->error_title,
                    'details' => $failed->error_details,
                ] : null,
            ]);

            $broadcasts->refreshCounters($broadcast);
        } catch (Throwable $exception) {
            Log::error('broadcast.recipient.failed', [
                'broadcast_id' => $broadcast->id,
                'recipient_id' => $recipient->id,
                'error' => $exception->getMessage(),
            ]);

            $recipient->update(['status' => 'failed', 'error' => 'Unexpected error while sending.']);
            $broadcasts->refreshCounters($broadcast);
        }
    }

    private function renderBody(string $body, array $variables): string
    {
        return preg_replace_callback('/\{\{(\d+)\}\}/', function (array $matches) use ($variables): string {
            return array_key_exists($matches[1], $variables) ? (string) $variables[$matches[1]] : $matches[0];
        }, $body) ?: $body;
    }
}
