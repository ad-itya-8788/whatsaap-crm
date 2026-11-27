<?php

namespace App\Http\Controllers\Api;

use App\Auth\Access;
use App\Auth\AuthorizationAudit;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password as PasswordRule;

class UserController extends Controller
{
    public function __construct(private Access $access) {}

    public function roles(): JsonResponse
    {
        return response()->json(DB::table('crm_roles')->where('key', '!=', 'owner')->orderBy('name')->get(['key', 'name']));
    }

    public function index(Request $request): JsonResponse
    {
        $perPage = min(max($request->integer('per_page', 25), 1), 100);
        $query = User::query();
        if ($role = $request->string('role')->toString()) {
            $query->where('role', $role);
        }

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
            'role' => ['required', Rule::exists('crm_roles', 'key')->whereNot('key', 'owner')],
        ]);

        return DB::transaction(function () use ($request, $data) {
            DB::table('crm_roles')->where('key', 'owner')->lockForUpdate()->first();
            $actor = User::query()->lockForUpdate()->findOrFail($request->user()->id);
            abort_unless($this->access->owner($actor), 403);
            abort_unless(DB::table('crm_roles')->where('key', $data['role'])->exists(), 422);
            $member = User::create($data + ['is_active' => true]);
            AuthorizationAudit::record($actor->id, 'user.created', 'user:'.$member->id, null, $member->only(['role', 'is_active']));

            return response()->json($member, 201);
        }, 3);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'role' => ['sometimes', 'required', Rule::exists('crm_roles', 'key')],
            'password' => ['sometimes', 'required', 'confirmed', PasswordRule::defaults()],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $actorId = $request->user()->id;
        $memberId = $user->id;

        return DB::transaction(function () use ($actorId, $memberId, $data) {
            DB::table('crm_roles')->where('key', 'owner')->lockForUpdate()->first();
            $members = $this->lockMembers($actorId, $memberId);
            $actor = $members->get($actorId);
            $member = $members->get($memberId);
            abort_unless($this->access->owner($actor), 403);
            abort_unless($member, 404);

            $nextRole = $data['role'] ?? $member->role;
            $deactivating = array_key_exists('is_active', $data) && ! $data['is_active'];
            if ($actorId === $memberId && ($nextRole !== $member->role || $deactivating)) {
                abort(403, 'You cannot change your own role or deactivate your account.');
            }
            if ($actorId !== $memberId && $member->role === 'owner') {
                abort(403, 'The owner can only be changed through ownership transfer.');
            }
            if ($member->role !== $nextRole && ($member->role === 'owner' || $nextRole === 'owner')) {
                abort(403, 'Use ownership transfer to change the owner.');
            }
            abort_unless(DB::table('crm_roles')->where('key', $nextRole)->exists(), 422);
            $before = $member->only(['role', 'is_active']);

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
            $after = $member->only(['role', 'is_active']);
            if ($before !== $after) {
                AuthorizationAudit::record($actorId, 'user.access_updated', 'user:'.$memberId, $before, $after);
            }

            return response()->json($member);
        }, 3);
    }

    public function transferOwnership(Request $request, User $user): JsonResponse
    {
        $actorId = $request->user()->id;
        $memberId = $user->id;

        return DB::transaction(function () use ($actorId, $memberId) {
            DB::table('crm_roles')->where('key', 'owner')->lockForUpdate()->first();
            $members = $this->lockMembers($actorId, $memberId);
            $actor = $members->get($actorId);
            $member = $members->get($memberId);
            abort_unless($this->access->owner($actor), 403);
            abort_unless($member, 404);
            abort_if(! $member->is_active || $member->role === 'owner', 422, 'Select an active member who is not already an owner.');

            $actor->update(['role' => 'admin']);
            $member->update(['role' => 'owner']);
            DB::table('user_permission_overrides')->where('user_id', $memberId)->delete();
            AuthorizationAudit::record($actorId, 'ownership.transferred', 'user:'.$memberId,
                ['from' => $actorId, 'to' => $memberId], ['from_role' => 'admin', 'to_role' => 'owner']);

            return response()->json(['user' => $member]);
        }, 3);
    }

    private function lockMembers(int $actorId, int $memberId)
    {
        return User::query()->whereKey([$actorId, $memberId])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
    }
}
