<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AccountInvitation;
use App\Models\User;
use App\Support\SessionUser;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class InvitationController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(AccountInvitation::query()->pending()->latest('id')->paginate(15));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'role' => ['required', Rule::in(['admin', 'agent', 'viewer'])],
            'label' => ['nullable', 'string', 'max:80'],
            'expiresInDays' => ['sometimes', 'integer', 'min:1', 'max:365'],
        ]);

        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $days = $data['expiresInDays'] ?? 7;
        $invitation = AccountInvitation::create([
            'role' => $data['role'],
            'label' => $data['label'] ?? null,
            'expires_at' => now()->addDays($days),
            'created_by' => $request->user()->id,
            'token_hash' => hash('sha256', $token),
        ]);

        return response()->json([
            'invitation' => $invitation,
            'path' => '/join/'.$token,
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function destroy(AccountInvitation $invitation): Response
    {
        abort_unless(AccountInvitation::query()->pending()->whereKey($invitation->id)->delete(), 404);

        return response()->noContent();
    }

    public function peek(string $token): JsonResponse
    {
        $invitation = AccountInvitation::query()->pending()
            ->where('token_hash', hash('sha256', $token))
            ->first(['role', 'expires_at']);
        abort_unless($invitation, 404, 'This invitation has expired, was revoked, or has already been used.');

        return response()->json($invitation)->header('Cache-Control', 'no-store');
    }

    public function redeem(Request $request, string $token): JsonResponse
    {
        abort_unless($request->hasSession(), 419, 'Open this invitation in the CRM to continue.');
        abort_if(Auth::guard('web')->check(), 409, 'Sign out before accepting an invitation.');
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        try {
            $user = DB::transaction(function () use ($data, $token) {
                $invitation = AccountInvitation::query()->pending()
                    ->where('token_hash', hash('sha256', $token))
                    ->lockForUpdate()->first();
                abort_unless($invitation && $invitation->expires_at->isFuture(), 404, 'This invitation has expired, was revoked, or has already been used.');

                $email = strtolower($data['email']);
                if (User::query()->where('email', $email)->exists()) {
                    throw ValidationException::withMessages(['email' => 'This email address already belongs to a team member.']);
                }
                $user = User::create([
                    'name' => $data['name'],
                    'email' => $email,
                    'password' => Hash::make($data['password']),
                    'role' => $invitation->role,
                    'is_active' => true,
                ]);
                $invitation->update(['accepted_by' => $user->id, 'accepted_at' => now()]);

                return $user;
            }, 3);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['email' => 'This email address already belongs to a team member.']);
        }

        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return response()->json(['user' => SessionUser::payload($user)], 201);
    }
}
