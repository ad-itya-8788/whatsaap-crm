<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ConversationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 50), 1), 100);
        $query = Conversation::with('contact');

        if ($search = $request->string('search')->toString()) {
            $query->whereHas('contact', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('phone_normalized', 'like', "%{$search}%");
            });
        }

        return response()->json(
            $query->orderByDesc('last_message_at')->orderByDesc('updated_at')->paginate($perPage)
        );
    }

    public function show(Conversation $conversation): JsonResponse
    {
        return response()->json($conversation->load('contact'));
    }

    public function markRead(Conversation $conversation): JsonResponse
    {
        $conversation->update(['unread_count' => 0]);

        return response()->json(['ok' => true]);
    }

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['contact_id' => ['required', 'integer', 'exists:contacts,id']]);

        $conversation = Conversation::firstOrCreate(
            ['contact_id' => $data['contact_id']],
            ['user_id' => $request->user()->id, 'status' => 'open'],
        );

        return response()->json($conversation->load('contact'));
    }
}
