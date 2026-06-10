(function() {
  const UI = window.UI = window.UI || {};

  function getDayName() {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  }

  function getTodaysSchedule(schedules) {
    const day = getDayName();
    const dayLower = day.toLowerCase();
    for (const s of schedules) {
      const name = (s.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (day === 'Saturday' || day === 'Sunday') {
        if (name.includes(dayLower)) return s;
      }
      if (name.includes('monday to friday') || name.includes('monday-friday') || name.includes('mon-fri') || name.includes('weekday') || name.includes('mon to fri')) return s;
    }
    if (day === 'Saturday') return schedules.find(s => (s.name || '').toLowerCase().includes('saturday')) || schedules[0];
    if (day === 'Sunday') return schedules.find(s => (s.name || '').toLowerCase().includes('sunday')) || schedules[0];
    return schedules[0];
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
    const kj = schedule.knownJourneys;
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

  function parseTimetableData(data) {
    if (!data || !data.timetable) {
      console.log('[Timetable] No timetable field', data ? Object.keys(data) : 'null');
      return { schedules: [], direction: data ? data.direction || '' : '' };
    }
    const tt = data.timetable;
    const direction = data.direction || '';
    let schedules = [];
    if (tt.schedules && tt.schedules.length) {
      console.log('[Timetable] Schedules:', tt.schedules.map(s => s.name + ' (kj:' + (s.knownJourneys ? s.knownJourneys.length : 0) + ' per:' + (s.periods ? s.periods.length : 0) + ')'));
      const todaySchedule = getTodaysSchedule(tt.schedules);
      if (todaySchedule) {
        const journeys = extractJourneyTimes(todaySchedule);
        console.log('[Timetable] Using schedule:', todaySchedule.name, 'journeys:', journeys.length);
        schedules.push({ name: todaySchedule.name, journeys, periods: todaySchedule.periods || [] });
      } else {
        console.log('[Timetable] No schedule matched today, using first');
        const first = tt.schedules[0];
        const journeys = extractJourneyTimes(first);
        schedules.push({ name: first.name, journeys, periods: first.periods || [] });
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
          if (data && data.timetable && data.timetable.schedules && data.timetable.schedules.length) {
            console.log('[Timetable] Got', data.timetable.schedules.length, 'schedules from', sid, 'dir:', dir);
            results.push(data);
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

  UI.showRouteTimetable = async function(stopId, stopName, lineId, directionFilter) {
    const panel = document.getElementById('departures-panel');
    panel.style.display = 'flex';
    panel.dataset.stopName = stopName;
    const list = document.getElementById('departures-list');
    list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    // Fetch arrivals first to get display name
    let arrivals = [];
    try { arrivals = await Stops.getArrivals(stopId); } catch (e) { console.log('[Timetable] Arrivals error:', e); }
    const displayName = arrivals.length ? (arrivals.find(a => a.lineId === lineId || a.line === lineId)?.line || lineId) : lineId;
    const headerSuffix = directionFilter ? ' (' + directionFilter + ')' : '';
    panel.querySelector('h3').innerHTML = '📋 ' + displayName + headerSuffix + ' Timetable \u00b7 ' + stopName + ' <span class="stop-code">' + stopId + '</span>';

    const resolvedStopIds = await Stops.resolveStopIds(stopId).catch(() => [stopId]);
    console.log('[Timetable] Resolved stop IDs:', resolvedStopIds);

    let allSchedules = [];
    const timetableResponses = await fetchAllTimetables(resolvedStopIds, lineId);
    timetableResponses.forEach(data => {
      const parsed = parseTimetableData(data);
      if (parsed.schedules.length && parsed.schedules[0].journeys.length) {
        const dirKey = parsed.direction || 'default';
        const existing = allSchedules.find(s => s.direction === dirKey);
        if (!existing) allSchedules.push(parsed);
      }
    });

    // Filter live arrivals by line + direction
    let routeArrivals = arrivals.filter(a => a.lineId === lineId || a.line === lineId);
    if (directionFilter) {
      routeArrivals = routeArrivals.filter(a => a.dirLabel === directionFilter);
    }
    routeArrivals = routeArrivals.slice(0, 10);

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
      filteredSchedules = allSchedules.filter(tt => {
        const schedName = (tt.schedules[0]?.name || '').toLowerCase();
        if (schedName.includes(dirLower)) return true;
        const apiDir = (tt.direction || '').toLowerCase();
        // Map inbound/outbound to common bound terms
        if (apiDir === 'inbound' && ['eastbound', 'westbound', 'northbound', 'southbound'].includes(dirLower)) {
          // Inbound could match any — don't filter out
          return true;
        }
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

    if (!liveHtml && !filteredSchedules.length) {
      list.innerHTML = '<div class="no-data">No timetable data available for route ' + displayName + ' at this stop</div>' +
        '<div style="padding:8px 12px;text-align:center"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
      setTimeout(() => { const pb = panel.querySelector('.panel-body'); if (pb) pb.scrollTop = 0; }, 50);
      return;
    }

    let html = liveHtml;
    if (filteredSchedules.length) {
      filteredSchedules.forEach(tt => {
        const schedName = tt.schedules.length ? tt.schedules[0].name : '';
        let dirLabel = '';
        if (schedName) {
          const dirMatch = schedName.match(/[-–—]\s*(Westbound|Eastbound|Northbound|Southbound|Inner Rail|Outer Rail)/i);
          if (dirMatch) dirLabel = ' (' + dirMatch[1] + ')';
        }
        if (!dirLabel && tt.direction) {
          dirLabel = ' (' + tt.direction.charAt(0).toUpperCase() + tt.direction.slice(1) + ')';
        }
        html += '<div class="tt-section"><div class="tt-header">\u25a0 Scheduled Timetable' + dirLabel + '</div><div class="tt-grid">';
        tt.schedules.forEach(s => {
          if (s.journeys.length) {
            html += '<div class="tt-day-label">' + s.name + '</div>';
            s.journeys.forEach(j => {
              html += '<div class="tt-entry" data-time="' + j.timeStr + '">' + j.timeStr + '</div>';
            });
          }
        });
        html += '</div></div>';
      });
    }

    html += '<div class="tt-actions"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
    list.innerHTML = html;
    setTimeout(() => { const pb = panel.querySelector('.panel-body'); if (pb) pb.scrollTop = 0; }, 50);
  };

  UI.showStopTimetable = async function(stopId, stopName) {
    const panel = document.getElementById('departures-panel');
    panel.style.display = 'flex';
    panel.dataset.stopName = stopName;
    const list = document.getElementById('departures-list');
    list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    panel.querySelector('h3').innerHTML = '📋 ' + stopName + ' Timetable <span class="stop-code">' + stopId + '</span>';
    let routes = [], liveArrivals = [];
    try {
      liveArrivals = await Stops.getArrivals(stopId);
      if (liveArrivals.length) routes = [...new Set(liveArrivals.map(a => a.line).filter(Boolean))];
    } catch (e) { console.log('[StopTimetable] Live arrivals error:', e); }
    if (!routes.length) {
      try {
        const stopData = await Api.getStopRoutes(stopId);
        if (stopData && stopData.stopRoutes && stopData.stopRoutes.length) {
          routes = [...new Set(stopData.stopRoutes.map(r => r.lineId || r.routeId || r.id || r.name).filter(Boolean))];
        }
      } catch (e) { console.log('[StopTimetable] Stop routes API error:', e); }
    }
    if (!routes.length) {
      list.innerHTML = '<div class="no-data">No routes found for this stop</div><div style="padding:8px 12px;text-align:center"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
      return;
    }
    let html = '<div class="tt-section"><div class="tt-header">\u25a0 Routes at this stop</div></div><div class="tt-stops-routes">';
    routes.slice(0, 30).forEach(r => {
      const routeLive = liveArrivals.filter(a => a.line === r);
      const mode = routeLive.length ? routeLive[0].mode : 'bus';
      const color = Stops.getModeColor(mode);
      const nextDue = routeLive.length ? routeLive[0].timeToStation : null;
      const nextText = nextDue !== null ? (nextDue <= 0 ? 'Due' : nextDue + ' min') : '';
      html += '<button class="tt-route-btn" data-stop="' + stopId + '" data-line="' + r + '" style="border-left-color:' + color + '">' +
        '<span class="tt-route-icon">' + Stops.getModeIcon(mode) + '</span>' +
        '<span class="tt-route-num" style="background:' + color + '">' + r + '</span>' +
        '<span class="tt-route-next">' + nextText + '</span>' +
        '<span class="tt-route-arrow">\u2192</span></button>';
    });
    html += '</div><div class="tt-actions"><button class="btn-secondary tt-back-btn">\u2190 Back to Live</button></div>';
    list.innerHTML = html;
    setTimeout(() => { const pb = panel.querySelector('.panel-body'); if (pb) pb.scrollTop = 0; }, 50);
  };

  window.UI = UI;
})();
