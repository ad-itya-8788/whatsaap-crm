<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class MemberPresenceController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(
            User::query()->where('is_active', true)->whereNotNull('last_seen_at')
                ->get(['id', 'presence_status', 'last_seen_at'])
                ->keyBy('id')
        );
    }

    public function update(Request $request): Response
    {
        $data = $request->validate(['status' => ['required', 'in:online,away']]);
        User::query()->whereKey($request->user()->id)->toBase()->update([
            'presence_status' => $data['status'],
            'last_seen_at' => now(),
        ]);

        return response()->noContent();
    }
}
