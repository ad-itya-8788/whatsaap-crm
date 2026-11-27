<?php

namespace App\Http\Middleware;

use App\Models\Conversation;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureConversationAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || $user->isAdmin()) {
            return $next($request);
        }

        $conversation = $request->route('conversation');
        $assignedAgentId = $conversation instanceof Conversation
            ? $conversation->assigned_agent_id
            : Conversation::query()->whereKey($conversation)->value('assigned_agent_id');

        if (! $assignedAgentId || (int) $assignedAgentId !== (int) $user->id) {
            abort(404);
        }

        return $next($request);
    }
}
