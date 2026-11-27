<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password as PasswordRule;

class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 25), 1), 100);
        $query = User::with('assignedRole:id,name,slug');

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
            'role_id' => ['required', 'integer', Rule::exists('roles', 'id')->whereNot('slug', 'owner')],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
            'role_id' => $data['role_id'],
            'is_active' => true,
        ]);

        return response()->json($user, 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'role_id' => ['sometimes', 'required', 'integer', Rule::exists('roles', 'id')],
            'password' => ['sometimes', 'required', 'confirmed', PasswordRule::defaults()],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $actorId = $request->user()->id;
        $memberId = $user->id;

        return DB::transaction(function () use ($actorId, $memberId, $data) {
            $members = $this->lockMembers($actorId, $memberId);
            $actor = $members->get($actorId);
            $member = $members->get($memberId);
            abort_unless($actor?->is_active && $actor->isOwner(), 403);
            abort_unless($member, 404);

            $nextRole = (int) ($data['role_id'] ?? $member->role_id);
            $ownerRole = (int) Role::where('slug', 'owner')->value('id');
            $deactivating = array_key_exists('is_active', $data) && ! $data['is_active'];
            if ($actorId === $memberId && ($nextRole !== (int) $member->role_id || $deactivating)) {
                abort(403, 'You cannot change your own role or deactivate your account.');
            }
            if ($actorId !== $memberId && $member->isOwner()) {
                abort(403, 'The owner can only be changed through ownership transfer.');
            }
            if ((int) $member->role_id !== $nextRole && ($member->isOwner() || $nextRole === $ownerRole)) {
                abort(403, 'Use ownership transfer to change the owner.');
            }
            $member->fill($data);
            if ($deactivating || $member->isDirty('password')) {
                $member->setRememberToken(Str::random(60));
                if (config('session.driver') === 'database') {
                    DB::connection(config('session.connection'))->table(config('session.table'))
                        ->where('user_id', $memberId)->delete();
                }
                $member->tokens()->delete();
            }
            $member->save();

            return response()->json($member);
        }, 3);
    }

    public function transferOwnership(Request $request, User $user): JsonResponse
    {
        $actorId = $request->user()->id;
        $memberId = $user->id;

        return DB::transaction(function () use ($actorId, $memberId) {
            $members = $this->lockMembers($actorId, $memberId);
            $actor = $members->get($actorId);
            $member = $members->get($memberId);
            abort_unless($actor?->is_active && $actor->isOwner(), 403);
            abort_unless($member, 404);
            abort_if(! $member->is_active || $member->isOwner(), 422, 'Select an active member who is not already an owner.');

            $ownerRole = $actor->role_id;
            $actor->update(['role_id' => Role::where('slug', 'agent')->value('id')]);
            $member->update(['role_id' => $ownerRole]);

            return response()->json(['user' => $member]);
        }, 3);
    }

    private function lockMembers(int $actorId, int $memberId)
    {
        return User::query()->whereKey([$actorId, $memberId])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
    }
}
