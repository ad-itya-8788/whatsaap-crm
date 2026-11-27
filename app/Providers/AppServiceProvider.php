<?php

namespace App\Providers;

use App\Models\Conversation;
use App\Models\Message;
use App\Services\OutboundWebhookEvents;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->scoped(\App\Auth\Access::class);
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $webhooks = app(OutboundWebhookEvents::class);
        Conversation::created($webhooks->conversationCreated(...));
        Message::created($webhooks->messageCreated(...));
        Message::updated($webhooks->messageUpdated(...));

        ResetPassword::createUrlUsing(function ($user, string $token): string {
            return route('password.reset', ['token' => $token, 'email' => $user->email]);
        });

        RateLimiter::for('login', function (Request $request) {
            return Limit::perMinute(5)->by(
                $request->ip().'|'.strtolower((string) $request->input('email'))
            );
        });

        RateLimiter::for('password-reset', function (Request $request) {
            return Limit::perMinute(3)->by($request->ip());
        });

        RateLimiter::for('send', function (Request $request) {
            return Limit::perMinute(30)->by(
                $request->user()?->id ?: $request->ip()
            );
        });

        RateLimiter::for('webhook', function (Request $request) {
            return Limit::perMinute(120)->by($request->ip());
        });

        RateLimiter::for('ai', function (Request $request) {
            return Limit::perMinute(20)->by(
                $request->user()?->id ?: $request->ip()
            );
        });
    }
}
