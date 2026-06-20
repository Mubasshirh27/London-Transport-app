const CACHE = 'lt-cache-v4';
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
  '/js/ui-helpers.js', '/js/app.js', '/js/offline-manager.js',
  '/img/icon.svg', '/img/icon-192.png', '/img/icon-512.png',
  '/img/people-walking-across-a-busy-city-street-with-blurred-background-photo.jpg',
  '/manifest.json'
].map(p => p ? BASE + p : BASE + '/');

const API_PATTERNS = ['api.tfl.gov.uk', 'tfl.gov.uk', 'transportapi.com'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'tiles.basemaps.cartocdn.com', 'server.arcgisonline.com'];

function isApiRequest(url) { return API_PATTERNS.some(p => url.hostname.includes(p)); }
function isTileRequest(url) { return TILE_HOSTS.some(h => url.hostname.includes(h)); }
function isCdnRequest(url) { return url.hostname.includes('cdn.') || url.hostname.includes('unpkg.com'); }

function offlineResponse(body, status) {
  return new Response(body || '', { status: status || 503, statusText: 'Offline' });
}

async function fromCacheOrFallback(request, cacheName) {
  const cache = await caches.open(cacheName || CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  return offlineResponse('', 503);
}

async function fetchAndCache(request, cacheName) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName || CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function handleRequest(request) {
  const url = new URL(request.url);

  try {
    if (isTileRequest(url)) {
      const cached = await caches.open(TILE_CACHE).then(c => c.match(request));
      if (cached) return cached;
      return await fetchAndCache(request, TILE_CACHE);
    }

    if (isApiRequest(url)) {
      const apiCache = await caches.open(API_CACHE);
      const cached = await apiCache.match(request);
      if (cached) {
        // stale-while-revalidate: serve cached, refresh in background
        fetchAndCache(request, API_CACHE).catch(() => {});
        return cached;
      }
      try {
        return await fetchAndCache(request, API_CACHE);
      } catch {
        return offlineResponse('', 503);
      }
    }

    if (isCdnRequest(url)) {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        return await fetchAndCache(request, CACHE);
      } catch {
        return offlineResponse('', 503);
      }
    }

    if (url.protocol === 'chrome-extension:') {
      try { return await fetch(request); } catch { return offlineResponse('', 503); }
    }

    if (url.origin === self.location.origin && STATIC.some(p => url.pathname === p)) {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        return await fetchAndCache(request, CACHE);
      } catch {
        return offlineResponse('', 503);
      }
    }

    try {
      return await fetchAndCache(request, CACHE);
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      return offlineResponse('', 503);
    }
  } catch {
    return offlineResponse('', 503);
  }
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
  e.respondWith(handleRequest(e.request));
});
