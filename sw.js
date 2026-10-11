```javascript
const CACHE = 'kas-pengajian-v7';

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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // Cache file secara terpisah supaya satu aset yang hilang
    // tidak menggagalkan penyimpanan seluruh aplikasi.
    await Promise.all(
      ASSETS.map(async asset => {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn('Aset belum berhasil dicache:', asset);
        }
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key =>
          key.startsWith('kas-pengajian-') && key !== CACHE
        )
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' ||
      url.origin !== self.location.origin) {
    return;
  }

  const appFile =
    /\/(index\.html|app\.js|style\.css|sw\.js)$/.test(url.pathname) ||
    url.pathname.endsWith('/');

  if (appFile) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, {
          cache: 'no-store'
        });

        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        return new Response(
          'Aplikasi sedang offline. Periksa koneksi internet.',
          {
            status: 503,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8'
            }
          }
        );
      }
    })());

    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    return fetch(request);
  })());
});
```
