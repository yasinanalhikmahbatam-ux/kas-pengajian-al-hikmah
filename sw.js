
const CACHE = 'kas-pengajian-v5';

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
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('kas-pengajian-') && key !== CACHE)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Permintaan API Google Apps Script tidak boleh ditangani cache aplikasi.
  if (
    url.origin !== self.location.origin ||
    request.method !== 'GET'
  ) {
    return;
  }

  // File utama selalu mencoba mengambil versi terbaru terlebih dahulu.
  const isAppFile =
    /\/(index\.html|app\.js|style\.css|sw\.js)$/.test(url.pathname) ||
    url.pathname.endsWith('/');

  if (isAppFile) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;

          const home = await caches.match('./index.html');
          if (home) return home;

          return new Response('Aplikasi sedang offline. Periksa koneksi internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );

    return;
  }

  // Aset lainnya menggunakan cache terlebih dahulu.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
