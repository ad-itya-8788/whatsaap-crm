<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;

class MakeAdminUser extends Command
{
    protected $signature = 'app:make-admin {email} {--name=} {--password=} {--role=admin}';
    protected $description = 'Create or promote a user to admin/owner (safe first-admin bootstrap).';

    public function handle(): int
    {
        $email = $this->argument('email');
        $role = $this->option('role');
        if (! in_array($role, ['admin', 'owner'], true)) {
            $this->error('Role must be admin or owner.');
            return self::FAILURE;
        }
        $user = User::where('email', $email)->first();
        if ($user) {
            $changed = DB::transaction(function () use ($user, $role) {
                $member = User::query()->lockForUpdate()->findOrFail($user->id);
                if ($member->role === 'owner' && $role !== 'owner') {
                    return false;
                }

                $member->update(['role' => $role, 'is_active' => $role === 'owner' || $member->is_active]);

                return true;
            }, 3);
            if (! $changed) {
                $this->error('Transfer ownership through the CRM to change an existing Owner.');

                return self::FAILURE;
            }
            $this->info("User {$email} promoted to {$role}.");
            return self::SUCCESS;
        }
        $name = $this->option('name') ?: 'Administrator';
        $password = $this->option('password') ?: $this->secret('Password');
        if (! $password) { $this->error('Password required.'); return self::FAILURE; }
        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'role' => $role,
            'email_verified_at' => now(),
        ]);
        $this->info("Admin user {$user->email} created with role {$role}.");
        return self::SUCCESS;
    }
}
