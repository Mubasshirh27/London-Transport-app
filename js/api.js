const Api = (() => {
  const BASE = CONFIG.tflApiBase;
  const KEY = CONFIG.tflApiKey;
  let rateLimitQueue = Promise.resolve();

  function rateLimited(fn) {
    rateLimitQueue = rateLimitQueue.then(() => fn()).then(r => new Promise(resolve => setTimeout(() => resolve(r), 200)));
    return rateLimitQueue;
  }

  async function fetchTfl(endpoint, params = {}) {
    params.app_key = KEY;
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${BASE}${endpoint}?${qs}`;
    const res = await fetch(url);
    if (!res.ok && res.status !== 300) {
      let body = '';
      try { body = await res.text(); } catch {}
      console.error(`TfL API ${res.status} for ${url}`, body);
      throw new Error(`TfL API error: ${res.status}`);
    }
    return res.json();
  }

  function parseCoord(input) {
    if (!input) return null;
    if (typeof input === 'string' && input.includes(',')) {
      const parts = input.split(',').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]))
        return { lat: parts[0], lon: parts[1] };
    }
    if (input.lat != null && input.lon != null)
      return { lat: input.lat, lon: input.lon };
    return null;
  }

  async function getJourney(from, to, opts = {}) {
    const f = parseCoord(from) || encodeURIComponent(from);
    const t = parseCoord(to) || encodeURIComponent(to);
    const fromStr = typeof f === 'string' ? f : `${f.lat},${f.lon}`;
    const toStr = typeof t === 'string' ? t : `${t.lat},${t.lon}`;
    const params = {
      walkingSpeed: 'Average',
      ...opts
    };
    return fetchTfl(`/Journey/JourneyResults/${fromStr}/to/${toStr}`, params);
  }

  async function getStopArrivals(stopId) {
    return rateLimited(() => fetchTfl(`/StopPoint/${stopId}/Arrivals`));
  }

  async function getNearbyStops(lat, lon, radius) {
    return fetchTfl('/StopPoint', {
      lat, lon,
      radius: radius || CONFIG.nearbyRadius,
      stopTypes: 'NaptanPublicBusCoachTram,NaptanMetroStation,NaptanRailStation',
      modes: 'bus,tube,dlr,overground,elizabeth-line,national-rail,tram'
    });
  }

  function normalizeLineId(input) {
    if (!input) return input;
    const normalized = input.toLowerCase().replace(/[&]/g, ' ').replace(/\s+/g, ' ').trim();
    const map = {
      'bakerloo': 'bakerloo', 'central': 'central', 'circle': 'circle',
      'district': 'district', 'hammersmith city': 'hammersmith-city', 'hammersmith': 'hammersmith-city',
      'jubilee': 'jubilee', 'metropolitan': 'metropolitan', 'northern': 'northern',
      'piccadilly': 'piccadilly', 'victoria': 'victoria',
      'waterloo city': 'waterloo-city', 'waterloo': 'waterloo-city',
      'dlr': 'dlr', 'london overground': 'london-overground', 'overground': 'london-overground',
      'elizabeth line': 'elizabeth', 'elizabeth': 'elizabeth',
      'tram': 'tram', 'cable car': 'cable-car', 'emirates air line': 'cable-car'
    };
    return map[normalized] || (normalized.replace(/[\s-]/g, '').match(/^[a-z]+$/) ? normalized : input);
  }

  async function getLineRoutes(lineId, direction) {
    return fetchTfl(`/Line/${lineId}/Route/Sequence/${direction || 'inbound'}`);
  }

  async function getWalkingRoute(fromLat, fromLon, toLat, toLon) {
    // Try OSM's dedicated foot routing server first, fallback to OSRM
    const servers = [
      // OSM foot server — specifically built for walking/foot routing
      { url: `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?geometries=geojson&overview=full` },
      // OSRM demo server — general-purpose with walking profile
      { url: `https://router.project-osrm.org/route/v1/walking/${fromLon},${fromLat};${toLon},${toLat}?geometries=geojson&overview=full` }
    ];
    for (const s of servers) {
      try {
        const res = await fetch(s.url);
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.code === 'Ok' && data.routes && data.routes[0]) {
          const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          return {
            coords,
            distance: data.routes[0].distance,
            duration: data.routes[0].duration
          };
        }
      } catch {}
    }
    return null;
  }

  async function getBikePoints(lat, lon, radius) {
    const res = await fetchTfl('/Place', {
      lat, lon,
      radius: radius || 1000,
      type: 'BikePoint'
    });
    return res?.places || [];
  }

  async function getDisruptions(modes) {
    return fetchTfl('/Line/Mode/' + (modes || 'tube,dlr,overground,elizabeth-line,bus,tram') + '/Disruption');
  }

  async function getStopProperties(stopId) {
    return rateLimited(() => fetchTfl(`/StopPoint/${stopId}`));
  }

  async function getMetaModes() {
    return fetchTfl('/Journey/Meta/Modes');
  }

  async function searchStops(query) {
    return fetchTfl('/StopPoint/Search', {
      query,
      modes: 'bus,tube,dlr,overground,elizabeth-line,national-rail,tram'
    });
  }

  async function geocodePostcode(postcode) {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.result) return { lat: data.result.latitude, lon: data.result.longitude, label: data.result.postcode };
    } catch {}
    return null;
  }

  async function searchPostcodes(query) {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes?q=${encodeURIComponent(query.trim())}&limit=5`);
      if (!res.ok) return [];
      const data = await res.json();
      if (data && Array.isArray(data.result)) return data.result.map(r => ({ label: r.postcode, lat: r.latitude, lon: r.longitude }));
    } catch {}
    return [];
  }

  async function getLineStatus(modes) {
    return fetchTfl('/Line/Mode/' + (modes || 'tube,dlr,overground,elizabeth-line,bus') + '/Status');
  }

  async function getLineStopPoints(lineId) {
    return fetchTfl(`/Line/${lineId}/StopPoints`);
  }

  async function getLineById(lineId) {
    return fetchTfl(`/Line/${lineId}`);
  }

  async function getLineTimetable(lineId, fromStopPointId, direction) {
    const params = {};
    if (direction) params.direction = direction;
    return fetchTfl(`/Line/${lineId}/Timetable/${fromStopPointId}`, params);
  }

  async function getStopRoutes(stopId) {
    return fetchTfl(`/StopPoint/${stopId}/Route`);
  }

  async function getStopTimetable(stopId, lineId) {
    return fetchTfl(`/StopPoint/${stopId}/Timetable/${lineId}`);
  }

  return { fetchTfl, getJourney, getStopArrivals, getNearbyStops, searchStops, getLineStatus, getLineRoutes, getBikePoints, getDisruptions, getStopProperties, getMetaModes, parseCoord, getLineStopPoints, getLineById, geocodePostcode, searchPostcodes, getWalkingRoute, getLineTimetable, getStopRoutes, getStopTimetable, normalizeLineId };
})();
