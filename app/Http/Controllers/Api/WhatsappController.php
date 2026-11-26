<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\SaveWhatsappConfigRequest;
use App\Models\WhatsappConfig;
use App\Services\MetaCloudApiService;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

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

        $displayPhoneNumber = $this->cachedDisplayPhoneNumber($config);

        return response()->json([
            'configured' => true,
            'status' => $config->status,
            'connection_status' => $config->status,
            'phone_number_id' => $config->phone_number_id,
            'display_phone_number' => $displayPhoneNumber,
            'waba_id' => $config->waba_id,
            'connected_at' => $config->connected_at,
            'registered_at' => $config->registered_at,
            'subscribed_apps_at' => $config->subscribed_apps_at,
            'mirror_inbound_media' => $config->mirror_inbound_media !== false,
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

        $sameNumber = $config->phone_number_id === $data['phone_number_id'];

        if (! empty($data['access_token'])) {
            $config->access_token = $data['access_token'];
        }

        try {
            if (! $config->access_token) {
                return response()->json(['message' => 'An access token is required to connect WhatsApp.'], 422);
            }
        } catch (DecryptException) {
            return response()->json(['message' => 'Enter a new access token to replace the unreadable saved token.'], 422);
        }

        $config->user_id = $request->user()->id;
        $config->phone_number_id = $data['phone_number_id'];
        $config->waba_id = array_key_exists('waba_id', $data) ? $data['waba_id'] : $config->waba_id;
        if (! empty($data['verify_token'])) {
            $config->verify_token = $data['verify_token'];
        }

        $error = $this->meta->verifyPhoneNumber($config);
        if ($error) {
            return response()->json(['message' => 'WhatsApp credentials could not be verified: '.$error], 422);
        }

        if ($config->waba_id && ($error = $this->meta->verifyWabaPhoneNumber($config))) {
            return response()->json(['message' => 'WhatsApp account could not be verified: '.$error], 422);
        }

        $pin = $data['pin'] ?? null;
        $registeredAt = $sameNumber ? $config->registered_at : null;
        $registrationError = null;
        if ($pin) {
            $registrationError = $this->meta->registerPhoneNumber($config, $pin);
            $registeredAt = $registrationError ? null : now();
        }

        $error = $this->meta->subscribeApp($config);
        if ($error) {
            return response()->json(['message' => 'WhatsApp app could not subscribe to the WABA: '.$error], 422);
        }

        $config->fill([
            'status' => $registrationError ? 'disconnected' : 'connected',
            'connected_at' => $registrationError ? null : now(),
            'registered_at' => $registeredAt,
            'last_registration_error' => $registrationError,
            'subscribed_apps_at' => $config->waba_id ? now() : null,
        ])->save();
        Cache::forget($this->displayPhoneNumberCacheKey($config));

        return response()->json([
            ...$this->getConfig()->getData(true),
            'success' => $registrationError === null,
            'registration_skipped' => $registeredAt === null && $pin === null,
        ]);
    }

    public function verifyRegistration(): JsonResponse
    {
        $config = WhatsappConfig::query()->latest('id')->first();
        if (! $config) {
            return response()->json([
                'live' => false,
                'checks' => ['config_exists' => false],
                'errors' => ['WhatsApp is not configured.'],
            ]);
        }

        try {
            $hasToken = (bool) $config->access_token;
        } catch (DecryptException) {
            $hasToken = false;
        }

        if (! $hasToken) {
            return response()->json([
                'live' => false,
                'checks' => ['config_exists' => true, 'token_decryptable' => false],
                'errors' => ['The saved access token is missing or unreadable.'],
            ]);
        }

        $phoneError = $this->meta->verifyPhoneNumber($config);
        $subscriptionError = $this->meta->verifyAppSubscription($config);
        $registered = $config->registered_at !== null;

        return response()->json([
            'live' => $config->status === 'connected' && ! $phoneError && ! $subscriptionError && $registered,
            'checks' => [
                'config_exists' => true,
                'token_decryptable' => true,
                'phone_metadata_ok' => $phoneError === null,
                'waba_subscribed_to_app' => $config->waba_id ? $subscriptionError === null : null,
                'locally_marked_registered' => $registered,
            ],
            'errors' => array_values(array_filter([$phoneError, $subscriptionError, $config->last_registration_error])),
            'registered_at' => $config->registered_at,
            'subscribed_apps_at' => $config->subscribed_apps_at,
            'last_registration_error' => $config->last_registration_error,
        ]);
    }

    public function updateMirrorMedia(Request $request): JsonResponse
    {
        $data = $request->validate(['mirror_inbound_media' => ['required', 'boolean']]);
        $config = WhatsappConfig::query()->latest('id')->firstOrFail();
        $config->update($data);

        return response()->json(['mirror_inbound_media' => $config->mirror_inbound_media]);
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
        $error = $config?->last_registration_error;

        if ($config?->status === 'connected') {
            try {
                $error = $this->meta->verifyPhoneNumber($config);
            } catch (DecryptException) {
                $error = 'The saved access token is unreadable.';
            }
        }

        return response()->json([
            'status' => $config?->status === 'connected' && ! $error ? 'connected' : 'disconnected',
            'phone_number_id' => $config?->phone_number_id,
            'connected_at' => $config?->connected_at,
            'message' => $error,
            'checked_at' => now(),
        ]);
    }

    private function cachedDisplayPhoneNumber(WhatsappConfig $config): ?string
    {
        $cacheKey = $this->displayPhoneNumberCacheKey($config);
        $cached = Cache::get($cacheKey);

        if (is_string($cached)) {
            return $cached !== '' ? $cached : null;
        }

        $number = $this->meta->getDisplayPhoneNumber($config);
        Cache::put($cacheKey, $number ?? '', now()->addMinutes($number ? 360 : 5));

        return $number;
    }

    private function displayPhoneNumberCacheKey(WhatsappConfig $config): string
    {
        return 'whatsapp.display_phone_number.'.hash('sha256', (string) $config->phone_number_id);
    }
}
