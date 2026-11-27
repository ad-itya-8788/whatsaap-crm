<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\TestCase;

class SeoMetadataTest extends TestCase
{
    public function test_login_html_contains_brand_metadata_and_application_schema(): void
    {
        config(['app.url' => 'https://ping.example.test']);

        $response = $this->get('/login')->assertOk();
        $html = $response->getContent();

        $this->assertStringContainsString(
            '<title>Aayojan AI Ping | WhatsApp Business Messaging &amp; AI Automation</title>',
            $html,
        );
        $this->assertStringContainsString('https://ping.example.test/login', $html);
        $this->assertStringContainsString('https://ping.example.test/assets/og-image.png', $html);
        $this->assertStringContainsString('name="author" content="Aayojan AI"', $html);
        $this->assertStringContainsString('name="application-name" content="Aayojan AI Ping"', $html);
        $this->assertStringContainsString('name="twitter:image:alt"', $html);

        preg_match('#<script type="application/ld\+json">(.*?)</script>#s', $html, $matches);
        $schema = json_decode($matches[1] ?? '', true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(
            ['Organization', 'WebSite', 'SoftwareApplication'],
            array_column($schema['@graph'], '@type'),
        );
        $this->assertSame('BusinessApplication', $schema['@graph'][2]['applicationCategory']);
    }

    public function test_robots_and_sitemap_only_reference_public_indexable_pages(): void
    {
        config(['app.url' => 'https://ping.example.test']);

        $this->get('/robots.txt')
            ->assertOk()
            ->assertSee('Disallow: /contacts')
            ->assertSee('Disallow: /api/')
            ->assertSee('Sitemap: https://ping.example.test/sitemap.xml');

        $this->get('/sitemap.xml')
            ->assertOk()
            ->assertSee('<loc>https://ping.example.test/login</loc>', false)
            ->assertDontSee('<loc>https://ping.example.test/</loc>', false)
            ->assertDontSee('/contacts', false);
    }

    public function test_invitation_pages_are_noindex_and_do_not_get_token_canonical_urls(): void
    {
        config(['app.url' => 'https://ping.example.test']);

        $html = $this->get('/join/private-invitation-token')->assertOk()->getContent();
        $head = substr($html, 0, (int) strpos($html, '</head>'));

        $this->assertStringContainsString('noindex, nofollow, noarchive, nosnippet', $head);
        $this->assertStringNotContainsString('<link rel="canonical"', $head);
        $this->assertStringContainsString('content="https://ping.example.test/"', $head);
        $this->assertStringNotContainsString('private-invitation-token', $head);
    }
}
