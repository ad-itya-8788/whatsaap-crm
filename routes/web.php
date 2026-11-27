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
    Route::inertia('/dashboard', 'DashboardPage')->name('dashboard')->middleware('rbac:dashboard.view');
    Route::inertia('/inbox', 'ChatsPage')->middleware('rbac:inbox.view');
    Route::get('/chats', function (Request $request) {
        $query = array_filter([
            'filter' => $request->query('filter'),
            'c' => $request->query('c') ?: $request->query('conversation'),
        ], fn ($value) => is_string($value) && $value !== '');

        return redirect()->to('/inbox'.($query ? '?'.http_build_query($query, '', '&', PHP_QUERY_RFC3986) : ''));
    })->middleware('rbac:inbox.view');
    Route::inertia('/notifications', 'NotificationsPage')->middleware('rbac:notifications.view');
    Route::inertia('/broadcasts', 'BroadcastsPage')->middleware('rbac:broadcasts.view');
    Route::inertia('/broadcasts/new', 'BroadcastWizardPage')->middleware('rbac:broadcasts.create');
    Route::get('/broadcasts/{id}', fn (string $id) => Inertia::render('BroadcastDetailPage', ['id' => $id]))->middleware('rbac:broadcasts.recipients');
    Route::inertia('/agents', 'AgentsPage')->middleware('rbac:ai.view');
    Route::inertia('/contacts', 'ContactsPage')->middleware('rbac:contacts.view');
    Route::inertia('/templates', 'TemplatesPage')->middleware('rbac:templates.view');
    Route::inertia('/templates/create', 'TemplatesPage')->middleware('rbac:templates.create');
    Route::get('/templates/{templateId}/edit', fn (string $templateId) => Inertia::render('TemplatesPage', [
        'templateId' => $templateId,
    ]))->middleware('rbac:templates.update');
    Route::inertia('/workspace', 'WorkspacePage')->middleware('rbac:tags.view|custom_fields.view|quick_replies.view');
    Route::inertia('/reports', 'ReportsPage')->middleware('rbac:reports.view');
    Route::inertia('/access', 'AuthorizationPage')->middleware('rbac:roles.manage');
    Route::inertia('/team', 'TeamPage')->middleware('rbac:users.view');
    Route::inertia('/settings', 'SettingsPage')->middleware('rbac:account.profile|account.password|account.sessions|inbox_settings.view|whatsapp.view|api_keys.view|tags.view|custom_fields.view');
});
