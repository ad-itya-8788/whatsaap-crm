<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::redirect('/', '/dashboard');

Route::get('/login', function (Request $request) {
    if ($request->user()?->is_active) {
        return redirect()->route('dashboard');
    }

    return Inertia::render('LoginPage');
})->name('login');

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
    Route::inertia('/dashboard', 'DashboardPage')->name('dashboard');
    Route::inertia('/inbox', 'ChatsPage');
    Route::get('/chats', function (Request $request) {
        $query = array_filter([
            'filter' => $request->query('filter'),
            'c' => $request->query('c') ?: $request->query('conversation'),
        ], fn ($value) => is_string($value) && $value !== '');

        return redirect()->to('/inbox'.($query ? '?'.http_build_query($query, '', '&', PHP_QUERY_RFC3986) : ''));
    });
    Route::inertia('/notifications', 'NotificationsPage');
    Route::inertia('/broadcasts', 'BroadcastsPage');
    Route::inertia('/broadcasts/new', 'BroadcastWizardPage');
    Route::get('/broadcasts/{id}', fn (string $id) => Inertia::render('BroadcastDetailPage', ['id' => $id]));
    Route::inertia('/agents', 'AgentsPage');
    Route::inertia('/contacts', 'ContactsPage');
    Route::inertia('/templates', 'TemplatesPage');
    Route::inertia('/templates/create', 'TemplatesPage');
    Route::get('/templates/{templateId}/edit', fn (string $templateId) => Inertia::render('TemplatesPage', [
        'templateId' => $templateId,
    ]));
    Route::inertia('/workspace', 'WorkspacePage');
    Route::inertia('/reports', 'ReportsPage');
    Route::inertia('/team', 'TeamPage');
    Route::inertia('/settings', 'SettingsPage');
});
