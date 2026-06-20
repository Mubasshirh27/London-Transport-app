(function() {
  const UI = window.UI = window.UI || {};
  function esc(s) { return String(s).replace(/[&<>"']/g, function(m) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }

  function getDateSchedule(schedules, date) {
    const day = date.getDay(); // 0=Sun, 6=Sat
    const isWeekend = day === 0 || day === 6;
    const variantMap = [
      ['sunday', 'sun'],
      ['monday', 'mon'],
      ['tuesday', 'tue', 'tues'],
      ['wednesday', 'wed'],
      ['thursday', 'thu', 'thur', 'thurs'],
      ['friday', 'fri'],
      ['saturday', 'sat']
    ];
    const targetVariants = variantMap[day];
    const weekdayPatterns = ['monday to friday', 'monday-friday', 'mon-fri', 'weekday', 'mon to fri', 'monday - friday'];
    // All weekday day-name references
    const weekdayRefs = variantMap.slice(1, 6).flat();
    // All weekend day-name references
    const weekendRefs = [].concat(variantMap[0], variantMap[6]);

    // Pass 1: Exact day match (e.g. "Saturday" for Sat, "Monday to Friday" for Tue)
    for (const s of schedules) {
      const name = (s.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (targetVariants.some(v => name.includes(v))) return s;
    }

    // Pass 2: Day-type match — weekday pattern on weekdays, weekend ref on weekends
    for (const s of schedules) {
      const name = (s.name || '').toLowerCase();
      if (isWeekend && (weekendRefs.some(v => name.includes(v)))) return s;
      if (!isWeekend && weekdayPatterns.some(p => name.includes(p))) return s;
    }

    // Pass 3: Generic schedule that doesn't reference the opposite day-type
    for (const s of schedules) {
      const name = (s.name || '').toLowerCase();
      const hasWeekday = weekdayRefs.some(v => name.includes(v)) || weekdayPatterns.some(p => name.includes(p));
      const hasWeekend = weekendRefs.some(v => name.includes(v));
      if (isWeekend && !hasWeekday) return s;  // weekend-safe: no weekday refs
      if (!isWeekend && !hasWeekend) return s; // weekday-safe: no weekend refs
    }

    return null; // No appropriate schedule for this day type
  }

  function generateFromPeriods(periods) {
    const journeys = [];
    if (!periods || !periods.length) return journeys;
    periods.forEach(p => {
      const fromTime = p.fromTime || '';
      const toTime = p.toTime || '';
      const freq = p.frequency;
      if (!freq || !fromTime || !toTime) return;
      const interval = Math.round(((freq.highest || 10) + (freq.lowest || 10)) / 2);
      const fromH = parseInt(fromTime.substring(0, 2), 10);
      const fromM = parseInt(fromTime.substring(2, 4), 10);
      const toH = parseInt(toTime.substring(0, 2), 10);
      const toM = parseInt(toTime.substring(2, 4), 10);
      if (isNaN(fromH) || isNaN(fromM) || isNaN(toH) || isNaN(toM)) return;
      let start = fromH * 60 + fromM;
      let end = toH * 60 + toM;
      if (end < start) end += 1440;
      for (let t = start; t <= end; t += interval) {
        const h = Math.floor(t / 60) % 24;
        const m = t % 60;
        journeys.push({ hour: h, minute: m, timeStr: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') });
      }
    });
    return journeys;
  }

  function extractJourneyTimes(schedule) {
    if (!schedule) return [];
    const kj = schedule.knownJourneys || schedule.plannedJourneys;
    if (kj && kj.length) {
      return kj.map(j => {
        const h = parseInt(j.hour, 10);
        const m = parseInt(j.minute, 10);
        if (isNaN(h) || isNaN(m)) return null;
        return { hour: h, minute: m, timeStr: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') };
      }).filter(Boolean);
    }
    if (schedule.periods && schedule.periods.length) {
      console.log('[Timetable] Generating from periods (frequency-based)');
      return generateFromPeriods(schedule.periods);
    }
    return [];
  }

  function parseTimetableData(data, date) {
    if (!data || !data.timetable) {
      console.log('[Timetable] No timetable field', data ? Object.keys(data) : 'null');
      return { schedules: [], direction: data ? data.direction || '' : '' };
    }
    const tt = data.timetable;
    const direction = data.direction || '';
    let schedules = [];

    if (tt.routes && tt.routes.length) {
      // TfL returns: timetable.routes[].schedules[]
      tt.routes.forEach(route => {
        if (!route.schedules || !route.schedules.length) return;
        const matched = getDateSchedule(route.schedules, date || new Date());
        if (matched) {
          const journeys = extractJourneyTimes(matched);
          schedules.push({
            name: matched.name,
            journeys: journeys,
            periods: matched.periods || [],
            direction: route.direction || direction
          });
        }
      });
    } else if (tt.schedules && tt.schedules.length) {
      console.log('[Timetable] Schedules:', tt.schedules.map(s => s.name + ' (kj:' + (s.knownJourneys ? s.knownJourneys.length : 0) + ' per:' + (s.periods ? s.periods.length : 0) + ')'));
      const matched = getDateSchedule(tt.schedules, date || new Date());
      if (matched) {
        const journeys = extractJourneyTimes(matched);
        console.log('[Timetable] Using schedule:', matched.name, 'for date', (date || new Date()).toDateString(), 'journeys:', journeys.length);
        schedules.push({ name: matched.name, journeys, periods: matched.periods || [], direction: direction });
      } else {
        console.log('[Timetable] No schedule matched for this day type');
      }
    } else {
      console.log('[Timetable] No schedules array');
    }
    return { schedules, direction };
  }

  async function fetchAllTimetables(stopIds, lineId) {
    const results = [];
    const dirs = ['inbound', 'outbound'];
    for (const sid of stopIds) {
      for (const dir of dirs) {
        try {
          console.log('[Timetable] Trying stopId:', sid, 'line:', lineId, 'dir:', dir);
          const data = await Api.getLineTimetable(lineId, sid, dir);
          if (data && data.timetable) {
            const hasRoutes = data.timetable.routes && data.timetable.routes.length && data.timetable.routes.some(r => r.schedules && r.schedules.length);
            const hasSchedules = data.timetable.schedules && data.timetable.schedules.length;
            if (hasRoutes || hasSchedules) {
              console.log('[Timetable] Got timetable data from', sid, 'dir:', dir);
              results.push(data);
            }
          }
        } catch (e) {
          console.log('[Timetable] Failed:', sid, 'dir:', dir, '-', e.message);
        }
      }
    }
    return results;
  }

  function generateFromLiveArrivals(arrivals, lineId) {
    const routeArrivals = arrivals.filter(a => a.lineId === lineId || a.line === lineId).slice(0, 8);
    if (routeArrivals.length < 2) return [];
    const intervals = [];
    for (let i = 1; i < routeArrivals.length; i++) {
      const diff = routeArrivals[i - 1].timeToStation - routeArrivals[i].timeToStation;
      if (diff > 0 && diff < 60) intervals.push(diff);
    }
    const avgInterval = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 15;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const endMins = 24 * 60;
    const journeys = [];
    let nextDeparture = Math.max(nowMins, routeArrivals.length ? nowMins + routeArrivals[routeArrivals.length - 1].timeToStation + 5 : nowMins + 10);
    let count = 0;
    while (nextDeparture < endMins && count < 60) {
      const h = Math.floor(nextDeparture / 60) % 24;
      const m = nextDeparture % 60;
      journeys.push({ hour: h, minute: m, timeStr: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') });
      nextDeparture += avgInterval;
      count++;
    }
    console.log('[Timetable] Generated', journeys.length, 'approx times from live data (interval:', avgInterval + 'min)');
    return journeys;
  }

  let _ttCache = null; // { timetableResponses, arrivals, stopId, stopName, lineId, directionFilter, resolvedStopIds }

  function formatDate(date) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return dayNames[date.getDay()] + ', ' + date.getDate() + ' ' + monthNames[date.getMonth()] + ' ' + date.getFullYear();
  }

  function formatDateISO(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  async function checkLineDisruption(lineId) {
    try {
      const statuses = await Status.fetchAll();
      if (!Array.isArray(statuses)) return null;
      const line = statuses.find(s => s.id === lineId || s.name === lineId);
      if (!line || line.statusCls === 'good') return null;
      return { text: line.reason || line.statusText, cls: line.statusCls };
    } catch { return null; }
  }

  async function checkPlannedWorks(lineId, date) {
    try {
      const disruptions = await Status.fetchDisruptions();
      if (!Array.isArray(disruptions) || !disruptions.length) return [];
      const dateMs = date.getTime();
      return disruptions.filter(d => {
        if (!d.closureText) return false;
        const aff = d.affectedRoutes || [];
        const matchesLine = aff.some(r => (r.name || '').toLowerCase() === lineId.toLowerCase());
        if (!matchesLine) return false;
        const from = d.fromDate ? new Date(d.fromDate).getTime() : null;
        const to = d.toDate ? new Date(d.toDate).getTime() : null;
        if (from && to) return dateMs >= from && dateMs <= to;
        if (from) return dateMs >= from;
        if (to) return dateMs <= to;
        return true;
      });
    } catch { return []; }
  }

  function getFreshnessLabel() {
    if (!_ttCache || !_ttCache.fetchedAt) return { text: 'Unknown', cls: 'info' };
    const elapsed = Date.now() - _ttCache.fetchedAt;
    if (elapsed < 60000) return { text: 'Live', cls: 'good' };
    if (elapsed < 3600000) return { text: Math.round(elapsed / 60000) + ' min ago', cls: 'good' };
    if (elapsed < 86400000) return { text: Math.round(elapsed / 3600000) + 'h ago', cls: 'minor' };
    return { text: '>' + Math.round(elapsed / 86400000) + 'd old', cls: 'severe' };
  }

  function renderTimetableContent(stopId, stopName, lineId, directionFilter, date) {
    const panel = document.getElementById('departures-panel');
    const list = document.getElementById('departures-list');
    const targetDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];

    if (!_ttCache) { UI.showRouteTimetable(stopId, stopName, lineId, directionFilter); return; }

    // Re-parse with new date — merge by route-level direction to avoid losing
    // schedules when multiple API responses share the same data.direction
    let allSchedules = [];
    const dirMap = {};
    _ttCache.timetableResponses.forEach(data => {
      const parsed = parseTimetableData(data, date);
      if (!parsed.schedules.length) return;
      parsed.schedules.forEach(s => {
        if (!s.journeys.length) return;
        const dirKey = (s.direction || parsed.direction || 'default').toLowerCase();
        if (!dirMap[dirKey]) {
          dirMap[dirKey] = { direction: s.direction || parsed.direction || 'default', schedules: [] };
          allSchedules.push(dirMap[dirKey]);
        }
        dirMap[dirKey].schedules.push(s);
      });
    });

    // Filter live arrivals by line + direction (only relevant for today)
    let routeArrivals = [];
    const isTodayDate = formatDateISO(date) === formatDateISO(new Date());
    if (isTodayDate) {
      routeArrivals = (_ttCache.arrivals || []).filter(a => a.lineId === lineId || a.line === lineId);
      if (directionFilter) {
        routeArrivals = routeArrivals.filter(a => a.dirLabel === directionFilter);
      }
      routeArrivals = routeArrivals.slice(0, 10);
    }

    let liveHtml = '';
    if (routeArrivals.length) {
      liveHtml = '<div class="tt-live-header">\u25b6 Live Departures</div>';
      routeArrivals.forEach(a => {
        const mins = a.timeToStation;
        const dueText = mins <= 0 ? '<span class="arr-due">Due</span>' : '<span class="arr-min">' + mins + ' min</span>';
        liveHtml += '<div class="tt-arrival"><span class="arr-dest">' + (a.destination || '') + '</span><span class="arr-time">' + dueText + '</span></div>';
      });
    }

    // Filter scheduled timetables by direction if specified
    let filteredSchedules = allSchedules;
    if (directionFilter) {
      const dirLower = directionFilter.toLowerCase();
      const compassDirs = ['eastbound', 'westbound', 'northbound', 'southbound'];
      filteredSchedules = allSchedules.filter(tt => {
        const apiDir = (tt.direction || '').toLowerCase();
        if (apiDir === dirLower) return true;
        if (compassDirs.includes(dirLower) && compassDirs.includes(apiDir)) return true;
        return false;
      });
    }

    // If no API timetable data, generate approximate timetable from live arrivals
    if (!filteredSchedules.length && routeArrivals.length) {
      const estimated = generateFromLiveArrivals(routeArrivals, lineId);
      if (estimated.length) {
        filteredSchedules.push({ direction: '', schedules: [{ name: 'Estimated (from live data)', journeys: estimated }] });
      }
    }

    // Date bar
    const isToday = formatDateISO(date) === formatDateISO(new Date());
    const isTomorrow = formatDateISO(date) === formatDateISO(new Date(Date.now() + 86400000));
    let dateBarHtml = '<div class="tt-date-bar">' +
      '<button class="time-btn tt-date-prev" data-date="' + formatDateISO(new Date(date.getTime() - 86400000)) + '">◀</button>' +
      '<span class="tt-date-display">' + formatDate(date) + '</span>' +
      '<button class="time-btn tt-date-next" data-date="' + formatDateISO(new Date(date.getTime() + 86400000)) + '">▶</button>' +
      '<button class="time-btn' + (isToday ? ' active' : '') + ' tt-date-today">Today</button>' +
      '<button class="time-btn' + (isTomorrow ? ' active' : '') + ' tt-date-tomorrow">Tomorrow</button>' +
      '</div>';

    // Direction arrow helper
    function dirArrow(dir) {
      const d = (dir || '').toLowerCase();
      if (d.includes('east') || d === 'inbound') return '\u25b6';
      if (d.includes('west') || d === 'outbound') return '\u25c0';
      if (d.includes('north')) return '\u25b2';
      if (d.includes('south')) return '\u25bc';
      return '\u25b6';
    }

    // Disruption check
    let disruptionHtml = '';
    checkLineDisruption(lineId).then(d => {
      const banner = document.getElementById('tt-disruption-banner');
      if (!banner) return;
      let html = '';
      if (d) {
        html += '<div><span class="tt-disruption-icon">\u26a0\ufe0f</span> ' + d.text + '</div>';
      }
      if (!isTodayDate) {
        checkPlannedWorks(lineId, date).then(works => {
          if (works && works.length) {
            const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            works.forEach(w => {
              const dateRange = w.fromDate && w.toDate
                ? new Date(w.fromDate).toLocaleDateString('en',{month:'short',day:'numeric'}) + '-' + new Date(w.toDate).toLocaleDateString('en',{month:'short',day:'numeric'})
                : w.fromDate ? new Date(w.fromDate).toLocaleDateString('en',{month:'short',day:'numeric'}) : '';
              html += '<div style="margin-top:' + (d ? 4 : 0) + 'px"><span class="tt-disruption-icon">\u26a0\ufe0f</span> <strong>Planned works' + (dateRange ? ' ' + dateRange : '') + '</strong> &mdash; ' + esc(w.closureText) + '</div>';
            });
            banner.innerHTML = html;
            banner.className = 'tt-disruption-banner tt-ds-minor';
            banner.style.display = '';
          } else if (!d) {
            banner.style.display = 'none';
          }
        }).catch(() => {});
      } else if (d) {
        banner.innerHTML = html;
        banner.className = 'tt-disruption-banner tt-ds-' + d.cls;
        banner.style.display = '';
      }
    });

    // Freshness badge
    const freshness = getFreshnessLabel();
    const freshnessHtml = '<span class="tt-freshness-badge tt-fb-' + freshness.cls + '">\u25c9 ' + freshness.text + '</span>';

    // Schedule grid
    let schedHtml = '';
    if (filteredSchedules.length) {
      filteredSchedules.forEach(tt => {
        // Group schedules within this direction block by their route-level direction
        const dirGroups = {};
        tt.schedules.forEach(s => {
          if (!s.journeys.length) return;
          const routeDir = s.direction || tt.direction || 'default';
          if (!dirGroups[routeDir]) dirGroups[routeDir] = [];
          dirGroups[routeDir].push(s);
        });
        Object.entries(dirGroups).forEach(([routeDir, scheds]) => {
          const arrow = dirArrow(routeDir);
          const dirLabel = routeDir.charAt(0).toUpperCase() + routeDir.slice(1);
          schedHtml += '<div class="tt-section"><div class="tt-header">' + arrow + ' ' + dirLabel + ' &middot; ' + targetDay + '</div><div class="tt-grid">';
          scheds.forEach(s => {
            s.journeys.forEach(j => {
              schedHtml += '<div class="tt-entry" data-time="' + j.timeStr + '">' + j.timeStr + '</div>';
            });
          });
          schedHtml += '</div></div>';
        });
      });
    }

    if (!liveHtml && !schedHtml) {
      list.innerHTML = dateBarHtml + '<div class="no-data">No timetable data for ' + formatDate(date) + '</div>' +
        '<div class="tt-actions"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
      setTimeout(() => { const pb = panel.querySelector('.panel-body'); if (pb) pb.scrollTop = 0; }, 50);
      return;
    }

    // Route map bar
    const ls = _ttCache && _ttCache.lineStops;
    const dn = _ttCache && _ttCache.displayName;
    const mapBarHtml = ls && Array.isArray(ls) && ls.length > 2
      ? '<div class="tt-map-bar"><span class="tt-map-bar-text">\u{1F4CD} ' + esc(dn || lineId) + ' (' + ls.length + ' stops)</span><button class="tt-map-btn" data-stop="' + esc(stopId) + '" data-line="' + esc(lineId) + '">\u{1F5FA}\ufe0f Show on map</button></div>'
      : '';

    let html = dateBarHtml +
      '<div id="tt-disruption-banner" class="tt-disruption-banner" style="' + (freshness.cls !== 'severe' ? 'display:none' : '') + '"></div>' +
      '<div class="tt-info-line">' + freshnessHtml + ' <span class="tt-day-type">' + targetDay + '</span></div>' +
      mapBarHtml +
      liveHtml +
      schedHtml +
      '<div class="tt-actions"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';

    list.innerHTML = html;
    setTimeout(() => { const pb = panel.querySelector('.panel-body'); if (pb) pb.scrollTop = 0; }, 50);
  }

  UI.showRouteTimetable = async function(stopId, stopName, lineId, directionFilter, date) {
    if (UI._clearDeparturesTimer) UI._clearDeparturesTimer();
    const panel = document.getElementById('departures-panel');
    panel.style.display = 'flex';
    panel.dataset.stopName = stopName;
    panel.dataset.stopId = stopId;
    const list = document.getElementById('departures-list');
    list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    if (!date) date = new Date();

    // Fetch arrivals first to get display name
    let arrivals = [];
    try { arrivals = await (Stops.getArrivalsForStopGroup ? Stops.getArrivalsForStopGroup(stopId) : Stops.getArrivals(stopId)); } catch (e) { console.log('[Timetable] Arrivals error:', e); }
    const displayName = arrivals.length ? (arrivals.find(a => a.lineId === lineId || a.line === lineId)?.line || lineId) : lineId;
    const eLineId = esc(lineId), eDisplayName = esc(displayName), eStopName = esc(stopName), eStopId = esc(stopId);
    const headerSuffix = directionFilter ? ' (' + esc(directionFilter) + ')' : '';
    const isLineSaved = typeof Store !== 'undefined' && Store.isLineSaved(lineId);
    const saveBtn = isLineSaved
      ? '<button class="line-save-btn saved" data-line="' + eLineId + '" data-name="' + eDisplayName + '" data-mode="' + esc(arrivals.length ? arrivals[0]?.mode || 'tube' : 'tube') + '" title="Remove from My Lines">\u2605</button>'
      : '<button class="line-save-btn" data-line="' + eLineId + '" data-name="' + eDisplayName + '" data-mode="' + esc(arrivals.length ? arrivals[0]?.mode || 'tube' : 'tube') + '" title="Save to My Lines">\u2606</button>';
    panel.querySelector('h3').innerHTML = saveBtn + ' 📋 ' + eDisplayName + headerSuffix + ' Timetable \u00b7 ' + eStopName + ' <span class="stop-code">' + eStopId + '</span>';

    const resolvedStopIds = await Stops.resolveStopIds(stopId).catch(() => [stopId]);
    console.log('[Timetable] Resolved stop IDs:', resolvedStopIds);

    const timetableResponses = await fetchAllTimetables(resolvedStopIds, lineId);

    // Fetch line stops for route map
    let lineStops = null;
    try { lineStops = await Api.getLineStopPoints(lineId); } catch {}

    // Cache for date bar navigation
    _ttCache = {
      timetableResponses,
      arrivals,
      stopId,
      stopName,
      lineId,
      directionFilter,
      resolvedStopIds,
      lineStops,
      displayName,
      fetchedAt: Date.now()
    };

    // Check disruption in background
    checkLineDisruption(lineId).then(d => {
      _ttCache._disruption = d;
    });

    renderTimetableContent(stopId, stopName, lineId, directionFilter, date);
  };

  UI.showStopTimetable = async function(stopId, stopName) {
    if (UI._clearDeparturesTimer) UI._clearDeparturesTimer();
    const panel = document.getElementById('departures-panel');
    panel.style.display = 'flex';
    panel.dataset.stopName = stopName;
    panel.dataset.stopId = stopId;
    const list = document.getElementById('departures-list');
    list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    panel.querySelector('h3').innerHTML = '📋 ' + esc(stopName) + ' Timetable <span class="stop-code">' + esc(stopId) + '</span>';
    let routes = [], liveArrivals = [], routeModeMap = {};
    try {
      liveArrivals = await Stops.getArrivals(stopId);
      if (liveArrivals.length) {
        routes = [...new Set(liveArrivals.map(a => a.line).filter(Boolean))];
        liveArrivals.forEach(a => { if (a.line && a.mode) routeModeMap[a.line] = a.mode; });
      }
    } catch (e) { console.log('[StopTimetable] Live arrivals error:', e); }
    if (!routes.length) {
      try {
        const stopData = await Api.getStopRoutes(stopId);
        if (stopData && stopData.stopRoutes && stopData.stopRoutes.length) {
          stopData.stopRoutes.forEach(r => {
            const id = r.lineId || r.routeId || r.id || r.name;
            if (id) { routeModeMap[id] = r.mode || routeModeMap[id]; }
          });
          routes = [...new Set(stopData.stopRoutes.map(r => r.lineId || r.routeId || r.id || r.name).filter(Boolean))];
        }
      } catch (e) { console.log('[StopTimetable] Stop routes API error:', e); }
    }
    if (!routes.length) {
      list.innerHTML = '<div class="no-data">No routes found for this stop</div><div style="padding:8px 12px;text-align:center"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
      return;
    }
    function _guessMode(lineName) {
      const m = routeModeMap[lineName];
      if (m) return m;
      const n = (lineName || '').toLowerCase();
      if (/^(bakerloo|central|circle|district|hammersmith|jubilee|metropolitan|northern|piccadilly|victoria|waterloo)/.test(n)) return 'tube';
      if (n === 'dlr' || n === 'london overground' || n.includes('elizabeth')) return n === 'dlr' ? 'dlr' : n.includes('overground') ? 'overground' : 'elizabeth-line';
      if (n === 'tram') return 'tram';
      return 'tube';
    }
    let html = '<div class="tt-section"><div class="tt-header">\u25a0 Routes at this stop</div></div><div class="tt-stops-routes">';
    routes.slice(0, 30).forEach(r => {
      const routeLive = liveArrivals.filter(a => a.line === r);
      const mode = routeLive.length ? routeLive[0].mode : _guessMode(r);
      const color = Stops.getModeColor(mode);
      const nextDue = routeLive.length ? routeLive[0].timeToStation : null;
      const nextText = nextDue !== null ? (nextDue <= 0 ? 'Due' : nextDue + ' min') : '';
      html += '<button class="tt-route-btn" data-stop="' + esc(stopId) + '" data-line="' + esc(r) + '" style="border-left-color:' + color + '">' +
        '<span class="tt-route-icon">' + Stops.getModeIcon(mode) + '</span>' +
        '<span class="tt-route-num" style="background:' + color + '">' + esc(r) + '</span>' +
        '<span class="tt-route-next">' + nextText + '</span>' +
        '<span class="tt-route-arrow">\u2192</span></button>';
    });
    html += '</div><div class="tt-actions"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
    list.innerHTML = html;
    setTimeout(() => { const pb = panel.querySelector('.panel-body'); if (pb) pb.scrollTop = 0; }, 50);
  };

  UI.changeTimetableDate = function(date) {
    if (!_ttCache) return;
    UI.showRouteTimetable(_ttCache.stopId, _ttCache.stopName, _ttCache.lineId, _ttCache.directionFilter, date);
  };

  window.UI = UI;
})();

// Line save button handler
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.line-save-btn');
  if (btn) {
    e.preventDefault();
    const lineId = btn.dataset.line;
    const name = btn.dataset.name;
    const mode = btn.dataset.mode || 'tube';
    if (typeof Store === 'undefined') return;
    const saved = Store.toggleSavedLine({ id: lineId, name: name, mode: mode });
    btn.classList.toggle('saved', saved);
    btn.title = saved ? 'Remove from My Lines' : 'Save to My Lines';
    btn.textContent = saved ? '\u2605' : '\u2606';
    if (typeof UI !== 'undefined' && UI.loadStatus) UI.loadStatus();
    return;
  }
  const mapBtn = e.target.closest('.tt-map-btn');
  if (mapBtn) {
    e.preventDefault();
    const lineId = mapBtn.dataset.line;
    const rawStops = _ttCache && _ttCache.lineStops;
    if (!rawStops || !Array.isArray(rawStops) || rawStops.length < 2) return;
    const valid = rawStops.filter(s => s.lat != null && s.lon != null && !isNaN(s.lat) && !isNaN(s.lon));
    if (valid.length < 2) return;
    // Map TfL commonName → name for showRouteStopMarkers
    const mapped = valid.map(s => ({
      lat: s.lat, lon: s.lon,
      name: s.commonName || s.name || '',
      id: s.id || '',
      stopLetter: s.stopLetter || ''
    }));
    const coords = mapped.map(s => [s.lat, s.lon]);
    const modeVal = (rawStops[0] && rawStops[0].modes && rawStops[0].modes[0]) || 'tube';
    const lineColor = Stops.getModeColor(modeVal);
    MapView.clearAll();
    MapView.addRoute(coords, lineColor, lineId);
    MapView.showRouteStopMarkers(mapped, lineColor);
    MapView.fitBounds([coords]);
    const overlay = document.getElementById('map-overlay');
    if (overlay) {
      if (overlay.classList.contains('floating')) {
        overlay.classList.remove('popout');
        overlay.style.left = ''; overlay.style.top = ''; overlay.style.bottom = ''; overlay.style.right = ''; overlay.style.width = ''; overlay.style.height = '';
      } else if (!overlay.classList.contains('open')) {
        overlay.classList.add('open');
        const toggle = document.getElementById('map-toggle-btn');
        if (toggle) toggle.innerHTML = '<span class="ic" data-ic="close"></span> Close';
        document.body.style.overflow = 'hidden';
      }
      setTimeout(() => { const m = MapView.getMap && MapView.getMap(); if (m && m.invalidateSize) m.invalidateSize(); }, 100);
    }
  }
});
