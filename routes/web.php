<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function (Request $request) {
    $user = $request->user();
    $module = $user?->allowedModules()[0] ?? null;

    return redirect($user?->is_active ? (\App\Models\Role::MODULES[$module]['path'] ?? '/dashboard') : '/login');
});

Route::get('/login', function (Request $request) {
    if ($request->user()?->is_active && ! $request->boolean('reauth')) {
        return redirect('/');
    }

    return Inertia::render('LoginPage');
})->name('login');

Route::get('/session/user', [\App\Http\Controllers\Api\AuthController::class, 'user'])
    ->middleware(['auth', 'active']);

Route::inertia('/register', 'RegisterPage');
Route::inertia('/forgot-password', 'ForgotPasswordPage');
Route::inertia('/reset-password', 'ResetPasswordPage')->name('password.reset');

Route::get('/signup', function (Request $request) {
    $token = $request->query('invite');

    return is_string($token) && $token !== ''
        ? Inertia::render('InviteJoinPage', ['inviteToken' => $token])
        : redirect()->route('login');
});

Route::get('/join/{token}', fn (string $token) => Inertia::render('InviteJoinPage', [
    'inviteToken' => $token,
]));

Route::middleware(['auth', 'active'])->group(function () {
    Route::inertia('/dashboard', 'DashboardPage')->name('dashboard')->middleware('module:dashboard');
    Route::inertia('/inbox', 'ChatsPage')->middleware('module:inbox');
    Route::get('/chats', function (Request $request) {
        $query = array_filter([
            'filter' => $request->query('filter'),
            'c' => $request->query('c') ?: $request->query('conversation'),
        ], fn ($value) => is_string($value) && $value !== '');

        return redirect()->to('/inbox'.($query ? '?'.http_build_query($query, '', '&', PHP_QUERY_RFC3986) : ''));
    })->middleware('module:inbox');
    Route::inertia('/notifications', 'NotificationsPage')->middleware('module:notifications');
    Route::inertia('/broadcasts', 'BroadcastsPage')->middleware('module:broadcasts');
    Route::inertia('/broadcasts/new', 'BroadcastWizardPage')->middleware('module:broadcasts');
    Route::get('/broadcasts/{id}', fn (string $id) => Inertia::render('BroadcastDetailPage', ['id' => $id]))->middleware('module:broadcasts');
    Route::inertia('/agents', 'AgentsPage')->middleware('module:ai_agents');
    Route::inertia('/contacts', 'ContactsPage')->middleware('module:contacts');
    Route::inertia('/templates', 'TemplatesPage')->middleware('module:templates');
    Route::inertia('/templates/create', 'TemplatesPage')->middleware('module:templates');
    Route::get('/templates/{templateId}/edit', fn (string $templateId) => Inertia::render('TemplatesPage', [
        'templateId' => $templateId,
    ]))->middleware('module:templates');
    Route::inertia('/workspace', 'WorkspacePage')->middleware('module:workspace');
    Route::inertia('/reports', 'ReportsPage')->middleware('module:reports');
    Route::inertia('/team', 'TeamPage')->middleware('module:team');
    Route::inertia('/settings', 'SettingsPage')->middleware('module:settings');
});
