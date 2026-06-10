const CACHE = 'lt-cache-v1';
const BASE = self.location.pathname.replace(/\/sw\.js$/, '') || '/';

const STATIC = [
  '',
  '/index.html',
  '/css/style.css',
  '/js/config.js', '/js/api.js', '/js/router.js',
  '/js/stops.js', '/js/status.js', '/js/map.js',
  '/js/geocoder.js', '/js/storage.js', '/js/icons.js',
  '/js/ui-sidebar.js', '/js/ui-journey.js',
  '/js/ui-departures.js', '/js/ui-timetable.js',
  '/js/ui-nearby.js', '/js/ui-bikes.js',
  '/js/ui-route.js', '/js/ui-favorites.js',
  '/js/ui-helpers.js', '/js/app.js',
  '/img/icon.svg', '/manifest.json'
].map(p => p ? BASE + p : BASE + '/');

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => { if (k !== CACHE) return caches.delete(k); }))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('cdn.') || url.hostname.includes('unpkg.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (STATIC.some(p => url.pathname === p)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const net = fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; });
        return cached || net;
      })
    );
    return;
  }
  e.respondWith(
    fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; }).catch(() => caches.match(e.request))
  );
});
