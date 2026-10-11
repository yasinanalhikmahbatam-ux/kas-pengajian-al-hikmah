// ============================================
// SERVICE WORKER - KAS PENGAJIAN AL HIKMAH
// Versi cache: v8
// ============================================

const CACHE = 'kas-pengajian-v8';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './logo-al-hikmah.png'
];

// ============================================
// INSTALL
// ============================================

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    await Promise.all(
      ASSETS.map(async asset => {
        try {
          const response = await fetch(asset, {
            cache: 'no-store'
          });

          if (response.ok) {
            await cache.put(asset, response);
          }
        } catch (error) {
          console.warn(
            'Gagal mengambil aset:',
            asset,
            error
          );
        }
      })
    );

    // Aktifkan versi terbaru tanpa menunggu semua tab ditutup.
    await self.skipWaiting();
  })());
});

// ============================================
// ACTIVATE
// ============================================

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key =>
          key.startsWith('kas-pengajian-') &&
          key !== CACHE
        )
        .map(key => caches.delete(key))
    );

    await self.clients.claim();

    console.log(
      'Service Worker aktif:',
      CACHE
    );
  })());
});

// ============================================
// FETCH
// File aplikasi: network-first.
// Aset pendukung: cache-first.
// Google Sheets API tidak dicegat.
// ============================================

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Jangan mencegat permintaan lintas domain,
  // termasuk Google Apps Script.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Abaikan permintaan yang bukan halaman biasa.
  if (
    request.destination === 'document' ||
    /\/(index\.html|app\.js|style\.css|sw\.js)$/.test(
      url.pathname
    ) ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith((async () => {
      try {
        // Ambil versi terbaru dari hosting.
        const response = await fetch(request, {
          cache: 'no-store'
        });

        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        // Jika offline, gunakan versi cache.
        const cached = await caches.match(request);

        if (cached) {
          return cached;
        }

        return new Response(
          'Aplikasi offline. Hubungkan HP ke internet, lalu buka kembali aplikasi.',
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

  // Cache-first untuk aset pendukung seperti ikon.
  event.respondWith((async () => {
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }

    return fetch(request);
  })());
});
