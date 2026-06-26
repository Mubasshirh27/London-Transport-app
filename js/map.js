const MapView = (() => {
  let map = null, markers = [], routes = [], stopMarkers = [], bikeMarkers = [], routeStopMarkers = [], userMarker = null;
  let routeIdCounter = 0;
  let markerData = [], routeData = [], stopMarkerData = [], bikeMarkerData = [], routeStopMarkerData = [], userLocData = null;
  let userAccuracyCircle = null;
  let tileProviderIdx = 0, tileFailCount = 0, tileFailTimer = null;
  let followMode = true;
  let threeDEnabled = false;
  let _clickHandler = null;
  let moveEndHandler = null;
  let mapLoaded = false;
  let pendingRoutes = [];

  const modeIcons = { bus: '🚌', tube: '🚇', dlr: '🚈', overground: '🚆', 'elizabeth-line': '🚄', 'national-rail': '🚂', tram: '🚊', riverBus: '⛴️', cableCar: '🚡' };
  const modeColors = { bus: '#e32017', tube: '#0019a8', dlr: '#00a94f', overground: '#f86c00', 'elizabeth-line': '#6950a0', 'national-rail': '#003688', tram: '#66cc00', riverBus: '#00a4a7', cableCar: '#e21836' };

  function makeTileStyle(provider) {
    return {
      version: 8,
      sources: {
        base: {
          type: 'raster',
          tiles: [provider.url],
          tileSize: 256,
          attribution: provider.attribution || '',
          maxzoom: provider.maxZoom || 19
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#080a10' } },
        { id: 'base-raster', type: 'raster', source: 'base' }
      ]
    };
  }

  function switchTileProvider(idx) {
    const providers = CONFIG.tileProviders;
    if (idx >= providers.length) {
      console.warn('All tile providers failed');
      UI?.showError?.('Map tiles unavailable');
      return;
    }
    tileProviderIdx = idx;
    tileFailCount = 0;
    if (tileFailTimer) { clearTimeout(tileFailTimer); tileFailTimer = null; }
    const p = providers[idx];
    console.log(`Switching tile provider [${idx}]: ${p.name}`);
    try {
      const src = map.getSource('base');
      if (src) {
        src.setTiles([p.url]);
      }
    } catch (e) {
      console.warn('Tile provider switch failed:', e);
    }
  }

  function init() {
    const providers = CONFIG.tileProviders;
    map = new maplibregl.Map({
      container: 'map',
      style: makeTileStyle(providers[0]),
      center: [CONFIG.mapCenter[1], CONFIG.mapCenter[0]],
      zoom: CONFIG.mapZoom,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('error', (e) => {
      if (e.error && (e.error.status >= 400 || !e.error.status)) {
        tileFailCount++;
        if (tileFailTimer) clearTimeout(tileFailTimer);
        tileFailTimer = setTimeout(() => {
          if (tileFailCount >= 3) {
            switchTileProvider(tileProviderIdx + 1);
          }
        }, 2000);
      }
    });

    map.on('load', () => {
      mapLoaded = true;
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 15 }
      });
      pendingRoutes.forEach(r => _addRouteInternal(r.points, r.color, r.weight, r.opacity));
      pendingRoutes = [];
    });

    document.getElementById('view-3d-btn')?.addEventListener('click', toggleTerrain);

    map.on('click', (e) => {
      if (_clickHandler) _clickHandler(e.lngLat.lat, e.lngLat.lng);
    });

    document.getElementById('map-legend')?.classList.remove('hidden');
    return map;
  }

  function makeMlMarker(lat, lon, html, className, onClick) {
    if (!map || lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
    const el = document.createElement('div');
    el.innerHTML = html;
    const child = el.firstChild || el;
    if (className) child.className = className;
    if (onClick) child.addEventListener('click', () => onClick(lat, lon));
    try {
      const m = new maplibregl.Marker({ element: child });
      m.setLngLat([lon, lat]);
      m.addTo(map);
      return m;
    } catch (e) {
      return null;
    }
  }

  function addMarker(lat, lon, label, color) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
    const isFrom = label && label.includes('From:');
    const isTo = label && label.includes('To:');
    const size = (isFrom || isTo) ? 32 : 18;
    const border = (isFrom || isTo) ? '4px' : '3px';
    const html = `<div style="position:relative;background:${color||'#0019a8'} !important;width:${size}px;height:${size}px;border-radius:50%;border:${border} solid white !important;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white">${isFrom ? 'A' : isTo ? 'B' : ''}</div>`;
    const m = makeMlMarker(lat, lon, html, 'custom-marker');
    if (m) {
      markers.push(m);
      markerData.push({ lat, lon, label, color, html });
      // Add label below marker
      if (label) {
        const lblEl = document.createElement('div');
        lblEl.textContent = label.replace(/^(From:|To:)\s*/, '');
        lblEl.style.cssText = 'background:rgba(0,0,0,.7);color:white;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;font-weight:600';
        const lbl = new maplibregl.Marker({ element: lblEl, offset: [0, size / 2 + 12] });
        lbl.setLngLat([lon, lat]);
        lbl.addTo(map);
        markers.push(lbl);
      }
    }
    return m;
  }

  function _addRouteInternal(points, color, weight, opacity) {
    if (!map || !points || points.length < 2) return null;
    const id = 'route_' + (routeIdCounter++);
    const glowId = id + '_glow';
    const w = weight || 4;
    const op = opacity != null ? opacity : 0.85;
    const coords = points.map(p => [p[1], p[0]]);
    try {
      map.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: glowId, type: 'line', source: id, paint: { 'line-color': color || '#0019a8', 'line-width': w * 2.5, 'line-opacity': Math.min(0.25, op * 0.25), 'line-blur': 4 } });
      map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color || '#0019a8', 'line-width': w, 'line-opacity': op } });
      routes.push(id, glowId);
      return id;
    } catch (e) {
      console.warn('addRoute error:', e);
      return null;
    }
  }

  function addRoute(points, color, label, weight, opacity) {
    if (!points || points.length === 0) return;
    routeData.push({ points, color, label, weight, opacity });
    if (!mapLoaded) {
      pendingRoutes.push({ points, color, weight, opacity });
      return;
    }
    const id = _addRouteInternal(points, color, weight, opacity);
    if (label && id) {
      const mid = points[Math.floor(points.length / 2)];
      const lblEl = document.createElement('div');
      lblEl.className = 'route-label';
      lblEl.textContent = label;
      const lbl = new maplibregl.Marker({ element: lblEl, offset: [0, -10] });
      lbl.setLngLat([mid[1], mid[0]]);
      lbl.addTo(map);
      routes.push(lbl);
    }
    return id;
  }

  function fitBounds(pointsList) {
    if (!pointsList || !pointsList.length) return;
    let pts = pointsList;
    if (Array.isArray(pointsList[0]) && pointsList.length === 1) pts = pointsList[0];
    const valid = pts.filter(Array.isArray).filter(p => p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && !isNaN(p[0]) && !isNaN(p[1]));
    if (valid.length < 2) return;
    const lats = valid.map(p => p[0]), lons = valid.map(p => p[1]);
    const latMin = Math.min(...lats), latMax = Math.max(...lats);
    const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
    if (latMin === latMax && lonMin === lonMax) return;
    try {
      map.fitBounds([[lonMin, latMin], [lonMax, latMax]], { padding: 50, duration: 600 });
    } catch (e) { console.warn('fitBounds error', e); }
  }

  function clearRoutes() {
    routes.forEach(r => {
      if (typeof r === 'string') {
        try { map.removeLayer(r); } catch {}
      } else if (r.remove) {
        try { r.remove(); } catch {}
      }
    });
    routes = [];
    routeData.forEach(r => {
      if (r._sourceId) {
        try { map.removeSource(r._sourceId); } catch {}
      }
    });
    routeData = [];
    pendingRoutes = [];
  }

  function clearMarkers() {
    markers.forEach(m => { try { m.remove(); } catch {} }); markers = [];
    markerData = [];
  }

  function clearAll() { clearRoutes(); clearMarkers(); hideStopMarkers(); hideBikeMarkers(); hideRouteStopMarkers(); }

  function onClick(cb) {
    _clickHandler = cb;
  }

  function clearClick() { _clickHandler = null; }

  function flyTo(lat, lon, zoom) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)) return;
    map.flyTo({ center: [lon, lat], zoom: zoom || 15, duration: 600 });
  }

  function panTo(lat, lon) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)) return;
    map.panTo({ center: [lon, lat], duration: 500 });
  }

  function getActiveCenter() {
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }

  function showStopLivePopup(stopId, stopName, lat, lon, opts = {}) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return;
    stopName = Helpers.esc(stopName);
    stopId = Helpers.esc(stopId);
    const modeStr = opts.modeStr || '';
    const distance = opts.distance != null ? `<span style="font-size:10px;color:#888">(${Math.round(opts.distance)}m)</span>` : '';
    const routeTags = opts.routeTags ? opts.routeTags.slice(0, 8).map(r => `<span class="popup-route-tag">${Helpers.esc(r)}</span>`).join('') : '';
    const extraLine = opts.extraLine || '';
    const stopLetter = opts.stopLetter || '';
    const stopLetterHtml = stopLetter ? `<span class="stop-letter">${Helpers.esc(stopLetter)}</span>` : '';
    let mlPopup = null;
    try {
      mlPopup = new maplibregl.Popup({ className: 'stop-detail-popup', closeButton: true, maxWidth: '300px' });
      mlPopup.setLngLat([lon, lat]);
      mlPopup.setHTML(`<div class="stop-popup"><div class="stop-popup-header"><strong>🚏 ${stopName}</strong> ${stopLetterHtml} <span class="stop-code">${stopId}</span></div>${modeStr ? `<div class="stop-popup-modes">${modeStr} ${distance}</div>` : ''}${extraLine}<div class="stop-popup-loading"><div class="spinner"></div><span>Loading departures...</span></div></div>`);
      mlPopup.addTo(map);
    } catch {}
    (async () => {
      let departuresHtml = '';
      const accData = await Stops.getStopAccessibility(stopId).catch(() => null);
      const accBadge = accData && accData.stepFree ? ` <span class="acc-badge" title="${(accData.text || 'Step-free access')}">\u267F</span>` : '';
      try {
        const arrivals = await (Stops.getArrivalsForStopGroup ? Stops.getArrivalsForStopGroup(stopId) : Stops.getArrivals(stopId));
        if (arrivals.length) {
          const grouped = Stops.groupArrivals(arrivals);
          grouped.forEach(g => {
            if (!g.lines.length) return;
            g.lines.forEach(([lineName, lineArrivals, dir, plat]) => {
              lineArrivals.slice(0, 5).forEach((a, i) => {
                if (i === 0) {
                  let label = `${modeIcons[g.mode]||''} ${g.mode} · ${lineName}`;
                  if (dir) label += ` <span style="font-weight:400;font-size:10px">${Helpers.esc(dir)}</span>`;
                  if (plat && !plat.match(/^(Westbound|Eastbound|Northbound|Southbound)/i)) label += ` <span style="font-weight:400;font-size:10px">Stop ${Helpers.esc(plat)}</span>`;
                  departuresHtml += `<div class="popup-mode-group"><span class="popup-mode-label">${label}</span></div>`;
                }
                const dueText = a.timeToStation <= 0 ? 'Due' : a.timeToStation === 1 ? '1 min' : `${a.timeToStation} min`;
                const bg = modeColors[g.mode] || '#333';
                departuresHtml += `<div class="popup-arrival"><span class="popup-line-badge" style="background:${bg}">${Helpers.esc(lineName)}</span><span class="popup-dest">${Helpers.esc(a.destination || dir || '')}</span><span class="popup-time">${dueText}</span></div>`;
              });
            });
          });
          if (arrivals.length > 8) departuresHtml += `<div style="font-size:9px;color:#888;padding:2px 0">+${arrivals.length - 8} more departures</div>`;
        } else {
          departuresHtml = `<div style="font-size:10px;color:#888;padding:6px 0;text-align:center">No arrivals at this time</div>`;
        }
      } catch { departuresHtml = `<div style="font-size:10px;color:#888;padding:6px 0;text-align:center">Could not load departures</div>`; }
      const btnHtml = `<button class="stop-popup-btn" data-id="${stopId}" data-name="${stopName}" data-lat="${lat}" data-lon="${lon}">📋 View Full Timetable</button>`;
      const finalHtml = `<div class="stop-popup"><div class="stop-popup-header"><strong>🚏 ${stopName}</strong>${accBadge}</div>${modeStr ? `<div class="stop-popup-modes">${modeStr} ${distance}</div>` : ''}${extraLine}${routeTags ? `<div class="stop-popup-routes">${routeTags}</div>` : ''}<div class="popup-departures-list">${departuresHtml}</div>${btnHtml}</div>`;
      if (mlPopup) mlPopup.setHTML(finalHtml);
      setTimeout(() => {
        document.querySelectorAll('.stop-popup-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const b = e.currentTarget;
            if (mlPopup) { try { mlPopup.remove(); } catch {} }
            document.dispatchEvent(new CustomEvent('open-departures', { detail: { id: b.dataset.id, name: b.dataset.name, lat: parseFloat(b.dataset.lat), lon: parseFloat(b.dataset.lon) } }));
          });
        });
      }, 50);
    })();
  }

  function showStopMarkers(stops) {
    hideStopMarkers();
    stopMarkerData = [];
    stops.slice(0, 50).forEach(s => {
      if (s.lat == null || s.lon == null || isNaN(s.lat) || isNaN(s.lon)) return;
      const mode = s.modes[0] || 'bus';
      const color = modeColors[mode] || '#666';
      const html = `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer"></div>`;
      const modeStr = s.modes.map(mo => modeIcons[mo] || '').filter(Boolean).join('');
      const sName = Helpers.esc(s.name), sId = Helpers.esc(s.id);
      const routeStr = s.lines && s.lines.length ? `${s.lines.slice(0,5).join(', ')}${s.lines.length>5?'...':''}` : '';
      const mlm = makeMlMarker(s.lat, s.lon, html, 'stop-marker', () => showStopLivePopup(s.id, s.name, s.lat, s.lon, { modeStr, distance: s.distance, routeTags: s.lines, stopLetter: s.stopLetter }));
      if (mlm) {
        mlm.getElement().title = `${sName} (${sId})`;
        stopMarkers.push(mlm);
        stopMarkerData.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, html, modes: s.modes, lines: s.lines, distance: s.distance, modeStr, stopLetter: s.stopLetter });
      }
    });
  }

  function hideStopMarkers() {
    stopMarkers.forEach(m => m.remove()); stopMarkers = [];
    stopMarkerData = [];
  }

  function showBikeMarkers(points) {
    hideBikeMarkers();
    bikeMarkerData = [];
    points.forEach(b => {
      if (b.lat == null || b.lon == null || isNaN(b.lat) || isNaN(b.lon)) return;
      const pct = b.docks > 0 ? (b.bikes / b.docks) * 100 : 0;
      const color = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
      const html = `<div style="background:${color};width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer">🚲</div>`;
      const bName = Helpers.esc(b.name);
      const m = makeMlMarker(b.lat, b.lon, html, 'bike-marker');
      if (m) {
        m.getElement().addEventListener('click', () => {
          const popup = new maplibregl.Popup({ className: 'stop-detail-popup', closeButton: true, maxWidth: '240px' });
          popup.setLngLat([b.lon, b.lat]);
          popup.setHTML(`
            <div style="font-size:13px;font-weight:700;margin-bottom:4px">🚲 ${bName}</div>
            <div style="font-size:11px;line-height:1.5">
              <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Available bikes</span><strong>${b.bikes}</strong></div>
              <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Empty docks</span><strong>${b.spaces}</strong></div>
              <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Total docks</span><strong>${b.docks}</strong></div>
              <div style="margin-top:4px;height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .3s"></div>
              </div>
              <div style="font-size:9px;color:var(--text2);margin-top:2px">${Math.round(pct)}% occupied</div>
            </div>
            <button class="stop-popup-btn" style="margin-top:6px">🚶 Route here</button>`);
          popup.addTo(map);
          setTimeout(() => {
            const btn = popup.getElement()?.querySelector('.stop-popup-btn');
            if (btn) btn.onclick = () => {
              document.dispatchEvent(new CustomEvent('bike-route-to', { detail: { lat: b.lat, lon: b.lon, name: b.name } }));
              popup.remove();
            };
          }, 10);
        });
        bikeMarkers.push(m);
        bikeMarkerData.push({ lat: b.lat, lon: b.lon, bikes: b.bikes, docks: b.docks, spaces: b.spaces, name: b.name });
      }
    });
  }

  function hideBikeMarkers() {
    bikeMarkers.forEach(m => m.remove()); bikeMarkers = [];
    bikeMarkerData = [];
  }

  function showRouteStopMarkers(stops, color) {
    hideRouteStopMarkers();
    routeStopMarkerData = [];
    stops.slice(0, 60).forEach((s, i) => {
      if (s.lat == null || s.lon == null || isNaN(s.lat) || isNaN(s.lon)) return;
      const html = `<div style="background:${color||'#e32017'};width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer"><span class="rs-inner-dot">${i+1}</span></div>`;
      const rsClick = () => showStopLivePopup(s.id, s.name, s.lat, s.lon, { extraLine: `<div class="stop-popup-modes" style="margin-bottom:6px">Stop #${i+1}</div>`, stopLetter: s.stopLetter });
      const mlm = makeMlMarker(s.lat, s.lon, html, 'route-stop-marker', rsClick);
      if (mlm) {
        routeStopMarkers.push(mlm);
        routeStopMarkerData.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, html, color });
      }
    });
  }

  function hideRouteStopMarkers() {
    routeStopMarkers.forEach(m => m.remove()); routeStopMarkers = [];
    routeStopMarkerData = [];
  }

  function showUserLocation(lat, lng, heading, accuracy) {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;

    if (userMarker) {
      userMarker.setLngLat([lng, lat]);
      userLocData = { lat, lng };

      const wrapper = userMarker.getElement().querySelector('.user-loc-wrapper');
      if (wrapper) {
        const hasHeading = heading != null && !isNaN(heading);
        if (hasHeading) {
          wrapper.style.transform = 'rotate(' + heading + 'deg)';
        }
        const arrow = wrapper.querySelector('.user-loc-arrow');
        const dot = wrapper.querySelector('.user-loc-dot');
        if (hasHeading && !arrow) {
          wrapper.innerHTML = '<div class="user-loc-arrow"><div class="pulse-ring"></div></div>';
        } else if (!hasHeading && !dot) {
          wrapper.innerHTML = '<div class="user-loc-dot"><div class="pulse-ring"></div></div>';
        }
      }

      if (userAccuracyCircle) {
        try {
          map.getSource('user-accuracy').setData(accuracyCircleGeoJSON(lat, lng, accuracy));
        } catch {}
      } else if (accuracy != null && accuracy > 0 && accuracy < 1000) {
        try {
          map.addSource('user-accuracy', { type: 'geojson', data: accuracyCircleGeoJSON(lat, lng, accuracy) });
          map.addLayer({ id: 'user-accuracy-fill', type: 'fill', source: 'user-accuracy', paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.15 } });
          map.addLayer({ id: 'user-accuracy-outline', type: 'line', source: 'user-accuracy', paint: { 'line-color': '#4285f4', 'line-opacity': 0.3, 'line-width': 1 } });
          userAccuracyCircle = true;
        } catch {}
      }

      return userMarker;
    }

    hideUserLocation();
    userLocData = { lat, lng };

    if (accuracy != null && accuracy > 0 && accuracy < 1000) {
      try {
        map.addSource('user-accuracy', { type: 'geojson', data: accuracyCircleGeoJSON(lat, lng, accuracy) });
        map.addLayer({ id: 'user-accuracy-fill', type: 'fill', source: 'user-accuracy', paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.15 } });
        map.addLayer({ id: 'user-accuracy-outline', type: 'line', source: 'user-accuracy', paint: { 'line-color': '#4285f4', 'line-opacity': 0.3, 'line-width': 1 } });
        userAccuracyCircle = true;
      } catch {}
    }

    const hasHeading = heading != null && !isNaN(heading);
    const html = hasHeading
      ? '<div class="user-loc-wrapper" style="transform:rotate(' + heading + 'deg)">'
        + '<div class="user-loc-arrow"><div class="pulse-ring"></div></div></div>'
      : '<div class="user-loc-wrapper">'
        + '<div class="user-loc-dot"><div class="pulse-ring"></div></div></div>';
    const el = document.createElement('div');
    el.innerHTML = html;
    const child = el.firstChild || el;
    child.className = 'user-location-marker';
    try {
      userMarker = new maplibregl.Marker({ element: child, offset: [0, -8] });
      userMarker.setLngLat([lng, lat]);
      userMarker.addTo(map);
      userMarker.getElement().style.zIndex = '10000';
    } catch (e) { userMarker = null; }
    return userMarker;
  }

  function accuracyCircleGeoJSON(lat, lng, radius) {
    const points = 36;
    const coords = [];
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      const dLat = dy / 111320;
      const dLng = dx / (111320 * Math.cos(lat * Math.PI / 180));
      coords.push([lng + dLng, lat + dLat]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
  }

  function hideUserLocation() {
    if (userMarker) { userMarker.remove(); userMarker = null; }
    if (userAccuracyCircle) {
      try { map.removeLayer('user-accuracy-fill'); } catch {}
      try { map.removeLayer('user-accuracy-outline'); } catch {}
      try { map.removeSource('user-accuracy'); } catch {}
      userAccuracyCircle = null;
    }
    userLocData = null;
  }

  function isUserLocationVisible() { return userMarker !== null; }
  function setFollowMode(on) { followMode = on; }
  function isFollowMode() { return followMode; }

  function onMoveEnd(cb) {
    offMoveEnd();
    moveEndHandler = () => { followMode = false; if (cb) cb(getActiveCenter()); };
    map.on('moveend', moveEndHandler);
  }

  function offMoveEnd() {
    if (moveEndHandler) {
      map.off('moveend', moveEndHandler);
      moveEndHandler = null;
    }
  }

  function getStopData(id) { return stopMarkerData.find(s => s.id === id); }

  function toggleTerrain() {
    if (!map || !mapLoaded) return;
    threeDEnabled = !threeDEnabled;
    if (threeDEnabled) {
      map.setPitch(60);
      map.setLayoutProperty('sky', 'visibility', 'visible');
      document.getElementById('view-3d-btn')?.classList.add('active');
    } else {
      map.setPitch(0);
      map.setLayoutProperty('sky', 'visibility', 'none');
      document.getElementById('view-3d-btn')?.classList.remove('active');
    }
  }

  function refreshTiles() {
    switchTileProvider(0);
  }

  if (typeof OfflineManager !== 'undefined') {
    OfflineManager.onSync(() => {
      refreshTiles();
    });
  }

  return { init, addMarker, addRoute, fitBounds, clearRoutes, clearMarkers, clearAll, onClick, clearClick, flyTo, panTo, getActiveCenter, getMap: () => map, showStopMarkers, hideStopMarkers, showBikeMarkers, hideBikeMarkers, showRouteStopMarkers, hideRouteStopMarkers, showUserLocation, hideUserLocation, isUserLocationVisible, setFollowMode, isFollowMode, onMoveEnd, offMoveEnd, showStopLivePopup, getStopData, refreshTiles, toggleTerrain };
})();
