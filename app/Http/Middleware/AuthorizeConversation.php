<?php

namespace App\Http\Middleware;

use App\Auth\Access;
use App\Models\Conversation;
use App\Models\Message;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthorizeConversation
{
    public function __construct(private Access $access) {}

    public function handle(Request $request, Closure $next): Response
    {
        foreach ($request->route()->parameters() as $value) {
            $conversation = $value instanceof Message ? $value->conversation : $value;
            if ($conversation instanceof Conversation) {
                $this->access->authorizeConversation($request->user(), $conversation);
            }
        }

        return $next($request);
    }
}
