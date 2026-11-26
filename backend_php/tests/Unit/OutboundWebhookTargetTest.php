<?php

namespace Tests\Unit;

use App\Services\OutboundWebhookTarget;
use PHPUnit\Framework\TestCase;

class OutboundWebhookTargetTest extends TestCase
{
    public function test_destination_validation_allows_public_https_and_rejects_nonpublic_addresses(): void
    {
        $target = new OutboundWebhookTarget;

        $this->assertSame([], $target->resolve('https://1.1.1.1/hook'));
        foreach ([
            'http://1.1.1.1/',
            'https://1.1.1.1:8080/',
            'https://localhost/',
            'https://127.0.0.1/',
            'https://[::1]/',
            'https://[::ffff:127.0.0.1]/',
            'https://169.254.169.254/',
            'https://name@1.1.1.1/',
        ] as $destination) {
            $this->assertNull($target->resolve($destination));
        }
    }
}
