<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\QuickReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class QuickReplyController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $replies = QuickReply::query()
            ->where(fn ($q) => $q->where('is_global', true)->orWhere('user_id', $request->user()->id))
            ->orderBy('title')
            ->get();

        return response()->json($replies);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'body' => ['required', 'string', 'max:5000'],
            'is_global' => ['sometimes', 'boolean'],
        ]);

        $isGlobal = (bool) ($data['is_global'] ?? false);
        if ($isGlobal && ! $request->user()->isAdmin()) {
            return response()->json(['message' => 'Only administrators may create global quick replies.'], 403);
        }

        $reply = QuickReply::create([
            'user_id' => $request->user()->id,
            'title' => $data['title'],
            'body' => $data['body'],
            'is_global' => $isGlobal,
        ]);

        return response()->json($reply, 201);
    }

    public function update(Request $request, QuickReply $quickReply): JsonResponse
    {
        $this->authorizeQuickReply($request, $quickReply);

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'body' => ['sometimes', 'required', 'string', 'max:5000'],
            'is_global' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('is_global', $data) && $data['is_global'] && ! $request->user()->isAdmin()) {
            return response()->json(['message' => 'Only administrators may create global quick replies.'], 403);
        }

        $quickReply->update($data);

        return response()->json($quickReply);
    }

    public function destroy(Request $request, QuickReply $quickReply): Response
    {
        $this->authorizeQuickReply($request, $quickReply);
        $quickReply->delete();

        return response()->noContent();
    }

    private function authorizeQuickReply(Request $request, QuickReply $quickReply): void
    {
        if ((int) $quickReply->user_id !== (int) $request->user()->id && ! $request->user()->isAdmin()) {
            abort(403, 'You may only manage your own quick replies.');
        }
    }
}
