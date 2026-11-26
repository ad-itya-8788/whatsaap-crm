<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApiKey;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ApiKeyController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['data' => ApiKey::query()->latest('id')->get(), 'scopes' => ApiKey::SCOPES]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'scopes' => ['present', 'array', 'max:'.count(ApiKey::SCOPES)],
            'scopes.*' => ['required', 'string', 'distinct', Rule::in(ApiKey::SCOPES)],
            'expires_at' => ['nullable', 'date', 'after:now'],
        ]);
        $token = 'wacrm_live_'.bin2hex(random_bytes(32));
        $key = ApiKey::create($data + [
            'created_by' => $request->user()->id,
            'key_prefix' => substr($token, 0, 23),
            'key_hash' => hash('sha256', $token),
        ]);

        return response()->json(['data' => $key, 'token' => $token], 201)->header('Cache-Control', 'no-store');
    }

    public function destroy(ApiKey $apiKey): JsonResponse
    {
        ApiKey::query()->whereKey($apiKey->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);

        return response()->json(['data' => $apiKey->refresh()]);
    }
}
