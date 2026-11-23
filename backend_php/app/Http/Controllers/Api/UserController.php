<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password as PasswordRule;

class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 25), 1), 100);
        $query = User::query();

        if ($search = $request->string('search')->toString()) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return response()->json($query->orderBy('id')->paginate($perPage));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', PasswordRule::defaults()],
            'role' => ['required', Rule::in(['owner', 'admin', 'agent'])],
        ]);

        if ($request->user()->role !== 'owner' && $data['role'] !== 'agent') {
            return response()->json([
                'message' => 'Only the owner may create administrators or owners.',
            ], 403);
        }

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
            'role' => $data['role'],
            'is_active' => true,
        ]);

        return response()->json($user, 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'role' => ['sometimes', 'required', Rule::in(['owner', 'admin', 'agent'])],
            'password' => ['sometimes', 'required', 'confirmed', PasswordRule::defaults()],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $actor = $request->user();
        $targetRole = $data['role'] ?? $user->role;

        if ($actor->role !== 'owner' && $targetRole !== 'agent') {
            return response()->json([
                'message' => 'Only the owner may assign or manage administrators and owners.',
            ], 403);
        }

        if ((int) $user->id === (int) $actor->id) {
            if (array_key_exists('role', $data) && $targetRole !== $user->role) {
                return response()->json(['message' => 'You cannot change your own role.'], 403);
            }
            if (array_key_exists('is_active', $data) && ! $data['is_active']) {
                return response()->json(['message' => 'You cannot deactivate your own account.'], 403);
            }
        }

        $demotingOwner = $user->role === 'owner' && $targetRole !== 'owner';
        $deactivatingOwner = $user->role === 'owner'
            && array_key_exists('is_active', $data)
            && ! $data['is_active'];

        if (($demotingOwner || $deactivatingOwner)
            && User::query()->where('role', 'owner')->where('is_active', true)->count() <= 1
        ) {
            return response()->json(['message' => 'The last remaining owner cannot be demoted or deactivated.'], 403);
        }

        if (array_key_exists('password', $data)) {
            $data['password'] = Hash::make($data['password']);
        }

        $user->update($data);

        return response()->json($user);
    }
}
