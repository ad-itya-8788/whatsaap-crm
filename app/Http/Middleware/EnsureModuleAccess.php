<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

class EnsureModuleAccess
{
    public function handle(Request $request, Closure $next, string ...$modules): Response
    {
        $user = $request->user();
        abort_unless($user, 401);

        foreach ($modules as $module) {
            if ($user->hasModuleAccess($module)) {
                return $next($request);
            }
        }

        abort_if($request->is('api/*'), 403);

        return Inertia::render('AccessDeniedPage')->toResponse($request)->setStatusCode(403);
    }
}
