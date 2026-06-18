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
    // Source 1: leg.path.lineString (best — actual route geometry)
    if (leg.path && leg.path.lineString) {
      const coords = decodePath(leg.path.lineString);
      if (coords.length >= 2) return coords;
    }
    // Source 2: leg.route.path (TfL route polyline)
    if (leg.route && leg.route.path) {
      const coords = decodePath(leg.route.path);
      if (coords.length >= 2) return coords;
    }
    // Source 3: leg.from + leg.to as clean 2-point fallback
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
        const mode = l.mode ? (l.mode.id || l.mode.name || 'walking') : 'walking';
        const path = extractPath(l);
        return {
        mode: mode.toLowerCase(),
        modeName: l.mode ? l.mode.name : 'Walking',
        duration: l.duration || 0,
        instruction: l.instruction ? l.instruction.summary || '' : '',
        detail: l.instruction ? l.instruction.detailed || '' : '',
        departureTime: l.departureTime || '',
        arrivalTime: l.arrivalTime || '',
        from: l.departurePoint ? { lat: l.departurePoint.lat, lon: l.departurePoint.lon, name: l.departurePoint.commonName, id: l.departurePoint.id || l.departurePoint.naptanId || '' } : (l.from ? { lat: l.from.lat, lon: l.from.lon, name: l.from.name || l.from.commonName, id: l.from.id || l.from.naptanId || '' } : null),
        to: l.arrivalPoint ? { lat: l.arrivalPoint.lat, lon: l.arrivalPoint.lon, name: l.arrivalPoint.commonName, id: l.arrivalPoint.id || l.arrivalPoint.naptanId || '' } : (l.to ? { lat: l.to.lat, lon: l.to.lon, name: l.to.name || l.to.commonName, id: l.to.id || l.to.naptanId || '' } : null),
        routeName: (l.route && l.route.name) || (l.routeOptions && l.routeOptions[0] && (l.routeOptions[0].lineIdentifier?.name || l.routeOptions[0].name)) || l.lineName || l.lineId || '',
        lineId: (l.route && l.route.id) || (l.routeOptions && l.routeOptions[0] && (l.routeOptions[0].lineIdentifier?.id || l.routeOptions[0].lineId)) || l.lineId || '',
        platformName: l.platformName || '',
        direction: l.direction || (l.routeOptions && l.routeOptions[0] && l.routeOptions[0].direction) || '',
        path,
        hasFixedLocations: (l.hasFixedLocations != null) ? l.hasFixedLocations : undefined,
        walkSteps: (l.instruction && l.instruction.steps) ? l.instruction.steps.map(s => ({
          instruction: s.description || s.instruction || '',
          name: s.streetName || '',
          distance: s.distance || 0,
          modifier: (s.turnDirection || s.modifier || '').toLowerCase().replace(/\s+/g, '-')
        })) : [],
        stops: (() => {
          const rawStops = l.path?.stopPoints || [];
          const depId = (l.departurePoint?.id || l.departurePoint?.naptanId || l.departurePoint?.stopId || '').toString();
          const arrId = (l.arrivalPoint?.id || l.arrivalPoint?.naptanId || l.arrivalPoint?.stopId || '').toString();
          return rawStops.filter(s => {
            if (!s) return false;
            const sid = (s.id || s.naptanId || s.stopId || '').toString();
            if (depId && sid && depId === sid) return false;
            if (arrId && sid && arrId === sid) return false;
            return true;
          }).map(s => ({ name: s.name || s.commonName || '', lat: s.lat, lon: s.lon }));
        })()
      };
      });

      const totalCost = j.fare?.totalCost != null ? j.fare.totalCost / 100 : null;
      const walkDuration = legs.filter(l => l.mode === 'walking').reduce((s, l) => s + l.duration, 0);

      // Extract fare breakdown
      let fareBreakdown = null;
      if (j.fare && j.fare.fares && j.fare.fares.length) {
        const fareEntry = j.fare.fares[0];
        const tickets = (fareEntry.tickets || []);
        const firstTicket = tickets[0] || null;
        fareBreakdown = {
          peak: firstTicket ? firstTicket.isPeak : null,
          ticketType: firstTicket ? (firstTicket.type || '') : '',
          zones: j.fare.zones || null,
          caveats: (j.fare.caveats || []).map(c => c.text || c).filter(Boolean)
        };
      }

      return {
        duration: j.duration,
        startTime: j.startDateTime,
        arrivalTime: j.arrivalDateTime,
        legs,
        fare: totalCost,
        estimatedFare: totalCost ?? estimateFare(legs),
        fareBreakdown,
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

    // Filter out 'walking' and 'cycling' — TfL API doesn't accept them as mode params
    const transitModes = opts.modes ? opts.modes.filter(m => m !== 'walking' && m !== 'cycling') : [];
    if (transitModes.length) {
      apiOpts.mode = transitModes.join(',');
    }

    // Valid coords needed for transit API too — validate early
    const fromCoord = Api.parseCoord(from);
    const toCoord = Api.parseCoord(to);
    if (!transitModes.length) {
      if (!fromCoord || !toCoord) return null;
      const route = await Api.getWalkingRoute(fromCoord.lat, fromCoord.lon, toCoord.lat, toCoord.lon);
      if (!route) return null;
      const durMin = Math.max(1, Math.round(route.duration / 60));
      const fromName = typeof from === 'string' ? from : (from.label || 'From');
      const toName = typeof to === 'string' ? to : (to.label || 'To');
      const leg = {
        mode: 'walking', modeName: 'Walking', duration: durMin,
        instruction: '', detail: '', departureTime: '', arrivalTime: '',
        from: { lat: fromCoord.lat, lon: fromCoord.lon, name: fromName },
        to: { lat: toCoord.lat, lon: toCoord.lon, name: toName },
        routeName: '', platformName: '', direction: '',
        path: route.coords, stops: [], walkSteps: route.steps || []
      };
      const j = { duration: durMin, startTime: '', arrivalTime: '', legs: [leg], fare: null, estimatedFare: null, walkDuration: durMin, transfers: 0 };
      return { fastest: j, cheapest: j, balanced: j, all: [j], raw: null, walkingOnly: true };
    }

    // For raw text strings (place names), ensure we don't pass objects to URL
    const fromStr = typeof from === 'string' ? from : (fromCoord ? `${fromCoord.lat},${fromCoord.lon}` : '');
    const toStr = typeof to === 'string' ? to : (toCoord ? `${toCoord.lat},${toCoord.lon}` : '');
    if (!fromStr || !toStr) return null;

    apiOpts.nationalSearch = true;
    apiOpts.alternativeWalking = true;
    apiOpts.journeyPreference = 'LeastTime';
    if (opts.walkingSpeed) apiOpts.walkingSpeed = opts.walkingSpeed;

    const raw = await Api.getJourney(fromStr, toStr, apiOpts);
    const journeys = parseJourneys(raw).filter(j => j.legs.every(l => l.mode !== 'cycling'));
    if (!journeys.length) return null;

    const transitJourneys = journeys.filter(j => j.legs.some(l => l.mode !== 'walking'));
    const walkOnly = journeys.find(j => j.legs.every(l => l.mode === 'walking'));

    let fastest, cheapest, balanced;
    if (transitJourneys.length) {
      fastest = transitJourneys.reduce((a, b) => a.duration < b.duration ? a : b);
      cheapest = transitJourneys.reduce((a, b) => {
        const af = a.estimatedFare != null ? a.estimatedFare : a.fare != null ? a.fare : 999;
        const bf = b.estimatedFare != null ? b.estimatedFare : b.fare != null ? b.fare : 999;
        return af < bf ? a : b;
      });
      const byBalance = [...transitJourneys].sort((a, b) => (a.transfers - b.transfers) || (a.walkDuration - b.walkDuration) || (a.duration - b.duration));
      balanced = byBalance.find(j => j !== fastest && j !== cheapest) || byBalance[0];
    } else {
      // Only walking available — show it
      fastest = cheapest = balanced = walkOnly || journeys[0];
    }

    return { fastest, cheapest, balanced, all: journeys, raw, walkingJourney: walkOnly || null };
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

  function formatRouteName(routeName, mode) {
    if (!routeName) return '';
    const railModes = ['tube', 'dlr', 'overground', 'elizabeth-line', 'national-rail', 'tram'];
    if (railModes.includes(mode) && !routeName.toLowerCase().includes('line')) {
      return routeName + ' Line';
    }
    return routeName;
  }

  async function enrichLegPath(leg) {
    if (!leg || leg.mode === 'walking' || leg.mode === 'cycling' || !leg.from || !leg.to) return;
    const apiLineId = leg.lineId || leg.routeName;
    if (!apiLineId) return;
    if (leg.path && leg.path.length >= 3 && leg.stops && leg.stops.length >= 2 && leg.stops.some(s => s.lat != null && s.lon != null)) return;
    const lineId = apiLineId;
    const dirsToTry = leg.direction ? [leg.direction] : [];
    dirsToTry.push('inbound', 'outbound');
    let bestStops = null, bestPath = null;
    for (const dir of dirsToTry) {
      try {
        const data = await Api.getLineRoutes(lineId, dir);
        if (!data) continue;
        const enriched = extractRoutePath(data);
        if (enriched.length >= 2) { bestPath = enriched; }
        if (data.stopPointSequences && data.stopPointSequences.length) {
          const fromLat = parseFloat(leg.from.lat);
          const fromLon = parseFloat(leg.from.lon);
          const toLat = parseFloat(leg.to.lat);
          const toLon = parseFloat(leg.to.lon);
          const fromId = leg.from.id;
          const toId = leg.to.id;
          for (const seq of data.stopPointSequences) {
            if (!seq.stopPoint) continue;
            const stops = seq.stopPoint.filter(s => s.lat != null && s.lon != null).map(s => ({
              id: s.id || s.stopId || s.stationId || '',
              name: s.name || s.commonName || '',
              lat: parseFloat(s.lat),
              lon: parseFloat(s.lon)
            }));
            if (stops.length < 2) continue;
            const hasFrom = stops.some(s => (s.id && fromId && s.id === fromId) || (Math.abs(s.lat - fromLat) < 0.001 && Math.abs(s.lon - fromLon) < 0.001));
            if (!hasFrom) continue;
            const hasTo = stops.some(s => (s.id && toId && s.id === toId) || (Math.abs(s.lat - toLat) < 0.001 && Math.abs(s.lon - toLon) < 0.001));
            if (!hasTo) continue;
            if (stops.length >= 2) { bestStops = stops; break; }
          }
        }
        if (bestStops) break;
      } catch {}
    }
    if (bestPath) leg.path = bestPath;
    if (bestStops && bestStops.length >= 2) {
      const fromId = leg.from.id;
      const toId = leg.to.id;
      const fromLat = parseFloat(leg.from.lat);
      const fromLon = parseFloat(leg.from.lon);
      const toLat = parseFloat(leg.to.lat);
      const toLon = parseFloat(leg.to.lon);
      let fromIdx = bestStops.findIndex(s => s.id && fromId && s.id === fromId);
      if (fromIdx < 0) {
        fromIdx = bestStops.findIndex(s => Math.abs(s.lat - fromLat) < 0.001 && Math.abs(s.lon - fromLon) < 0.001);
      }
      let toIdx = -1;
      if (fromIdx >= 0) {
        toIdx = bestStops.findIndex(s => s.id && toId && s.id === toId);
        if (toIdx < 0) {
          toIdx = bestStops.findIndex(s => Math.abs(s.lat - toLat) < 0.001 && Math.abs(s.lon - toLon) < 0.001);
        }
      }
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx < toIdx) {
        leg.stops = bestStops.slice(fromIdx + 1, toIdx);
      } else {
        leg.stops = bestStops;
      }
    }
  }

  async function enrichJourneyPaths(journey) {
    if (!journey || !journey.legs) return;
    const transitLegs = journey.legs.filter(l => l.mode !== 'walking' && l.mode !== 'cycling');
    await Promise.allSettled(transitLegs.map(l => enrichLegPath(l)));
  }

  return { plan, getModeColor, getModeIcon, parseJourneys, parseWktLineString, extractRoutePath, extractRouteStops, isNightRoute, formatRouteName, enrichLegPath, enrichJourneyPaths };
})();
