<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\QuickReply;
use App\Support\InteractiveMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

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
        $data = $this->replyData($request);
        if (! $request->has('kind') && ($data['is_global'] ?? false)) {
            abort_unless($request->user()->hasModuleAccess('workspace'), 403);
        }

        if (! $request->user()->hasModuleAccess('workspace')) unset($data['is_global']);

        $reply = QuickReply::create($data + [
            'user_id' => $request->user()->id,
            'is_global' => $request->user()->hasModuleAccess('workspace') && $request->has('kind'),
        ]);

        return response()->json($reply, 201);
    }

    public function update(Request $request, QuickReply $quickReply): JsonResponse
    {
        $this->authorizeQuickReply($request, $quickReply);
        $quickReply->update($this->replyData($request, $quickReply));

        return response()->json($quickReply);
    }

    public function destroy(Request $request, QuickReply $quickReply): Response
    {
        $this->authorizeQuickReply($request, $quickReply);
        $quickReply->delete();

        return response()->noContent();
    }

    private function replyData(Request $request, ?QuickReply $reply = null): array
    {
        $data = $request->validate([
            'title' => $reply ? ['sometimes', 'required', 'string', 'max:255'] : ['required', 'string', 'max:255'],
            'body' => ['sometimes', 'required', 'string', 'max:5000'],
            'kind' => ['sometimes', 'required', 'in:text,interactive'],
            'interactive_payload' => ['sometimes', 'nullable', 'array'],
            'is_global' => ['sometimes', 'boolean'],
        ]);
        $kind = $data['kind'] ?? $reply?->kind ?? 'text';
        $data['kind'] = $kind;

        if ($kind === 'interactive') {
            $payload = array_key_exists('interactive_payload', $data)
                ? $data['interactive_payload']
                : $reply?->interactive_payload;
            $data['interactive_payload'] = InteractiveMessage::validate($payload)->validate()['interactive_payload'];
            $data['body'] = $data['interactive_payload']['body'];
        } else {
            $body = $data['body'] ?? ($reply?->kind === 'text' ? $reply->body : null);
            if (! is_string($body) || trim($body) === '') {
                throw ValidationException::withMessages(['body' => 'A text reply needs a message.']);
            }
            $data['body'] = $body;
            $data['interactive_payload'] = null;
        }

        return $data;
    }

    private function authorizeQuickReply(Request $request, QuickReply $quickReply): void
    {
        abort_unless(
            $quickReply->is_global
                || (int) $quickReply->user_id === (int) $request->user()->id
                || $request->user()->isOwner(),
            403,
            'You may only manage your own private quick replies.',
        );
    }
}
