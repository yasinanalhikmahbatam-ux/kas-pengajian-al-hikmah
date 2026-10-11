```javascript
const CACHE = 'kas-pengajian-v6';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './logo-al-hikmah.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .catch(error => {
        console.error('Gagal menyimpan cache aplikasi:', error);
      })
  );

  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key.startsWith('kas-pengajian-') &&
              key !== CACHE
            )
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Jangan tangani API eksternal atau permintaan selain GET.
  if (
    url.origin !== self.location.origin ||
    request.method !== 'GET'
  ) {
    return;
  }

  // File aplikasi utama selalu mencoba jaringan terlebih dahulu.
  const isAppFile =
    /\/(index\.html|app\.js|style\.css|sw\.js)$/.test(url.pathname) ||
    url.pathname.endsWith('/');

  if (isAppFile) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE)
              .then(cache => cache.put(request, copy))
              .catch(error =>
                console.warn('Gagal memperbarui cache:', error)
              );
          }

          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;

          const home = await caches.match('./index.html');
          if (home) return home;

          return new Response(
            'Aplikasi offline. Periksa koneksi internet.',
            {
              status: 503,
              headers: {
                'Content-Type': 'text/plain; charset=utf-8'
              }
            }
          );
        })
    );

    return;
  }

  // Aset lain: gunakan cache jika tersedia.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE)
            .then(cache => cache.put(request, copy))
            .catch(() => {});
        }

        return response;
      });
    })
  );
});
```
