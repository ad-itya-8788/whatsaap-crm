<?php

namespace App\Services;

use App\Models\Message;
use App\Models\WhatsappConfig;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

class InboundMediaMirror
{
    private const MAX_BYTES = 16 * 1024 * 1024;

    public function __construct(private MetaCloudApiService $meta) {}

    public function store(Message $message, WhatsappConfig $config): void
    {
        $mediaId = (string) $message->media_url;
        if (! ctype_digit($mediaId)) {
            return;
        }

        try {
            $asset = $this->meta->downloadMessageMedia($config, $mediaId, $message->content_type, self::MAX_BYTES);
            if (! Storage::disk('local')->put($this->path($message), $asset['body'])) {
                Log::warning('whatsapp.inbound_media.storage_failed', ['message_id' => $message->id]);
            }
        } catch (Throwable) {
            Log::warning('whatsapp.inbound_media.mirror_failed', ['message_id' => $message->id]);
        }
    }

    public function read(Message $message): ?array
    {
        if ($message->sender_type !== 'customer') {
            return null;
        }

        $disk = Storage::disk('local');
        $path = $this->path($message);
        if (! $disk->exists($path)) {
            return null;
        }

        $body = $disk->get($path);
        if ($body === null) {
            return null;
        }

        return [
            'body' => $body,
            'mime_type' => $message->media_type ?: $disk->mimeType($path),
        ];
    }

    private function path(Message $message): string
    {
        return "whatsapp/inbound/{$message->id}";
    }
}
