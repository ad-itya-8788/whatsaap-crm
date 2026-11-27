<?php

namespace App\Http\Middleware;

use App\Models\Conversation;
use App\Models\Message;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureConversationAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || $user->isOwner()) {
            return $next($request);
        }

        $message = $request->route('message');
        $conversation = $request->route('conversation') ?? ($message instanceof Message ? $message->conversation : null);
        $assignedAgentId = $conversation instanceof Conversation
            ? $conversation->assigned_agent_id
            : Conversation::query()->whereKey($conversation)->value('assigned_agent_id');

        if (! $assignedAgentId || (int) $assignedAgentId !== (int) $user->id) {
            abort(404);
        }

        return $next($request);
    }
}
