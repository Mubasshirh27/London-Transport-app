(function () {
  let activeJourneys = null;
  let activeFromMarker = null;
  let activeToMarker = null;
  let pinTarget = null;
  let watchId = null;
  let liveNearbyTimer = null;
  let activeCenter = null;
  let activeZoom = null;
  let bikeLocation = null;
  let bikePinTarget = null;
  let currentStationIndex = -1;
  let _remOpen = true;
  let _walkOpen = {};
  let _lastLat = null;
  let _lastLon = null;

  const GREATER_LONDON = {
    north: 51.7,
    south: 51.28,
    east: 0.34,
    west: -0.51
  };

  function escapeHtml(str) { const d = document.createElement('div'); d.appendChild(document.createTextNode(str)); return d.innerHTML; }
  function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  document.addEventListener('DOMContentLoaded', async () => {
    UI.init();
    Icon.init();

    // --- Offline detection ---
    function updateOnlineStatus() {
      const online = navigator.onLine;
      const badge = document.getElementById('offline-badge');
      const banner = document.getElementById('offline-banner');
      const navBar = document.getElementById('trip-nav-bar');
      if (badge) badge.style.display = online ? 'none' : '';
      if (banner) banner.style.display = (online || !navBar || navBar.style.display === 'none') ? 'none' : '';
      window._lastConnectionCheck = Date.now();
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // --- Resume prompt ---
    function doRestoreTrip(data) {
      if (!data.journey || !data.journey.legs || !data.journey.legs.length || data.legIndex === undefined) return;
      if (data.legIndex >= data.journey.legs.length) data.legIndex = 0;
      tripActiveKey = data.key || '__restored__';
      if (!activeJourneys) activeJourneys = {};
      if (!activeJourneys[tripActiveKey]) {
        activeJourneys[tripActiveKey] = data.journey;
      }
      tripLegIndex = data.legIndex || 0;
      lastLegTransitionTime = data.lastTransition || Date.now();
      lastRenderedLegIndex = -1;
      tripArrived = false;
      tripDeviationStart = null;
      tripRerouting = false;
      window.__tripRestoreLegIndex = tripLegIndex;
      window.__tripRestoreLastTransition = lastLegTransitionTime;
      document.dispatchEvent(new CustomEvent('start-trip', { detail: { key: tripActiveKey, restore: true } }));
      const resumeEl = document.getElementById('resume-prompt');
      if (resumeEl) resumeEl.style.display = 'none';
      Store.clearJourneyState();
    }

    function tryRestoreTrip() {
      const data = Store.loadJourneyState();
      if (!data || !data.journey || !data.fromLabel) return;
      const elapsed = Math.round((Date.now() - (data._savedAt || 0)) / 60000);
      const timeAgo = elapsed < 1 ? 'just now' : elapsed < 60 ? elapsed + 'm ago' : Math.round(elapsed / 60) + 'h ago';
      const resumeEl = document.getElementById('resume-prompt');
      if (!resumeEl) return;
      resumeEl.innerHTML = '<div class="resume-content"><div class="resume-info"><span class="resume-from">' + escapeHtml(data.fromLabel) + '</span> <span class="ic" data-ic="arrow_right"></span> <span class="resume-to">' + escapeHtml(data.toLabel || 'Destination') + '</span> <span class="resume-time">' + timeAgo + '</span></div><div class="resume-actions"><button id="resume-yes" class="btn-primary">Resume</button><button id="resume-no" class="btn-secondary">Dismiss</button></div></div>';
      resumeEl.style.display = '';
      document.getElementById('resume-yes').onclick = () => doRestoreTrip(data);
      document.getElementById('resume-no').onclick = () => { resumeEl.style.display = 'none'; Store.clearJourneyState(); };
    }
    const map = MapView.init();
    let bikePoints = [];

    // --- Map click for pin mode ---
    async function handleMapClick(lat, lon) {
      if (window.__legViewActive) return;
      if (bikePinTarget) {
        bikePinTarget = null;
        UI.clearMapPinMode();
        try {
          const data = await Api.getBikePoints(lat, lon, 10000);
          if (Array.isArray(data)) {
            bikePoints = data.map(b => {
              const props = {};
              (b.additionalProperties || []).forEach(p => { props[p.key] = p.value; });
              return { id: b.id, name: b.commonName, lat: b.lat, lon: b.lon, bikes: parseInt(props.NbBikes) || 0, docks: parseInt(props.NbDocks) || 0, spaces: parseInt(props.NbEmptyDocks) || 0 };
            });
            MapView.showBikeMarkers(bikePoints);
            MapView.flyTo(lat, lon, 12);
            UI.showBikePanel(bikePoints, lat, lon);
            UI.toggleBikeMarkers(true);
            bikeLocation = { lat, lon };
          }
        } catch {}
        return;
      }
      if (pinTarget) {
        const target = pinTarget;
        const label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        const val = { label, lat, lon };
        if (target === 'from') { UI.setFromText(label); UI.setFromValue(val); }
        else { UI.setToText(label); UI.setToValue(val); }
        pinTarget = null;
        UI.clearMapPinMode();
        // Flash effect on map
        const mapEl = document.getElementById('map');
        const flash = document.createElement('div');
        flash.className = 'map-click-flash';
        flash.style.left = '50%';
        flash.style.top = '50%';
        mapEl.appendChild(flash);
        setTimeout(() => flash.remove(), 600);
        // Close map overlay
        const overlay = document.getElementById('map-overlay');
        if (overlay.classList.contains('open')) {
          overlay.classList.remove('open');
          document.getElementById('map-toggle-btn').innerHTML = '<span class="ic" data-ic="map"></span> Map';
          document.body.style.overflow = '';
        }
        // Focus the search input
        setTimeout(() => {
          const input = target === 'from' ? document.getElementById('from-input') : document.getElementById('to-input');
          if (input) { input.focus(); input.select(); }
        }, 350);
        return;
      }
      if (!UI.isBikeMarkersVisible()) {
        try {
          const stops = await Stops.getNearby(lat, lon);
          if (stops.length) {
            const s = stops[0];
            MapView.showStopLivePopup(s.id, s.name, s.lat, s.lon, {
              modeStr: s.modes.map(m => Stops.getModeIcon(m)).join(''),
              distance: s.distance,
              routeTags: s.lines,
              stopLetter: s.stopLetter
            });
            document.dispatchEvent(new CustomEvent('open-departures', { detail: { id: s.id, name: s.name, lat: s.lat, lon: s.lon, stopLetter: s.stopLetter } }));
          }
        } catch {}
      }
    }

    MapView.onClick(handleMapClick);

    document.addEventListener('map-pin-mode', (e) => {
      pinTarget = e.detail;
      UI.setMapPinMode(pinTarget);
      // Auto-open map overlay if closed
      const overlay = document.getElementById('map-overlay');
      if (!overlay.classList.contains('open')) {
        overlay.classList.add('open');
        document.getElementById('map-toggle-btn').innerHTML = '<span class="ic" data-ic="close"></span> Close';
        document.body.style.overflow = 'hidden';
        setTimeout(() => { MapView.getMap()?.invalidateSize(); }, 100);
      }
    });

    document.addEventListener('map-pin-loc', (e) => {
      const { lat, lon, mode } = e.detail;
      if (mode === 'from') {
        UI._fromValue = { label: 'Pinned location', lat, lon };
        document.getElementById('from-input').value = 'Pinned location';
      } else if (mode === 'to') {
        UI._toValue = { label: 'Pinned location', lat, lon };
        document.getElementById('to-input').value = 'Pinned location';
      }
    });

    // --- Plan Journey ---
    let _planJourneyInProgress = false;
    document.addEventListener('plan-journey', async () => {
      // Prevent re-entrancy and ensure map stays closed during journey planning
      if (_planJourneyInProgress) return;
      _planJourneyInProgress = true;

      // Ensure map overlay stays closed during journey planning (Enter key should not open map)
      window.__legViewActive = false;
      MapView.hideBikeMarkers(); UI.toggleBikeMarkers(false);
      if (window._bikeRouteLayers) { window._bikeRouteLayers.forEach(l => { try { l.remove(); } catch {} }); window._bikeRouteLayers = []; }
      const mapOverlay = document.getElementById('map-overlay');
      mapOverlay.classList.remove('open', 'floating', 'popout');

      const from = UI.getFromValue();
      const to = UI.getToValue();
      const fromText = UI.getFromText();
      const toText = UI.getToText();

      if (!fromText || !toText) { UI.showError('Please enter both From and To locations'); _planJourneyInProgress = false; return; }
      if (fromText.toLowerCase() === toText.toLowerCase() || (from && to && from.lat === to.lat && from.lon === to.lon)) {
        UI.showError('From and To locations are the same. Choose different locations.'); _planJourneyInProgress = false; return;
      }

      UI.showLoading();
      activeJourneys = null;

      let fromLoc = from || fromText;
      let toLoc = to || toText;
      // Geocode any location missing coords to avoid TfL 300 disambiguation
      async function ensureCoords(loc) {
        if (!loc) return loc;
        if (loc.lat != null && loc.lon != null) return loc;
        const searchText = typeof loc === 'string' ? loc : (loc.label || '');
        if (!searchText || Api.parseCoord(searchText)) return loc;
        try {
          const geo = await Geocoder.search(searchText);
          if (geo && geo.length && geo[0].lat != null && geo[0].lon != null) {
            return { label: geo[0].label, lat: geo[0].lat, lon: geo[0].lon };
          }
        } catch {}
        return loc;
      }
      fromLoc = await ensureCoords(fromLoc);
      toLoc = await ensureCoords(toLoc);
      const timeOpts = UI.getTimeOpts();
      const modes = UI.getActiveModes();
      const journeyOpts = { ...timeOpts, modes };

      try {
        const result = await Router.plan(fromLoc, toLoc, journeyOpts);
        if (!result || !result.all || !result.all.length) {
          UI.showError('No routes found. Try different locations or modes.');
          _planJourneyInProgress = false;
          return;
        }
        activeJourneys = result;

        // Attach disruption info to each leg
        try {
          const lineStatuses = await Status.fetchAll();
          if (lineStatuses && lineStatuses.length) {
            const attachDisruptions = (j) => {
              if (!j || !j.legs) return;
              j.legs.forEach(leg => {
                if (leg.mode === 'walking' || !leg.lineId) return;
                const status = lineStatuses.find(s => s.id.toLowerCase() === leg.lineId.toLowerCase());
                if (status && status.statusCls !== 'good') {
                  leg.disruption = { cls: status.statusCls, text: status.statusText, reason: status.reason };
                }
              });
            };
            attachDisruptions(result.fastest);
            attachDisruptions(result.cheapest);
            attachDisruptions(result.balanced);
            if (result.walkingJourney) attachDisruptions(result.walkingJourney);
            (result.all || []).forEach(attachDisruptions);
          }
        } catch {}

        UI.showResults(result);

        const bestJourney = result.all[0];

        const { lat, lon } = getCenterOfRoutes(result);
        UI.getFromValue() && Store.addRecent(UI.getFromValue());
        UI.getToValue() && Store.addRecent(UI.getToValue());
      } catch (err) {
        console.error(err);
        const msg = err && err.message && err.message.includes('404') ? 'Could not plan journey between these locations (they may be too far apart or outside London area). Check the locations match London.' : 'Could not plan journey. Check locations and try again.';
        UI.showError(msg);
      } finally {
        _planJourneyInProgress = false;
      }
    });

    // --- Show Route ---
    document.addEventListener('show-route', (e) => {
      const key = e.detail;
      if (!activeJourneys) return;
      if (!activeJourneys[key] && activeJourneys.all) {
        if (key === 'walking' && activeJourneys.walkingJourney) {
          activeJourneys[key] = activeJourneys.walkingJourney;
        } else {
          const routeIdx = parseInt(key.replace('route_', ''), 10);
          if (!isNaN(routeIdx) && activeJourneys.all[routeIdx]) {
            activeJourneys[key] = activeJourneys.all[routeIdx];
          }
        }
      }
      if (!activeJourneys[key]) return;
      drawJourneyRoutesOnMap(activeJourneys[key]);
    });

    // --- Trip Navigation ---
    let tripWatchId = null;
    let tripActiveKey = null;
    let tripLegIndex = -1;
    let lastLegTransitionTime = 0;
    let lastRenderedLegIndex = -1;
    let tripArrived = false;
    let tripDeviationStart = null;
    let tripRerouting = false;
    let _navHeaderCleanup = null;
    let _gpsRetryCount = 0;
    let _gpsRetryTimer = null;
    let recenterBtn = null;
    let followEnabled = true;

    function startGPSWatch() {
      let firstFix = true;

      return navigator.geolocation.watchPosition(
        (pos) => {
          if (tripWatchId === null) return;
          if (!pos || !pos.coords) return;
          const { latitude: lat, longitude: lon, speed, heading, accuracy } = pos.coords;
          _lastLat = lat; _lastLon = lon;
          const now = Date.now();
          if (_posHistory.length && _posHistory[_posHistory.length - 1]) {
            const last = _posHistory[_posHistory.length - 1];
            const dist = haversine(last.lat, last.lon, lat, lon);
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
            if (heading != null && !isNaN(heading)) {
              try {
                const m = MapView.getMap();
                if (m && typeof m.setBearing === 'function') {
                  m.setBearing(heading, { animate: true, duration: 0.3 });
                }
              } catch {}
            }
            recenterBtn.style.display = 'none';
          } else {
            recenterBtn.style.display = 'inline-block';
          }
          updateTripProgress(lat, lon, pos);
        },
        (err) => {
          if (tripWatchId === null) return;
          _gpsRetryCount++;
          if (_gpsRetryCount >= 3) {
            UI.showError('Navigation error: ' + err.message);
            document.dispatchEvent(new Event('end-trip'));
          } else {
            UI.showError('Navigation error, retrying... (' + _gpsRetryCount + '/3)');
            clearTimeout(_gpsRetryTimer);
            _gpsRetryTimer = setTimeout(() => {
              if (tripWatchId === null) return;
              navigator.geolocation.clearWatch(tripWatchId);
              tripWatchId = startGPSWatch();
            }, _gpsRetryCount * 2000);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    }
    let _persistInterval = null;
    let _posHistory = [];
    let _currentSpeed = 1.4;
    let _tripDelaySecs = 0;
    let _autoEndTimer = null;
    function _onVisibilityChange() { if (document.hidden) saveTripState(); }

    function _cleanupNavHandlers() {
      if (_navHeaderCleanup) {
        _navHeaderCleanup.forEach(({ el, type, fn, opts }) => el.removeEventListener(type, fn, opts));
        _navHeaderCleanup = null;
      }
    }

    function saveTripState() {
      if (!tripActiveKey) return;
      const j = activeJourneys && activeJourneys[tripActiveKey];
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
        setTimeout(() => { MapView.getMap()?.invalidateSize(); }, 100);
      }
    }

    document.addEventListener('start-trip', (e) => {
      const key = e.detail.key;
      if (!activeJourneys) return;
      if (!activeJourneys[key] && activeJourneys.all) {
        if (key === 'walking' && activeJourneys.walkingJourney) {
          activeJourneys[key] = activeJourneys.walkingJourney;
        } else {
          const routeIdx = parseInt(key.replace('route_', ''), 10);
          if (!isNaN(routeIdx) && activeJourneys.all[routeIdx]) {
            activeJourneys[key] = activeJourneys.all[routeIdx];
          }
        }
      }
      if (!activeJourneys[key]) return;
      if (!navigator.geolocation) { UI.showError('Geolocation not supported'); return; }

      // Clean up any previous trip resources before starting a new one
      if (tripWatchId !== null) { navigator.geolocation.clearWatch(tripWatchId); tripWatchId = null; }
      if (_gpsRetryTimer) { clearTimeout(_gpsRetryTimer); _gpsRetryTimer = null; _gpsRetryCount = 0; }
      _cleanupNavHandlers();

      tripActiveKey = key;
      tripLegIndex = window.__tripRestoreLegIndex !== undefined ? window.__tripRestoreLegIndex : 0;
      lastLegTransitionTime = window.__tripRestoreLastTransition !== undefined ? window.__tripRestoreLastTransition : Date.now();
      lastRenderedLegIndex = -1;
      window.__tripRestoreLegIndex = undefined;
      window.__tripRestoreLastTransition = undefined;
      _posHistory = [];
      _currentSpeed = 1.4;
      _tripDelaySecs = 0;
      currentStationIndex = getLegStartStationIndex(activeJourneys[key].legs, tripLegIndex);
      if (_autoEndTimer !== null) { clearTimeout(_autoEndTimer); _autoEndTimer = null; }

      // Switch to journey tab
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

      navBar.style.display = 'block';
      timeline.innerHTML = '<div style="display:flex;align-items:center;gap:6px;padding:8px 10px"><div class="spinner" style="display:inline-block;width:12px;height:12px;border-width:2px;flex-shrink:0"></div><span>Locating you...</span></div>';
      recenterBtn.style.display = 'none';
      if (tripEta) tripEta.textContent = '';
      // Show locating message in map title bar too
      const mapTitleText = document.querySelector('.map-title-text');
      if (mapTitleText) mapTitleText.innerHTML = '<span class="ic" data-ic="map"></span> <span class="map-title-trip-info"><span class="leg-preview">Acquiring GPS...</span></span>';

      // Reroute button
      const rerouteBtn = document.getElementById('trip-reroute-btn');
      if (rerouteBtn) {
        rerouteBtn.style.display = 'inline-flex';
        rerouteBtn.disabled = false;
        rerouteBtn.onclick = () => {
          if (tripRerouting) return;
          rerouteBtn.disabled = true;
          tripRerouting = true;
          navigator.geolocation.getCurrentPosition(
            (pos) => triggerReroute(pos.coords.latitude, pos.coords.longitude),
            () => { tripRerouting = false; rerouteBtn.disabled = false; UI.showError('Could not get location for reroute'); },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        };
      }

      // Draw initial route as faded
      const journey = activeJourneys[tripActiveKey];
      MapView.clearRoutes();
      MapView.clearMarkers();
      journey.legs.forEach((leg) => {
        const path = leg.path || [];
        if (path.length >= 2) MapView.addRoute(path, '#555', '');
      });
      // Mark start/end
      const firstLeg = journey.legs[0];
      const lastLeg = journey.legs[journey.legs.length - 1];
      if (firstLeg && firstLeg.from) activeFromMarker = MapView.addMarker(firstLeg.from.lat, firstLeg.from.lon, 'From: ' + (UI.getFromText() || 'Start'), '#0019a8');
      if (lastLeg && lastLeg.to) activeToMarker = MapView.addMarker(lastLeg.to.lat, lastLeg.to.lon, 'To: ' + (UI.getToText() || 'Destination'), '#e32017');

      // Fit map to show full route
      const allPoints = [];
      journey.legs.forEach(l => { const p = l.path || []; p.forEach(pt => allPoints.push(pt)); });
      if (allPoints.length > 0) MapView.fitBounds([allPoints]);

      tripWatchId = startGPSWatch();

      recenterBtn.onclick = () => {
        followEnabled = true;
        recenterBtn.style.display = 'none';
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              MapView.flyTo(pos.coords.latitude, pos.coords.longitude, 16);
            },
            () => { MapView.flyTo(51.5074, -0.1278, 14); },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        }
      };

      MapView.onMoveEnd(() => {
        followEnabled = false;
        recenterBtn.style.display = 'inline-block';
      });

      // Enrich path geometry from TfL Route Sequence API (skip offline)
      const enrichJourney = activeJourneys[tripActiveKey];
      if (enrichJourney && navigator.onLine) {
        Router.enrichJourneyPaths(enrichJourney).then(() => {
          const j = activeJourneys[tripActiveKey];
          if (j && _lastLat != null) {
            renderTripTimeline(j, j.legs, tripLegIndex, _lastLat, _lastLon, null, '');
          }
        }).catch(() => {});
      }

      // Periodic state save
      if (_persistInterval) clearInterval(_persistInterval);
      _persistInterval = setInterval(saveTripState, 30000);
      window.removeEventListener('beforeunload', saveTripState);
      window.addEventListener('beforeunload', saveTripState);
      document.addEventListener('visibilitychange', _onVisibilityChange);

      // Bottom sheet drag (Google Maps style)
      const toggleBtn = document.getElementById('trip-nav-toggle');
      const navHeader = document.getElementById('trip-nav-header');
      const SHEET_COLLAPSED = 56;
      const SHEET_MID_RATIO = 0.45;
      const SHEET_FULL_RATIO = 0.85;
      let sheetState = 'mid';
      let sheetStartY = 0, sheetStartHeight = 0;
      let sheetDragging = false, sheetDragVelocity = 0, sheetLastTime = 0, sheetLastY = 0;

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

      function setSheetState(state, animate) {
        sheetState = state;
        const h = getSheetTargetHeight(state);
        navBar.style.transition = animate !== false ? 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)' : 'none';
        navBar.style.height = h + 'px';
        navBar.style.transform = '';
        toggleBtn.innerHTML = '<span class="ic" data-ic="' + (state === 'collapsed' ? 'chevron_up' : 'chevron_down') + '"></span>';
        navBar.classList.toggle('collapsed', state === 'collapsed');
      }

      const onSheetStart = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        sheetStartY = e.touches ? e.touches[0].clientY : e.clientY;
        sheetStartHeight = navBar.offsetHeight;
        sheetDragging = true;
        sheetLastTime = Date.now();
        sheetLastY = sheetStartY;
        sheetDragVelocity = 0;
        navBar.style.transition = 'none';
        navBar.style.willChange = 'height';
        navBar.classList.remove('collapsed');
      };

      const onSheetMove = (e) => {
        if (!sheetDragging) return;
        e.preventDefault();
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = cy - sheetStartY;
        const now = Date.now();
        const dt = now - sheetLastTime;
        if (dt > 0) sheetDragVelocity = (cy - sheetLastY) / dt;
        sheetLastTime = now;
        sheetLastY = cy;
        const safeBottom = window.visualViewport ? window.visualViewport.offsetTop : 0;
        const availableH = window.innerHeight - safeBottom;
        const maxH = Math.min(availableH * SHEET_FULL_RATIO, availableH - 40);
        const newH = Math.max(SHEET_COLLAPSED, Math.min(maxH, sheetStartHeight - delta));
        navBar.style.height = newH + 'px';
      };

      const onSheetEnd = () => {
        if (!sheetDragging) return;
        sheetDragging = false;
        navBar.style.willChange = '';
        const curH = navBar.offsetHeight;
        const vh = window.innerHeight;
        const safeBottom = window.visualViewport ? window.visualViewport.offsetTop : 0;
        const availableH = vh - safeBottom;
        const midH = Math.round(availableH * SHEET_MID_RATIO);
        const fullH = Math.round(Math.min(availableH * SHEET_FULL_RATIO, availableH - 40));
        let target;
        if (curH < SHEET_COLLAPSED + (midH - SHEET_COLLAPSED) * 0.3 || (sheetDragVelocity > 0.5 && curH < midH)) {
          target = 'collapsed';
        } else if (curH < midH + (fullH - midH) * 0.4 || (sheetDragVelocity > 0.3 && curH < fullH)) {
          target = 'mid';
        } else {
          target = 'full';
        }
        setSheetState(target, true);
      };

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (sheetState === 'collapsed') setSheetState('mid');
        else if (sheetState === 'mid') setSheetState('full');
        else setSheetState('collapsed');
      };

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

      // Init sheet to mid state
      setSheetState('mid', false);

      // --- Notification Setup ---
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
      currentStationIndex = -1;
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
      activeJourneys = null;
      activeFromMarker = null;
      activeToMarker = null;
      const resultsPanel = document.getElementById('results-panel');
      if (resultsPanel) resultsPanel.innerHTML = '';
      const mapOverlay = document.getElementById('map-overlay');
      if (mapOverlay) {
        mapOverlay.classList.remove('floating', 'popout', 'open');
        delete mapOverlay.dataset.tripFs;
        delete mapOverlay.dataset.tripFsWasMin;
        mapOverlay.style.left = '';
        mapOverlay.style.top = '';
        mapOverlay.style.bottom = '';
        mapOverlay.style.right = '';
        mapOverlay.style.width = '';
        mapOverlay.style.height = '';
      }
      const mapTitleText = document.querySelector('.map-title-text');
      if (mapTitleText) mapTitleText.innerHTML = '<span class="ic" data-ic="map"></span> Trip Map';
    });

    // Floating map handlers (set up once, outside start-trip to prevent duplicate listeners)
    {
      const overlay = document.getElementById('map-overlay');
      const titleBar = document.getElementById('map-title-bar');
      const popBtn = document.getElementById('map-pop-btn');
      const resizeHandle = document.getElementById('map-resize-handle');
      let mapDragOccurred = false, mapDragOffX = 0, mapDragOffY = 0;
      const isMinimized = () => overlay.classList.contains('popout');

      const toggleMapPop = () => {
        const willBeMin = !isMinimized();
        console.debug('toggleMapPop called', { willBeMin, beforeClass: overlay.className, left: overlay.style.left, top: overlay.style.top, width: overlay.style.width, height: overlay.style.height });
        overlay.classList.toggle('popout', willBeMin);
        // Clear inline styles so CSS class rules take full effect in both directions
        overlay.style.left = '';
        overlay.style.top = '';
        overlay.style.bottom = '';
        overlay.style.right = '';
        overlay.style.width = '';
        overlay.style.height = '';
        console.debug('toggleMapPop after', { popout: overlay.classList.contains('popout'), className: overlay.className, left: overlay.style.left, top: overlay.style.top, width: overlay.style.width, height: overlay.style.height });
        const m = MapView.getMap();
        if (m) {
          setTimeout(() => {
            m.invalidateSize({ pan: false });
            if (activeCenter && !willBeMin) {
              m.setView(activeCenter, activeZoom || m.getZoom(), { animate: false });
            }
            m.invalidateSize({ pan: true });
          }, 50);
        }
        if (map3dInstance) {
          setTimeout(() => { try { map3dInstance.resize(); } catch(e) {} }, 100);
        }
      };

      if (popBtn) popBtn.onclick = (e) => {
        e.stopPropagation();
        if (mapDragOccurred) { mapDragOccurred = false; return; }
        if (map3dInstance) {
          const cameFromMin = wasMinimizedFor3D;
          if (tripEnd3D) tripEnd3D();
          if (!cameFromMin) toggleMapPop();
          return;
        }
        toggleMapPop();
      };
      if (titleBar) {
        titleBar.addEventListener('click', (e) => {
          if (e.target.closest('#map-pop-btn')) return;
          if (e.target.closest('#map-fullscreen-btn')) return;
          if (mapDragOccurred) { mapDragOccurred = false; return; }
          if (map3dInstance) {
            const cameFromMin = wasMinimizedFor3D;
            if (tripEnd3D) tripEnd3D();
            if (!cameFromMin) toggleMapPop();
            return;
          }
          toggleMapPop();
        });
      }
      overlay.addEventListener('click', (e) => {
        if (e.target.closest('#map-title-bar')) return;
        if (isMinimized()) {
          if (map3dInstance) {
            if (tripEnd3D) tripEnd3D();
          } else {
            toggleMapPop();
          }
        }
      });

      const onMapDragStart = (ex) => {
        mapDragOccurred = false;
        const cx = ex.clientX ?? ex.touches[0].clientX;
        const cy = ex.clientY ?? ex.touches[0].clientY;
        const gs = (n) => { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return parseFloat(v) || 0; };
        let dragInit = false;
        const onMove = (me) => {
          if (!dragInit) {
            dragInit = true;
            mapDragOccurred = true;
            const rect = overlay.getBoundingClientRect();
            overlay.style.left = rect.left + 'px';
            overlay.style.top = rect.top + 'px';
            overlay.style.bottom = 'auto';
            overlay.style.right = 'auto';
            mapDragOffX = cx - rect.left;
            mapDragOffY = cy - rect.top;
          }
          const mx = me.clientX ?? me.touches[0].clientX;
          const my = me.clientY ?? me.touches[0].clientY;
          const safeL = gs('--safe-l'), safeT = gs('--safe-t'), safeR = gs('--safe-r'), safeB = gs('--safe-b');
          const w = overlay.offsetWidth, h = overlay.offsetHeight;
          const vw = window.innerWidth, vh = window.innerHeight;
          const left = Math.max(safeL + 4, Math.min(mx - mapDragOffX, vw - w - safeR - 4));
          const top = Math.max(safeT + 4, Math.min(my - mapDragOffY, vh - h - safeB - 4));
          overlay.style.left = left + 'px';
          overlay.style.top = top + 'px';
        };
        const onEnd = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onEnd);
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
      };
      // Drag by overlay (works in both big and minimized states)
      overlay.addEventListener('mousedown', (ex) => {
        if (ex.target.closest('#map')) return;
        if (ex.target.closest('#map-3d')) return;
        if (ex.target.closest('#map-resize-handle')) return;
        onMapDragStart(ex);
      });
      overlay.addEventListener('touchstart', (ex) => {
        if (ex.target.closest('#map')) return;
        if (ex.target.closest('#map-3d')) return;
        if (ex.target.closest('#map-resize-handle')) return;
        onMapDragStart(ex);
      }, { passive: true });

      if (resizeHandle) {
        const onResizeStart = (ex) => {
          ex.preventDefault();
          const startX = ex.clientX ?? ex.touches[0].clientX;
          const startY = ex.clientY ?? ex.touches[0].clientY;
          const startW = overlay.offsetWidth;
          const startH = overlay.offsetHeight;
          const onMove = (me) => {
            const mx = me.clientX ?? me.touches[0].clientX;
            const my = me.clientY ?? me.touches[0].clientY;
            const w = Math.max(180, startW + (mx - startX));
            const h = Math.max(180, startH + (my - startY));
            overlay.style.width = w + 'px';
            overlay.style.height = h + 'px';
          };
          const onEnd = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            const m = MapView.getMap();
            if (m) setTimeout(() => { m.invalidateSize(); }, 50);
            if (map3dInstance) setTimeout(() => { map3dInstance.resize(); }, 50);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onEnd);
          document.addEventListener('touchmove', onMove, { passive: true });
          document.addEventListener('touchend', onEnd);
        };
        resizeHandle.addEventListener('mousedown', onResizeStart);
        resizeHandle.addEventListener('touchstart', onResizeStart, { passive: true });
      }

      // --- Fullscreen toggle for floating map ---
      const fsBtn = document.getElementById('map-fullscreen-btn');
      const goFullscreen = () => {
        const wasMin = isMinimized();
        overlay.dataset.tripFsWasMin = wasMin ? '1' : '';
        overlay.style.transition = 'all 0.3s ease';
        overlay.classList.remove('floating', 'popout');
        overlay.classList.add('open');
        overlay.dataset.tripFs = '1';
        overlay.style.left = '';
        overlay.style.top = '';
        overlay.style.bottom = '';
        overlay.style.right = '';
        overlay.style.width = '';
        overlay.style.height = '';
        const m = MapView.getMap();
        if (m) setTimeout(() => { m.invalidateSize(); }, 100);
        // Handle 3D map fullscreen
        if (map3dInstance) setTimeout(() => { map3dInstance.resize(); }, 150);
        setTimeout(() => { overlay.style.transition = ''; }, 300);
      };
      if (fsBtn) fsBtn.onclick = (e) => { e.stopPropagation(); goFullscreen(); };

      // Override close button to handle trip fullscreen restore
      const closeBtn = document.getElementById('close-map-btn');
      if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (overlay.dataset.tripFs) {
            window.__legViewActive = false;
            delete overlay.dataset.tripFs;
            overlay.style.transition = 'all 0.3s ease';
            overlay.classList.remove('open');
            overlay.classList.add('floating');
            if (overlay.dataset.tripFsWasMin) {
              overlay.classList.add('popout');
              delete overlay.dataset.tripFsWasMin;
            }
            overlay.style.left = '';
            overlay.style.top = '';
            overlay.style.bottom = '';
            overlay.style.right = '';
            overlay.style.width = '';
            overlay.style.height = '';
            const m = MapView.getMap();
            if (m) setTimeout(() => { m.invalidateSize(); }, 100);
            // Handle 3D map restore
            if (map3dInstance) setTimeout(() => { map3dInstance.resize(); }, 150);
            setTimeout(() => { overlay.style.transition = ''; }, 300);
          } else if (overlay.classList.contains('floating')) {
            window.__legViewActive = false;
            overlay.classList.remove('floating', 'popout');
            document.getElementById('map-toggle-btn').innerHTML = '<span class="ic" data-ic="map"></span> Map';
            document.body.style.overflow = '';
            if (map3dInstance) setTimeout(() => { map3dInstance.resize(); }, 100);
          } else if (overlay.classList.contains('open')) {
            window.__legViewActive = false;
            overlay.classList.remove('open');
            document.getElementById('map-toggle-btn').innerHTML = '<span class="ic" data-ic="map"></span> Map';
            document.body.style.overflow = '';
            // Handle 3D map restore
            if (map3dInstance) setTimeout(() => { map3dInstance.resize(); }, 100);
          }
        };
      }
    }

    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

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
      // Remove "on to" and "onto"
      text = text.replace(/\bon\s+to\s+/gi, '');
      text = text.replace(/\bonto\s+/gi, '');
      // Remove "continue for X metres/meters" patterns
      text = text.replace(/,?\s*continue\s+for\s+[\d.]+\s*(metres|meters)/gi, '');
      // Remove "for X metres/meters" at the start
      text = text.replace(/^for\s+[\d.]+\s*(metres|meters)[,\s]*/gi, '');
      text = text.replace(/^for\s+[\d.]+\s*(metres|meters)/gi, '');
      // Remove trailing punctuation
      text = text.replace(/,\s*$/, '');
      text = text.trim();
      // If empty, use modifier
      if (!text) {
        const action = { 'turn-left': 'Turn left', 'turn-right': 'Turn right', 'uturn': 'U-turn', 'sharp-left': 'Sharp left', 'sharp-right': 'Sharp right', 'slight-left': 'Slight left', 'slight-right': 'Slight right', 'depart': 'Start walking', 'arrive': 'Arrive', 'continue': 'Continue', 'merge': 'Merge' }[modifier] || 'Walk';
        return action;
      }
      // Capitalize first letter
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function getPathLength(path) {
      if (!path || path.length < 2) return 0;
      let len = 0;
      for (let i = 0; i < path.length - 1; i++) {
        len += haversine(path[i][0], path[i][1], path[i+1][0], path[i+1][1]);
      }
      return len;
    }

    function renderTripTimeline(journey, legs, tripLegIdx, lat, lon, distToNextStation, etaStr) {
      const container = document.getElementById('trip-timeline');
      if (!container) { return; }
      container.innerHTML = '';

      const currentLeg = legs[tripLegIdx];
      if (!currentLeg) return;

      const now = Date.now();
      let html = '';
      let globalStationIdx = 0;

      // Calculate per-leg current index from global currentStationIndex
      const legStartGlobalIdx = getLegStartStationIndex(legs, tripLegIdx);
      const perLegCurrentIdx = currentStationIndex - legStartGlobalIdx;

      // Count remaining stations (upcoming stops + destinations) across all remaining legs
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

      // --- Current leg stations header ---
      const modeIcon = Router.getModeIcon(currentLeg.mode);
      const rawRoute = currentLeg.routeName || currentLeg.modeName || currentLeg.mode || 'Travel';
      const routeName = Router.formatRouteName(rawRoute, currentLeg.mode) || rawRoute;
      const platform = currentLeg.platformName || '';
      const direction = currentLeg.direction || '';
      const depTime = currentLeg.departureTime ? new Date(currentLeg.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const arrTime = currentLeg.arrivalTime ? new Date(currentLeg.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      if (currentLeg.mode !== 'walking') {
        html += '<div class="tl-leg-header">';
        html += '<span class="tl-leg-mode-icon">' + modeIcon + '</span>';
        html += '<div class="tl-leg-info">';
        html += '<div class="tl-leg-line-name">' + escapeHtml(routeName) + (direction ? ' <span class="tl-leg-dir">→ ' + escapeHtml(direction) + '</span>' : '') + '</div>';
        html += '</div>';
        if (platform) html += '<div class="tl-leg-platform">' + escapeHtml(platform) + '</div>';
        html += '</div>';
      }

      // --- Origin station (departed) ---
      if (currentLeg.from && currentLeg.mode !== 'walking') {
        const isCompleted = perLegCurrentIdx > globalStationIdx;
        const isCurrent = perLegCurrentIdx === globalStationIdx;
        html += '<div class="tl-station ' + (isCompleted ? 'completed' : (isCurrent ? 'current' : 'upcoming')) + '">';
        html += '<div class="tl-dot"></div>';
        html += '<div class="tl-station-info">';
        html += '<span class="tl-station-name">' + escapeHtml(currentLeg.from.name || '') + '</span>';
        if (depTime) html += '<span class="tl-station-time">' + depTime + '</span>';
        html += '</div>';
        html += '</div>';
        globalStationIdx++;
      }

      // --- Intermediate stops (skip walking) ---
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
              html += '<span class="tl-station-name">' + escapeHtml(stop.name || '') + '</span>';
              html += '<span class="tl-next-stop-badge">Next stop</span>';
              html += '</div></div>';
            } else {
              colStops.push({ stop, idx: globalStationIdx });
            }
          } else {
            html += '<div class="tl-station ' + stopState + '" data-station-idx="' + globalStationIdx + '">';
            html += '<div class="tl-dot"></div>';
            html += '<div class="tl-station-info">';
            html += '<span class="tl-station-name">' + escapeHtml(stop.name || '') + '</span>';
            if (stopState === 'current' && distToNextStation !== null) {
              html += '<span class="tl-you-are-here">' + Math.round(distToNextStation) + 'm away</span>';
            }
            html += '</div></div>';
          }
          globalStationIdx++;
        }
        if (colStops.length > 0) {
          const colId = 'tl-col-stops';
          const colOpen = !!_walkOpen['_col'];
          html += '<div class="tl-col-stops' + (colOpen ? ' open' : '') + '" id="' + colId + '">';
          html += '<div class="tl-col-toggle">';
          html += '<span class="tl-col-arrow">' + (colOpen ? '▼' : '▶') + '</span>';
          html += '<span class="tl-col-summary">ride ' + colStops.length + ' stop' + (colStops.length > 1 ? 's' : '') + '</span>';
          html += '</div>';
          html += '<div class="tl-col-content" style="display:' + (colOpen ? 'block' : 'none') + '">';
          for (const item of colStops) {
            html += '<div class="tl-station-upcoming-compact">';
            html += '<div class="tl-station-info">';
            html += '<span class="tl-col-stop-name">▸ ' + escapeHtml(item.stop.name || '') + '</span>';
            html += '</div></div>';
          }
          html += '</div></div>';
          setTimeout(function() {
            var el = document.getElementById(colId);
            if (el) {
              el.onclick = function(e) {
                var toggle = el.querySelector('.tl-col-toggle');
                if (toggle && !toggle.contains(e.target)) return;
                var content = el.querySelector('.tl-col-content');
                var arrow = el.querySelector('.tl-col-arrow');
                var open = content.style.display !== 'none';
                content.style.display = open ? 'none' : 'block';
                arrow.textContent = open ? '▶' : '▼';
                el.classList.toggle('open', !open);
                _walkOpen['_col'] = !open;
              };
            }
          }, 0);
        }
      }

      // --- Destination station (skip walking) ---
      if (currentLeg.to && currentLeg.mode !== 'walking') {
        const isCompleted = perLegCurrentIdx > globalStationIdx;
        const isCurrent = perLegCurrentIdx === globalStationIdx;
        const destState = isCompleted ? 'completed' : (isCurrent ? 'current' : 'upcoming');
        const approachingDest = isCurrent && currentLeg.mode !== 'walking' && distToNextStation !== null && distToNextStation < 200;

        html += '<div class="tl-station ' + destState + '" data-station-idx="' + globalStationIdx + '">';
        html += '<div class="tl-dot"></div>';
        html += '<div class="tl-station-info">';
        html += '<span class="tl-station-name">' + escapeHtml(currentLeg.to.name || '') + '</span>';
        if (approachingDest) html += '<span class="tl-alight-badge">Get off</span>';
        if (isCurrent && distToNextStation !== null) {
          html += '<span class="tl-you-are-here">' + Math.round(distToNextStation) + 'm away</span>';
        }
        html += '<span class="tl-station-time">' + (arrTime || '') + '</span>';
        html += '</div>';
        html += '</div>';
        globalStationIdx++;
      }

      // --- Current walking leg summary ---
      if (currentLeg.mode === 'walking') {
        const walkDist = currentLeg.path && currentLeg.path.length >= 2 ? Math.round(getPathLength(currentLeg.path)) : 0;
        const walkDur = currentLeg.duration || 0;
        const walkDistStr = walkDist >= 1000 ? (walkDist / 1000).toFixed(1) + 'km' : walkDist + 'm';
        html += '<div class="tl-walking">';
        html += '<span class="tl-walking-icon">🚶</span>';
        html += '<span class="tl-walking-text">Walk ' + walkDur + ' min</span>';
        if (walkDist > 0) html += '<span class="tl-walking-dist">• ' + walkDistStr + '</span>';
        html += '</div>';
      }

      // --- Walking leg after current leg (standalone, outside collapsible) ---
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

      // --- Remaining legs (always visible) ---
      const remainingStopsCount = stopsRemaining;
      if (remainingStopsCount > 0) {
        html += '<div class="tl-rem-content" style="display:block">';

        // All remaining legs (starting from remStartIdx)
        for (let ri = remStartIdx; ri < legs.length; ri++) {
          const remLeg = legs[ri];
          if (!remLeg) { html += '</div><div style="display:none">'; continue; }

          // Walking segment before this leg
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

          // Transit leg header
          const remIcon = Router.getModeIcon(remLeg.mode);
          const remRawRoute = remLeg.routeName || remLeg.modeName || remLeg.mode || 'Travel';
          const remRouteName = Router.formatRouteName(remRawRoute, remLeg.mode) || remRawRoute;
          const remDir = remLeg.direction || '';
          const remDepTime = remLeg.departureTime ? new Date(remLeg.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const remArrTime = remLeg.arrivalTime ? new Date(remLeg.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

          html += '<div class="tl-leg-header tl-rem-leg-header">';
          html += '<span class="tl-leg-mode-icon">' + remIcon + '</span>';
          html += '<div class="tl-leg-info">';
          html += '<div class="tl-leg-line-name">' + escapeHtml(remRouteName) + (remDir ? ' <span class="tl-leg-dir">→ ' + escapeHtml(remDir) + '</span>' : '') + '</div>';
          html += '</div>';
          if (remLeg.platformName) html += '<div class="tl-leg-platform">' + escapeHtml(remLeg.platformName) + '</div>';
          html += '</div>';

          // Origin + departure countdown
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
            html += '<span class="tl-station-name">' + escapeHtml(remLeg.from.name || '') + '</span>';
            html += '<span class="tl-station-time">' + (remDepTime || '') + '</span>';
            if (depCountdown) html += '<span class="tl-dep-countdown">' + depCountdown + '</span>';
            html += '</div>';
            html += '</div>';
          }

          // All intermediate stops (compact, collapsible)
          if (remLeg.stops && remLeg.stops.length) {
            let remFirstShown = false;
            const remColStops = [];
            for (const stop of remLeg.stops) {
              if (!stop.name) continue;
              if (!remFirstShown) {
                remFirstShown = true;
                html += '<div class="tl-station-upcoming-compact">';
                html += '<div class="tl-station-info">';
                html += '<span class="tl-col-stop-name">▸ ' + escapeHtml(stop.name || '') + '</span>';
                html += '</div></div>';
              } else {
                remColStops.push(stop);
              }
            }
            if (remColStops.length > 0) {
              const remColId = 'tl-rem-stops-' + ri;
              const remColOpen = !!_walkOpen['_remc_' + ri];
              html += '<div class="tl-col-stops' + (remColOpen ? ' open' : '') + '" id="' + remColId + '">';
              html += '<div class="tl-col-toggle">';
              html += '<span class="tl-col-arrow">' + (remColOpen ? '▼' : '▶') + '</span>';
              html += '<span class="tl-col-summary">ride ' + remColStops.length + ' stop' + (remColStops.length > 1 ? 's' : '') + '</span>';
              html += '</div>';
              html += '<div class="tl-col-content" style="display:' + (remColOpen ? 'block' : 'none') + '">';
              for (const item of remColStops) {
                html += '<div class="tl-station-upcoming-compact">';
                html += '<div class="tl-station-info">';
                html += '<span class="tl-col-stop-name">▸ ' + escapeHtml(item.name || '') + '</span>';
                html += '</div></div>';
              }
              html += '</div></div>';
              (function(id, ri) {
                setTimeout(function() {
                  var el = document.getElementById(id);
                  if (el) {
                    el.onclick = function(e) {
                      var toggle = el.querySelector('.tl-col-toggle');
                      if (toggle && !toggle.contains(e.target)) return;
                      var content = el.querySelector('.tl-col-content');
                      var arrow = el.querySelector('.tl-col-arrow');
                      var open = content.style.display !== 'none';
                      content.style.display = open ? 'none' : 'block';
                      arrow.textContent = open ? '▶' : '▼';
                      el.classList.toggle('open', !open);
                      _walkOpen['_remc_' + ri] = !open;
                    };
                  }
                }, 0);
              })(remColId, ri);
            }
          }

          // Destination station
          if (remLeg.to) {
            html += '<div class="tl-station upcoming">';
            html += '<div class="tl-dot"></div>';
            html += '<div class="tl-station-info">';
            html += '<span class="tl-station-name">' + escapeHtml(remLeg.to.name || '') + '</span>';
            html += '<span class="tl-station-time">' + (remArrTime || '') + '</span>';
            html += '</div>';
            html += '</div>';
          }
        }

        html += '</div>';
      }

      // --- Footer ---
      const destLeg = legs[legs.length - 1];
      const destName = destLeg && destLeg.to ? (destLeg.to.name || 'Destination') : 'Destination';

      html += '<div class="tl-footer">';
      html += '<div class="tl-footer-leg">';
      html += '<span class="tl-footer-icon">📍</span>';
      html += '<span class="tl-footer-name">' + escapeHtml(destName) + '</span>';
      if (etaStr) html += '<span class="tl-footer-time">ETA ' + escapeHtml(etaStr) + '</span>';
      html += '</div>';
      html += '</div>';

      container.innerHTML = html;

      // Auto-scroll to current station
      const currentEl = container.querySelector('.tl-station.current');
      if (currentEl) {
        setTimeout(() => {
          currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }

    function renderTripRoutes() {
      const journey = activeJourneys[tripActiveKey];
      if (!journey) return;
      MapView.clearRoutes();
      MapView.clearMarkers();

      const modeColors = { walking: '#888', bus: '#e32017', tube: '#0019a8', dlr: '#00a94f', overground: '#f86c00', 'elizabeth-line': '#6950a8', 'national-rail': '#003688', tram: '#66cc00' };

      // Collect ALL stations across all legs for markers
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

      // Add markers for ALL stations with appropriate styles
      allStations.forEach((station, idx) => {
        let color, size, label;
        const isCompleted = idx < currentStationIndex;
        const isCurrent = idx === currentStationIndex;
        const isUpcoming = idx > currentStationIndex;

        if (tripArrived || isCompleted) {
          color = '#00cc66'; size = 10; label = station.name || 'Station';
        } else if (isCurrent) {
          color = '#4285f4'; size = 14; label = station.name || 'Station';
        } else {
          color = '#aaaaaa'; size = 8; label = station.name || 'Station';
        }

        MapView.addMarker(station.lat, station.lon, label, color);
      });

      // Draw route lines - completed legs green, current bright green with wider stroke, future legs colored
      journey.legs.forEach((leg, i) => {
        const path = leg.path || [];
        if (path.length < 2) return;

        if (i < tripLegIndex) {
          // Completed leg - green
          MapView.addRoute(path, '#00cc66', '', 3);
        } else if (i === tripLegIndex) {
          // Current leg - bright green, wider
          MapView.addRoute(path, '#33ff99', '', 6);
        } else {
          // Future leg - mode color
          MapView.addRoute(path, modeColors[leg.mode] || '#666', '', 4);
        }
      });

      // Auto-zoom to show full journey on first render
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
      const journey = activeJourneys[tripActiveKey];
      if (!journey || !journey.legs.length) return;
      const legs = journey.legs;
      const currentLeg = legs[tripLegIndex];
      if (!currentLeg) return;
      const now = Date.now();
      const speed = _currentSpeed;

      // --- Leg Advancement (80m Haversine threshold) ---
      if (tripLegIndex < legs.length - 1 && now - lastLegTransitionTime > 5000) {
        let distToEnd = Infinity, distToNextStart = Infinity;
        if (currentLeg.to && currentLeg.to.lat != null) {
          distToEnd = haversine(lat, lon, currentLeg.to.lat, currentLeg.to.lon);
        }
        const nextLeg = legs[tripLegIndex + 1];
        if (nextLeg && nextLeg.from && nextLeg.from.lat != null) {
          distToNextStart = haversine(lat, lon, nextLeg.from.lat, nextLeg.from.lon);
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

      // --- Re-render map routes when leg index changes ---
      if (tripLegIndex !== lastRenderedLegIndex) {
        // When leg changes, set currentStationIndex to the new leg's starting station index
      currentStationIndex = getLegStartStationIndex(legs, tripLegIndex);
        window._notifiedAlight = false;
        renderTripRoutes();
        lastRenderedLegIndex = tripLegIndex;
      }

      // --- Final destination arrival detection (GPS-aware threshold) ---
      if (!tripArrived && tripLegIndex === legs.length - 1) {
        const finalLeg = legs[legs.length - 1];
        if (finalLeg && finalLeg.to && finalLeg.to.lat != null) {
          const dist = haversine(lat, lon, finalLeg.to.lat, finalLeg.to.lon);
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

      // --- Alight notification for transit stops ---
      if (!tripArrived && !window._notifiedAlight) {
        const cur = legs[tripLegIndex];
        if (cur && cur.mode !== 'walking' && cur.to && cur.to.lat != null) {
          const dist = haversine(lat, lon, cur.to.lat, cur.to.lon);
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

      // --- Deviation Detection (>200m Haversine) ---
      if (!tripArrived && !tripRerouting) {
        let minDist = Infinity;
        for (const leg of legs) {
          if (leg.path && leg.path.length >= 2) {
            for (let i = 0; i < leg.path.length; i++) {
              const d = haversine(lat, lon, leg.path[i][0], leg.path[i][1]);
              if (d < minDist) { minDist = d; if (minDist < 80) break; }
            }
          } else {
            if (leg.from && leg.from.lat != null) {
              const d = haversine(lat, lon, leg.from.lat, leg.from.lon);
              if (d < minDist) minDist = d;
            }
            if (leg.to && leg.to.lat != null) {
              const d = haversine(lat, lon, leg.to.lat, leg.to.lon);
              if (d < minDist) minDist = d;
            }
          }
          if (minDist < 80) break;
        }
        if (minDist > 200) {
          if (tripDeviationStart === null) tripDeviationStart = now;
          else if (now - tripDeviationStart > 15000) {
            tripDeviationStart = null;
            tripRerouting = true;
            triggerReroute(lat, lon);
          }
        } else {
          tripDeviationStart = null;
        }
      }

      // --- Progress Bar ---
      const totalDuration = legs.reduce((sum, l) => sum + (l.duration || 0), 0);
      let completedDuration = legs.slice(0, tripLegIndex).reduce((sum, l) => sum + (l.duration || 0), 0);
      let currentLegProgress = 0;

      const curLeg = legs[tripLegIndex];
      if (curLeg) {
        if (curLeg.path && curLeg.path.length >= 2) {
          const p = getProgressAlongPath(curLeg.path, lat, lon);
          if (p > 0) currentLegProgress = Math.min(p, 1);
        } else if (curLeg.from && curLeg.to && curLeg.from.lat != null && curLeg.to.lat != null) {
          const dFrom = haversine(lat, lon, curLeg.from.lat, curLeg.from.lon);
          const totalD = haversine(curLeg.from.lat, curLeg.from.lon, curLeg.to.lat, curLeg.to.lon);
          if (totalD > 0) currentLegProgress = Math.min(dFrom / totalD, 1);
        }
      }

      const currentLegDuration = curLeg ? (curLeg.duration || 0) : 0;
      const currentProgressDuration = currentLegProgress * currentLegDuration;
      const totalProgress = tripArrived ? 100 : (totalDuration > 0
        ? Math.min(99, Math.round(((completedDuration + currentProgressDuration) / totalDuration) * 100))
        : 0);

      // --- ETA: walking uses GPS speed, transit uses schedule+delay ---
      let remainingSecs = 0;
      if (tripArrived) {
        remainingSecs = 0;
      } else {
        if (curLeg && curLeg.mode === 'walking') {
          const remainingPathDist = curLeg.path && curLeg.path.length >= 2
            ? (1 - currentLegProgress) * getPathLength(curLeg.path)
            : (1 - currentLegProgress) * (curLeg.from && curLeg.to ? haversine(curLeg.from.lat, curLeg.from.lon, curLeg.to.lat, curLeg.to.lon) : 100);
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

      // --- Connection Alert Check (every 30s, offline-safe) ---
      if (!tripArrived && tripLegIndex < legs.length - 1 && now - (window._lastConnectionCheck || 0) > 30000 && navigator.onLine) {
        window._lastConnectionCheck = now;
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

      // --- Find nearest station for timeline tracking ---
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
          const d = haversine(lat, lon, st.lat, st.lon);
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
        if (candidateStationIdx > currentStationIndex) {
          currentStationIndex = candidateStationIdx;
        }

        const nextStationItem = allStations.find(s => s.idx === nearestStationIdx + 1);
        if (nextStationItem) {
          distToNextStation = haversine(lat, lon, nextStationItem.lat, nextStationItem.lon);
        } else if (cur.to && nearestStationIdx === allStations.length - 1) {
          distToNextStation = haversine(lat, lon, cur.to.lat, cur.to.lon);
        }
      } else if (cur && cur.mode === 'walking') {
        currentStationIndex = legStartGlobalIdx;
      }

      // --- Update UI ---
      const progressText = document.getElementById('trip-progress-text');
      const progressFill = document.getElementById('trip-progress-fill');
      const tripEta = document.getElementById('trip-eta');
      if (progressText) progressText.textContent = (tripArrived ? '100' : totalProgress) + '%';
      if (progressFill) progressFill.style.width = (tripArrived ? '100' : totalProgress) + '%';
      if (tripEta) tripEta.textContent = tripArrived ? '✅ Arrived' : 'ETA ' + etaStr;

      // --- Google Maps-Style Timeline ---
      renderTripTimeline(journey, legs, tripLegIndex, lat, lon, distToNextStation, etaStr);

      // --- Highlight steps in journey card ---
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

    async function triggerReroute(fromLat, fromLon) {
      if (!navigator.onLine) { tripRerouting = false; showRerouteNotification('Cannot reroute while offline'); return; }
      if (!activeJourneys || !tripActiveKey) { tripRerouting = false; return; }
      const oldJourney = activeJourneys[tripActiveKey];
      if (!oldJourney || !oldJourney.legs.length) { tripRerouting = false; return; }
      const destLeg = oldJourney.legs[oldJourney.legs.length - 1];
      if (!destLeg || !destLeg.to || destLeg.to.lat == null) { tripRerouting = false; return; }
      const from = { label: 'Current Location', lat: fromLat, lon: fromLon };
      const to = { label: destLeg.to.name || 'Destination', lat: destLeg.to.lat, lon: destLeg.to.lon };
      let modes = [];
      try { modes = UI.getActiveModes ? UI.getActiveModes() : []; } catch {}
      try {
        const result = await Router.plan(from, to, { modes, timeMode: 'now' });
        if (!result || !result.fastest) { tripRerouting = false; return; }
        if (result.fastest.duration > oldJourney.duration * 2 && oldJourney.duration > 5) {
          showRerouteNotification('Staying on current route');
          tripRerouting = false; return;
        }
        activeJourneys[tripActiveKey] = result.fastest;
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
        if (newFirst && newFirst.from) activeFromMarker = MapView.addMarker(newFirst.from.lat, newFirst.from.lon, 'From: ' + (UI.getFromText() || 'Start'), '#0019a8');
        if (newLast && newLast.to) activeToMarker = MapView.addMarker(newLast.to.lat, newLast.to.lon, 'To: ' + (UI.getToText() || 'Destination'), '#e32017');
        showRerouteNotification('Route recalculated');
      } catch (e) {
        console.warn('Reroute failed:', e);
      }
      tripRerouting = false;
    }

    // --- Clear ---
    document.addEventListener('clear-all', () => {
      if (UI.isLiveTracking()) {
        document.dispatchEvent(new Event('toggle-live'));
      }
      MapView.clearAll();
      activeJourneys = null; activeFromMarker = null; activeToMarker = null;
      UI.hidePanels();
      MapView.hideStopMarkers();
      MapView.hideBikeMarkers();
      MapView.flyTo(CONFIG.mapCenter[0], CONFIG.mapCenter[1], CONFIG.mapZoom);
      document.getElementById('results-panel').innerHTML = '';
      const mapOv = document.getElementById('map-overlay');
      mapOv.classList.remove('floating', 'popout', 'open');
      delete mapOv.dataset.tripFs;
      delete mapOv.dataset.tripFsWasMin;
      mapOv.style.left = '';
      mapOv.style.top = '';
      mapOv.style.bottom = '';
      mapOv.style.right = '';
      mapOv.style.width = '';
      mapOv.style.height = '';
    });

    // --- Bike Points Toggle ---
    async function drawBikeRoute(lat, lon, name) {
      if (!bikeLocation) return;
      if (window._bikeRouteLayers) { window._bikeRouteLayers.forEach(l => { try { l.remove(); } catch {} }); window._bikeRouteLayers = []; }
      const overlay = document.getElementById('map-overlay');
      if (overlay && !overlay.classList.contains('open')) {
        overlay.classList.add('open');
        const toggle = document.getElementById('map-toggle-btn'); if (toggle) toggle.innerHTML = '<span class="ic" data-ic="close"></span> Close';
        document.body.style.overflow = 'hidden';
        setTimeout(() => { const m = MapView.getMap && MapView.getMap(); if (m && m.invalidateSize) m.invalidateSize(); }, 100);
      }
      const fromLat = bikeLocation.lat, fromLon = bikeLocation.lon;
      let route;
      try { route = await Api.getWalkingRoute(fromLat, fromLon, lat, lon); } catch (e) { UI.showError('Could not fetch walking route'); return; }
      const coords = (route && route.coords) ? route.coords : [[fromLat, fromLon], [lat, lon]];
      MapView.clearRoutes(); MapView.clearMarkers();
      MapView.addRoute(coords, '#0019a8');
      MapView.addMarker(fromLat, fromLon, 'From: Walking start', '#0019a8');
      MapView.addMarker(lat, lon, 'To: ' + (name || 'Bike'), '#e32017');
      if (coords.length) MapView.fitBounds([...coords]);
      let bBtn = document.getElementById('bike-map-close-btn');
      if (!bBtn) {
        bBtn = document.createElement('div'); bBtn.id = 'bike-map-close-btn'; bBtn.innerHTML = '<span class="ic" data-ic="close"></span>';
        overlay.appendChild(bBtn);
      }
      bBtn.onclick = () => {
        MapView.clearRoutes(); MapView.clearMarkers();
        bBtn.style.display = 'none';
        if (overlay.classList.contains('open')) {
          overlay.classList.remove('open');
          document.getElementById('map-toggle-btn').innerHTML = '<span class="ic" data-ic="map"></span> Map';
          document.body.style.overflow = '';
        }
      };
      bBtn.style.display = 'flex';
    }

    document.addEventListener('bike-route-to', e => {
      drawBikeRoute(e.detail.lat, e.detail.lon, e.detail.name);
    });

    document.addEventListener('toggle-bikes', async () => {
      const currentlyVisible = UI.isBikeMarkersVisible();
      if (currentlyVisible) {
        UI.toggleBikeMarkers(false);
        MapView.hideBikeMarkers();
        if (window._bikeRouteLayers) { window._bikeRouteLayers.forEach(l => { try { l.remove(); } catch {} }); window._bikeRouteLayers = []; }
        document.getElementById('bike-list').innerHTML = '';
        bikeLocation = null;
        return;
      }
      // Switch to bikes tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.querySelector('.tab-btn[data-tab="bikes"]').classList.add('active');
      document.getElementById('tab-bikes').classList.add('active');

      const loc = await promptBikeLocation();
      if (!loc) { UI.toggleBikeMarkers(false); UI.showError('Could not find that location. Try a postcode, station, or place name.'); return; }
      bikeLocation = loc;
      try {
        const data = await Api.getBikePoints(loc.lat, loc.lon, 10000);
        if (Array.isArray(data)) {
          bikePoints = data.map(b => {
            const props = {};
            (b.additionalProperties || []).forEach(p => { props[p.key] = p.value; });
            return {
              id: b.id,
              name: b.commonName,
              lat: b.lat,
              lon: b.lon,
              bikes: parseInt(props.NbBikes) || 0,
              docks: parseInt(props.NbDocks) || 0,
              spaces: parseInt(props.NbEmptyDocks) || 0
            };
          });
          MapView.showBikeMarkers(bikePoints);
          MapView.flyTo(loc.lat, loc.lon, 12);
          UI.showBikePanel(bikePoints, loc.lat, loc.lon);
        }
        setupBikeAutocomplete();
      } catch { UI.toggleBikeMarkers(false); }
    });

    UI._setupBikeAutocomplete = function() { setupBikeAutocomplete(); };

    // --- Transit Layer Overlay ---
    window.__transitLayerCache = {};
    window.__transitLayerRoutes = {};

    function setupTransitLayers() {
      const toggles = document.getElementById('layer-toggles');
      if (!toggles) return;
      toggles.classList.remove('hidden');

      document.querySelectorAll('.layer-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const mode = btn.dataset.mode;
          const active = btn.classList.toggle('active');
          if (!active) {
            const layers = window.__transitLayerRoutes[mode];
            if (layers) {
              (layers.leaflet || []).forEach(l => { try { l.remove(); } catch {} });
              (layers.mlIds || []).forEach(id => { try { if (map3dInstance) map3dInstance.removeLayer(id); } catch {} });
              (layers.mlIds || []).forEach(id => { try { if (map3dInstance && !id.endsWith('_glow')) map3dInstance.removeSource(id.replace(/_glow$/, '')); } catch {} });
              delete window.__transitLayerRoutes[mode];
            }
            return;
          }
          btn.textContent = '...';
          try {
            const lines = await Status.fetchAll();
            const modeLines = (lines || []).filter(l => l.mode === mode);
            if (!modeLines.length) { btn.textContent = 'None'; setTimeout(() => { btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1).replace('-', ' '); }, 1500); btn.classList.remove('active'); return; }

            const color = btn.style.background || '#555';
            const routeLayers = { leaflet: [], mlIds: [] };
            let fetched = 0;
            const prevMlCount = window.__ml_lineLayer ? window.__ml_lineLayer.lines.length : 0;

            for (const line of modeLines.slice(0, 20)) {
              const cacheKey = mode + '_' + line.id;
              let path = window.__transitLayerCache[cacheKey];
              if (!path) {
                try {
                  const data = await Api.getLineRoutes(line.id, 'inbound');
                  const coords = Router.extractRoutePath(data);
                  if (coords.length >= 2) {
                    path = coords;
                    window.__transitLayerCache[cacheKey] = coords;
                  }
                } catch {}
              }
              if (path && path.length >= 2) {
                const layer = MapView.addRoute(path, color, '', 2, 0.35);
                if (layer) routeLayers.leaflet.push(layer);
                fetched++;
              }
            }

            // Track the 3D layers added for this mode
            const newMlCount = window.__ml_lineLayer ? window.__ml_lineLayer.lines.length : 0;
            for (let i = prevMlCount; i < newMlCount; i++) {
              routeLayers.mlIds.push(window.__ml_lineLayer.lines[i]);
            }
            window.__transitLayerRoutes[mode] = routeLayers;
            btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1).replace('-', ' ') + ' (' + fetched + ')';
          } catch {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1).replace('-', ' '); btn.classList.remove('active'); }, 2000);
          }
        });
      });
    }
    setupTransitLayers();

    function setupBikeAutocomplete() {
      const input = document.getElementById('bike-search-input');
      const suggestionsEl = document.getElementById('bike-search-suggestions');
      if (!input || input._bikeAutocompleteSetup) return;
      input._bikeAutocompleteSetup = true;
      let timeout;
      input.addEventListener('input', () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (q.length < 2) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('active'); return; }
        timeout = setTimeout(async () => {
          const results = await Geocoder.search(q);
          if (results.length) {
            suggestionsEl.innerHTML = results.map(r =>
               `<div class="suggestion-item" data-label="${escapeAttr(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}" data-type="${escapeAttr(r.type)}">
                 <span class="sug-type">${r.type === 'stop' ? '🚏' : '📍'}</span>
                 <span class="sug-label">${escapeHtml(r.label)}</span>
                 <span class="sug-sub">${escapeHtml((r.fullLabel || '').substring(0, 100))}</span>
               </div>`
            ).join('');
            suggestionsEl.classList.add('active');
          } else {
            suggestionsEl.innerHTML = '';
            suggestionsEl.classList.remove('active');
          }
        }, 200);
      });
      suggestionsEl.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        input.value = item.dataset.label;
        suggestionsEl.innerHTML = '';
        suggestionsEl.classList.remove('active');
        document.dispatchEvent(new CustomEvent('bike-search-loc', { detail: { lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), label: item.dataset.label } }));
      });
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('active');
          const q = input.value.trim();
          if (!q) return;
          const results = await Geocoder.search(q);
          if (results.length) {
            document.dispatchEvent(new CustomEvent('bike-search-loc', { detail: { lat: results[0].lat, lon: results[0].lon, label: results[0].label } }));
          }
        }
      });
      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('active');
        }
      });
      document.getElementById('bike-search-gps').addEventListener('click', () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          pos => document.dispatchEvent(new CustomEvent('bike-search-loc', { detail: { lat: pos.coords.latitude, lon: pos.coords.longitude } })),
          () => {},
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
      document.getElementById('bike-search-pin').addEventListener('click', () => {
        bikePinTarget = true;
        UI.setMapPinMode('bike');
      });
      document.addEventListener('bike-search-loc', async (e) => {
        const loc = e.detail;
        bikeLocation = { lat: loc.lat, lon: loc.lon };
        try {
          const data = await Api.getBikePoints(loc.lat, loc.lon, 10000);
          if (Array.isArray(data)) {
            bikePoints = data.map(b => {
              const props = {};
              (b.additionalProperties || []).forEach(p => { props[p.key] = p.value; });
              return { id: b.id, name: b.commonName, lat: b.lat, lon: b.lon, bikes: parseInt(props.NbBikes) || 0, docks: parseInt(props.NbDocks) || 0, spaces: parseInt(props.NbEmptyDocks) || 0 };
            });
            MapView.hideBikeMarkers();
            MapView.showBikeMarkers(bikePoints);
            UI.toggleBikeMarkers(true);
            MapView.flyTo(loc.lat, loc.lon, 12);
            UI.showBikePanel(bikePoints, loc.lat, loc.lon);
          }
        } catch {}
      });
    }

    async function promptBikeLocation() {
      const oldClean = window._bikePromptCleanup;
      if (oldClean) oldClean();

      return new Promise(resolve => {
        const input = document.getElementById('bike-search-input');
        const suggestionsEl = document.getElementById('bike-search-suggestions');
        const list = document.getElementById('bike-list');
        list.innerHTML = '<div class="no-data" style="padding:20px;text-align:center;color:var(--text2);font-size:11px">Search a postcode, station, or place above to find nearby bikes</div>';
        input.value = '';
        input.focus();

        const abort = new AbortController();
        const opts = { signal: abort.signal };

        function doResolve(val) {
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('active');
          abort.abort();
          resolve(val);
        }

        document.getElementById('bike-search-gps').addEventListener('click', () => {
          if (!navigator.geolocation) { doResolve({ lat: 51.5, lon: -0.12 }); return; }
          list.innerHTML = '<div class="no-data" style="padding:20px;text-align:center;color:var(--text2);font-size:11px">Getting your location...</div>';
          navigator.geolocation.getCurrentPosition(
            pos => { doResolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
            () => { doResolve({ lat: 51.5, lon: -0.12 }); },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        }, opts);

        document.getElementById('bike-search-pin').addEventListener('click', () => {
          bikePinTarget = true;
          UI.setMapPinMode('bike');
          list.innerHTML = '<div class="no-data" style="padding:20px;text-align:center;color:var(--text2);font-size:11px">Click on the map to set bike search location</div>';
        }, opts);

        let autocompleteTimeout;
        input.addEventListener('input', () => {
          clearTimeout(autocompleteTimeout);
          if (abort.signal.aborted) return;
          const q = input.value.trim();
          if (q.length < 2) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('active'); return; }
          autocompleteTimeout = setTimeout(async () => {
            if (abort.signal.aborted) return;
            const results = await Geocoder.search(q);
            if (abort.signal.aborted) return;
            if (results.length) {
              suggestionsEl.innerHTML = results.map(r =>
                `<div class="suggestion-item" data-label="${escapeAttr(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}" data-type="${escapeAttr(r.type)}">
                  <span class="sug-type">${r.type === 'stop' ? '🚏' : '📍'}</span>
                  <span class="sug-label">${escapeHtml(r.label)}</span>
                <span class="sug-sub">${escapeHtml((r.fullLabel || '').substring(0, 100))}</span>
                </div>`
              ).join('');
              suggestionsEl.classList.add('active');
            } else {
              suggestionsEl.innerHTML = '';
              suggestionsEl.classList.remove('active');
            }
          }, 200);
        }, opts);

        suggestionsEl.addEventListener('click', (e) => {
          const item = e.target.closest('.suggestion-item');
          if (!item) return;
          input.value = item.dataset.label;
          doResolve({ lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), label: item.dataset.label });
        }, opts);

        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            suggestionsEl.innerHTML = '';
            suggestionsEl.classList.remove('active');
            const q = input.value.trim();
            if (!q) return;
            const results = await Geocoder.search(q);
            if (results.length) {
              doResolve({ lat: results[0].lat, lon: results[0].lon, label: results[0].label });
            } else {
              doResolve({ label: q, lat: 51.5, lon: -0.12 });
            }
          }
        }, opts);

        const docHandler = (e) => {
          if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
            suggestionsEl.innerHTML = '';
            suggestionsEl.classList.remove('active');
          }
        };
        document.addEventListener('click', docHandler);
        abort.signal.addEventListener('abort', () => document.removeEventListener('click', docHandler));

        window._bikePromptCleanup = () => { abort.abort(); };
      });
    }

    // --- 3D View Toggle ---
    let map3dInstance = null;
    let rotationHandle = null;
    let loadTimer = null;
    let wasMinimizedFor3D = false;
    let start3DTimer = null;
    let tripEnd3D = null; // shared ref for floating map handlers block

    document.getElementById('view-3d-btn').addEventListener('click', () => {
      const overlay = document.getElementById('map-overlay');
      const mapEl = document.getElementById('map');
      const map3dEl = document.getElementById('map-3d');
      const btn = document.getElementById('view-3d-btn');

      if (map3dInstance) {
        end3D();
        return;
      }

      if (typeof maplibregl === 'undefined') {
        UI.showError('MapLibre GL not loaded. Check internet or reload.');
        mapEl.style.display = 'block'; map3dEl.style.display = 'none'; map3dEl.classList.add('hidden');
        btn.textContent = '🧊 3D'; btn.classList.remove('active3d');
        return;
      }
      let glTest = document.createElement('canvas').getContext('webgl2');
      if (!glTest) {
        UI.showError('WebGL2 not supported. 3D map requires a modern browser.');
        mapEl.style.display = 'block'; map3dEl.style.display = 'none'; map3dEl.classList.add('hidden');
        btn.textContent = '🧊 3D'; btn.classList.remove('active3d');
        return;
}

      // If in minimized state, expand to big floating for 3D
      if (overlay.classList.contains('popout')) {
        wasMinimizedFor3D = true;
        overlay.classList.remove('popout');
        overlay.style.left = '';
        overlay.style.top = '';
        overlay.style.bottom = '';
        overlay.style.right = '';
        overlay.style.width = '';
        overlay.style.height = '';
        const m = MapView.getMap();
        if (m) setTimeout(() => { m.invalidateSize(); }, 50);
        // Short delay to allow DOM transition before 3D starts
        if (start3DTimer) clearTimeout(start3DTimer);
        start3DTimer = setTimeout(start3DMap, 120);
      } else {
        wasMinimizedFor3D = false;
        start3DMap();
      }

function start3DMap() {
        const m = MapView.getMap();
        if (!m) return;
        const center = m.getCenter();
        const zoom = m.getZoom();
        activeCenter = [center.lat, center.lng];
        activeZoom = zoom;

        map3dEl.innerHTML = '<div class="loading" style="height:100%;display:flex;align-items:center;justify-content:center"><div class="spinner"></div><span style="margin-left:10px">Loading 3D map...</span></div>';
        mapEl.style.display = 'none';
        map3dEl.style.display = 'block';
        map3dEl.classList.remove('hidden');
        btn.textContent = '◀ 2D';
        btn.classList.add('active3d');

        let tile3dIdx = 0;
        function makeTileStyle(idx) {
          const p = CONFIG.tileProvider3d[idx];
          if (!p) return null;
          return {
            version: 8,
            sources: {
              base: {
                type: 'raster',
                tiles: [p.url],
                tileSize: 256,
                attribution: p.attribution || '© OpenStreetMap contributors',
                maxzoom: p.maxZoom || 19
              }
            },
            layers: [
              { id: 'bg', type: 'background', paint: { 'background-color': '#080a10' } },
              { id: 'base-raster', type: 'raster', source: 'base' }
            ]
          };
        }

        function switchTileProvider3d() {
          tile3dIdx++;
          if (tile3dIdx >= CONFIG.tileProvider3d.length) {
            console.warn('All 3D tile providers failed');
            UI?.showError?.('3D map tiles unavailable — no tile provider responded.');
            return;
          }
          const src = map3dInstance.getSource('base');
          const p = CONFIG.tileProvider3d[tile3dIdx];
          if (src && p) {
            try { src.setTiles([p.url]); } catch {
              map3dInstance.setStyle(makeTileStyle(tile3dIdx));
              map3dInstance.once('style.load', () => {
                map3dInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
                MapView.set3dMap(map3dInstance);
                MapView.resync3d();
              });
            }
            console.log(`3D tile provider: ${p.name}`);
          }
        }

        const style = makeTileStyle(0);

        function addBuildingLayer() {
          if (map3dInstance.getLayer('bld-fill')) return;
          try {
            map3dInstance.addSource('bld', {
              type: 'vector',
              url: 'https://tiles.openfreemap.org/planet'
            });
            map3dInstance.addLayer({
              id: 'bld-fill',
              type: 'fill-extrusion',
              source: 'bld',
              'source-layer': 'building',
              minzoom: 14,
              paint: {
                'fill-extrusion-color': 'hsl(35,8%,85%)',
                'fill-extrusion-height': ['get', 'render_height'],
                'fill-extrusion-base': ['get', 'render_min_height'],
                'fill-extrusion-opacity': 0.8
              }
            });
          } catch {}
        }

        try {
          map3dInstance = new maplibregl.Map({
            container: map3dEl,
            style,
            center: [center.lng, center.lat],
            zoom: Math.max(zoom, 13),
            pitch: 55,
            bearing: -15,
            antialias: true
          });

          MapView.set3dMap(map3dInstance);
          MapView.syncBikeMarkers3d();
          setTimeout(() => MapView.syncBikeMarkers3d(), 500);
          setTimeout(() => MapView.syncBikeMarkers3d(), 2000);
          map3dInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
          let tile3dFailCount = 0, tile3dFailTimer = null;
          map3dInstance.on('error', (e) => {
            if (e.error && e.error.status === 0 && tile3dIdx < CONFIG.tileProvider3d.length - 1) {
              tile3dFailCount++;
              if (tile3dFailTimer) clearTimeout(tile3dFailTimer);
              tile3dFailTimer = setTimeout(() => {
                if (tile3dFailCount >= 3) {
                  console.warn(`3D tile provider failed (${tile3dFailCount} errors), switching`);
                  switchTileProvider3d();
                  tile3dFailCount = 0;
                }
              }, 2000);
            }
          });
          map3dInstance.on('click', (e) => handleMapClick(e.lngLat.lat, e.lngLat.lng));

          let buildingsLoaded = false;
          map3dInstance.on('load', () => {
            document.querySelector('#map-3d .loading')?.remove();
            document.body.classList.add('mode-3d');
            map3dInstance.resize();
            console.debug('3D load event fired, running resync3d');
            MapView.resync3d();
            if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }

            if (!buildingsLoaded) {
              buildingsLoaded = true;
              if (map3dInstance.getZoom() < 13) return;
              addBuildingLayer();
            }

            try { map3dInstance.setFog({ range: [0.5, 8], color: '#0d0f15', 'high-color': '#141e2a', 'space-color': '#030508', 'horizon-blend': 0.2 }); } catch {}
            try { map3dInstance.setLight({ anchor: 'viewport', position: [80, 50, 30] }); } catch {}
            let last = Date.now();
            ['dragstart','zoomstart','rotatestart','pitchstart'].forEach(ev => map3dInstance.on(ev, () => { last = Date.now(); }));
            const spin = () => {
              if (Date.now() - last > 8000) map3dInstance.setBearing((map3dInstance.getBearing() + 0.05) % 360);
              rotationHandle = requestAnimationFrame(spin);
            };
            spin();
          });

          loadTimer = setTimeout(() => {
            if (map3dInstance && loadTimer) {
              document.querySelector('#map-3d .loading')?.remove();
              document.body.classList.add('mode-3d');
              MapView.resync3d();
              if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
            }
          }, 15000);

        } catch (e) {
          console.error('3D init failed:', e);
          map3dInstance = null;
          MapView.set3dMap(null);
          map3dEl.style.display = 'none';
          map3dEl.classList.add('hidden');
          mapEl.style.display = 'block';
          btn.textContent = '🧊 3D';
          btn.classList.remove('active3d');
          UI.showError('3D view failed: ' + (e && e.message || e));
        }
      }

      function end3D() {
        if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
        if (rotationHandle) { cancelAnimationFrame(rotationHandle); rotationHandle = null; }

        const mc = map3dInstance ? map3dInstance.getCenter() : null;
        const mz = map3dInstance ? map3dInstance.getZoom() : null;
        if (mc) { activeCenter = [mc.lat, mc.lng]; activeZoom = mz; }

        if (map3dInstance) {
          try { map3dInstance.remove(); } catch {}
          map3dInstance = null;
          MapView.set3dMap(null);
          MapView.clear3dState();
        }

        map3dEl.innerHTML = '';
        map3dEl.style.display = 'none';
        map3dEl.classList.add('hidden');
        mapEl.style.display = 'block';
        btn.textContent = '🧊 3D';
        btn.classList.remove('active3d');
        document.body.classList.remove('mode-3d');

        if (wasMinimizedFor3D) {
          wasMinimizedFor3D = false;
          overlay.classList.add('floating', 'popout');
        }

        const m = MapView.getMap();
        if (m) {
          setTimeout(() => {
            m.invalidateSize({ pan: false });
            if (activeCenter) {
              m.setView(activeCenter, activeZoom || m.getZoom(), { animate: false });
            }
            m.invalidateSize({ pan: true });
          }, 50);
        }
      }
      tripEnd3D = end3D;
    });
    function switchToJourneyTab() {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.querySelector('.tab-btn[data-tab="journey"]').classList.add('active');
      document.getElementById('tab-journey').classList.add('active');
    }

    // Nearby button → direct GPS
    document.getElementById('nearby-btn').addEventListener('click', () => {
      if (!navigator.geolocation) { UI.showError('Geolocation not supported'); return; }
      const btn = document.getElementById('nearby-btn');
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Locating...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          UI.showNearbyStops(lat, lon);
          MapView.flyTo(lat, lon, 15);
          btn.innerHTML = '<span class="ic" data-ic="nearby"></span> Nearby';
          switchToJourneyTab();
        },
        (err) => {
          UI.showError('Location error: ' + err.message);
          btn.innerHTML = '<span class="ic" data-ic="nearby"></span> Nearby';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    

    // Search place in nearby panel
    (function setupNearbySearch() {
      const input = document.getElementById('nearby-search-input');
      const suggestionsEl = document.getElementById('nearby-search-suggestions');
      if (!input) return;
      let timeout;
      input.addEventListener('input', () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (q.length < 2) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('active'); return; }
        timeout = setTimeout(async () => {
          const results = await Geocoder.search(q);
          if (results.length) {
            suggestionsEl.innerHTML = results.map(r =>
               `<div class="suggestion-item" data-label="${escapeAttr(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}">
                 <span class="sug-type">📍</span>
                 <span class="sug-label">${escapeHtml(r.label)}</span>
                 <span class="sug-sub">${escapeHtml((r.fullLabel || '').substring(0, 80))}</span>
               </div>`
            ).join('');
            suggestionsEl.classList.add('active');
          } else {
            suggestionsEl.innerHTML = '<div class="suggestion-item" style="color:#999;cursor:default">No results</div>';
            suggestionsEl.classList.add('active');
          }
        }, 200);
      });
      suggestionsEl.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item || !item.dataset.lat) return;
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        input.value = item.dataset.label;
        suggestionsEl.innerHTML = '';
        suggestionsEl.classList.remove('active');
        UI.showNearbyStops(lat, lon);
        MapView.flyTo(lat, lon, 15);
      });
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('active');
          const q = input.value.trim();
          if (!q) return;
          const results = await Geocoder.search(q);
          if (results.length) {
            const r = results[0];
            UI.showNearbyStops(r.lat, r.lon);
            MapView.flyTo(r.lat, r.lon, 15);
          }
        }
      });
    })();

    // --- Live Location Tracking ---
    document.addEventListener('toggle-live', () => {
      const btn = document.getElementById('live-toggle');
      if (watchId !== null && !MapView.isFollowMode()) {
        MapView.setFollowMode(true);
        btn.innerHTML = '<span class="live-pulse-dot"></span> LIVE';
        return;
      }
      const on = !UI.isLiveTracking();
      if (on) {
        if (!navigator.geolocation) { UI.showError('Geolocation not supported'); return; }
        UI.setLiveTracking(true);
        btn.innerHTML = '<span class="live-pulse-dot"></span> LIVE';
        MapView.setFollowMode(true);
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude: lat, longitude: lon, heading, accuracy } = pos.coords;
            MapView.showUserLocation(lat, lon, heading, accuracy);
            if (MapView.isFollowMode()) {
              MapView.panTo(lat, lon);
              if (heading != null && !isNaN(heading)) {
                try {
                  const m = MapView.getMap();
                  if (m && typeof m.setBearing === 'function') {
                    m.setBearing(heading, { animate: true, duration: 0.3 });
                  }
                } catch {}
              }
            }
            UI.showNearbyStops(lat, lon, true);
          },
          (err) => { UI.showError('Location error: ' + err.message); toggleLiveOff(); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
        liveNearbyTimer = setInterval(async () => {
          if (MapView.isUserLocationVisible() && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => UI.showNearbyStops(pos.coords.latitude, pos.coords.longitude, true),
              () => {},
              { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
            );
          }
        }, 30000);
        MapView.onMoveEnd(() => {
          if (watchId !== null) btn.innerHTML = '<span class="ic" data-ic="gps"></span> RECENTER';
        });
      } else {
        toggleLiveOff();
      }
      function toggleLiveOff() {
        UI.setLiveTracking(false);
        if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
        if (liveNearbyTimer !== null) { clearInterval(liveNearbyTimer); liveNearbyTimer = null; }
        MapView.offMoveEnd();
        MapView.hideUserLocation();
        MapView.setFollowMode(true);
        btn.innerHTML = '<span class="ic" data-ic="gps"></span>';
      }
    });

    // --- Open departures from map stop click ---
    document.addEventListener('open-departures', (e) => {
      const { id, name, lat, lon, stopLetter } = e.detail;
      UI.showDepartures(id, name, stopLetter || '');
      MapView.flyTo(lat, lon, 16);
    });

    // --- Full Day Timetable (route-specific) ---
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.full-day-btn');
      if (btn) {
        const stopId = btn.dataset.stop;
        const lineId = Api.normalizeLineId(btn.dataset.line);
        const dir = btn.dataset.dir || '';
        const panel = document.getElementById('departures-panel');
        let stopName = panel.dataset.stopName;
        if (!stopName) {
          const h3 = (panel.querySelector('h3').textContent || '').replace('LIVE', '').replace(/[🚏📋]/g, '').trim();
          const sepIdx = h3.indexOf('·');
          stopName = sepIdx >= 0 ? h3.substring(sepIdx + 1).trim() : h3.replace(/Timetable/g, '').trim();
        }
        e.preventDefault();
        UI.showRouteTimetable(stopId, stopName, lineId, dir);
      }
    });

    // --- Panel Timetable Button ---
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.panel-timetable-btn');
      if (btn) {
        const panel = document.getElementById('departures-panel');
        const stopId = panel.dataset.stopId;
        let stopName = panel.dataset.stopName;
        if (!stopName) {
          const h3 = (panel.querySelector('h3').textContent || '').replace('LIVE', '').replace(/[🚏📋]/g, '').trim();
          const sepIdx = h3.indexOf('·');
          stopName = sepIdx >= 0 ? h3.substring(sepIdx + 1).trim() : h3.replace(/Timetable/g, '').trim();
        }
        if (stopId) UI.showStopTimetable(stopId, stopName);
      }
    });

    // --- Back to Live from Timetable ---
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.tt-back-btn');
      if (btn) {
        const panel = document.getElementById('departures-panel');
        const stopId = panel.dataset.stopId;
        const stopName = panel.dataset.stopName || '';
        if (stopId && stopName) {
          const stopLetter = panel.dataset.stopLetter || '';
          UI.showDepartures(stopId, stopName, stopLetter);
        }
      }
    });

    // --- Route button in stop timetable view ---
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.tt-route-btn');
      if (btn) {
        const stopId = btn.dataset.stop;
        const lineId = Api.normalizeLineId(btn.dataset.line);
        const panel = document.getElementById('departures-panel');
        let stopName = panel.dataset.stopName;
        if (!stopName) {
          const h3 = (panel.querySelector('h3').textContent || '').replace('LIVE', '').replace(/[🚏📋]/g, '').trim();
          const sepIdx = h3.indexOf('·');
          stopName = sepIdx >= 0 ? h3.substring(sepIdx + 1).trim() : h3.replace(/Timetable/g, '').trim();
        }
        UI.showRouteTimetable(stopId, stopName, lineId);
      }
    });

    // --- Star Favorite ---
    document.addEventListener('star-location', (e) => {
      const saved = UI.toggleFavorite(e.detail);
      UI.showToast(saved ? `⭐ "${e.detail.label}" saved` : `Removed "${e.detail.label}" from saved`, 2000);
    });

    // --- Explore Route ---
    document.addEventListener('explore-route', async () => {
      const rawInput = UI.getRouteInput();
      if (!rawInput) { UI.showRouteError('Enter a route number or line name'); return; }
      const routeInput = Api.normalizeLineId(rawInput);
      UI.showRouteLoading();
      MapView.clearAll();
      try {
        const [routeInfo, routeSeq] = await Promise.all([
          Api.getLineById(routeInput).catch(() => null),
          Api.getLineRoutes(routeInput, 'inbound').catch(() => null)
        ]);
        const outSeq = await Api.getLineRoutes(routeInput, 'outbound').catch(() => null);
        if (!routeInfo && !routeSeq) { UI.showRouteError('Route not found. Try a different route or line name.'); return; }
        const routeName = routeInfo && routeInfo.length ? routeInfo[0].name : routeInput;
        const routeMode = routeInfo && routeInfo.length ? (routeInfo[0].modeName || routeInfo[0].mode || 'bus') : 'bus';
        const modeColor = Stops.getModeColor(routeMode);

        const stops = Router.extractRouteStops(routeSeq || outSeq || {});
        if (!stops.length) { UI.showRouteError('No stop data for this route'); return; }
        const path = Router.extractRoutePath(routeSeq || {});
        const outPath = !path.length && outSeq ? Router.extractRoutePath(outSeq) : [];
        const combinedPath = path.length ? path : outPath;

        const firstStop = stops[0]?.name || '';
        const lastStop = stops[stops.length - 1]?.name || '';
        UI.showRouteStopList(stops, routeName, routeInput, routeMode, firstStop, lastStop);
        if (combinedPath.length >= 2) {
          MapView.addRoute(combinedPath, modeColor, `Route ${routeName}`);
          const moreStops = stops.slice(1, -1);
          if (moreStops.length) MapView.showRouteStopMarkers(moreStops, modeColor);
          MapView.fitBounds([combinedPath]);
        } else if (stops.length >= 2) {
          const stopCoords = stops.map(s => [s.lat, s.lon]);
          MapView.addRoute(stopCoords, modeColor, `Route ${routeName}`);
          MapView.fitBounds([stopCoords]);
        }
      } catch (err) {
        console.error(err);
        UI.showRouteError('Could not load route. Try again.');
      }
    });

    // --- Status refresh every 2 min ---
    setInterval(() => UI.loadStatus(), 120000);
    updateOnlineStatus();
    tryRestoreTrip();
  });

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

  function getCenterOfRoutes(result) {
    const allCoords = [];
    result.all.forEach(j => { j.legs.forEach(l => { if (l.path) l.path.forEach(p => allCoords.push(p)); }); });
    if (allCoords.length > 0) {
      const mid = Math.floor(allCoords.length / 2);
      return { lat: allCoords[mid][0], lon: allCoords[mid][1] };
    }
      return { lat: CONFIG.mapCenter[0], lon: CONFIG.mapCenter[1] };
  }

    // --- Timetable Date Bar ---
    document.addEventListener('click', (e) => {
      let btn, newDate;
      if ((btn = e.target.closest('.tt-date-prev')) && btn.dataset.date) {
        newDate = new Date(btn.dataset.date + 'T12:00:00');
      } else if ((btn = e.target.closest('.tt-date-next')) && btn.dataset.date) {
        newDate = new Date(btn.dataset.date + 'T12:00:00');
      } else if ((btn = e.target.closest('.tt-date-today'))) {
        newDate = new Date();
      } else if ((btn = e.target.closest('.tt-date-tomorrow'))) {
        newDate = new Date(Date.now() + 86400000);
      } else {
        return;
      }
      if (isNaN(newDate.getTime())) return;
      UI.changeTimetableDate(newDate);
    });
})();
