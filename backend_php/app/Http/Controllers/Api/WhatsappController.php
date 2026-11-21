<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\SaveWhatsappConfigRequest;
use App\Models\WhatsappConfig;
use App\Services\MetaCloudApiService;
use Illuminate\Http\JsonResponse;

class WhatsappController extends Controller
{
    public function __construct(private MetaCloudApiService $meta) {}

    public function getConfig(): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();

        if (! $config) {
            return response()->json([
                'configured' => false,
                'status' => 'disconnected',
                'connection_status' => 'disconnected',
                'webhook_url' => url('/api/whatsapp/webhook'),
            ]);
        }

        return response()->json([
            'configured' => true,
            'status' => $config->status,
            'connection_status' => $config->status,
            'phone_number_id' => $config->phone_number_id,
            'waba_id' => $config->waba_id,
            'connected_at' => $config->connected_at,
            'last_registration_error' => $config->last_registration_error,
            'has_access_token' => ! empty($config->getRawOriginal('access_token')),
            'has_verify_token' => ! empty($config->getRawOriginal('verify_token')),
            'webhook_url' => url('/api/whatsapp/webhook'),
        ]);
    }

    public function saveConfig(SaveWhatsappConfigRequest $request): JsonResponse
    {
        $data = $request->validated();
        $config = WhatsappConfig::query()->latest('id')->first() ?: new WhatsappConfig;

        if (empty($data['access_token']) && ! $config->access_token) {
            return response()->json(['message' => 'An access token is required to connect WhatsApp.'], 422);
        }

        $config->user_id = $request->user()->id;
        $config->phone_number_id = $data['phone_number_id'];
        $config->waba_id = $data['waba_id'] ?? $config->waba_id;
        if (! empty($data['access_token'])) {
            $config->access_token = $data['access_token'];
        }
        if (! empty($data['verify_token'])) {
            $config->verify_token = $data['verify_token'];
        }
        $config->status = 'disconnected';
        $config->connected_at = null;
        $config->save();

        $error = $this->meta->verifyPhoneNumber($config);
        if ($error) {
            $config->update(['last_registration_error' => $error]);

            return response()->json([
                'message' => 'WhatsApp credentials could not be verified: '.$error,
                'configured' => true,
                'status' => 'disconnected',
                'connection_status' => 'disconnected',
            ], 422);
        }

        $config->update([
            'status' => 'connected',
            'connected_at' => $config->connected_at ?: now(),
            'last_registration_error' => null,
        ]);

        return $this->getConfig();
    }

    public function disconnect(): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        if ($config) {
            $config->update(['status' => 'disconnected', 'connected_at' => null]);
        }

        return response()->json(['ok' => true, 'status' => 'disconnected']);
    }

    public function health(): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        $error = $config ? $this->meta->verifyPhoneNumber($config) : 'WhatsApp is not configured';

        return response()->json([
            'status' => $config && ! $error ? 'connected' : 'disconnected',
            'phone_number_id' => $config?->phone_number_id,
            'connected_at' => $config?->connected_at,
            'message' => $error,
            'checked_at' => now(),
        ]);
    }
}
