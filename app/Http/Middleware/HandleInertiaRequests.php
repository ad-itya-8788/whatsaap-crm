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
            'branding' => fn () => [
                'name' => config('branding.name'),
                'product' => config('branding.product'),
                'tagline' => config('branding.tagline'),
                'logo' => config('branding.logo'),
                'logoVertical' => config('branding.logo_vertical'),
                'icon' => config('branding.icon'),
                'developer' => config('branding.developer'),
                'colors' => config('branding.colors'),
            ],
            'seo' => fn () => [
                'title' => config('branding.seo.title'),
                'description' => config('branding.seo.description'),
                'canonical' => rtrim((string) config('app.url'), '/').'/'.ltrim($request->path(), '/'),
                'robots' => in_array(trim($request->path(), '/'), config('branding.seo.indexable_paths', []), true)
                    ? 'index, follow, max-image-preview:large'
                    : 'noindex, nofollow, noarchive, nosnippet',
            ],
            'auth' => fn () => [
                'user' => $request->user()?->is_active ? SessionUser::payload($request->user()) : null,
            ],
            'realtime' => fn () => [
                'enabled' => config('broadcasting.default') === 'reverb'
                    && filled(config('broadcasting.connections.reverb.key'))
                    && filled(config('broadcasting.connections.reverb.secret')),
                'key' => config('broadcasting.connections.reverb.key'),
                'host' => in_array(config('broadcasting.connections.reverb.options.host'), ['localhost', '127.0.0.1'], true)
                    ? $request->getHost()
                    : config('broadcasting.connections.reverb.options.host'),
                'port' => (int) config('broadcasting.connections.reverb.options.port'),
                'scheme' => config('broadcasting.connections.reverb.options.scheme'),
            ],
        ];
    }
}
