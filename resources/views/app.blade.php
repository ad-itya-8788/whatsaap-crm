<!doctype html>
<html lang="en" data-mode="dark" data-theme="emerald">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="/img/logo.png" />
    <title>Aayojan AI CRM</title>
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
