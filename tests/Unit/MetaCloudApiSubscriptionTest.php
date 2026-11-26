<?php

namespace Tests\Unit;

use App\Models\WhatsappConfig;
use App\Services\MetaCloudApiService;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class MetaCloudApiSubscriptionTest extends TestCase
{
    public function test_it_reports_an_app_id_mismatch_from_the_waba_subscription_list(): void
    {
        config(['services.whatsapp.app_id' => 'expected-app']);
        Http::fake([
            'graph.facebook.com/*' => Http::response([
                'data' => [
                    ['whatsapp_business_api_data' => ['id' => 'subscribed-app']],
                ],
            ]),
        ]);

        $config = new WhatsappConfig;
        $config->waba_id = 'waba-id';
        $config->access_token = 'test-token';

        $error = app(MetaCloudApiService::class)->verifyAppSubscription($config);

        $this->assertSame(
            'This WABA is subscribed to Meta app ID(s) subscribed-app, but META_APP_ID is expected-app. Set META_APP_ID to the app that issued the WhatsApp access token.',
            $error,
        );
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/waba-id/subscribed_apps'));
    }

    public function test_it_accepts_the_configured_app_in_the_waba_subscription_list(): void
    {
        config(['services.whatsapp.app_id' => 'expected-app']);
        Http::fake([
            'graph.facebook.com/*' => Http::response([
                'data' => [
                    ['whatsapp_business_api_data' => ['id' => 'expected-app']],
                ],
            ]),
        ]);

        $config = new WhatsappConfig;
        $config->waba_id = 'waba-id';
        $config->access_token = 'test-token';

        $this->assertNull(app(MetaCloudApiService::class)->verifyAppSubscription($config));
    }
}
