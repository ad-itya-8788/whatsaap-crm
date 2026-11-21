<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MetaApiException;
use App\Exceptions\MessagingException;
use App\Http\Controllers\Controller;
use App\Http\Requests\SendMessageRequest;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\WhatsappConfig;
use App\Services\MessagingService;
use App\Services\MetaCloudApiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class MessageController extends Controller
{
    public function __construct(private MessagingService $messaging) {}

    public function index(Request $request, Conversation $conversation): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 50), 1), 100);

        return response()->json(
            $conversation->messages()->orderByDesc('id')->cursorPaginate($perPage)
        );
    }

    public function store(SendMessageRequest $request, Conversation $conversation): JsonResponse
    {
        try {
            $message = $this->messaging->send($conversation, $request->validated(), $request->user()->id);
        } catch (MessagingException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'data' => $e->failedMessage,
            ], $e->status);
        }

        return response()->json($message, $message->wasRecentlyCreated ? 201 : 200);
    }

    public function media(Message $message, MetaCloudApiService $meta): Response|JsonResponse
    {
        $mediaId = (string) $message->media_url;
        if ($mediaId === '' || ! ctype_digit($mediaId)) {
            return response()->json(['message' => 'Attachment not found.'], 404);
        }

        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config || ! $config->access_token) {
            return response()->json(['message' => 'WhatsApp is not configured.'], 422);
        }

        $type = match (true) {
            str_starts_with((string) $message->media_type, 'image/') => 'image',
            str_starts_with((string) $message->media_type, 'video/') => 'video',
            str_starts_with((string) $message->media_type, 'audio/') => 'audio',
            in_array($message->content_type, ['image', 'video', 'audio', 'document'], true) => $message->content_type,
            default => 'document',
        };

        try {
            $asset = $meta->downloadMessageMedia($config, $mediaId, $type);
        } catch (MetaApiException $e) {
            return response()->json(['message' => $e->getMessage()], min(max($e->httpStatus, 400), 599));
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $filename = basename($message->filename ?: 'whatsapp-attachment');
        $filename = preg_replace('/[\r\n"\\\\]/', '_', $filename);
        $disposition = in_array($type, ['image', 'video', 'audio'], true) ? 'inline' : 'attachment';

        return response($asset['body'])
            ->header('Content-Type', $asset['mime_type'] ?: 'application/octet-stream')
            ->header('Content-Disposition', $disposition.'; filename="'.$filename.'"')
            ->header('Cache-Control', 'private, no-store')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
