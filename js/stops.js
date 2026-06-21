const Stops = (() => {
  async function getNearby(lat, lon) {
    const data = await Api.getNearbyStops(lat, lon);
    if (!data || !data.stopPoints) return [];
    return data.stopPoints.map(s => ({
      id: s.id,
      name: s.commonName,
      lat: s.lat,
      lon: s.lon,
      distance: s.distance,
      modes: s.modes || [],
      lines: (s.lines || []).map(l => l.name).filter(Boolean),
      stopLetter: s.stopLetter || (s.indicator ? s.indicator.replace(/[->\s]/g, '').toUpperCase() : '')
    })).sort((a, b) => a.distance - b.distance);
  }

  async function getArrivals(stopId) {
    const data = await Api.getStopArrivals(stopId);
    if (data && Array.isArray(data) && data.length) {
      const now = Date.now();
      return data.map(a => normalizeArrival(a, now)).sort((a, b) => a.timeToStation - b.timeToStation);
    }
    // Try child stops
    try {
      const sd = await Api.getStopProperties(stopId);
      if (sd.children && sd.children.length) {
        const allArrivals = [];
        for (const child of sd.children) {
          const childData = await Api.getStopArrivals(child.id).catch(() => null);
          if (childData && Array.isArray(childData) && childData.length) {
            allArrivals.push(...childData);
          }
        }
        if (allArrivals.length) {
          return allArrivals.map(a => normalizeArrival(a, Date.now())).sort((a, b) => a.timeToStation - b.timeToStation);
        }
      }
    } catch {}
    // Fallback to scheduled timetable when no live arrivals
    return getScheduledArrivals(stopId);
  }

  async function getScheduledArrivals(stopId) {
    try {
      const [routeData, stopProps] = await Promise.all([
        Api.getStopRoutes(stopId),
        Api.getStopProperties(stopId).catch(() => null)
      ]);
      const modes = stopProps && stopProps.modes && stopProps.modes.length ? stopProps.modes : null;
      if (!routeData || !routeData.routeSection || !routeData.routeSection.length) return [];
      const seen = new Set();
      const tasks = [];
      const now = new Date();

      for (const rs of routeData.routeSection) {
        const lid = rs.lineId;
        const dir = rs.direction;
        const key = lid + '|' + dir;
        if (!lid || !dir || seen.has(key)) continue;
        seen.add(key);
        const mode = rs.mode || (modes && modes.length === 1 ? modes[0] : 'tube');
        tasks.push(loadTimetableForLine(stopId, lid, dir, now, mode));
      }
      const results = await Promise.all(tasks);
      const flat = results.flat().filter(Boolean);
      if (!flat.length) return [];
      const cutoff = Date.now() + 90 * 60 * 1000;
      return flat.filter(a => a.timeMs <= cutoff).sort((a, b) => a.timeMs - b.timeMs).map(a => ({
        line: a.line, lineId: a.lineId, mode: a.mode,
        destination: a.destination || '',
        expected: new Date(a.timeMs).toISOString(),
        timeToStation: Math.max(0, Math.round((a.timeMs - Date.now()) / 60000)),
        vehicleId: '', platformName: a.platformName || '',
        direction: a.dir, dirLabel: a.dirLabel || '',
        _scheduled: true
      }));
    } catch { return []; }
  }

  async function loadTimetableForLine(stopId, lineId, dir, now, mode) {
    try {
      const tt = await Api.getLineTimetable(lineId, stopId, dir);
      if (!tt || !tt.timetable || !tt.timetable.routes) return [];
      const results = [];
      for (const route of tt.timetable.routes) {
        if (!route.schedules) continue;
        for (const sched of route.schedules) {
          const kj = sched.knownJourneys || sched.plannedJourneys;
          if (!kj || !kj.length) continue;
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const schedFrom = sched.firstDay ? new Date(sched.firstDay) : null;
          const schedTo = sched.lastDay ? new Date(sched.lastDay) : null;
          if (schedFrom && schedFrom > today) continue;
          if (schedTo && schedTo < today) continue;
          const name = (sched.name || '').toLowerCase();
          const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
          const todayStr = dayNames[now.getDay()];
          const isWeekend = now.getDay() === 0 || now.getDay() === 6;
          const mentionedDays = dayNames.filter(d => name.includes(d));
          if (mentionedDays.length > 0) {
            const inRange = !isWeekend && (name.includes('monday to friday') || name.includes('monday - friday') || name.includes('mon-fri') || name.includes('monday-friday'));
            const isMatch = mentionedDays.includes(todayStr) || (inRange && !isWeekend) || (name.includes('weekend') && isWeekend);
            if (!isMatch) continue;
          }
          for (const j of kj) {
            const depH = parseInt(j.hour, 10);
            const depM = parseInt(j.minute, 10);
            if (isNaN(depH) || isNaN(depM)) continue;
            const depTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), depH, depM);
            const depMs = depTime.getTime();
            if (depMs <= now.getTime()) continue;
            if (depMs > now.getTime() + 90 * 60 * 1000) continue;
            const destDir = dir === 'inbound' ? 'Inbound' : 'Outbound';
            results.push({
              line: lineId,
              lineId,
              mode: mode || 'tube',
              destination: route.name || destDir,
              timeMs: depMs,
              platformName: '',
              dir,
              dirLabel: destDir
            });
          }
        }
      }
      return results;
    } catch { return []; }
  }

  function normalizeArrival(a, now) {
    let dest = a.destinationName || '';
    if (!dest) {
      const towards = (a.towards || '').trim();
      if (towards && towards !== 'Check Front of Train') dest = towards;
    }
    if (!dest && a.platformName) {
      const m = a.platformName.match(/^(Westbound|Eastbound|Northbound|Southbound|Inner Rail|Outer Rail)/i);
      if (m) dest = m[1];
    }
    // Extract friendly direction label — search anywhere in platformName
    const plat = a.platformName || '';
    const boundRe = /(Westbound|Eastbound|Northbound|Southbound|Inner Rail|Outer Rail)/i;
    const boundMatch = plat.match(boundRe);
    let dirLabel = boundMatch ? boundMatch[1] : '';
    if (!dirLabel) {
      if (a.direction === 'inbound') dirLabel = 'Inbound';
      else if (a.direction === 'outbound') dirLabel = 'Outbound';
    }
    if (!dirLabel && a.platformName) {
      const pl = plat.toLowerCase();
      if (pl.includes('eastbound')) dirLabel = 'Eastbound';
      else if (pl.includes('westbound')) dirLabel = 'Westbound';
      else if (pl.includes('northbound')) dirLabel = 'Northbound';
      else if (pl.includes('southbound')) dirLabel = 'Southbound';
    }
    return {
      line: a.lineName || a.lineId || '',
      lineId: a.lineId || '',
      mode: (a.modeName || a.mode || 'other').toString().toLowerCase().replace(/\s+/g, '-'),
      destination: dest,
      expected: a.expectedArrival,
      timeToStation: Math.max(0, Math.round(((a.expectedArrival ? new Date(a.expectedArrival) : now) - now) / 60000)),
      vehicleId: a.vehicleId,
      platformName: a.platformName,
      direction: a.direction,
      dirLabel
    };
  }

  function groupArrivals(arrivals) {
    const groups = {};
    arrivals.forEach(a => {
      const key = a.mode || 'other';
      if (!groups[key]) groups[key] = {};
      const dir = a.dirLabel || a.direction || '';
      const plat = a.platformName || '';
      const lineKey = a.line || '?';
      const subKey = `${lineKey}${dir ? '|' + dir : ''}${plat ? '|' + plat : ''}`;
      if (!groups[key][subKey]) groups[key][subKey] = { lineKey, dir, plat, arrivals: [] };
      groups[key][subKey].arrivals.push(a);
    });
    const modeOrder = ['bus', 'tube', 'national-rail', 'elizabeth-line', 'dlr', 'overground', 'tram', 'cableCar', 'riverBus', 'walking', 'other'];
    const sorted = [];
    modeOrder.forEach(m => {
      if (groups[m]) {
        const lines = Object.entries(groups[m]).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
        sorted.push({ mode: m, lines: lines.map(([k, v]) => [v.lineKey, v.arrivals, v.dir, v.plat]) });
      }
    });
    return sorted;
  }

  async function resolveStopIds(stopId) {
    const ids = [stopId];
    try {
      const sd = await Api.getStopProperties(stopId);
      if (sd.children && sd.children.length) {
        ids.push(...sd.children.map(c => c.id));
      }
    } catch {}
    return ids;
  }

  // --- Mode icons/colors now from shared Modes module ---
  function getModeIcon(mode) {
    return Modes.getIcon(mode);
  }

  function getModeColor(mode) {
    return Modes.getColor(mode);
  }

  const _accCache = new Map();
  const _accTTL = 10 * 60 * 1000;

  async function getStopAccessibility(stopId) {
    if (!stopId) return null;
    const cached = _accCache.get(stopId);
    if (cached && Date.now() - cached.ts < _accTTL) return cached.data;
    try {
      const data = await Api.getStopProperties(stopId);
      const result = {
        stepFree: !!(data.accessibilitySummary && data.accessibilitySummary.toLowerCase().includes('step-free')),
        hearingLoop: !!(data.accessibilitySummary && data.accessibilitySummary.toLowerCase().includes('hearing')),
        text: data.accessibilitySummary || ''
      };
      _accCache.set(stopId, { data: result, ts: Date.now() });
      return result;
    } catch { return null; }
  }

  function clearCache() {
    _accCache.clear();
  }

  return { getNearby, getArrivals, groupArrivals, getModeIcon, getModeColor, resolveStopIds, getStopAccessibility, clearCache };
})();
