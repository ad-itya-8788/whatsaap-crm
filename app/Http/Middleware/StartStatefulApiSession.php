<?php

namespace App\Http\Middleware;

use Illuminate\Support\Facades\Auth;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

class StartStatefulApiSession extends EnsureFrontendRequestsAreStateful
{
    public static function fromFrontend($request)
    {
        if ($request->headers->get('referer') || $request->headers->get('origin')) {
            return parent::fromFrontend($request);
        }

        return $request->headers->get('Sec-Fetch-Site') === 'same-origin';
    }

    public function handle($request, $next)
    {
        $requiresAuth = in_array('auth:sanctum', $request->route()?->gatherMiddleware() ?? [], true);

        if ($requiresAuth
            && ! $request->bearerToken()
            && ! $request->cookies->has(config('session.cookie'))
            && ! $request->cookies->has(Auth::guard('web')->getRecallerName())) {
            // Let the authentication middleware reject requests without credentials
            // before Sanctum opens or creates a session in the database.
            return $next($request);
        }

        return parent::handle($request, $next);
    }
}
