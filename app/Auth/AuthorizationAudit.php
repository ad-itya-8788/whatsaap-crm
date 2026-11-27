<?php

namespace App\Auth;

use App\Events\AuthorizationChanged;
use Illuminate\Support\Facades\DB;

class AuthorizationAudit
{
    public static function record(int $actor, string $action, string $subject, ?array $previous, ?array $updated): void
    {
        DB::table('authorization_audits')->insert([
            'actor_id' => $actor,
            'action' => $action,
            'subject' => $subject,
            'previous' => $previous === null ? null : json_encode($previous, JSON_THROW_ON_ERROR),
            'updated' => $updated === null ? null : json_encode($updated, JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
        DB::afterCommit(function () {
            try {
                event(new AuthorizationChanged);
            } catch (\Throwable $error) {
                report($error);
            }
        });
    }
}
