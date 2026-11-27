<!doctype html>
<html lang="en" data-mode="dark" data-theme="emerald">
  <head>
    @php
      $seo = config('branding.seo');
      $developer = config('branding.developer');
      $path = trim(request()->path(), '/');
      $siteUrl = rtrim((string) config('app.url'), '/');
      $indexable = in_array($path, $seo['indexable_paths'] ?? [], true);
      $canonical = $indexable ? $siteUrl.($path === '' ? '/' : '/'.$path) : null;
      $socialUrl = $canonical ?? $siteUrl.'/';
      $imageUrl = $siteUrl.'/'.ltrim($seo['image'], '/');
      $robots = $indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow, noarchive, nosnippet';
      $organizationId = $developer['url'].'/#organization';
    @endphp
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="{{ $seo['description'] }}" />
    <meta name="author" content="{{ $developer['name'] }}" />
    <meta name="application-name" content="{{ config('branding.name') }}" />
    <meta name="publisher" content="{{ $developer['name'] }}" />
    <meta name="robots" content="{{ $robots }}" />
    <meta name="googlebot" content="{{ $robots }}" />
    <meta name="theme-color" content="{{ config('branding.colors.green') }}" />
    @if ($canonical)
      <link rel="canonical" href="{{ $canonical }}" />
    @endif
    <link rel="icon" href="{{ asset('assets/favicon.ico') }}" type="image/x-icon" />
    <link rel="icon" href="{{ asset('assets/favicon-16x16.png') }}" type="image/png" sizes="16x16" />
    <link rel="icon" href="{{ asset('assets/favicon-32x32.png') }}" type="image/png" sizes="32x32" />
    <link rel="icon" href="{{ asset('assets/favicon-48x48.png') }}" type="image/png" sizes="48x48" />
    <link rel="apple-touch-icon" href="{{ asset('assets/apple-touch-icon.png') }}" sizes="180x180" />
    <link rel="manifest" href="{{ asset('notification.webmanifest') }}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="{{ config('branding.name') }}" />
    <meta property="og:title" content="{{ $seo['social_title'] }}" />
    <meta property="og:description" content="{{ $seo['social_description'] }}" />
    <meta property="og:url" content="{{ $socialUrl }}" />
    <meta property="og:image" content="{{ $imageUrl }}" />
    <meta property="og:image:width" content="{{ $seo['image_width'] }}" />
    <meta property="og:image:height" content="{{ $seo['image_height'] }}" />
    <meta property="og:image:alt" content="{{ $seo['image_alt'] }}" />
    <meta property="og:locale" content="{{ $seo['locale'] }}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{{ $seo['social_title'] }}" />
    <meta name="twitter:description" content="{{ $seo['social_description'] }}" />
    <meta name="twitter:image" content="{{ $imageUrl }}" />
    <meta name="twitter:image:alt" content="{{ $seo['image_alt'] }}" />
    <title>{{ $seo['title'] }}</title>
    @if ($indexable)
      @php
      $structuredData = [
        '@context' => 'https://schema.org',
        '@graph' => [
          [
            '@type' => 'Organization',
            '@id' => $organizationId,
            'name' => $developer['name'],
            'url' => $developer['url'],
          ],
          [
            '@type' => 'WebSite',
            '@id' => $siteUrl.'/#website',
            'name' => config('branding.name'),
            'alternateName' => config('branding.product'),
            'url' => $siteUrl.'/',
            'description' => $seo['description'],
            'inLanguage' => $seo['locale'],
            'publisher' => ['@id' => $organizationId],
          ],
          [
            '@type' => 'SoftwareApplication',
            '@id' => $siteUrl.'/#software',
            'name' => config('branding.name'),
            'url' => $siteUrl.'/',
            'applicationCategory' => 'BusinessApplication',
            'operatingSystem' => 'Web',
            'description' => $seo['description'],
            'developer' => ['@id' => $organizationId],
          ],
        ],
      ];
      @endphp
      <script type="application/ld+json">@json($structuredData)</script>
    @endif
    <script>
      (function () {
        try {
          var mode = localStorage.getItem('wacrm.mode');
          var theme = localStorage.getItem('wacrm.theme');
          if (['light', 'dark'].includes(mode)) document.documentElement.dataset.mode = mode;
          if (['amber', 'violet', 'emerald', 'cobalt', 'rose'].includes(theme)) document.documentElement.dataset.theme = theme;
        } catch {
          // Use the default appearance if browser storage is unavailable.
        }
      })();
    </script>
    @viteReactRefresh
    @vite('resources/js/main.jsx')
    @inertiaHead
  </head>

  <body>
    @inertia
    <div class="app-loading app-boot-loading" role="status"><span class="spinner"></span> Loading workspace&#8230;</div>
  </body>
</html>
