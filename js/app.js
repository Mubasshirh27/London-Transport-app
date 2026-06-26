(function () {
  let watchId = null;
  let liveNearbyTimer = null;
  let bikeLocation = null;
  let bikePinTarget = null;

  const GREATER_LONDON = {
    north: 51.7,
    south: 51.28,
    east: 0.34,
    west: -0.51
  };


  window.addEventListener('unhandledrejection', e => { e.preventDefault(); console.warn('[UH]', e.reason); });

    document.addEventListener('DOMContentLoaded', async () => {
      UI.init();
      Icon.init();
      // Fetch line statuses once and refresh periodically for timeline badges
      try {
        window.__statusLines = await Status.fetchAll();
      } catch (e) { window.__statusLines = []; }
      window.__statusTimer = setInterval(async () => { try { if (typeof OfflineManager === 'undefined' || OfflineManager.isOnline()) window.__statusLines = await Status.fetchAll(); } catch (e) {} }, 60000);

    // --- Offline detection (using OfflineManager) ---
    function updateOnlineStatus() {
      const online = navigator.onLine;
      const badge = document.getElementById('offline-badge');
      const banner = document.getElementById('offline-banner');
      const navBar = document.getElementById('trip-nav-bar');
      if (badge) badge.style.display = online ? 'none' : '';
      if (banner) banner.style.display = (online || !navBar || navBar.style.display === 'none') ? 'none' : '';
      window._lastConnectionCheck = Date.now();
    }
    if (typeof OfflineManager !== 'undefined') {
      OfflineManager.setErrorHandler((msg) => { UI.showError(msg); });
      OfflineManager.init();
      OfflineManager.onConnectivityChange((online) => {
        const badge = document.getElementById('offline-badge');
        const banner = document.getElementById('offline-banner');
        const navBar = document.getElementById('trip-nav-bar');
        const sync = document.getElementById('sync-indicator');
        if (badge) badge.style.display = online ? 'none' : '';
        if (banner) banner.style.display = (online || !navBar || navBar.style.display === 'none') ? 'none' : '';
        if (sync) {
          sync.className = 'sync-indicator ' + (online ? 'synced' : 'offline');
          sync.title = online ? 'Synced' : 'Offline';
        }
        window._lastConnectionCheck = Date.now();
        if (online) TripNav.resetGpsRetryCount();
      });
      OfflineManager.onSync(() => {
        const sync = document.getElementById('sync-indicator');
        if (sync) {
          sync.className = 'sync-indicator syncing';
          sync.title = 'Syncing...';
        }
        if (typeof Status !== 'undefined') Status.fetchAll().catch(() => {});
        if (typeof Stops !== 'undefined') {
          if (typeof Stops.clearCache === 'function') Stops.clearCache();
        }
        TripNav.rerenderCurrentTimeline();
        // Refresh map tiles
        if (typeof MapView !== 'undefined' && MapView.refreshTiles) {
          MapView.refreshTiles();
        }
        setTimeout(() => {
          const s = document.getElementById('sync-indicator');
          if (s && OfflineManager.isOnline()) {
            s.className = 'sync-indicator synced';
            s.title = 'Synced';
          }
        }, 1000);
      });
      updateOnlineStatus();
    } else {
      window.addEventListener('online', updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);
      updateOnlineStatus();
    }

    // --- Resume prompt ---
    function doRestoreTrip(data) {
      if (!data.journey || !data.journey.legs || !data.journey.legs.length || data.legIndex === undefined) return;
      if (data.legIndex >= data.journey.legs.length) data.legIndex = 0;
      const key = data.key || '__restored__';
      if (!window.__appState.activeJourneys) window.__appState.activeJourneys = {};
      if (!window.__appState.activeJourneys[key]) {
        window.__appState.activeJourneys[key] = data.journey;
      }
      window.__tripRestoreLegIndex = data.legIndex || 0;
      window.__tripRestoreLastTransition = data.lastTransition || Date.now();
      document.dispatchEvent(new CustomEvent('start-trip', { detail: { key, restore: true } }));
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
      resumeEl.innerHTML = '<div class="resume-content"><div class="resume-info"><span class="resume-from">' + Helpers.esc(data.fromLabel) + '</span> <span class="ic" data-ic="arrow_right"></span> <span class="resume-to">' + Helpers.esc(data.toLabel || 'Destination') + '</span> <span class="resume-time">' + timeAgo + '</span></div><div class="resume-actions"><button id="resume-yes" class="btn-primary">Resume</button><button id="resume-no" class="btn-secondary">Dismiss</button></div></div>';
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
      if (window.__appState.pinTarget) {
        const target = window.__appState.pinTarget;
        const label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        const val = { label, lat, lon };
        if (target === 'from') { UI.setFromText(label); UI.setFromValue(val); }
        else { UI.setToText(label); UI.setToValue(val); }
        window.__appState.pinTarget = null;
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
      window.__appState.pinTarget = e.detail;
      UI.setMapPinMode(window.__appState.pinTarget);
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
      mapOverlay.classList.remove('open');

      const from = UI.getFromValue();
      const to = UI.getToValue();
      const fromText = UI.getFromText();
      const toText = UI.getToText();

      if (!fromText || !toText) { UI.showError('Please enter both From and To locations'); _planJourneyInProgress = false; return; }
      if (fromText.toLowerCase() === toText.toLowerCase() || (from && to && from.lat === to.lat && from.lon === to.lon)) {
        UI.showError('From and To locations are the same. Choose different locations.'); _planJourneyInProgress = false; return;
      }

      UI.showLoading();
      window.__appState.activeJourneys = null;

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
        window.__appState.activeJourneys = result;

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
      const aj = window.__appState.activeJourneys;
      if (!aj) return;
      if (!aj[key] && aj.all) {
        if (key === 'walking' && aj.walkingJourney) {
          aj[key] = aj.walkingJourney;
        } else {
          const routeIdx = parseInt(key.replace('route_', ''), 10);
          if (!isNaN(routeIdx) && aj.all[routeIdx]) {
            aj[key] = aj.all[routeIdx];
          }
        }
      }
      if (!aj[key]) return;
      TripNav.drawJourneyRoutesOnMap(aj[key]);
    });

    TripNav.init();









    // --- Clear ---
    document.addEventListener('clear-all', () => {
      if (UI.isLiveTracking()) {
        document.dispatchEvent(new Event('toggle-live'));
      }
      MapView.clearAll();
      window.__appState.activeJourneys = null; window.__appState.activeFromMarker = null; window.__appState.activeToMarker = null;
      UI.hidePanels();
      MapView.hideStopMarkers();
      MapView.hideBikeMarkers();
      MapView.flyTo(CONFIG.mapCenter[0], CONFIG.mapCenter[1], CONFIG.mapZoom);
      document.getElementById('results-panel').innerHTML = '';
      const mapOv = document.getElementById('map-overlay');
      mapOv.classList.remove('open');
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
        setTimeout(() => { MapView.getMap(); }, 100);
      }
      const fromLat = bikeLocation.lat, fromLon = bikeLocation.lon;
      let route;
      try { route = await Api.getWalkingRoute(fromLat, fromLon, lat, lon); } catch (e) { UI.showError('Could not fetch walking route'); return; }
      const coords = (route && route.coords) ? route.coords : [[fromLat, fromLon], [lat, lon]];
      MapView.clearRoutes(); MapView.clearMarkers();
      MapView.addRoute(coords, '#0019a8');
      MapView.addMarker(fromLat, fromLon, 'From: Walking start', '#0019a8');
      MapView.addMarker(lat, lon, 'To: ' + (name || 'Bike'), '#e32017');
      try { MapView.fitBounds(coords); } catch (e) { console.warn('fitBounds skipped for bike route', e); }
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
        }
      };
      bBtn.style.display = 'flex';
    }

    document.addEventListener('bike-route-to', e => {
      drawBikeRoute(e.detail.lat, e.detail.lon, e.detail.name).catch(() => {});
    });

    document.addEventListener('toggle-bikes', async () => {
      const currentlyVisible = UI.isBikeMarkersVisible();
      if (currentlyVisible) {
        UI.toggleBikeMarkers(false);
        MapView.hideBikeMarkers();
        if (window._bikeRouteLayers) { window._bikeRouteLayers.forEach(l => { try { l.remove(); } catch {} }); window._bikeRouteLayers = []; }
        document.getElementById('bike-list').innerHTML = '';
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
          let results;
          try { results = await Geocoder.search(q); } catch { results = []; }
          if (results.length) {
            suggestionsEl.innerHTML = results.map(r =>
               `<div class="suggestion-item" data-label="${Helpers.esc(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}" data-type="${Helpers.esc(r.type)}">
                 <span class="sug-type">${r.type === 'stop' ? '🚏' : '📍'}</span>
                 <span class="sug-label">${Helpers.esc(r.label)}</span>
                 <span class="sug-sub">${Helpers.esc((r.fullLabel || '').substring(0, 100))}</span>
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
          let results;
          try { results = await Geocoder.search(q); } catch { results = []; }
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
        UI.setMapPinInteractive('bike');
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
      if (window._bikePromptResolve) window._bikePromptResolve({ lat: 51.5, lon: -0.12 });
      const oldClean = window._bikePromptCleanup;
      if (oldClean) oldClean();

      return new Promise(resolve => {
        window._bikePromptResolve = resolve;
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
          UI.setMapPinInteractive('bike');
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
            let results;
            try { results = await Geocoder.search(q); } catch { results = []; }
            if (abort.signal.aborted) return;
            if (results.length) {
              suggestionsEl.innerHTML = results.map(r =>
                `<div class="suggestion-item" data-label="${Helpers.esc(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}" data-type="${Helpers.esc(r.type)}">
                  <span class="sug-type">${r.type === 'stop' ? '🚏' : '📍'}</span>
                  <span class="sug-label">${Helpers.esc(r.label)}</span>
                <span class="sug-sub">${Helpers.esc((r.fullLabel || '').substring(0, 100))}</span>
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
            let results;
            try { results = await Geocoder.search(q); } catch { results = []; }
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
          let results;
          try { results = await Geocoder.search(q); } catch { results = []; }
          if (results.length) {
            suggestionsEl.innerHTML = results.map(r =>
               `<div class="suggestion-item" data-label="${Helpers.esc(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}">
                 <span class="sug-type">📍</span>
                 <span class="sug-label">${Helpers.esc(r.label)}</span>
                 <span class="sug-sub">${Helpers.esc((r.fullLabel || '').substring(0, 80))}</span>
               </div>`
            ).join('');
            suggestionsEl.classList.add('active');
          } else {
            suggestionsEl.innerHTML = '<div class="suggestion-item" style="color:#999;cursor:default">No matching locations — try a different search term</div>';
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
          let results;
          try { results = await Geocoder.search(q); } catch { results = []; }
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
      const routeTab = document.querySelector('.tab-btn[data-tab="routes"]');
      if (routeTab) routeTab.click();
    });

    // --- Status refresh every 2 min ---
    window.__loadStatusTimer = setInterval(() => { if (!document.hidden) UI.loadStatus(); }, 120000);
    updateOnlineStatus();
    tryRestoreTrip();
  });



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
