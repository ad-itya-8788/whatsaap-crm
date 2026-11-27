<?php

namespace App\Http\Middleware;

use App\Auth\Access;
use App\Auth\PermissionRegistry;
use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

class AuthorizeCrm
{
    public function __construct(private Access $access) {}

    public function handle(Request $request, Closure $next, ?string $permission = null): Response
    {
        $user = $request->user();
        abort_unless($user, 401);

        $permission ??= PermissionRegistry::forAction($request->route()->getActionName());
        if ($permission === null || ! collect(explode('|', $permission))->contains(fn ($key) => $this->access->can($user, $key))) {
            abort_if($request->is('api/*'), 403);

            return Inertia::render('AccessDeniedPage')->toResponse($request)->setStatusCode(403);
        }

        return $next($request);
    }
}
