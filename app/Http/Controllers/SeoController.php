<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;

class SeoController extends Controller
{
    public function robots(): Response
    {
        $site = rtrim((string) config('app.url'), '/');

        $lines = [
            'User-agent: *',
            'Allow: /',
            'Disallow: /api/',
            'Disallow: /session/',
            'Disallow: /register',
            'Disallow: /forgot-password',
            'Disallow: /reset-password',
            'Disallow: /signup',
            'Disallow: /join/',
            'Disallow: /dashboard',
            'Disallow: /inbox',
            'Disallow: /chats',
            'Disallow: /notifications',
            'Disallow: /broadcasts',
            'Disallow: /agents',
            'Disallow: /contacts',
            'Disallow: /templates',
            'Disallow: /workspace',
            'Disallow: /reports',
            'Disallow: /team',
            'Disallow: /settings',
            'Disallow: /up',
            'Sitemap: '.$site.'/sitemap.xml',
            '',
        ];

        return response(implode("\n", $lines), 200, ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    public function sitemap(): Response
    {
        $site = rtrim((string) config('app.url'), '/');
        $paths = config('branding.seo.indexable_paths', []);

        $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n";
        $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n";

        foreach ($paths as $path) {
            $path = '/'.ltrim((string) $path, '/');
            $loc = htmlspecialchars($site.$path, ENT_XML1 | ENT_QUOTES, 'UTF-8');

            $xml .= "  <url>\n";
            $xml .= "    <loc>{$loc}</loc>\n";
            $xml .= "  </url>\n";
        }

        $xml .= "</urlset>\n";

        return response($xml, 200, ['Content-Type' => 'application/xml; charset=utf-8']);
    }
}
