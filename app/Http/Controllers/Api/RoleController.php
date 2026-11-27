<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AccountInvitation;
use App\Models\Role;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class RoleController extends Controller
{
    public function index()
    {
        return response()->json(['roles' => Role::withCount('users')->orderBy('name')->get(), 'modules' => Role::MODULES]);
    }

    public function store(Request $request)
    {
        return response()->json(Role::create($this->validated($request) + ['slug' => 'custom-'.Str::lower((string) Str::ulid())]), 201);
    }

    public function update(Request $request, Role $role)
    {
        abort_if($role->slug === 'owner', 403);
        $role->update($this->validated($request));

        return response()->json($role);
    }

    public function destroy(Role $role)
    {
        abort_if(in_array($role->slug, ['owner', 'agent', 'viewer'], true), 403);

        DB::transaction(function () use ($role) {
            $locked = Role::lockForUpdate()->findOrFail($role->id);
            abort_if($locked->users()->exists() || AccountInvitation::pending()->where('role', $locked->slug)->exists(),
                409, 'Reassign members and revoke pending invitations before deleting this role.');
            $locked->delete();
        }, 3);

        return response()->noContent();
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'module_access' => ['present', 'array', 'list', 'max:11'],
            'module_access.*' => ['required', 'distinct', Rule::in(array_keys(Role::MODULES))],
        ]);
    }
}
