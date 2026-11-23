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
        $search = $request->string('search')->toString();

        $query = $conversation->messages()
            ->with([
                'replyTo:id,content_text,sender_type,content_type,filename',
                'template:name,body_text',
            ])
            ->orderByDesc('id');

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('content_text', 'like', "%{$search}%")
                    ->orWhere('filename', 'like', "%{$search}%")
                    ->orWhere('template_name', 'like', "%{$search}%");
            });
        }

        return response()->json($query->cursorPaginate($perPage));
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
        $mimeType = $asset['mime_type'] ?: 'application/octet-stream';
        $previewable = in_array($type, ['image', 'video', 'audio'], true)
            || $mimeType === 'application/pdf'
            || str_starts_with($mimeType, 'text/');
        $disposition = $previewable ? 'inline' : 'attachment';

        return response($asset['body'])
            ->header('Content-Type', $mimeType)
            ->header('Content-Disposition', $disposition.'; filename="'.$filename.'"')
            ->header('Cache-Control', 'private, no-store')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
