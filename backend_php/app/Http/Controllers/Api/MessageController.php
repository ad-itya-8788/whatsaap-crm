<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MessagingException;
use App\Http\Controllers\Controller;
use App\Http\Requests\SendMessageRequest;
use App\Models\Conversation;
use App\Services\MessagingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    public function __construct(private MessagingService $messaging) {}

    public function index(Request $request, Conversation $conversation): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 50), 1), 100);

        return response()->json(
            $conversation->messages()->orderBy('id')->paginate($perPage)
        );
    }

    public function store(SendMessageRequest $request, Conversation $conversation): JsonResponse
    {
        try {
            $message = $this->messaging->send(
                $conversation,
                array_merge($request->validated(), ['content_type' => 'text']),
                $request->user()->id,
            );
        } catch (MessagingException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'data' => $e->failedMessage,
            ], $e->status);
        }

        return response()->json($message, 201);
    }
}
