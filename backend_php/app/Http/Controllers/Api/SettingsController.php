<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class SettingsController extends Controller
{
    public function profile(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($request->user()->id)],
            'avatar' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp,gif', 'max:2048'],
            'remove_avatar' => ['nullable', 'boolean'],
        ]);

        $user = $request->user();

        if ($request->boolean('remove_avatar') && $user->avatar_url) {
            Storage::disk('public')->delete($user->avatar_url);
            $data['avatar_url'] = null;
        }

        if ($request->hasFile('avatar')) {
            if ($user->avatar_url) {
                Storage::disk('public')->delete($user->avatar_url);
            }
            $data['avatar_url'] = $request->file('avatar')->store('avatars', 'public');
        }

        $user->update($data);

        return response()->json(['user' => $this->userPayload($user->fresh())]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        $user = $request->user();
        if (! Hash::check($data['current_password'], $user->password)) {
            return response()->json(['message' => 'The current password is incorrect.'], 422);
        }

        $user->update(['password' => Hash::make($data['password'])]);
        $this->destroyOtherSessions($request);

        return response()->json(['ok' => true]);
    }

    public function sessions(Request $request): JsonResponse
    {
        $currentId = $request->session()->getId();

        return response()->json([
            'sessions' => DB::table('sessions')
                ->where('user_id', $request->user()->id)
                ->get()
                ->map(fn ($session) => [
                    'id' => $session->id,
                    'current' => $session->id === $currentId,
                    'ip_address' => $session->ip_address,
                    'user_agent' => $session->user_agent,
                    'last_activity' => $session->last_activity,
                ]),
        ]);
    }

    public function destroySessions(Request $request): JsonResponse
    {
        $deleted = $this->destroyOtherSessions($request);

        return response()->json(['deleted' => $deleted]);
    }

    public function inboxSettings(): JsonResponse
    {
        $raw = DB::table('crm_settings')->where('key', 'reply_target_minutes')->value('value');
        $decoded = is_string($raw) ? json_decode($raw, true) : null;

        return response()->json([
            'reply_target_minutes' => is_numeric($decoded) ? (int) $decoded : 5,
        ]);
    }

    public function updateInboxSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'reply_target_minutes' => ['required', 'integer', 'min:1', 'max:1440'],
        ]);

        DB::table('crm_settings')->updateOrInsert(
            ['key' => 'reply_target_minutes'],
            ['value' => json_encode((int) $data['reply_target_minutes']), 'updated_at' => now()]
        );

        return response()->json(['reply_target_minutes' => (int) $data['reply_target_minutes']]);
    }

    private function destroyOtherSessions(Request $request): int
    {
        return DB::table('sessions')
            ->where('user_id', $request->user()->id)
            ->where('id', '!=', $request->session()->getId())
            ->delete();
    }

    private function userPayload($user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'full_name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'avatar_url' => $user->avatar_url,
        ];
    }
}
