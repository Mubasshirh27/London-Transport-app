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

  document.addEventListener('DOMContentLoaded', async () => {
    UI.init();
    Icon.init();
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

      const fromLoc = from || fromText;
      const toLoc = to || toText;
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
        UI.showResults(result);

        const bestJourney = result.all[0];

        const { lat, lon } = getCenterOfRoutes(result);
        UI.getFromValue() && Store.addRecent(UI.getFromValue());
        UI.getToValue() && Store.addRecent(UI.getToValue());
      } catch (err) {
        console.error(err);
        const msg = err.message && err.message.includes('404') ? 'Could not plan journey between these locations (they may be too far apart or outside London area). Check the locations match London.' : 'Could not plan journey. Check locations and try again.';
        UI.showError(msg);
      } finally {
        _planJourneyInProgress = false;
      }
    });

    // --- Show Route ---
    document.addEventListener('show-route', (e) => {
      const key = e.detail;
      if (!activeJourneys || !activeJourneys[key]) return;
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

    function _cleanupNavHandlers() {
      if (_navHeaderCleanup) {
        _navHeaderCleanup.forEach(({ el, type, fn, opts }) => el.removeEventListener(type, fn, opts));
        _navHeaderCleanup = null;
      }
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
      if (!activeJourneys || !activeJourneys[key]) return;
      if (!navigator.geolocation) { UI.showError('Geolocation not supported'); return; }

      // Clean up any previous trip resources before starting a new one
      if (tripWatchId !== null) { navigator.geolocation.clearWatch(tripWatchId); tripWatchId = null; }
      _cleanupNavHandlers();

      tripActiveKey = key;
      tripLegIndex = 0;
      lastLegTransitionTime = Date.now();
      lastRenderedLegIndex = -1;

      // Switch to journey tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.querySelector('.tab-btn[data-tab="journey"]').classList.add('active');
      document.getElementById('tab-journey').classList.add('active');

      // Show floating map
      const overlay = document.getElementById('map-overlay');
      overlay.classList.remove('open', 'popout');
      overlay.classList.add('floating');
      overlay.style.left = '';
      overlay.style.top = '';
      overlay.style.bottom = '';
      overlay.style.right = '';
      overlay.style.width = '';
      overlay.style.height = '';
      setTimeout(() => { const m = MapView.getMap(); if (m) m.invalidateSize(); }, 50);

      const tsBtn = document.getElementById('trip-start-btn');
      const teBtn = document.getElementById('trip-end-btn');
      if (tsBtn) tsBtn.style.display = 'none';
      if (teBtn) teBtn.style.display = 'inline-block';

      const navBar = document.getElementById('trip-nav-bar');
      const navContent = document.getElementById('trip-nav-content');
      const recenterBtn = document.getElementById('trip-recenter-btn');
      const tripEta = document.getElementById('trip-eta');

      navBar.style.display = 'block';
      navBar.classList.remove('collapsed');
      navContent.innerHTML = '<div style="display:flex;align-items:center;gap:6px;padding:4px 0"><div class="spinner" style="display:inline-block;width:12px;height:12px;border-width:2px;flex-shrink:0"></div><span>Locating you...</span></div>';
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

      let firstFix = true;
      let followEnabled = true;

      tripWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          MapView.showUserLocation(lat, lon);
          if (followEnabled) {
            MapView.flyTo(lat, lon, firstFix ? 14 : 16);
            firstFix = false;
          }
          recenterBtn.style.display = 'inline-block';
          updateTripProgress(lat, lon);
        },
        (err) => { if (tripWatchId === null) return; UI.showError('Navigation error: ' + err.message); document.dispatchEvent(new Event('end-trip')); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );

      recenterBtn.onclick = () => {
        followEnabled = true;
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              MapView.flyTo(pos.coords.latitude, pos.coords.longitude, 16);
              setTimeout(() => { followEnabled = false; }, 10000);
            },
            () => { MapView.flyTo(51.5074, -0.1278, 14); },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        }
      };

      MapView.onMoveEnd(() => { followEnabled = false; });

      // Trip nav toggle
      const toggleBtn = document.getElementById('trip-nav-toggle');
      const navHeader = document.getElementById('trip-nav-header');
      const doToggle = () => navBar.classList.toggle('collapsed');
      toggleBtn.onclick = (e) => { e.stopPropagation(); doToggle(); };
      let dragOccurred = false;

      // Trip nav drag with safe-area clamping
      let dragOffX = 0, dragOffY = 0;
      const getSafe = (name) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return parseFloat(v) || 0; };
      const onDragStart = (ex) => {
        dragOccurred = false;
        const cx = ex.clientX ?? ex.touches[0].clientX;
        const cy = ex.clientY ?? ex.touches[0].clientY;
        const rect = navBar.getBoundingClientRect();
        navBar.style.left = rect.left + 'px';
        navBar.style.top = rect.top + 'px';
        navBar.style.bottom = 'auto';
        navBar.style.right = 'auto';
        dragOffX = cx - rect.left;
        dragOffY = cy - rect.top;
        const onMove = (me) => {
          dragOccurred = true;
          const mx = me.clientX ?? me.touches[0].clientX;
          const my = me.clientY ?? me.touches[0].clientY;
          const safeL = getSafe('--safe-l'), safeT = getSafe('--safe-t'), safeR = getSafe('--safe-r'), safeB = getSafe('--safe-b');
          const w = navBar.offsetWidth, h = navBar.offsetHeight;
          const vw = window.innerWidth, vh = window.innerHeight;
          const left = Math.max(safeL + 4, Math.min(mx - dragOffX, vw - w - safeR - 4));
          const top = Math.max(safeT + 4, Math.min(my - dragOffY, vh - h - safeB - 4));
          navBar.style.left = left + 'px';
          navBar.style.top = top + 'px';
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
      const clickHandler = (e) => {
        if (e.target.closest('#trip-nav-toggle')) return;
        if (dragOccurred) { dragOccurred = false; return; }
        doToggle();
        // Restore CSS positioning so safe-area calc() takes effect
        navBar.style.left = '';
        navBar.style.top = '';
        navBar.style.bottom = '';
        navBar.style.right = '';
      };
      navHeader.addEventListener('mousedown', onDragStart);
      navHeader.addEventListener('touchstart', onDragStart, { passive: true });
      navHeader.addEventListener('click', clickHandler);
      _navHeaderCleanup = [
        { el: navHeader, type: 'mousedown', fn: onDragStart },
        { el: navHeader, type: 'touchstart', fn: onDragStart, opts: { passive: true } },
        { el: navHeader, type: 'click', fn: clickHandler }
      ];

    });

    document.addEventListener('end-trip', () => {
      if (tripWatchId !== null) { navigator.geolocation.clearWatch(tripWatchId); tripWatchId = null; }
      _cleanupNavHandlers();
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
        console.log('toggleMapPop called', { willBeMin, beforeClass: overlay.className, left: overlay.style.left, top: overlay.style.top, width: overlay.style.width, height: overlay.style.height });
        overlay.classList.toggle('popout', willBeMin);
        // Clear inline styles so CSS class rules take full effect in both directions
        overlay.style.left = '';
        overlay.style.top = '';
        overlay.style.bottom = '';
        overlay.style.right = '';
        overlay.style.width = '';
        overlay.style.height = '';
        console.log('toggleMapPop after', { popout: overlay.classList.contains('popout'), className: overlay.className, left: overlay.style.left, top: overlay.style.top, width: overlay.style.width, height: overlay.style.height });
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

    function renderTripRoutes() {
      const journey = activeJourneys[tripActiveKey];
      if (!journey) return;
      MapView.clearRoutes();
      MapView.clearMarkers();
      const modeColors = { walking: '#666', bus: '#e32017', tube: '#0019a8', dlr: '#00a94f', overground: '#f86c00', 'elizabeth-line': '#6950a0', 'national-rail': '#003688', tram: '#66cc00' };
      const firstLeg = journey.legs[0];
      const lastLeg = journey.legs[journey.legs.length - 1];
      if (firstLeg && firstLeg.from) MapView.addMarker(firstLeg.from.lat, firstLeg.from.lon, 'From: ' + (firstLeg.from.name || 'Start'), '#0019a8');
      if (lastLeg && lastLeg.to) MapView.addMarker(lastLeg.to.lat, lastLeg.to.lon, 'To: ' + (lastLeg.to.name || 'Destination'), '#e32017');

      journey.legs.forEach((leg, i) => {
        const path = leg.path || [];
        if (path.length >= 2) {
          let color, w;
          if (i < tripLegIndex) { color = '#00cc66'; w = 3; }
          else if (i === tripLegIndex) {
            color = '#33ff99'; w = 6;
            // Show intermediate stop markers for current leg
            if (leg.stops && leg.stops.length) {
              leg.stops.forEach(s => {
                if (s.lat != null && s.lon != null) {
                  MapView.addMarker(s.lat, s.lon, s.name || 'Stop', 'rgba(255,255,255,0.3)');
                }
              });
            }
          }
          else { color = modeColors[leg.mode] || '#555'; w = 4; }
          MapView.addRoute(path, color, '', w);
        }
      });
    }

    function updateTripProgress(lat, lon) {
      const journey = activeJourneys[tripActiveKey];
      if (!journey || !journey.legs.length) return;
      const legs = journey.legs;
      const currentLeg = legs[tripLegIndex];
      if (!currentLeg) return;

      // --- Leg Advancement ---
      const now = Date.now();
      if (tripLegIndex < legs.length - 1 && now - lastLegTransitionTime > 5000) {
        let distToEnd = Infinity, distToNextStart = Infinity;
        if (currentLeg.to && currentLeg.to.lat != null) {
          distToEnd = distanceDeg(lat, lon, currentLeg.to.lat, currentLeg.to.lon);
        }
        const nextLeg = legs[tripLegIndex + 1];
        if (nextLeg && nextLeg.from && nextLeg.from.lat != null) {
          distToNextStart = distanceDeg(lat, lon, nextLeg.from.lat, nextLeg.from.lon);
        }
        const threshold = 0.0009; // ~100m
        if (distToEnd < threshold || distToNextStart < threshold) {
          tripLegIndex++;
          lastLegTransitionTime = now;
        }
      }

      // --- Re-render map routes only when leg index changes ---
      if (tripLegIndex !== lastRenderedLegIndex) {
        renderTripRoutes();
        lastRenderedLegIndex = tripLegIndex;
      }

      // --- Final destination arrival detection ---
      if (!tripArrived && tripLegIndex === legs.length - 1) {
        const finalLeg = legs[legs.length - 1];
        if (finalLeg && finalLeg.to && finalLeg.to.lat != null) {
          const dist = distanceDeg(lat, lon, finalLeg.to.lat, finalLeg.to.lon);
          if (dist < 0.00018) tripArrived = true; // ~15-20m threshold
        }
      }

      // --- Deviation Detection & Auto-Reroute ---
      if (!tripArrived && !tripRerouting) {
        let minDist = Infinity;
        for (const leg of legs) {
          if (leg.path && leg.path.length >= 2) {
            for (let i = 0; i < leg.path.length; i++) {
              const d = distanceDeg(lat, lon, leg.path[i][0], leg.path[i][1]);
              if (d < minDist) { minDist = d; if (minDist < 0.0009) break; }
            }
          } else {
            if (leg.from && leg.from.lat != null) {
              const d = distanceDeg(lat, lon, leg.from.lat, leg.from.lon);
              if (d < minDist) minDist = d;
            }
            if (leg.to && leg.to.lat != null) {
              const d = distanceDeg(lat, lon, leg.to.lat, leg.to.lon);
              if (d < minDist) minDist = d;
            }
          }
          if (minDist < 0.0009) break;
        }
        if (minDist > 0.0018) {
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
          const dFrom = distanceDeg(lat, lon, curLeg.from.lat, curLeg.from.lon);
          const totalD = distanceDeg(curLeg.from.lat, curLeg.from.lon, curLeg.to.lat, curLeg.to.lon);
          if (totalD > 0) currentLegProgress = Math.min(dFrom / totalD, 1);
        }
      }

      const currentLegDuration = curLeg ? (curLeg.duration || 0) : 0;
      const currentProgressDuration = currentLegProgress * currentLegDuration;
      const totalProgress = tripArrived ? 100 : (totalDuration > 0
        ? Math.min(99, Math.round(((completedDuration + currentProgressDuration) / totalDuration) * 100))
        : 0);

      // --- ETA ---
      const remainingSecs = (totalDuration - (completedDuration + currentProgressDuration)) * 60;
      const eta = new Date(Date.now() + remainingSecs * 1000);
      const etaStr = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // --- Connection Alert Check ---
      if (!tripArrived && tripLegIndex < legs.length - 1 && now - (window._lastConnectionCheck || 0) > 30000) {
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
                  const delayMin = (actualDep - scheduledDep) / 60000;
                  if (delayMin > 2) {
                    showRerouteNotification('⚠️ Next ' + (routeName || nextLeg.modeName) + ' at ' + (nextLeg.from.name || 'stop') + ' delayed by ' + Math.round(delayMin) + ' min');
                  }
                }
              } else if (scheduledDep && arrs.length > 0 && !matched.length && (now - scheduledDep.getTime()) > -60000) {
                showRerouteNotification('⚠️ Next ' + (routeName || nextLeg.modeName) + ' at ' + (nextLeg.from.name || 'stop') + ' may be cancelled');
              }
            } catch {}
          })();
        }
      }

      // --- Update UI ---
      const progressText = document.getElementById('trip-progress-text');
      const progressFill = document.getElementById('trip-progress-fill');
      const tripEta = document.getElementById('trip-eta');
      if (progressText) progressText.textContent = (tripArrived ? '100' : totalProgress) + '%';
      if (progressFill) progressFill.style.width = (tripArrived ? '100' : totalProgress) + '%';
      if (tripEta) tripEta.textContent = tripArrived ? '✅ Arrived' : 'ETA ' + etaStr;

      // --- Step Guidance ---
      const destLeg = legs[legs.length - 1];
      const destName = destLeg && destLeg.to ? (destLeg.to.name || 'Destination') : 'Destination';

      let html = '';
      if (tripArrived) {
        html += '<div class="trip-step current" style="text-align:center"><div class="trip-step-header" style="justify-content:center;font-size:14px">✅ Arrived</div><div class="trip-step-loc" style="text-align:center">' + destName + '</div></div>';
      } else {
        const nextLeg = legs[tripLegIndex + 1];
        const cur = legs[tripLegIndex];

        // Current leg
        if (cur) {
          const modeIcon = Router.getModeIcon(cur.mode);
          const modeName = cur.modeName || cur.mode || '';
          const routeName = cur.routeName || '';
          const dep = cur.departureTime ? new Date(cur.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const arr = cur.arrivalTime ? new Date(cur.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const fromName = cur.from ? (cur.from.name || '') : '';
          const toName = cur.to ? (cur.to.name || '') : '';
          const detail = cur.detail || cur.instruction || '';
          const plat = cur.platformName || '';
          const dir = cur.direction || '';

          // Countdown: time until arrival of current leg
          const curArrTime = cur.arrivalTime ? new Date(cur.arrivalTime).getTime() : 0;
          const countdownMs = curArrTime ? Math.max(0, curArrTime - Date.now()) : 0;
          const countdownMin = Math.floor(countdownMs / 60000);
          const countdownSec = Math.floor((countdownMs % 60000) / 1000);
          const countdownStr = countdownMs > 0 ? (countdownMin > 0 ? countdownMin + 'm ' : '') + countdownSec + 's' : '';

          const legProgressPct = Math.round(currentLegProgress * 100);
          const label = (modeName + (routeName ? ' ' + routeName : '')).trim() || 'Travel';

          html += '<div class="trip-step current">';
          html += '<div class="trip-step-header"><span class="mode-icon">' + modeIcon + '</span><span class="route-name">' + label + '</span><span class="step-dur">' + (cur.duration || 0) + ' min</span></div>';
          if (fromName && toName && cur.mode !== 'walking') html += '<div class="trip-step-loc">' + fromName + ' → ' + toName + '</div>';
          if (detail && cur.mode === 'walking') html += '<div class="trip-step-loc">' + detail + '</div>';

          // Meta row: platform, direction, times
          let metaParts = [];
          if (plat) metaParts.push('<span class="plat-badge">' + plat + '</span>');
          if (dir) metaParts.push('<span class="trip-step-dir">→ ' + dir + '</span>');
          if (dep || arr) metaParts.push('<span class="trip-time">' + (dep || '') + (dep && arr ? ' → ' : '') + (arr || '') + '</span>');
          if (metaParts.length) html += '<div class="trip-step-meta">' + metaParts.join('') + '</div>';

          // Countdown
          if (countdownStr) html += '<div class="trip-countdown">Arriving in ' + countdownStr + '</div>';

          // Mini progress bar for within-leg progress
          if (legProgressPct > 0 && legProgressPct < 100) html += '<div class="trip-step-progress"><div class="trip-step-progress-fill" style="width:' + legProgressPct + '%"></div></div>';

          html += '</div>';
        }

        // Next leg connection
        if (nextLeg && nextLeg.mode !== 'walking') {
          const nextIcon = Router.getModeIcon(nextLeg.mode);
          const nextName = (nextLeg.modeName || nextLeg.mode || '') + (nextLeg.routeName ? ' ' + nextLeg.routeName : '');
          const nextFrom = nextLeg.from ? nextLeg.from.name : '';
          const nextDepTime = nextLeg.departureTime ? new Date(nextLeg.departureTime) : null;
          const nextCountdownMs = nextDepTime ? Math.max(0, nextDepTime.getTime() - Date.now()) : 0;
          const nextCountdownMin = Math.floor(nextCountdownMs / 60000);
          const nextCountdownSec = Math.floor((nextCountdownMs % 60000) / 1000);
          const nextTimeStr = nextDepTime ? nextDepTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

          html += '<div class="trip-step next">';
          html += '<div class="trip-step-header"><span class="mode-icon">' + nextIcon + '</span><span class="route-name">Next: ' + nextName + '</span><span class="step-dur">' + (nextLeg.duration || 0) + ' min</span></div>';
          if (nextFrom) html += '<div class="trip-step-loc">from ' + nextFrom + '</div>';
          if (nextTimeStr) html += '<div class="trip-step-meta"><span class="trip-time">' + nextTimeStr + '</span></div>';
          if (nextCountdownMs > 0 && nextCountdownMs < 600000) {
            html += '<div class="next-countdown">Departs in ' + (nextCountdownMin > 0 ? nextCountdownMin + 'm ' : '') + nextCountdownSec + 's</div>';
          }
          html += '</div>';
        } else if (nextLeg && nextLeg.mode === 'walking') {
          html += '<div class="trip-step next"><div class="trip-step-header"><span class="mode-icon">🚶</span><span class="route-name">Walk ' + (nextLeg.duration || 0) + ' min</span></div></div>';
        }

        // Destination
        html += '<div class="trip-step-dest">→ ' + destName + '</div>';
      }
      document.getElementById('trip-nav-content').innerHTML = html;

      // Update map title bar with trip info
      const mapTitleText = document.querySelector('.map-title-text');
      if (mapTitleText && !tripArrived) {
        const cur = legs[tripLegIndex];
        const dest = destName;
        if (cur) {
          const modeIcon = Router.getModeIcon(cur.mode);
          const routeName = cur.routeName || '';
          const label = routeName ? modeIcon + ' ' + routeName + ' → ' : modeIcon + ' → ';
          mapTitleText.innerHTML = '<span class="ic" data-ic="map"></span> <span class="map-title-trip-info"><span class="leg-preview">' + label + '<span class="route-label">' + dest + '</span></span><span class="trip-progress-pct">' + totalProgress + '%</span></span>';
        }
      } else if (mapTitleText && tripArrived) {
        mapTitleText.innerHTML = '<span class="ic" data-ic="map"></span> ✅ Arrived';
      }

      // --- Highlight steps in journey card ---
      document.querySelectorAll('.journey-card .step').forEach((el, i) => {
        el.classList.remove('completed', 'active', 'upcoming');
        if (tripArrived || i < tripLegIndex) el.classList.add('completed');
        else if (i === tripLegIndex) el.classList.add('active');
        else el.classList.add('upcoming');
      });

      // Scroll current step into view
      const stepsContainer = document.querySelector('.jc-steps');
      const activeStepEl = stepsContainer ? stepsContainer.querySelector('.step.active') : null;
      if (activeStepEl) activeStepEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      // --- Notify route departure on leg transition ---
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
      const nc = document.getElementById('trip-nav-content');
      if (!nc) return;
      const note = document.createElement('div');
      note.className = 'reroute-notification';
      note.textContent = msg;
      nc.insertBefore(note, nc.firstChild);
      setTimeout(() => { if (note.parentNode) note.remove(); }, 4200);
    }

    async function triggerReroute(fromLat, fromLon) {
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
      const route = await Api.getWalkingRoute(fromLat, fromLon, lat, lon);
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
              `<div class="suggestion-item" data-label="${r.label}" data-lat="${r.lat}" data-lon="${r.lon}" data-type="${r.type}">
                <span class="sug-type">${r.type === 'stop' ? '🚏' : '📍'}</span>
                <span class="sug-label">${r.label}</span>
                <span class="sug-sub">${(r.fullLabel || '').substring(0, 100)}</span>
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
                `<div class="suggestion-item" data-label="${r.label}" data-lat="${r.lat}" data-lon="${r.lon}" data-type="${r.type}">
                  <span class="sug-type">${r.type === 'stop' ? '🚏' : '📍'}</span>
                  <span class="sug-label">${r.label}</span>
                <span class="sug-sub">${(r.fullLabel || '').substring(0, 100)}</span>
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

        const style = {
          version: 8,
          sources: {
            base: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors',
              maxzoom: 19
            }
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#080a10' } },
            { id: 'base-raster', type: 'raster', source: 'base' }
          ]
        };

        async function fetchBuildings(m) {
          const zoom = m.getZoom();
          if (zoom < 13) return [];
          const b = m.getBounds();
          const pad = 0.002;
          const bbox = `${b.getSouth()-pad},${b.getWest()-pad},${b.getNorth()+pad},${b.getEast()+pad}`;
          const query = `[out:json][timeout:10];way["building"](${bbox});out geom;`;
          try {
            const r = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
            if (!r.ok) return [];
            const d = await r.json();
            if (!d.elements) return [];
            const feats = [];
            d.elements.forEach(el => {
              if (!el.geometry || el.geometry.length < 3) return;
              const coords = el.geometry.map(g => [g.lon, g.lat]);
              const lvls = parseFloat(el.tags?.['building:levels']) || 0;
              const height = parseFloat(el.tags?.height) || lvls * 3 || 5;
              feats.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [coords] },
                properties: { height: Math.min(height, 80), levels: lvls || 1 }
              });
            });
            return feats;
          } catch { return []; }
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
          map3dInstance.on('click', (e) => handleMapClick(e.lngLat.lat, e.lngLat.lng));

          map3dInstance.on('load', () => {
            document.querySelector('#map-3d .loading')?.remove();
            document.body.classList.add('mode-3d');
            map3dInstance.resize();
            console.log('3D load event fired, running resync3d');
            MapView.resync3d();
            if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }

            (async () => {
              if (map3dInstance.getZoom() < 13) return;
              const status = document.getElementById('map-legend');
              const origHTML = status ? status.innerHTML : '';
              if (status) status.innerHTML += ' <span style="color:#888;font-size:10px">Loading buildings…</span>';
              const feats = await fetchBuildings(map3dInstance);
              if (status && origHTML) status.innerHTML = origHTML;
              if (feats.length > 0 && !map3dInstance.getLayer('bld-extrude')) {
                map3dInstance.addSource('bld', {
                  type: 'geojson',
                  data: { type: 'FeatureCollection', features: feats }
                });
                map3dInstance.addLayer({
                  id: 'bld-extrude',
                  type: 'fill-extrusion',
                  source: 'bld',
                  paint: {
                    'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'levels'], 1, '#2e3340', 3, '#3e4558', 6, '#50587a', 10, '#6070a0'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.75,
                    'fill-extrusion-ambient-occlusion-intensity': 0.4,
                    'fill-extrusion-ambient-occlusion-radius': 3
                  }
                });
              }
            })();

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
          UI.showError('3D view failed: ' + e.message);
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
          overlay.classList.add('popout');
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
              `<div class="suggestion-item" data-label="${r.label}" data-lat="${r.lat}" data-lon="${r.lon}">
                <span class="sug-type">📍</span>
                <span class="sug-label">${r.label}</span>
                <span class="sug-sub">${(r.fullLabel || '').substring(0, 80)}</span>
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
            const { latitude: lat, longitude: lon } = pos.coords;
            MapView.showUserLocation(lat, lon);
            if (MapView.isFollowMode()) MapView.flyTo(lat, lon, 16);
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
