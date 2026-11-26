<?php

namespace App\Http\Middleware;

use App\Support\SessionUser;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'auth' => fn () => [
                'user' => $request->user()?->is_active ? SessionUser::payload($request->user()) : null,
            ],
        ];
    }
}
