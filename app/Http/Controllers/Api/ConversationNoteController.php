<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\ConversationNote;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ConversationNoteController extends Controller
{
    public function index(Conversation $conversation): JsonResponse
    {
        return response()->json(
            $conversation->notes()->with('user')->latest()->limit(50)->get()
        );
    }

    public function store(Request $request, Conversation $conversation): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:5000'],
        ]);

        $note = $conversation->notes()->create([
            'user_id' => $request->user()->id,
            'body' => $data['body'],
        ]);

        return response()->json($note->load('user'), 201);
    }

    public function destroy(Request $request, Conversation $conversation, ConversationNote $note): Response
    {
        if ((int) $note->conversation_id !== (int) $conversation->id) {
            abort(404);
        }

        if ((int) $note->user_id !== (int) $request->user()->id && ! $request->user()->isOwner()) {
            abort(403, 'Only the author or an administrator may delete this note.');
        }

        $note->delete();

        return response()->noContent();
    }
}
