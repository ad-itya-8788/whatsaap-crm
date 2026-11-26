<?php

use App\Http\Middleware\EnsureActiveUser;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\StartStatefulApiSession;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->statefulApi();
        $middleware->api(replace: [EnsureFrontendRequestsAreStateful::class => StartStatefulApiSession::class]);
        $middleware->web(append: [HandleInertiaRequests::class]);
        $middleware->prependToPriorityList(
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
            \App\Http\Middleware\AuthenticateApiKey::class,
        );
        $middleware->prependToPriorityList(
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
            EnsureActiveUser::class,
        );
        $middleware->prependToPriorityList(
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
            EnsureRole::class,
        );
        $middleware->alias([
            'active' => EnsureActiveUser::class,
            'role' => EnsureRole::class,
        ]);
    })
    ->withSchedule(function (Schedule $schedule) {
            $schedule->command('broadcasts:dispatch-scheduled')
                ->everyMinute()
                ->withoutOverlapping();
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());
        $exceptions->render(function (ValidationException $error, Request $request) {
            if ($request->is('api/v1/*')) {
                return response()->json(['error' => [
                    'code' => 'bad_request', 'message' => $error->getMessage(), 'fields' => $error->errors(),
                ]], 400);
            }
        });
        $exceptions->render(function (HttpExceptionInterface $error, Request $request) {
            if ($request->is('api/v1/*') && $error->getStatusCode() === 404) {
                return response()->json(['error' => ['code' => 'not_found', 'message' => 'The requested resource was not found.']], 404);
            }
        });
    })->create();
