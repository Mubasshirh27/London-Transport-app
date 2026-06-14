const CACHE = 'lt-cache-v2';
const API_CACHE = 'lt-api-v1';
const TILE_CACHE = 'lt-tiles-v1';
const BASE = (self.location.pathname.replace(/\/sw\.js$/, '') || '').replace(/\/+$/, '');

const STATIC = [
  BASE ? '/' : '',
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

const API_PATTERNS = ['api.tfl.gov.uk', 'tfl.gov.uk', 'transportapi.com'];

function isApiRequest(url) {
  return API_PATTERNS.some(p => url.hostname.includes(p));
}

function isTileRequest(url) {
  return url.hostname.includes('tile.openstreetmap.org');
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if (k !== CACHE && k !== API_CACHE && k !== TILE_CACHE) return caches.delete(k);
    }))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (isTileRequest(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(c => c.match(e.request)).then(cached => {
        const net = fetch(e.request).then(res => {
          const c = res.clone();
          if (res.ok) caches.open(TILE_CACHE).then(ca => ca.put(e.request, c));
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  if (isApiRequest(url)) {
    e.respondWith(
      fetch(e.request).then(res => {
        const c = res.clone();
        caches.open(API_CACHE).then(ca => ca.put(e.request, c));
        return res;
      }).catch(() => caches.open(API_CACHE).then(c => c.match(e.request)))
    );
    return;
  }

  if (url.hostname.includes('cdn.') || url.hostname.includes('unpkg.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin && STATIC.some(p => url.pathname === p)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const net = fetch(e.request).then(res => {
          const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then(res => {
      const c = res.clone();
      if (res.ok && res.type === 'basic') caches.open(CACHE).then(ca => ca.put(e.request, c));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
