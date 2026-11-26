<?php

namespace App\Http\Middleware;

use App\Models\ApiKey;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateApiKey
{
    public function handle(Request $request, Closure $next, ?string $scope = null): Response
    {
        $token = $request->bearerToken() ?? '';
        $key = preg_match('/\Awacrm_live_[a-f0-9]{64}\z/', $token)
            ? ApiKey::query()->where('key_hash', hash('sha256', $token))->first()
            : null;

        if (! $key || $key->revoked_at || $key->expires_at?->isPast()) {
            return response()->json(['error' => ['code' => 'unauthorized', 'message' => 'A valid API key is required.']], 401);
        }

        $limitKey = 'crm-api:'.$key->id;
        if (RateLimiter::tooManyAttempts($limitKey, 120)) {
            return response()->json(['error' => ['code' => 'rate_limited', 'message' => 'This key exceeded its request limit.']], 429)
                ->header('Retry-After', (string) RateLimiter::availableIn($limitKey));
        }
        RateLimiter::hit($limitKey, 60);

        if ($scope && ! in_array($scope, $key->scopes ?? [], true)) {
            return response()->json(['error' => ['code' => 'forbidden', 'message' => "This API key is missing the '$scope' scope."]], 403);
        }

        if (! $key->last_used_at || $key->last_used_at->lt(now()->subMinute())) {
            $key->forceFill(['last_used_at' => now()])->save();
        }
        $request->attributes->set(ApiKey::class, $key);

        return $next($request);
    }
}
