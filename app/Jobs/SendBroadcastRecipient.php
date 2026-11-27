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
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

class SendBroadcastRecipient implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $backoff = 30;

    public ?int $actorId = null;

    public string $permission = 'broadcasts.send';

    public function __construct(public int $recipientId, ?int $actorId = null, string $permission = 'broadcasts.send')
    {
        $this->actorId = $actorId;
        $this->permission = $permission;
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping('broadcast-recipient:'.$this->recipientId))->expireAfter(120)->dontRelease()];
    }

    public function handle(MessagingService $messaging, BroadcastService $broadcasts): void
    {
        $recipient = BroadcastRecipient::with(['broadcast.template', 'contact'])->find($this->recipientId);

        if (! $recipient || $recipient->status !== 'pending') {
            return;
        }

        $broadcast = $recipient->broadcast;
        $template = $broadcast?->template;
        $contact = $recipient->contact;

        if (! $broadcast || ! $template || ! $contact) {
            $recipient->update(['status' => 'failed', 'error' => 'Broadcast, template, or contact is no longer available.']);
            return;
        }

        if ($this->actorId !== null && ! app(\App\Auth\Access::class)->allowsFresh(
            \App\Models\User::find($this->actorId), $this->permission
        )) {
            $recipient->update(['status' => 'failed', 'error' => 'The requesting member no longer has permission for this broadcast.']);
            $broadcasts->refreshCounters($broadcast);

            return;
        }

        try {
            $broadcasts->assertApproved($broadcast);
            $variables = array_values($recipient->variables ?: []);

            $conversation = Conversation::firstOrCreate(
                ['contact_id' => $contact->id],
                ['user_id' => $broadcast->user_id, 'status' => 'open'],
            );

            $idempotencyKey = 'broadcast:'.$broadcast->id.':recipient:'.$recipient->id;
            if ($recipient->attempt_version) {
                $idempotencyKey .= ':attempt:'.$recipient->attempt_version;
            }
            $message = $messaging->send($conversation, [
                'content_type' => 'template',
                'template_name' => $template->name,
                'template_language' => $template->language,
                'template_params' => $variables,
                'idempotency_key' => $idempotencyKey,
            ], $broadcast->user_id);

            $recipient->update([
                'status' => in_array($message->status, ['sent', 'delivered', 'read'], true) ? $message->status : 'pending',
                'message_id' => $message->id,
                'sent_at' => $message->message_id ? now() : null,
                'error' => null,
                'provider_error' => null,
            ]);

            $broadcasts->refreshCounters($broadcast);
        } catch (MessagingException $exception) {
            $failed = $exception->failedMessage;

            $recipient->update([
                'status' => $failed?->status === 'pending' ? 'pending' : 'failed',
                'message_id' => $failed?->id,
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

}
