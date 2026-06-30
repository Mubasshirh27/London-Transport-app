const TripNav = (() => {
  const S = window.__appState;

  // --- Internal trip state ---
  let tripWatchId = null;
  let tripActiveKey = null;
  let tripLegIndex = -1;
  let lastLegTransitionTime = 0;
  let lastRenderedLegIndex = -1;
  let tripArrived = false;
  let tripDeviationStart = null;
  let tripRerouting = false;
  let followEnabled = true;
  let _posHistory = [];
  let _currentSpeed = 1.4;
  let _tripDelaySecs = 0;
  let _autoEndTimer = null;
  let _autoEndPaused = false;
  let _navHeaderCleanup = null;
  let _persistInterval = null;
  let recenterBtn = null;
  let _tlRenderGen = 0;
  let _gpsRetryCount = 0;
  let _gpsRetryTimer = null;
  let _gpsFirstFixReceived = false;
  let _gpsFirstFixTimer = null;

  // --- Helper functions ---
  function getLegStartStationIndex(legs, legIdx) {
    let idx = 0;
    for (let i = 0; i < legIdx; i++) {
      const leg = legs[i];
      if (!leg) continue;
      if (leg.mode === 'walking' || leg.mode === 'cycling') continue;
      if (leg.from && leg.from.lat != null) idx++;
      if (leg.stops) idx += leg.stops.filter(s => s.lat != null && s.lon != null).length;
      if (leg.to && leg.to.lat != null) idx++;
    }
    return idx;
  }

  function distanceDeg(lat1, lon1, lat2, lon2) {
    return Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2);
  }

  function getProgressAlongPath(path, lat, lon) {
    if (!path || path.length < 2) return -1;
    let minDistSq = Infinity, closestSeg = 0, closestT = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i], p2 = path[i + 1];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const segLenSq = dx * dx + dy * dy;
      if (segLenSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((lat - p1[0]) * dx + (lon - p1[1]) * dy) / segLenSq));
      const px = p1[0] + t * dx, py = p1[1] + t * dy;
      const d = (px - lat) ** 2 + (py - lon) ** 2;
      if (d < minDistSq) { minDistSq = d; closestSeg = i; closestT = t; }
    }
    let cumDist = 0;
    for (let i = 0; i < closestSeg; i++) {
      cumDist += Math.sqrt((path[i+1][0] - path[i][0]) ** 2 + (path[i+1][1] - path[i][1]) ** 2);
    }
    cumDist += closestT * Math.sqrt(
      (path[closestSeg+1][0] - path[closestSeg][0]) ** 2 + (path[closestSeg+1][1] - path[closestSeg][1]) ** 2
    );
    let totalLen = 0;
    for (let i = 0; i < path.length - 1; i++) {
      totalLen += Math.sqrt((path[i+1][0] - path[i][0]) ** 2 + (path[i+1][1] - path[i][1]) ** 2);
    }
    return totalLen > 0 ? cumDist / totalLen : 0;
  }

  function cleanWalkInstruction(instruction, modifier, distance) {
    if (!instruction) return 'Walk';
    let text = instruction;
    text = text.replace(/\bon\s+to\s+/gi, '');
    text = text.replace(/\bonto\s+/gi, '');
    text = text.replace(/,?\s*continue\s+for\s+[\d.]+\s*(metres|meters)/gi, '');
    text = text.replace(/^for\s+[\d.]+\s*(metres|meters)[,\s]*/gi, '');
    text = text.replace(/^for\s+[\d.]+\s*(metres|meters)/gi, '');
    text = text.replace(/,\s*$/, '');
    text = text.trim();
    if (!text) {
      const action = { 'turn-left': 'Turn left', 'turn-right': 'Turn right', 'uturn': 'U-turn', 'sharp-left': 'Sharp left', 'sharp-right': 'Sharp right', 'slight-left': 'Slight left', 'slight-right': 'Slight right', 'depart': 'Start walking', 'arrive': 'Arrive', 'continue': 'Continue', 'merge': 'Merge' }[modifier] || 'Walk';
      return action;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function getPathLength(path) {
    if (!path || path.length < 2) return 0;
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
      len += Helpers.haversine(path[i][0], path[i][1], path[i+1][0], path[i+1][1]);
    }
    return len;
  }

  // --- GPS Watch ---
  function startGPSWatch() {
    _gpsFirstFixReceived = false;
    let firstFix = true;
    let lastGoodLat = null, lastGoodLon = null;

    return navigator.geolocation.watchPosition(
      (pos) => {
        if (tripWatchId === null) return;
        if (!pos || !pos.coords) return;
        _gpsFirstFixReceived = true;
        if (_gpsFirstFixTimer) { clearTimeout(_gpsFirstFixTimer); _gpsFirstFixTimer = null; }
        const { latitude: lat, longitude: lon, speed, heading, accuracy } = pos.coords;
        console.log('GPS fix:', lat.toFixed(4), lon.toFixed(4), 'acc:', accuracy, 'spd:', speed);

        if (accuracy != null && accuracy > 200 && lastGoodLat != null && lastGoodLon != null) {
          updateTripProgress(lastGoodLat, lastGoodLon, pos);
          return;
        }

        lastGoodLat = lat; lastGoodLon = lon;
        S._lastLat = lat; S._lastLon = lon;
        const now = Date.now();

        if (tripActiveKey && S.activeJourneys && S.activeJourneys[tripActiveKey]) {
          window.__tripStateSnapshot = {
            key: tripActiveKey,
            journey: S.activeJourneys[tripActiveKey],
            legIndex: tripLegIndex,
            lastTransition: lastLegTransitionTime,
            currentStationIndex: S.currentStationIndex,
            fromLabel: UI.getFromText() || 'From',
            toLabel: UI.getToText() || 'Destination',
            lat: lat,
            lon: lon
          };
        }

        if (_posHistory.length && _posHistory[_posHistory.length - 1]) {
          const last = _posHistory[_posHistory.length - 1];
          const dist = Helpers.haversine(last.lat, last.lon, lat, lon);
          const dt = (now - last.ts) / 1000;
          if (dt > 0.5 && dt < 60 && dist < 500) {
            const gpsSpeed = speed !== null && speed !== undefined ? speed : (dist / dt);
            if (gpsSpeed > 0.3 && gpsSpeed < 30) _currentSpeed = gpsSpeed;
          }
        }
        _posHistory.push({ lat, lon, ts: now });
        if (_posHistory.length > 10) _posHistory.shift();
        _currentSpeed = Math.max(0.5, Math.min(3, _currentSpeed));

        MapView.showUserLocation(lat, lon, heading, accuracy);
        if (followEnabled) {
          if (firstFix) {
            MapView.flyTo(lat, lon, 14);
            firstFix = false;
          } else {
            MapView.panTo(lat, lon);
          }
          recenterBtn.style.display = 'none';
        } else {
          recenterBtn.style.display = 'inline-block';
        }
        updateTripProgress(lat, lon, pos);
      },
      (err) => {
        if (tripWatchId === null) return;
        console.warn('GPS error:', err.code, err.message);
        if (_gpsFirstFixTimer) { clearTimeout(_gpsFirstFixTimer); _gpsFirstFixTimer = null; }
        _gpsRetryCount++;
        const isOffline = typeof OfflineManager !== 'undefined' ? !OfflineManager.isOnline() : !navigator.onLine;
        if (_gpsRetryCount >= 3 && !isOffline) {
          UI.showError('Navigation error: ' + err.message + '. Check location permissions and try again.');
          document.dispatchEvent(new Event('end-trip'));
        } else if (_gpsRetryCount >= 3 && isOffline) {
          UI.showError('GPS unavailable — continuing trip with last known position.');
        } else {
          UI.showError('GPS not responding, retrying... (' + _gpsRetryCount + '/3). Ensure location is enabled.');
        }
        clearTimeout(_gpsRetryTimer);
        _gpsRetryTimer = setTimeout(() => {
          if (tripWatchId === null) return;
          navigator.geolocation.clearWatch(tripWatchId);
          tripWatchId = startGPSWatch();
        }, _gpsRetryCount * 2000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
    );
  }

  // --- Visibility / Handlers ---
  function _onVisibilityChange() {
    if (document.hidden) {
      saveTripState();
      if (_autoEndTimer !== null) {
        clearTimeout(_autoEndTimer);
        _autoEndTimer = null;
        _autoEndPaused = true;
      }
    } else {
      if (_autoEndPaused) {
        _autoEndPaused = false;
        if (tripArrived && _autoEndTimer === null) {
          _autoEndTimer = setTimeout(() => document.dispatchEvent(new Event('end-trip')), 2000);
        }
      }
      if (typeof OfflineManager !== 'undefined') OfflineManager.forceCheck();
    }
  }

  function _cleanupNavHandlers() {
    if (_navHeaderCleanup) {
      _navHeaderCleanup.forEach(({ el, type, fn, opts }) => el.removeEventListener(type, fn, opts));
      _navHeaderCleanup = null;
    }
  }

  function saveTripState() {
    if (!tripActiveKey) return;
    const j = S.activeJourneys && S.activeJourneys[tripActiveKey];
    if (!j) return;
    try {
      Store.saveJourneyState({
        key: tripActiveKey,
        journey: j,
        legIndex: tripLegIndex,
        lastTransition: lastLegTransitionTime,
        fromLabel: UI.getFromText() || 'From',
        toLabel: UI.getToText() || 'Destination'
      });
    } catch(e) {}
  }

  function openMapOverlay() {
    const overlay = document.getElementById('map-overlay');
    if (!overlay.classList.contains('open')) {
      overlay.classList.add('open');
      document.getElementById('map-toggle-btn').innerHTML = '<span class="ic" data-ic="close"></span> Close';
      document.body.style.overflow = 'hidden';
    }
  }

  // --- Timeline Rendering ---
  function renderTripTimeline(journey, legs, tripLegIdx, lat, lon, distToNextStation, etaStr) {
    _tlRenderGen++;
    const _thisGen = _tlRenderGen;
    const container = document.getElementById('trip-timeline');
    if (!container) { return; }

    if (!container.dataset.tlDelegate) {
      container.dataset.tlDelegate = '1';
      container.addEventListener('click', function(e) {
        var stops = e.target.closest('.tl-col-stops');
        if (!stops) return;
        var toggle = stops.querySelector('.tl-col-toggle');
        if (toggle && !toggle.contains(e.target)) return;
        var content = stops.querySelector('.tl-col-content');
        var arrow = stops.querySelector('.tl-col-arrow');
        var key = stops.dataset.colKey;
        var open = content.style.display !== 'none';
        content.style.display = open ? 'none' : 'block';
        if (arrow) arrow.textContent = open ? '▶' : '▼';
        stops.classList.toggle('open', !open);
        if (key) S._walkOpen[key] = !open;
      });
    }

    let currentLeg = legs[tripLegIdx];
    if (!currentLeg) return;

    container.innerHTML = '';

    currentLeg = legs[tripLegIdx];
    if (!currentLeg) return;

    const now = Date.now();
    let html = '';
    let globalStationIdx = 0;

    const legStartGlobalIdx = getLegStartStationIndex(legs, tripLegIdx);
    const perLegCurrentIdx = S.currentStationIndex - legStartGlobalIdx;

    function countRemainingStops() {
      let count = 0;
      const cl = legs[tripLegIdx];
      if (cl) {
        if (cl.stops) {
          const startIdx = Math.max(0, perLegCurrentIdx - (cl.from ? 1 : 0));
          for (let i = startIdx; i < cl.stops.length; i++) {
            if (cl.stops[i].lat != null && i > perLegCurrentIdx - (cl.from ? 1 : 0)) count++;
          }
        }
        const lastStopIdx = (cl.from ? 1 : 0) + (cl.stops ? cl.stops.filter(s => s.lat != null).length : 0);
        if (cl.to && perLegCurrentIdx < lastStopIdx) count++;
      }
      for (let r = tripLegIdx + 1; r < legs.length; r++) {
        const rl = legs[r];
        if (!rl || rl.mode === 'walking' || rl.mode === 'cycling') continue;
        if (rl.from && rl.from.lat != null) count++;
        if (rl.stops) count += rl.stops.filter(s => s.lat != null).length;
        if (rl.to && rl.to.lat != null) count++;
      }
      return count;
    }
    const stopsRemaining = countRemainingStops();

    const modeIcon = Router.getModeIcon(currentLeg.mode);
    const rawRoute = currentLeg.routeName || currentLeg.modeName || currentLeg.mode || 'Travel';
    const routeName = Router.formatRouteName(rawRoute, currentLeg.mode) || rawRoute;
    const platform = currentLeg.platformName || '';
    const direction = currentLeg.direction || '';
    const depTime = currentLeg.departureTime ? new Date(currentLeg.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const arrTime = currentLeg.arrivalTime ? new Date(currentLeg.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    if (currentLeg.mode !== 'walking') {
      let statusHtml = '';
      try {
        const statusLines = window.__statusLines || [];
        const lineId = (currentLeg.lineId || currentLeg.routeId || '').toString();
        let lineStatus = null;
        if (lineId) lineStatus = Status.getLineStatus(statusLines, lineId);
        if (!lineStatus && currentLeg.routeName) {
          lineStatus = statusLines.find(s => s.name && s.name.toLowerCase() === (currentLeg.routeName || '').toLowerCase());
        }
        if (!lineStatus && currentLeg.mode === 'national-rail') {
          lineStatus = statusLines.find(s => s.mode === 'national-rail');
        }
        if (lineStatus) {
          statusHtml = '<span class="tl-line-status ' + (lineStatus.statusCls || '') + '" title="' + Helpers.esc(lineStatus.statusText || '') + '">' + Helpers.esc((lineStatus.statusText || '').split(':')[0]) + '</span>';
        }
      } catch (e) { statusHtml = ''; }

      html += '<div class="tl-leg-header">';
      html += '<span class="tl-leg-mode-icon">' + modeIcon + '</span>';
      html += '<div class="tl-leg-info">';
      html += '<div class="tl-leg-line-name">' + Helpers.esc(routeName) + (direction ? ' <span class="tl-leg-dir">→ ' + Helpers.esc(direction) + '</span>' : '') + '</div>';
      html += '</div>';
      if (platform) html += '<div class="tl-leg-platform">' + Helpers.esc(platform) + '</div>';
      html += statusHtml;
      html += '</div>';
    }

    if (currentLeg.from && currentLeg.mode !== 'walking') {
      const isCompleted = perLegCurrentIdx > globalStationIdx;
      const isCurrent = perLegCurrentIdx === globalStationIdx;
      html += '<div class="tl-station ' + (isCompleted ? 'completed' : (isCurrent ? 'current' : 'upcoming')) + '">';
      html += '<div class="tl-dot"></div>';
      html += '<div class="tl-station-info">';
      html += '<span class="tl-station-name">' + Helpers.esc(currentLeg.from.name || '') + '</span>';
      if (depTime) html += '<span class="tl-station-time">' + depTime + '</span>';
      html += '</div>';
      html += '</div>';
      globalStationIdx++;
    }

    if (currentLeg.stops && currentLeg.stops.length && currentLeg.mode !== 'walking') {
      let firstShown = false;
      const colStops = [];
      for (const stop of currentLeg.stops) {
        if (!stop.lat || !stop.lon) continue;
        const isCompleted = perLegCurrentIdx > globalStationIdx;
        const isCurrent = perLegCurrentIdx === globalStationIdx;
        const stopState = isCompleted ? 'completed' : (isCurrent ? 'current' : 'upcoming');

        if (stopState === 'upcoming') {
          if (!firstShown) {
            firstShown = true;
            html += '<div class="tl-station upcoming" data-station-idx="' + globalStationIdx + '">';
            html += '<div class="tl-dot"></div>';
            html += '<div class="tl-station-info">';
            html += '<span class="tl-station-name">' + Helpers.esc(stop.name || '') + '</span>';
            html += '<span class="tl-next-stop-badge">Next stop</span>';
            html += '</div></div>';
          } else {
            colStops.push({ stop, idx: globalStationIdx });
          }
        } else {
          html += '<div class="tl-station ' + stopState + '" data-station-idx="' + globalStationIdx + '">';
          html += '<div class="tl-dot"></div>';
          html += '<div class="tl-station-info">';
          html += '<span class="tl-station-name">' + Helpers.esc(stop.name || '') + '</span>';
          if (stopState === 'current' && distToNextStation !== null) {
            html += '<span class="tl-you-are-here">' + Math.round(distToNextStation) + 'm away</span>';
          }
          html += '</div></div>';
        }
        globalStationIdx++;
      }
      if (colStops.length > 0) {
        const colKey = '_col_' + tripLegIdx;
        const colOpen = !!S._walkOpen[colKey];
        html += '<div class="tl-col-stops' + (colOpen ? ' open' : '') + '" data-col-key="' + colKey + '">';
        html += '<div class="tl-col-toggle">';
        html += '<span class="tl-col-arrow">' + (colOpen ? '▼' : '▶') + '</span>';
        html += '<span class="tl-col-summary">ride ' + colStops.length + ' stop' + (colStops.length > 1 ? 's' : '') + '</span>';
        html += '</div>';
        html += '<div class="tl-col-content" style="display:' + (colOpen ? 'block' : 'none') + '">';
        for (const item of colStops) {
          html += '<div class="tl-station-upcoming-compact">';
          html += '<div class="tl-station-info">';
          html += '<span class="tl-col-stop-name">▸ ' + Helpers.esc(item.stop.name || '') + '</span>';
          html += '</div></div>';
        }
        html += '</div></div>';
      }
    }

    if (currentLeg.to && currentLeg.mode !== 'walking') {
      const isCompleted = perLegCurrentIdx > globalStationIdx;
      const isCurrent = perLegCurrentIdx === globalStationIdx;
      const destState = isCompleted ? 'completed' : (isCurrent ? 'current' : 'upcoming');
      const approachingDest = isCurrent && currentLeg.mode !== 'walking' && distToNextStation !== null && distToNextStation < 200;

      html += '<div class="tl-station ' + destState + '" data-station-idx="' + globalStationIdx + '">';
      html += '<div class="tl-dot"></div>';
      html += '<div class="tl-station-info">';
      html += '<span class="tl-station-name">' + Helpers.esc(currentLeg.to.name || '') + '</span>';
      if (approachingDest) html += '<span class="tl-alight-badge">Get off</span>';
      if (isCurrent && distToNextStation !== null) {
        html += '<span class="tl-you-are-here">' + Math.round(distToNextStation) + 'm away</span>';
      }
      html += '<span class="tl-station-time">' + (arrTime || '') + '</span>';
      html += '</div>';
      html += '</div>';
      globalStationIdx++;
    }

    if (currentLeg.mode === 'walking') {
      const totalDist = currentLeg.path && currentLeg.path.length >= 2 ? getPathLength(currentLeg.path) : 0;
      let remainingDist = totalDist;
      if (totalDist > 0 && lat != null && lon != null && currentLeg.path && currentLeg.path.length >= 2) {
        const progress = getProgressAlongPath(currentLeg.path, lat, lon);
        if (progress > 0) remainingDist = Math.max(0, (1 - Math.min(progress, 1)) * totalDist);
      }
      const walkDist = Math.round(remainingDist);
      const walkDur = currentLeg.duration || 0;
      const walkDistStr = walkDist >= 1000 ? (walkDist / 1000).toFixed(1) + 'km' : walkDist + 'm';
      html += '<div class="tl-walking">';
      html += '<span class="tl-walking-icon">🚶</span>';
      html += '<span class="tl-walking-text">Walk ' + walkDur + ' min</span>';
      if (walkDist > 0) html += '<span class="tl-walking-dist">• ' + walkDistStr + '</span>';
      html += '</div>';
    }

    let remStartIdx = tripLegIdx + 1;
    const nextLegAfter = legs[tripLegIdx + 1];
    if (nextLegAfter && nextLegAfter.mode === 'walking') {
      const wlkDist = nextLegAfter.path && nextLegAfter.path.length >= 2 ? Math.round(getPathLength(nextLegAfter.path)) : 0;
      const wlkDur = nextLegAfter.duration || 0;
      const wlkDistStr = wlkDist >= 1000 ? (wlkDist / 1000).toFixed(1) + 'km' : wlkDist + 'm';
      html += '<div class="tl-walking">';
      html += '<span class="tl-walking-icon">🚶</span>';
      html += '<span class="tl-walking-text">Walk ' + wlkDur + ' min</span>';
      if (wlkDist > 0) html += '<span class="tl-walking-dist">• ' + wlkDistStr + '</span>';
      html += '</div>';
      remStartIdx = tripLegIdx + 2;
    }

    const remainingStopsCount = stopsRemaining;
    if (remainingStopsCount > 0) {
      html += '<div class="tl-rem-content" style="display:block">';

      for (let ri = remStartIdx; ri < legs.length; ri++) {
        const remLeg = legs[ri];
        if (!remLeg) { html += '</div><div style="display:none">'; continue; }

        if (remLeg.mode === 'walking') {
          const walkDist = remLeg.path && remLeg.path.length >= 2 ? Math.round(getPathLength(remLeg.path)) : 0;
          const walkDur = remLeg.duration || 0;
          const walkDistStr = walkDist >= 1000 ? (walkDist / 1000).toFixed(1) + 'km' : walkDist + 'm';
          html += '<div class="tl-walking">';
          html += '<span class="tl-walking-icon">🚶</span>';
          html += '<span class="tl-walking-text">Walk ' + walkDur + ' min</span>';
          if (walkDist > 0) html += '<span class="tl-walking-dist">• ' + walkDistStr + '</span>';
          html += '</div>';
          continue;
        }

        const remIcon = Router.getModeIcon(remLeg.mode);
        const remRawRoute = remLeg.routeName || remLeg.modeName || remLeg.mode || 'Travel';
        const remRouteName = Router.formatRouteName(remRawRoute, remLeg.mode) || remRawRoute;
        const remDir = remLeg.direction || '';
        const remDepTime = remLeg.departureTime ? new Date(remLeg.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const remArrTime = remLeg.arrivalTime ? new Date(remLeg.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        html += '<div class="tl-leg-header tl-rem-leg-header">';
        html += '<span class="tl-leg-mode-icon">' + remIcon + '</span>';
        html += '<div class="tl-leg-info">';
        html += '<div class="tl-leg-line-name">' + Helpers.esc(remRouteName) + (remDir ? ' <span class="tl-leg-dir">→ ' + Helpers.esc(remDir) + '</span>' : '') + '</div>';
        html += '</div>';
        if (remLeg.platformName) html += '<div class="tl-leg-platform">' + Helpers.esc(remLeg.platformName) + '</div>';
        html += '</div>';

        if (remLeg.from) {
          let depCountdown = '';
          if (remLeg.departureTime) {
            const depMs = new Date(remLeg.departureTime).getTime();
            const minsUntil = Math.round((depMs - now) / 60000);
            if (minsUntil > 0 && minsUntil <= 30) depCountdown = 'Departs in ' + minsUntil + ' min';
            else if (minsUntil <= 0 && minsUntil > -5) depCountdown = 'Departs now';
          }
          html += '<div class="tl-station upcoming">';
          html += '<div class="tl-dot"></div>';
          html += '<div class="tl-station-info">';
          html += '<span class="tl-station-name">' + Helpers.esc(remLeg.from.name || '') + '</span>';
          html += '<span class="tl-station-time">' + (remDepTime || '') + '</span>';
          if (depCountdown) html += '<span class="tl-dep-countdown">' + depCountdown + '</span>';
          html += '</div>';
          html += '</div>';
        }

        if (remLeg.stops && remLeg.stops.length) {
          let remFirstShown = false;
          const remColStops = [];
          for (const stop of remLeg.stops) {
            if (!stop.name) continue;
            if (!remFirstShown) {
              remFirstShown = true;
              html += '<div class="tl-station-upcoming-compact">';
              html += '<div class="tl-station-info">';
              html += '<span class="tl-col-stop-name">▸ ' + Helpers.esc(stop.name || '') + '</span>';
              html += '</div></div>';
            } else {
              remColStops.push(stop);
            }
          }
          if (remColStops.length > 0) {
            const remColKey = '_remc_' + ri;
            const remColOpen = !!S._walkOpen[remColKey];
            html += '<div class="tl-col-stops' + (remColOpen ? ' open' : '') + '" data-col-key="' + remColKey + '">';
            html += '<div class="tl-col-toggle">';
            html += '<span class="tl-col-arrow">' + (remColOpen ? '▼' : '▶') + '</span>';
            html += '<span class="tl-col-summary">ride ' + remColStops.length + ' stop' + (remColStops.length > 1 ? 's' : '') + '</span>';
            html += '</div>';
            html += '<div class="tl-col-content" style="display:' + (remColOpen ? 'block' : 'none') + '">';
            for (const item of remColStops) {
              html += '<div class="tl-station-upcoming-compact">';
              html += '<div class="tl-station-info">';
              html += '<span class="tl-col-stop-name">▸ ' + Helpers.esc(item.name || '') + '</span>';
              html += '</div></div>';
            }
            html += '</div></div>';
          }
        }

        if (remLeg.to) {
          html += '<div class="tl-station upcoming">';
          html += '<div class="tl-dot"></div>';
          html += '<div class="tl-station-info">';
          html += '<span class="tl-station-name">' + Helpers.esc(remLeg.to.name || '') + '</span>';
          html += '<span class="tl-station-time">' + (remArrTime || '') + '</span>';
          html += '</div>';
          html += '</div>';
        }
      }

      html += '</div>';
    }

    const destLeg = legs[legs.length - 1];
    const destName = destLeg && destLeg.to ? (destLeg.to.name || 'Destination') : 'Destination';

    html += '<div class="tl-footer">';
    html += '<div class="tl-footer-leg">';
    html += '<span class="tl-footer-icon">📍</span>';
    html += '<span class="tl-footer-name">' + Helpers.esc(destName) + '</span>';
    if (etaStr) html += '<span class="tl-footer-time">ETA ' + Helpers.esc(etaStr) + '</span>';
    html += '</div>';
    html += '</div>';

    container.innerHTML = html;

    const currentEl = container.querySelector('.tl-station.current');
    if (currentEl) {
      setTimeout(() => {
        if (window._tlRenderGen !== _thisGen) return;
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }

    setTimeout(() => {
      if (window._tlRenderGen !== _thisGen) return;
      try {
        const footer = container.querySelector('.tl-footer');
        const scrollParent = document.getElementById('trip-nav-body') || container.parentElement;
        if (!footer || !scrollParent) return;

        const spRect = scrollParent.getBoundingClientRect();
        const ftRect = footer.getBoundingClientRect();

        const docStyle = getComputedStyle(document.documentElement);
        const safeAreaBottom = parseFloat(docStyle.getPropertyValue('--safe-b')) || 0;
        const extraPadding = 12 + (isNaN(safeAreaBottom) ? 0 : safeAreaBottom);

        const visibleBottom = spRect.bottom - extraPadding;
        if (ftRect.bottom > visibleBottom) {
          const delta = Math.ceil(ftRect.bottom - visibleBottom + 8);
          const footerOffsetTop = footer.offsetTop;
          const footerOffsetBottom = footerOffsetTop + footer.offsetHeight;
          const scrollNeeded = footerOffsetBottom - (scrollParent.scrollTop + scrollParent.clientHeight - extraPadding) + 8;
          scrollParent.scrollBy({ top: scrollNeeded, left: 0, behavior: 'smooth' });
        }
      } catch (e) { /* ignore */ }
    }, 500);
  }

  function renderTripRoutes() {
    const journey = S.activeJourneys[tripActiveKey];
    if (!journey) return;
    MapView.clearRoutes();
    MapView.clearMarkers();

    const modeColors = { walking: '#888', bus: '#e32017', tube: '#0019a8', dlr: '#00a94f', overground: '#f86c00', 'elizabeth-line': '#6950a8', 'national-rail': '#003688', tram: '#66cc00' };

    const allStations = [];
    let stationIdx = 0;
    const legStartStationIdx = [];

    journey.legs.forEach((leg, legIdx) => {
      legStartStationIdx[legIdx] = stationIdx;
      if (leg.from && leg.from.lat != null) {
        allStations.push({ ...leg.from, stationIdx: stationIdx++, legIndex: legIdx, type: 'departure' });
      }
      if (leg.stops && leg.stops.length) {
        leg.stops.forEach(s => {
          if (s.lat != null) allStations.push({ ...s, stationIdx: stationIdx++, legIndex: legIdx, type: 'stop' });
        });
      }
      if (leg.to && leg.to.lat != null) {
        allStations.push({ ...leg.to, stationIdx: stationIdx++, legIndex: legIdx, type: 'arrival' });
      }
    });

    allStations.forEach((station, idx) => {
      let color, size, label;
      const isCompleted = idx < S.currentStationIndex;
      const isCurrent = idx === S.currentStationIndex;
      const isUpcoming = idx > S.currentStationIndex;

      if (tripArrived || isCompleted) {
        color = '#00cc66'; size = 10; label = station.name || 'Station';
      } else if (isCurrent) {
        color = '#4285f4'; size = 14; label = station.name || 'Station';
      } else {
        color = '#aaaaaa'; size = 8; label = station.name || 'Station';
      }

      MapView.addMarker(station.lat, station.lon, label, color);
    });

    journey.legs.forEach((leg, i) => {
      const path = leg.path || [];
      if (path.length < 2) return;

      if (i < tripLegIndex) {
        MapView.addRoute(path, '#00cc66', '', 3);
      } else if (i === tripLegIndex) {
        MapView.addRoute(path, '#33ff99', '', 6);
      } else {
        MapView.addRoute(path, modeColors[leg.mode] || '#666', '', 4);
      }
    });

    const validStations = allStations.filter(s => s.lat != null && s.lon != null && !isNaN(s.lat) && !isNaN(s.lon));
    if (validStations.length > 0) {
      const lats = validStations.map(s => s.lat);
      const lons = validStations.map(s => s.lon);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);
      const midLat = (minLat + maxLat) / 2;
      const midLon = (minLon + maxLon) / 2;
      if (!isNaN(midLat) && !isNaN(midLon)) {
        MapView.flyTo(midLat, midLon, 12);
      }
    }
  }

  function updateTripProgress(lat, lon, gpsPos) {
    const journey = S.activeJourneys[tripActiveKey];
    if (!journey || !journey.legs.length) return;
    const legs = journey.legs;
    const currentLeg = legs[tripLegIndex];
    if (!currentLeg) return;
    const now = Date.now();
    const speed = _currentSpeed;

    if (tripLegIndex < legs.length - 1 && now - lastLegTransitionTime > 5000) {
      let distToEnd = Infinity, distToNextStart = Infinity;
      if (currentLeg.to && currentLeg.to.lat != null) {
        distToEnd = Helpers.haversine(lat, lon, currentLeg.to.lat, currentLeg.to.lon);
      }
      const nextLeg = legs[tripLegIndex + 1];
      if (nextLeg && nextLeg.from && nextLeg.from.lat != null) {
        distToNextStart = Helpers.haversine(lat, lon, nextLeg.from.lat, nextLeg.from.lon);
      }
      const ADVANCE_THRESHOLD = 80;
      if (distToEnd < ADVANCE_THRESHOLD || distToNextStart < ADVANCE_THRESHOLD) {
        if (distToEnd < ADVANCE_THRESHOLD && currentLeg.to && currentLeg.to.name) {
          showRerouteNotification('Arriving at ' + currentLeg.to.name);
        }
        tripLegIndex++;
        lastLegTransitionTime = now;
        _autoEndTimer = null;
      }
    }

    if (tripLegIndex !== lastRenderedLegIndex) {
      S.currentStationIndex = getLegStartStationIndex(legs, tripLegIndex);
      window._notifiedAlight = false;
      renderTripRoutes();
      lastRenderedLegIndex = tripLegIndex;
    }

    if (!tripArrived && tripLegIndex === legs.length - 1) {
      const finalLeg = legs[legs.length - 1];
      if (finalLeg && finalLeg.to && finalLeg.to.lat != null) {
        const dist = Helpers.haversine(lat, lon, finalLeg.to.lat, finalLeg.to.lon);
        const accuracy = (gpsPos && gpsPos.coords && gpsPos.coords.accuracy) || 30;
        const threshold = Math.max(25, Math.min(80, accuracy * 1.5));
        if (dist < threshold) {
          tripArrived = true;
          if (_autoEndTimer === null) {
            _autoEndTimer = setTimeout(() => document.dispatchEvent(new Event('end-trip')), 2000);
          }
        } else {
          if (_autoEndTimer !== null) { clearTimeout(_autoEndTimer); _autoEndTimer = null; }
        }
      }
    }

    if (!tripArrived && !window._notifiedAlight) {
      const cur = legs[tripLegIndex];
      if (cur && cur.mode !== 'walking' && cur.to && cur.to.lat != null) {
        const dist = Helpers.haversine(lat, lon, cur.to.lat, cur.to.lon);
        if (dist < 200 && tripLegIndex < legs.length - 2) {
          window._notifiedAlight = true;
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('Alight here', { body: 'Next stop: ' + (cur.to.name || 'your stop') });
            }
          } catch {}
        }
      }
      if (cur && cur.mode === 'walking') window._notifiedAlight = false;
    }

    if (!tripArrived && !tripRerouting) {
      let minDist = Infinity;
      for (const leg of legs) {
        if (leg.path && leg.path.length >= 2) {
          for (let i = 0; i < leg.path.length; i++) {
            const d = Helpers.haversine(lat, lon, leg.path[i][0], leg.path[i][1]);
            if (d < minDist) { minDist = d; if (minDist < 80) break; }
          }
        } else {
          if (leg.from && leg.from.lat != null) {
            const d = Helpers.haversine(lat, lon, leg.from.lat, leg.from.lon);
            if (d < minDist) minDist = d;
          }
          if (leg.to && leg.to.lat != null) {
            const d = Helpers.haversine(lat, lon, leg.to.lat, leg.to.lon);
            if (d < minDist) minDist = d;
          }
        }
        if (minDist < 80) break;
      }
      const isOnline = typeof OfflineManager !== 'undefined' ? OfflineManager.isOnline() : navigator.onLine;
      const gpsAccurate = (gpsPos && gpsPos.coords && gpsPos.coords.accuracy != null && gpsPos.coords.accuracy <= 100);
      if (minDist > 200 && gpsAccurate) {
        if (tripDeviationStart === null) tripDeviationStart = now;
        else if (now - tripDeviationStart > 15000) {
          tripDeviationStart = null;
          if (isOnline) {
            tripRerouting = true;
            triggerReroute(lat, lon);
          } else {
            showRerouteNotification('⚠️ Route deviation detected. Go online to reroute.');
          }
        }
      } else if (minDist <= 200 || !gpsAccurate) {
        tripDeviationStart = null;
      }
    }

    const totalDuration = legs.reduce((sum, l) => sum + (l.duration || 0), 0);
    let completedDuration = legs.slice(0, tripLegIndex).reduce((sum, l) => sum + (l.duration || 0), 0);
    let currentLegProgress = 0;

    const curLeg = legs[tripLegIndex];
    if (curLeg) {
      if (curLeg.path && curLeg.path.length >= 2) {
        const p = getProgressAlongPath(curLeg.path, lat, lon);
        if (p > 0) currentLegProgress = Math.min(p, 1);
      } else if (curLeg.from && curLeg.to && curLeg.from.lat != null && curLeg.to.lat != null) {
        const dFrom = Helpers.haversine(lat, lon, curLeg.from.lat, curLeg.from.lon);
        const totalD = Helpers.haversine(curLeg.from.lat, curLeg.from.lon, curLeg.to.lat, curLeg.to.lon);
        if (totalD > 0) currentLegProgress = Math.min(dFrom / totalD, 1);
      }
    }

    const currentLegDuration = curLeg ? (curLeg.duration || 0) : 0;
    const currentProgressDuration = currentLegProgress * currentLegDuration;
    const totalProgress = tripArrived ? 100 : (totalDuration > 0
      ? Math.min(99, Math.round(((completedDuration + currentProgressDuration) / totalDuration) * 100))
      : 0);

    let remainingSecs = 0;
    if (tripArrived) {
      remainingSecs = 0;
    } else {
      if (curLeg && curLeg.mode === 'walking') {
        const remainingPathDist = curLeg.path && curLeg.path.length >= 2
          ? (1 - currentLegProgress) * getPathLength(curLeg.path)
          : (1 - currentLegProgress) * (curLeg.from && curLeg.to ? Helpers.haversine(curLeg.from.lat, curLeg.from.lon, curLeg.to.lat, curLeg.to.lon) : 100);
        const walkingSecs = remainingPathDist / speed;
        const futureLegsSecs = legs.slice(tripLegIndex + 1).reduce((s, l) => s + (l.duration || 0) * 60, 0);
        remainingSecs = walkingSecs + futureLegsSecs;
      } else {
        const legEnd = curLeg && curLeg.arrivalTime ? new Date(curLeg.arrivalTime) : null;
        if (legEnd) {
          remainingSecs = Math.max(0, (legEnd.getTime() - Date.now()) / 1000) + _tripDelaySecs;
          const futureLegsSecs = legs.slice(tripLegIndex + 1).reduce((s, l) => s + (l.duration || 0) * 60, 0);
          remainingSecs += futureLegsSecs;
        } else {
          remainingSecs = (totalDuration - (completedDuration + currentProgressDuration)) * 60;
        }
      }
    }
    const eta = new Date(Date.now() + remainingSecs * 1000);
    const etaStr = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isOnline = typeof OfflineManager !== 'undefined' ? OfflineManager.isOnline() : navigator.onLine;
    if (!tripArrived && tripLegIndex < legs.length - 1 && now - (window._lastConnectionCheck || 0) > 30000) {
      window._lastConnectionCheck = now;
      if (!isOnline) {
        showRerouteNotification('⚠️ Offline — arrival times may be stale');
      } else {
        const nextLeg = legs[tripLegIndex + 1];
        if (nextLeg && nextLeg.from && nextLeg.from.id && nextLeg.mode !== 'walking' && ['bus','tube','dlr','overground','elizabeth-line','national-rail','tram'].includes(nextLeg.mode)) {
          (async () => {
            try {
              const arrs = await Stops.getArrivals(nextLeg.from.id);
              const routeName = nextLeg.routeName;
              if (!routeName) return;
              const matched = arrs.filter(a => (a.lineId === routeName || a.line === routeName) && (!nextLeg.direction || (a.dirLabel || '').toLowerCase().includes(nextLeg.direction.toLowerCase())));
              const scheduledDep = nextLeg.departureTime ? new Date(nextLeg.departureTime) : null;
              if (scheduledDep && matched.length) {
                const actualDep = matched[0].expected ? new Date(matched[0].expected) : null;
                if (actualDep) {
                  const delaySec = (actualDep - scheduledDep) / 1000;
                  _tripDelaySecs = delaySec;
                  if (delaySec > 120) {
                    showRerouteNotification('⚠️ Next ' + (routeName || nextLeg.modeName) + ' at ' + (nextLeg.from.name || 'stop') + ' delayed by ' + Math.round(delaySec/60) + ' min');
                  }
                }
              } else if (scheduledDep && arrs.length > 0 && !matched.length && (now - scheduledDep.getTime()) > -60000) {
                showRerouteNotification('⚠️ Next ' + (routeName || nextLeg.modeName) + ' at ' + (nextLeg.from.name || 'stop') + ' may be cancelled');
              }
            } catch {}
          })();
        }
      }
    }

    let distToNextStation = null;
    let nearestStationIdx = 0;
    let nearestStationDist = Infinity;
    const cur = legs[tripLegIndex];
    const legStartGlobalIdx = getLegStartStationIndex(legs, tripLegIndex);

    if (cur && cur.mode !== 'walking') {
      const allStations = [];
      if (cur.from) allStations.push({ name: cur.from.name, lat: cur.from.lat, lon: cur.from.lon, idx: 0 });
      if (cur.stops) {
        cur.stops.forEach((s, i) => {
          if (s.lat != null && s.lon != null) allStations.push({ name: s.name, lat: s.lat, lon: s.lon, idx: i + 1 });
        });
      }
      if (cur.to) allStations.push({ name: cur.to.name, lat: cur.to.lat, lon: cur.to.lon, idx: allStations.length });

      let prevDist = Infinity;
      for (const st of allStations) {
        const d = Helpers.haversine(lat, lon, st.lat, st.lon);
        if (d < nearestStationDist) {
          nearestStationDist = d;
          nearestStationIdx = st.idx;
        }
        if (d < 80 && d < prevDist) {
          nearestStationIdx = st.idx;
          distToNextStation = d;
        }
        prevDist = d;
      }

      const candidateStationIdx = nearestStationIdx + legStartGlobalIdx;
      if (candidateStationIdx > S.currentStationIndex) {
        S.currentStationIndex = candidateStationIdx;
      }

      const nextStationItem = allStations.find(s => s.idx === nearestStationIdx + 1);
      if (nextStationItem) {
        distToNextStation = Helpers.haversine(lat, lon, nextStationItem.lat, nextStationItem.lon);
      } else if (cur.to && nearestStationIdx === allStations.length - 1) {
        distToNextStation = Helpers.haversine(lat, lon, cur.to.lat, cur.to.lon);
      }
    } else if (cur && cur.mode === 'walking') {
      S.currentStationIndex = legStartGlobalIdx;
    }

    const progressText = document.getElementById('trip-progress-text');
    const progressFill = document.getElementById('trip-progress-fill');
    const tripEta = document.getElementById('trip-eta');
    if (progressText) progressText.textContent = (tripArrived ? '100' : totalProgress) + '%';
    if (progressFill) progressFill.style.transform = 'scaleX(' + ((tripArrived ? 100 : totalProgress) / 100) + ')';
    if (tripEta) tripEta.textContent = tripArrived ? '✅ Arrived' : 'ETA ' + etaStr;

    renderTripTimeline(journey, legs, tripLegIndex, lat, lon, distToNextStation, etaStr);

    document.querySelectorAll('.journey-card .step').forEach((el, i) => {
      el.classList.remove('completed', 'active', 'upcoming');
      if (tripArrived || i < tripLegIndex) el.classList.add('completed');
      else if (i === tripLegIndex) el.classList.add('active');
      else el.classList.add('upcoming');
    });

    const stepsContainer = document.querySelector('.jc-steps');
    const activeStepEl = stepsContainer ? stepsContainer.querySelector('.step.active') : null;
    if (activeStepEl) activeStepEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (!tripArrived && tripLegIndex > 0 && now - lastLegTransitionTime < 6000) {
      const newLeg = legs[tripLegIndex];
      if (newLeg && newLeg.from && newLeg.from.id && ['bus', 'tube', 'dlr', 'overground', 'elizabeth-line', 'national-rail', 'tram'].includes(newLeg.mode)) {
        document.dispatchEvent(new CustomEvent('open-departures', {
          detail: { id: newLeg.from.id, name: newLeg.from.name || '', lat: newLeg.from.lat, lon: newLeg.from.lon }
        }));
      }
    }
  }

  // --- Reroute ---
  function showRerouteNotification(msg) {
    const nc = document.getElementById('trip-timeline');
    if (!nc) return;
    const note = document.createElement('div');
    note.className = 'reroute-notification';
    note.textContent = msg;
    nc.insertBefore(note, nc.firstChild);
    setTimeout(() => { if (note.parentNode) note.remove(); }, 4200);
  }

  function _reEnableRerouteBtn() {
    const btn = document.getElementById('trip-reroute-btn');
    if (btn) { btn.disabled = false; tripRerouting = false; }
  }

  async function triggerReroute(fromLat, fromLon, userConfirmed) {
    const isOnline = typeof OfflineManager !== 'undefined' ? OfflineManager.isOnline() : navigator.onLine;
    if (!isOnline) { tripRerouting = false; _reEnableRerouteBtn(); showRerouteNotification('Cannot reroute while offline'); return; }
    if (!S.activeJourneys || !tripActiveKey) { _reEnableRerouteBtn(); return; }
    const oldJourney = S.activeJourneys[tripActiveKey];
    if (!oldJourney || !oldJourney.legs.length) { _reEnableRerouteBtn(); return; }

    if (!userConfirmed) {
      const confirmed = confirm('Route deviation detected. Recalculate route? This will restart from your current location.');
      if (!confirmed) {
        _reEnableRerouteBtn();
        showRerouteNotification('Reroute cancelled');
        return;
      }
    }

    const destLeg = oldJourney.legs[oldJourney.legs.length - 1];
    if (!destLeg || !destLeg.to || destLeg.to.lat == null) { _reEnableRerouteBtn(); return; }
    const from = { label: 'Current Location', lat: fromLat, lon: fromLon };
    const to = { label: destLeg.to.name || 'Destination', lat: destLeg.to.lat, lon: destLeg.to.lon };
    let modes = [];
    try { modes = UI.getActiveModes ? UI.getActiveModes() : []; } catch {}
    try {
      const result = await Router.plan(from, to, { modes, timeMode: 'now' });
      if (!result || !result.fastest) { _reEnableRerouteBtn(); return; }
      if (result.fastest.duration > oldJourney.duration * 2 && oldJourney.duration > 5) {
        showRerouteNotification('Staying on current route');
        _reEnableRerouteBtn(); return;
      }
      S.activeJourneys[tripActiveKey] = result.fastest;
      Router.enrichJourneyPaths(result.fastest).catch(() => {});
      tripLegIndex = 0;
      lastLegTransitionTime = Date.now();
      lastRenderedLegIndex = -1;
      tripDeviationStart = null;
      tripArrived = false;
      MapView.clearMarkers();
      renderTripRoutes();
      const newFirst = result.fastest.legs[0];
      const newLast = result.fastest.legs[result.fastest.legs.length - 1];
      if (newFirst && newFirst.from) S.activeFromMarker = MapView.addMarker(newFirst.from.lat, newFirst.from.lon, 'From: ' + (UI.getFromText() || 'Start'), '#0019a8');
      if (newLast && newLast.to) S.activeToMarker = MapView.addMarker(newLast.to.lat, newLast.to.lon, 'To: ' + (UI.getToText() || 'Destination'), '#e32017');
      showRerouteNotification('Route recalculated');
    } catch (e) {
      console.warn('Reroute failed:', e);
      UI.showError('Could not recalculate route. Try again.');
    }
    _reEnableRerouteBtn();
  }

  // --- Route Drawing (exposed for app.js usage) ---
  function drawJourneyRoutesOnMap(journey) {
    if (!journey || !journey.legs || !journey.legs.length) return;
    MapView.hideBikeMarkers(); UI.toggleBikeMarkers(false);
    if (window._bikeRouteLayers) { window._bikeRouteLayers.forEach(l => { try { l.remove(); } catch {} }); window._bikeRouteLayers = []; }
    MapView.clearRoutes(); MapView.clearMarkers();
    const modeColors = { walking: '#666', bus: '#e32017', tube: '#0019a8', dlr: '#00a94f', overground: '#f86c00', 'elizabeth-line': '#6950a0', 'national-rail': '#003688', tram: '#66cc00' };
    const allPoints = [];
    journey.legs.forEach((leg, i) => {
      const path = leg.path || [];
      if (path.length >= 2) {
        const color = modeColors[leg.mode] || '#333';
        const label = i === 0 ? `${leg.modeName || ''} ${leg.routeName || ''}` : '';
        MapView.addRoute(path, color, label);
        path.forEach(p => allPoints.push(p));
      }
    });
    if (allPoints.length > 0) MapView.fitBounds([allPoints]);
    else if (journey.legs[0] && journey.legs[0].from) {
      MapView.flyTo(journey.legs[0].from.lat, journey.legs[0].from.lon, 14);
    }
  }

  function rerenderCurrentTimeline() {
    if (S.activeJourneys && tripActiveKey && S.activeJourneys[tripActiveKey] && S._lastLat != null && S._lastLon != null) {
      const journey = S.activeJourneys[tripActiveKey];
      if (journey && journey.legs && tripLegIndex < journey.legs.length) {
        renderTripTimeline(journey, journey.legs, tripLegIndex, S._lastLat, S._lastLon, null, '');
      }
    }
  }

  // --- Init: registers event listeners ---
  function init() {
    document.addEventListener('start-trip', (e) => {
      let key = e.detail.key;
      const restore = e.detail.restore || false;
      if (!S.activeJourneys) return;
      if (!S.activeJourneys[key] && S.activeJourneys.all) {
        if (key === 'walking' && S.activeJourneys.walkingJourney) {
          S.activeJourneys[key] = S.activeJourneys.walkingJourney;
        } else {
          const routeIdx = parseInt(key.replace('route_', ''), 10);
          if (!isNaN(routeIdx) && S.activeJourneys.all[routeIdx]) {
            S.activeJourneys[key] = S.activeJourneys.all[routeIdx];
          }
        }
      }
      if (!S.activeJourneys[key]) return;
      if (!navigator.geolocation) { UI.showError('Geolocation not supported'); return; }

      if (tripWatchId !== null) { navigator.geolocation.clearWatch(tripWatchId); tripWatchId = null; }
      if (_gpsRetryTimer) { clearTimeout(_gpsRetryTimer); _gpsRetryTimer = null; _gpsRetryCount = 0; }
      _cleanupNavHandlers();

      let restoredFromBackup = false;
      if (!restore && typeof OfflineManager !== 'undefined') {
        const backup = OfflineManager.restoreTripState ? OfflineManager.restoreTripState() : null;
        if (backup && backup.journey && backup.journey.legs) {
          S.activeJourneys[backup.key] = backup.journey;
          key = backup.key;
          tripLegIndex = backup.legIndex || 0;
          lastLegTransitionTime = backup.lastTransition || Date.now();
          S.currentStationIndex = backup.currentStationIndex || 0;
          restoredFromBackup = true;
          UI.showToast('Trip restored from offline backup', 2000);
        }
      }

      tripActiveKey = key;
      if (!restoredFromBackup) {
        tripLegIndex = window.__tripRestoreLegIndex !== undefined ? window.__tripRestoreLegIndex : 0;
        lastLegTransitionTime = window.__tripRestoreLastTransition !== undefined ? window.__tripRestoreLastTransition : Date.now();
        S.currentStationIndex = getLegStartStationIndex(S.activeJourneys[key].legs, tripLegIndex);
      }
      lastRenderedLegIndex = -1;
      window.__tripRestoreLegIndex = undefined;
      window.__tripRestoreLastTransition = undefined;
      _posHistory = [];
      _currentSpeed = 1.4;
      _tripDelaySecs = 0;
      if (_autoEndTimer !== null) { clearTimeout(_autoEndTimer); _autoEndTimer = null; }

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.querySelector('.tab-btn[data-tab="journey"]').classList.add('active');
      document.getElementById('tab-journey').classList.add('active');
      document.getElementById('results-panel').innerHTML = '';

      const tsBtn = document.getElementById('trip-start-btn');
      const teBtn = document.getElementById('trip-end-btn');
      if (tsBtn) tsBtn.style.display = 'none';
      if (teBtn) teBtn.style.display = 'inline-block';

      const navBar = document.getElementById('trip-nav-bar');
      const timeline = document.getElementById('trip-timeline');
      recenterBtn = document.getElementById('trip-recenter-btn');
      const tripEta = document.getElementById('trip-eta');

      navBar.style.display = 'flex';
      recenterBtn.style.display = 'none';
      if (tripEta) tripEta.textContent = '';
      const mapTitleText = document.querySelector('.map-title-text');
      if (mapTitleText) mapTitleText.innerHTML = '<span class="ic" data-ic="map"></span> <span class="map-title-trip-info"><span class="leg-preview">Acquiring GPS...</span></span>';

      const rerouteBtn = document.getElementById('trip-reroute-btn');
      if (rerouteBtn) {
        rerouteBtn.style.display = 'inline-flex';
        rerouteBtn.disabled = false;
        rerouteBtn.onclick = () => {
          if (tripRerouting) return;
          rerouteBtn.disabled = true;
          tripRerouting = true;
          navigator.geolocation.getCurrentPosition(
            (pos) => triggerReroute(pos.coords.latitude, pos.coords.longitude, true),
            () => { tripRerouting = false; rerouteBtn.disabled = false; UI.showError('Could not get location for reroute'); },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        };
      }

      const journey = S.activeJourneys[tripActiveKey];
      MapView.clearRoutes();
      MapView.clearMarkers();
      journey.legs.forEach((leg) => {
        const path = leg.path || [];
        if (path.length >= 2) MapView.addRoute(path, '#555', '');
      });
      const firstLeg = journey.legs[0];
      const lastLeg = journey.legs[journey.legs.length - 1];
      if (firstLeg && firstLeg.from) S.activeFromMarker = MapView.addMarker(firstLeg.from.lat, firstLeg.from.lon, 'From: ' + (UI.getFromText() || 'Start'), '#0019a8');
      if (lastLeg && lastLeg.to) S.activeToMarker = MapView.addMarker(lastLeg.to.lat, lastLeg.to.lon, 'To: ' + (UI.getToText() || 'Destination'), '#e32017');

      const allPoints = [];
      journey.legs.forEach(l => { const p = l.path || []; p.forEach(pt => allPoints.push(pt)); });
      if (allPoints.length > 0) MapView.fitBounds([allPoints]);

      const initLat = (firstLeg && firstLeg.from && firstLeg.from.lat) || 51.5;
      const initLon = (firstLeg && firstLeg.from && firstLeg.from.lon) || -0.12;
      S._lastLat = initLat; S._lastLon = initLon;
      renderTripTimeline(S.activeJourneys[tripActiveKey], S.activeJourneys[tripActiveKey].legs, tripLegIndex, initLat, initLon, null, '');

      tripWatchId = startGPSWatch();
      if (_gpsFirstFixTimer) clearTimeout(_gpsFirstFixTimer);
      _gpsFirstFixTimer = setTimeout(() => {
        if (!_gpsFirstFixReceived && tripWatchId !== null) {
          timeline.innerHTML = '<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;color:#e32017"><span>⚠️</span><span>GPS not responding. Check location permissions or ensure GPS is enabled.</span></div>';
          timeline.innerHTML += '<div style="padding:0 10px 8px"><button id="trip-retry-gps" class="btn btn-sm" style="background:#0019a8;color:#fff;border:0;padding:4px 12px;border-radius:20px;cursor:pointer">Retry GPS</button></div>';
          setTimeout(() => {
            const retryBtn = document.getElementById('trip-retry-gps');
            if (retryBtn) retryBtn.onclick = () => {
              if (tripWatchId !== null) { navigator.geolocation.clearWatch(tripWatchId); tripWatchId = null; }
              tripWatchId = startGPSWatch();
              timeline.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px;padding:8px 10px"><div class="sk-card-row"><div class="sk sk-circle" style="width:10px;height:10px"></div><div class="sk sk-line" style="width:50%"></div></div><div class="sk-card-row"><div class="sk sk-circle" style="width:10px;height:10px"></div><div class="sk sk-line" style="width:65%"></div><div class="sk sk-line-sm" style="width:40px"></div></div><div class="sk-card-row"><div class="sk sk-circle" style="width:10px;height:10px"></div><div class="sk sk-line" style="width:45%"></div></div></div>';
            };
          }, 0);
        }
      }, 20000);

      recenterBtn.onclick = () => {
        followEnabled = true;
        recenterBtn.style.display = 'none';
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude, lon = pos.coords.longitude;
              const heading = pos.coords.heading;
              const accuracy = pos.coords.accuracy;
              if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon) && isFinite(lat) && isFinite(lon)) {
                MapView.flyTo(lat, lon, 16);
                // Update trip progress card immediately
                updateTripProgress(lat, lon, pos);
                MapView.showUserLocation(lat, lon, heading, accuracy);
              } else {
                MapView.flyTo(51.5074, -0.1278, 14);
              }
            },
            () => { MapView.flyTo(51.5074, -0.1278, 14); },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
          );
        }
      };

      MapView.onMoveEnd(() => {
        followEnabled = false;
        recenterBtn.style.display = 'inline-block';
      });

      const enrichJourney = S.activeJourneys[tripActiveKey];
      if (enrichJourney && (typeof OfflineManager !== 'undefined' ? OfflineManager.isOnline() : navigator.onLine)) {
        Router.enrichJourneyPaths(enrichJourney).then(() => {
          const j = S.activeJourneys[tripActiveKey];
          if (j && S._lastLat != null) {
            renderTripTimeline(j, j.legs, tripLegIndex, S._lastLat, S._lastLon, null, '');
          }
        }).catch(() => {});
      }

      if (_persistInterval) clearInterval(_persistInterval);
      _persistInterval = setInterval(saveTripState, 30000);
      window.removeEventListener('beforeunload', saveTripState);
      window.addEventListener('beforeunload', saveTripState);
      document.addEventListener('visibilitychange', _onVisibilityChange);

      const toggleBtn = document.getElementById('trip-nav-toggle');
      const navHeader = document.getElementById('trip-nav-header');
      const SHEET_COLLAPSED = 56;
      const SHEET_MID_RATIO = 0.45;
      const SHEET_FULL_RATIO = 0.85;
      let sheetState = 'full';
      let sheetStartY = 0, sheetStartOffset = 0;
      let sheetDragging = false, sheetDragVelocity = 0, sheetLastTime = 0, sheetLastY = 0;
      let sheetWasDragged = false;

      function getSheetTargetHeight(state) {
        const vh = window.innerHeight;
        const safeTop = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top') || '0', 10);
        const safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom') || '0', 10) ||
          (window.visualViewport ? window.visualViewport.offsetTop : 0);
        const availableH = vh - safeTop - safeBottom;
        if (state === 'collapsed') return SHEET_COLLAPSED;
        if (state === 'mid') return Math.round(availableH * SHEET_MID_RATIO);
        const maxH = availableH - 40;
        return Math.round(Math.min(maxH, vh * SHEET_FULL_RATIO));
      }

      const _maxSheetH = getSheetTargetHeight('full');
      navBar.style.height = _maxSheetH + 'px';
      navBar.style.transform = 'translateY(0px)';

      function setSheetState(state, animate) {
        sheetState = state;
        const targetH = getSheetTargetHeight(state);
        const offset = _maxSheetH - targetH;
        navBar.style.transition = animate !== false ? 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)' : 'none';
        navBar.style.transform = 'translateY(' + offset + 'px)';
        toggleBtn.innerHTML = '<span class="ic" data-ic="' + (state === 'collapsed' ? 'chevron_up' : 'chevron_down') + '"></span>';
        navBar.classList.toggle('collapsed', state === 'collapsed');
      }

      const onSheetStart = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        sheetStartY = e.touches ? e.touches[0].clientY : e.clientY;
        const curTransform = navBar.style.transform;
        const match = curTransform && curTransform.match(/translateY\(([-\d.]+)px\)/);
        sheetStartOffset = match ? parseFloat(match[1]) : 0;
        sheetDragging = true;
        sheetWasDragged = false;
        sheetLastTime = Date.now();
        sheetLastY = sheetStartY;
        sheetDragVelocity = 0;
        navBar.style.transition = 'none';
        navBar.style.willChange = 'transform';
        navBar.classList.remove('collapsed');
      };

      const onSheetMove = (e) => {
        if (!sheetDragging) return;
        e.preventDefault();
        sheetWasDragged = true;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = cy - sheetStartY;
        const now = Date.now();
        const dt = now - sheetLastTime;
        if (dt > 0) sheetDragVelocity = (cy - sheetLastY) / dt;
        sheetLastTime = now;
        sheetLastY = cy;
        const maxOffset = _maxSheetH - SHEET_COLLAPSED;
        const offset = Math.max(0, Math.min(maxOffset, sheetStartOffset + delta));
        navBar.style.transform = 'translateY(' + offset + 'px)';
      };

      const onSheetEnd = () => {
        if (!sheetDragging) return;
        sheetDragging = false;
        navBar.style.willChange = '';
        const curTransform = navBar.style.transform;
        const match = curTransform && curTransform.match(/translateY\(([-\d.]+)px\)/);
        const curOffset = match ? parseFloat(match[1]) : 0;
        const curH = _maxSheetH - curOffset;
        const vh = window.innerHeight;
        const safeBottom = window.visualViewport ? window.visualViewport.offsetTop : 0;
        const availableH = vh - safeBottom;
        const midH = Math.round(availableH * SHEET_MID_RATIO);
        const fullH = Math.round(Math.min(availableH * SHEET_FULL_RATIO, availableH - 40));
        let target;
        if (curH < midH || (sheetDragVelocity > 0.3 && curH < fullH)) {
          target = 'collapsed';
        } else {
          target = 'full';
        }
        setSheetState(target, true);
      };

      function toggleSheet() {
        if (sheetState === 'collapsed') setSheetState('full');
        else setSheetState('collapsed');
      }

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleSheet();
      };

      navHeader.onclick = (e) => {
        if (sheetWasDragged) { sheetWasDragged = false; return; }
        if (e.target.closest('#trip-nav-toggle, #trip-reroute-btn, #trip-recenter-btn, #trip-cancel-btn')) return;
        toggleSheet();
      };

      setSheetState('full', false);

      navHeader.addEventListener('mousedown', onSheetStart);
      navHeader.addEventListener('touchstart', onSheetStart, { passive: true });
      document.addEventListener('mousemove', onSheetMove);
      document.addEventListener('mouseup', onSheetEnd);
      document.addEventListener('touchmove', onSheetMove, { passive: false });
      document.addEventListener('touchend', onSheetEnd);
      _navHeaderCleanup = [
        { el: navHeader, type: 'mousedown', fn: onSheetStart },
        { el: navHeader, type: 'touchstart', fn: onSheetStart, opts: { passive: true } },
        { el: document, type: 'mousemove', fn: onSheetMove },
        { el: document, type: 'mouseup', fn: onSheetEnd },
        { el: document, type: 'touchmove', fn: onSheetMove, opts: { passive: false } },
        { el: document, type: 'touchend', fn: onSheetEnd }
      ];

      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      if (window._ttlTimer) { clearTimeout(window._ttlTimer); window._ttlTimer = null; }
      if (firstLeg && firstLeg.departureTime && firstLeg.mode !== 'walking') {
        const depMs = new Date(firstLeg.departureTime).getTime();
        const nowMs = Date.now();
        const leadMs = Math.max(0, depMs - nowMs - 5 * 60 * 1000);
        if (leadMs > 0 && leadMs < 3600 * 1000) {
          window._ttlTimer = setTimeout(() => {
            try {
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Time to leave!', { body: 'Your ' + (firstLeg.modeName || 'transit') + ' from ' + (firstLeg.from ? firstLeg.from.name : '') + ' departs at ' + new Date(firstLeg.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) });
              }
            } catch {}
          }, leadMs);
        }
      }
      window._notifiedAlight = false;
    });

    document.addEventListener('end-trip', () => {
      if (tripWatchId !== null) { navigator.geolocation.clearWatch(tripWatchId); tripWatchId = null; }
      if (_gpsRetryTimer) { clearTimeout(_gpsRetryTimer); _gpsRetryTimer = null; }
      if (_gpsFirstFixTimer) { clearTimeout(_gpsFirstFixTimer); _gpsFirstFixTimer = null; }
      if (window.__statusTimer) { clearInterval(window.__statusTimer); window.__statusTimer = null; }
      _gpsRetryCount = 0;
      if (window._ttlTimer) { clearTimeout(window._ttlTimer); window._ttlTimer = null; }
      window._notifiedAlight = false;
      _cleanupNavHandlers();
      if (_persistInterval) { clearInterval(_persistInterval); _persistInterval = null; }
      window.removeEventListener('beforeunload', saveTripState);
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      Store.clearJourneyState();
      window.__tripRestoreLegIndex = undefined;
      window.__tripRestoreLastTransition = undefined;
      _posHistory = [];
      _currentSpeed = 1.4;
      _tripDelaySecs = 0;
      S.currentStationIndex = -1;
      if (_autoEndTimer !== null) { clearTimeout(_autoEndTimer); _autoEndTimer = null; }
      tripActiveKey = null;
      tripLegIndex = -1;
      lastLegTransitionTime = 0;
      lastRenderedLegIndex = -1;
      tripArrived = false;
      tripDeviationStart = null;
      tripRerouting = false;
      window._lastConnectionCheck = 0;
      const rBtn = document.getElementById('trip-reroute-btn');
      if (rBtn) { rBtn.style.display = 'none'; rBtn.disabled = false; rBtn.onclick = null; }
      const tsBtn = document.getElementById('trip-start-btn');
      const teBtn = document.getElementById('trip-end-btn');
      if (tsBtn) tsBtn.style.display = 'none';
      if (teBtn) teBtn.style.display = 'none';
      const navBar = document.getElementById('trip-nav-bar');
      if (navBar) navBar.style.display = 'none';
      const progText = document.getElementById('trip-progress-text');
      if (progText) progText.textContent = '0%';
      const progFill = document.getElementById('trip-progress-fill');
      if (progFill) progFill.style.width = '0%';
      const tripEta = document.getElementById('trip-eta');
      if (tripEta) tripEta.textContent = '';
      MapView.hideUserLocation();
      MapView.clearAll();
      S.activeJourneys = null;
      S.activeFromMarker = null;
      S.activeToMarker = null;
      const resultsPanel = document.getElementById('results-panel');
      if (resultsPanel) resultsPanel.innerHTML = '';
      const mapOverlay = document.getElementById('map-overlay');
      if (mapOverlay) {
        mapOverlay.classList.remove('open');
      }
      const mapTitleText = document.querySelector('.map-title-text');
      if (mapTitleText) mapTitleText.innerHTML = '<span class="ic" data-ic="map"></span> Trip Map';
    });

    document.getElementById('trip-cancel-btn')?.addEventListener('click', () => {
      document.dispatchEvent(new Event('end-trip'));
    });
  }

  function forceUpdatePosition() {
  // Force a GPS refresh when reconnecting from offline
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon, heading, accuracy } = pos.coords;
      console.log('[TripNav] Forced GPS update on reconnect:', lat, lon);
      updateTripProgress(lat, lon, pos);
      MapView.showUserLocation(lat, lon, heading, accuracy);
      if (followEnabled && recenterBtn) {
        MapView.panTo(lat, lon);
        recenterBtn.style.display = 'none';
      }
    },
    (err) => {
      console.warn('[TripNav] Forced GPS update failed:', err.message);
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

  return {
    init,
    drawJourneyRoutesOnMap,
    rerenderCurrentTimeline,
    forceUpdatePosition,
    resetGpsRetryCount: () => { _gpsRetryCount = 0; },
    getTripActiveKey: () => tripActiveKey,
    getTripLegIndex: () => tripLegIndex
  };
})();
