const Router = (() => {
  function decodePath(encoded) {
    if (!encoded) return [];
    try {
      if (typeof encoded !== 'string') {
        if (Array.isArray(encoded)) return encoded;
        return [];
      }

      // Format 1: JSON array string [[lat,lng],[lat,lng]]
      if (encoded.startsWith('[[') || encoded.startsWith('[{')) {
        const coords = [];
        try {
          const parsed = JSON.parse(encoded);
          if (Array.isArray(parsed)) {
            parsed.forEach(p => {
              if (Array.isArray(p) && p.length >= 2) {
                const lat = parseFloat(p[0]), lng = parseFloat(p[1]);
                if (!isNaN(lat) && !isNaN(lng)) coords.push([lat, lng]);
              } else if (p && p.lat != null && p.lon != null) {
                const lat = parseFloat(p.lat), lng = parseFloat(p.lon);
                if (!isNaN(lat) && !isNaN(lng)) coords.push([lat, lng]);
              } else if (p && p.latitude != null && p.longitude != null) {
                const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
                if (!isNaN(lat) && !isNaN(lng)) coords.push([lat, lng]);
              }
            });
            if (coords.length) return coords;
          }
        } catch {}
        // Manual fallback for [[lat,lng],[lat,lng]] string
        const matches = encoded.match(/-?\d+\.?\d*/g);
        if (matches && matches.length >= 2) {
          for (let i = 0; i < matches.length - 1; i += 2) {
            const lat = parseFloat(matches[i]), lng = parseFloat(matches[i + 1]);
            if (!isNaN(lat) && !isNaN(lng)) coords.push([lat, lng]);
          }
          if (coords.length) return coords;
        }
      }

      // Format 2: {lat:x,lon:y},{lat:x,lon:y} (no quotes)
      const objMatch = encoded.match(/{lat:\s*([\d.-]+)\s*,\s*l(?:on|ng):\s*([\d.-]+)}/gi);
      if (objMatch) {
        return objMatch.map(m => {
          const nums = m.match(/[\d.-]+/g);
          return nums && nums.length >= 2 ? [parseFloat(nums[0]), parseFloat(nums[1])] : null;
        }).filter(Boolean);
      }

      // Format 3: Google encoded polyline (alphanumeric starting with letter)
      if (/^[a-zA-Z]/.test(encoded) && encoded.length > 10) {
        try {
          return decodePolyline(encoded);
        } catch {}
      }
    } catch { return []; }
    return [];
  }

  function decodePolyline(str) {
    let index = 0, lat = 0, lng = 0, coords = [];
    while (index < str.length) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dlat;
      shift = 0; result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lng += dlng;
      coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
  }

  function extractPath(leg) {
    // Source 1: leg.path.lineString
    if (leg.path && leg.path.lineString) {
      const coords = decodePath(leg.path.lineString);
      if (coords.length >= 2) return coords;
    }
    // Source 2: leg.path.stopPoints
    if (leg.path && leg.path.stopPoints && Array.isArray(leg.path.stopPoints)) {
      const coords = leg.path.stopPoints.map(s => {
        if (s.lat != null && s.lon != null) return [parseFloat(s.lat), parseFloat(s.lon)];
        return null;
      }).filter(Boolean);
      if (coords.length >= 2) return coords;
    }
    // Source 3: leg.route.path
    if (leg.route && leg.route.path) {
      const coords = decodePath(leg.route.path);
      if (coords.length >= 2) return coords;
    }
    // Source 4: leg.path as array of objects
    if (leg.path && Array.isArray(leg.path)) {
      const coords = leg.path.map(p => {
        if (Array.isArray(p) && p.length >= 2) return [parseFloat(p[0]), parseFloat(p[1])];
        if (p.lat != null && p.lon != null) return [parseFloat(p.lat), parseFloat(p.lon)];
        return null;
      }).filter(Boolean);
      if (coords.length >= 2) return coords;
    }
    // Source 5: leg.from + leg.to as fallback (always works)
    if (leg.from && leg.to) {
      const fromLat = leg.from.lat ?? leg.from.latitude;
      const fromLon = leg.from.lon ?? leg.from.longitude;
      const toLat = leg.to.lat ?? leg.to.latitude;
      const toLon = leg.to.lon ?? leg.to.longitude;
      if (fromLat != null && fromLon != null && toLat != null && toLon != null) {
        return [[parseFloat(fromLat), parseFloat(fromLon)], [parseFloat(toLat), parseFloat(toLon)]];
      }
    }
    return [];
  }

  function parseJourneys(data) {
    if (!data || !data.journeys || !data.journeys.length) return [];

    return data.journeys.map(j => {
      const legs = (j.legs || []).map(l => {
        const mode = l.mode ? l.mode.id || l.mode.name : 'walking';
        const path = extractPath(l);
      return {
        mode: mode.toLowerCase(),
        modeName: l.mode ? l.mode.name : 'Walking',
        duration: l.duration || 0,
        instruction: l.instruction ? l.instruction.summary || '' : '',
        detail: l.instruction ? l.instruction.detailed || '' : '',
        departureTime: l.departureTime || '',
        arrivalTime: l.arrivalTime || '',
        from: l.departurePoint ? { lat: l.departurePoint.lat, lon: l.departurePoint.lon, name: l.departurePoint.commonName, id: l.departurePoint.id } : (l.from ? { lat: l.from.lat, lon: l.from.lon, name: l.from.name || l.from.commonName, id: l.from.id } : null),
        to: l.arrivalPoint ? { lat: l.arrivalPoint.lat, lon: l.arrivalPoint.lon, name: l.arrivalPoint.commonName, id: l.arrivalPoint.id } : (l.to ? { lat: l.to.lat, lon: l.to.lon, name: l.to.name || l.to.commonName, id: l.to.id } : null),
        routeName: l.route ? l.route.name : '',
        platformName: l.platformName || '',
        direction: l.direction || '',
        path,
        hasFixedLocations: (l.hasFixedLocations != null) ? l.hasFixedLocations : undefined,
        stops: (l.path?.stopPoints || []).map(s => ({
          name: s.name,
          lat: s.lat,
          lon: s.lon
        }))
      };
      });

      const totalCost = j.fare?.totalCost != null ? j.fare.totalCost / 100 : null;
      const walkDuration = legs.filter(l => l.mode === 'walking').reduce((s, l) => s + l.duration, 0);

      return {
        duration: j.duration,
        startTime: j.startDateTime,
        arrivalTime: j.arrivalDateTime,
        legs,
        fare: totalCost,
        estimatedFare: totalCost ?? estimateFare(legs),
        walkDuration,
        transfers: legs.length - 1
      };
    });
  }

  function estimateFare(legs) {
    const modeFares = { bus: 1.75, tube: 3.20, dlr: 3.20, overground: 3.20, 'elizabeth-line': 3.20, 'national-rail': 5.00, tram: 1.75, riverBus: 4.90, 'cable-car': 3.50 };
    let total = 0;
    let lastBusTime = null;
    const HOFFER_WINDOW_MS = 60 * 60 * 1000;
    const DAILY_BUS_CAP = 5.25;
    const DAILY_RAIL_CAP = 10.00;
    let busTotal = 0;
    let railTotal = 0;

    for (const leg of legs) {
      const fare = modeFares[leg.mode];
      if (!fare) continue;
      if (leg.mode === 'bus') {
        const legTime = leg.departureTime ? new Date(leg.departureTime).getTime() : Date.now();
        if (lastBusTime != null && (legTime - lastBusTime) < HOFFER_WINDOW_MS) continue;
        lastBusTime = legTime;
        busTotal += fare;
      } else {
        railTotal += fare;
      }
    }

    busTotal = Math.min(busTotal, DAILY_BUS_CAP);
    railTotal = Math.min(railTotal, DAILY_RAIL_CAP);
    total = busTotal + railTotal;
    return Math.min(total, DAILY_BUS_CAP + DAILY_RAIL_CAP);
  }

  async function plan(from, to, opts = {}) {
    const apiOpts = {};
    const timeMode = opts.timeMode === 'now' ? null : opts.timeMode;
    const hasDateTime = timeMode && opts.time && opts.time.length > 0 && opts.date && opts.date.length > 0;
    if (hasDateTime) {
      const now = new Date();
      let dateStr = opts.date;
      const timeParts = opts.time.split(':');
      const selectedHour = parseInt(timeParts[0], 10);
      const selectedMin = parseInt(timeParts[1], 10);
      const [y, m, d] = dateStr.split('-').map(Number);
      const selectedMs = new Date(y, m - 1, d, selectedHour, selectedMin).getTime();
      if (!isNaN(selectedMs) && selectedMs < now.getTime()) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateStr = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, '0'), String(tomorrow.getDate()).padStart(2, '0')].join('-');
      }
      apiOpts.date = dateStr.replace(/-/g, '');
      apiOpts.time = opts.time.replace(/:/g, '');
      apiOpts.timeIs = timeMode === 'arrive' ? 'Arriving' : 'Departing';
    }

    // Filter out 'walking' — TfL API doesn't accept it as a mode
    const transitModes = opts.modes ? opts.modes.filter(m => m !== 'walking') : [];
    if (transitModes.length) {
      apiOpts.mode = transitModes.join(',');
    }

    // Walking-only: use OSRM foot routing
    if (!transitModes.length) {
      const fromC = Api.parseCoord(from);
      const toC = Api.parseCoord(to);
      if (!fromC || !toC) return null;
      const route = await Api.getWalkingRoute(fromC.lat, fromC.lon, toC.lat, toC.lon);
      if (!route) return null;
      const durMin = Math.max(1, Math.round(route.duration / 60));
      const fromName = typeof from === 'string' ? from : (from.label || 'From');
      const toName = typeof to === 'string' ? to : (to.label || 'To');
      const leg = {
        mode: 'walking', modeName: 'Walking', duration: durMin,
        instruction: '', detail: '', departureTime: '', arrivalTime: '',
        from: { lat: fromC.lat, lon: fromC.lon, name: fromName },
        to: { lat: toC.lat, lon: toC.lon, name: toName },
        routeName: '', platformName: '', direction: '',
        path: route.coords, stops: []
      };
      const j = { duration: durMin, startTime: '', arrivalTime: '', legs: [leg], fare: null, estimatedFare: null, walkDuration: durMin, transfers: 0 };
      return { fastest: j, cheapest: j, balanced: j, all: [j], raw: null, walkingOnly: true };
    }

    const raw = await Api.getJourney(from, to, apiOpts);
    const journeys = parseJourneys(raw);
    if (!journeys.length) return null;

    const fastest = journeys.reduce((a, b) => a.duration < b.duration ? a : b);
    const cheapest = journeys.reduce((a, b) => (a.estimatedFare ?? 999) < (b.estimatedFare ?? 999) ? a : b);
    const byBalance = [...journeys].sort((a, b) => (a.transfers - b.transfers) || (a.walkDuration - b.walkDuration));
    const balanced = byBalance.find(j => j !== fastest && j !== cheapest) || byBalance[0];

    return { fastest, cheapest, balanced, all: journeys, raw };
  }

  function getModeColor(mode) {
    const colors = {
      bus: '#e32017', tube: '#0019a8', dlr: '#00a94f',
      overground: '#f86c00', 'elizabeth-line': '#6950a0',
      'national-rail': '#003688', tram: '#66cc00',
      'cable-car': '#e21836', riverBus: '#00a4a7',
      walking: '#666666', cycling: '#fcbb03'
    };
    return colors[mode] || '#333';
  }

  function getModeIcon(mode) {
    if (typeof Icon !== 'undefined') {
      const iconMap = { bus:'bus', tube:'tube', dlr:'dlr', overground:'overground', 'elizabeth-line':'elizabeth', 'national-rail':'train', tram:'tram', walking:'walk', cycling:'bike', riverBus:'bus', cableCar:'cable_car' };
      const svg = Icon.get(iconMap[mode] || '');
      if (svg) return svg;
    }
    const icons = { bus:'🚌', tube:'🚇', dlr:'🚈', overground:'🚆', 'elizabeth-line':'🚄', 'national-rail':'🚂', tram:'🚊', walking:'🚶', cycling:'🚲', riverBus:'⛴️', cableCar:'🚡' };
    return icons[mode] || '➡️';
  }

  function parseWktLineString(wkt) {
    if (!wkt || typeof wkt !== 'string') return [];
    try {
      const coordsStr = wkt.replace(/^MULTILINESTRING\s*\(\(/, '').replace(/\)\)\s*$/, '').replace(/^LINESTRING\s*\(/, '').replace(/\)\s*$/, '');
      const points = coordsStr.split(',').map(p => p.trim()).filter(Boolean);
      if (points.length < 2) return [];
      return points.map(p => {
        const parts = p.split(/\s+/).map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return [parts[1], parts[0]];
        }
        return null;
      }).filter(Boolean);
    } catch { return []; }
  }

  function extractRoutePath(routeData) {
    if (!routeData) return [];
    if (routeData.orderedLineRoutes && routeData.orderedLineRoutes.length) {
      for (const route of routeData.orderedLineRoutes) {
        if (route.lineString) {
          const coords = parseWktLineString(route.lineString);
          if (coords.length >= 2) return coords;
        }
      }
    }
    if (routeData.lineString) {
      const coords = parseWktLineString(routeData.lineString);
      if (coords.length >= 2) return coords;
    }
    if (routeData.stopPointSequences && routeData.stopPointSequences.length) {
      const stops = routeData.stopPointSequences[0].stopPoint || [];
      if (stops.length >= 2) {
        return stops.map(s => [parseFloat(s.lat), parseFloat(s.lon)]).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
      }
    }
    return [];
  }

  function extractRouteStops(routeData) {
    if (!routeData) return [];
    if (routeData.stopPointSequences && routeData.stopPointSequences.length) {
      const stops = routeData.stopPointSequences[0].stopPoint || [];
      return stops.filter(s => s.lat != null && s.lon != null).map(s => ({
        id: s.id || s.stopId || s.stationId || '',
        name: s.name || s.commonName || '',
        lat: parseFloat(s.lat),
        lon: parseFloat(s.lon)
      }));
    }
    return [];
  }

  function isNightRoute(routeName) {
    return routeName && routeName.toUpperCase().startsWith('N');
  }

  return { plan, getModeColor, getModeIcon, parseJourneys, parseWktLineString, extractRoutePath, extractRouteStops, isNightRoute };
})();
