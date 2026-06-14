const MapView = (() => {
  let map, markers = [], routes = [], stopMarkers = [], bikeMarkers = [], routeStopMarkers = [], userMarker = null, followMode = true;
  let mlMap = null;
  let mlMarkers = [], mlRouteLayers = [], mlStopMarkers = [], mlBikeMarkers = [], mlRouteStopMarkers = [], mlUserMarker = null;
  let routeIdCounter = 0;
  let markerData = [], routeData = [], stopMarkerData = [], bikeMarkerData = [], routeStopMarkerData = [], userLocData = null;

  function init() {
    map = L.map('map').setView(CONFIG.mapCenter, CONFIG.mapZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a>'
    }).addTo(map);
    document.getElementById('map-legend').classList.remove('hidden');
    return map;
  }

  function set3dMap(ml) { mlMap = ml; }
  function get3dMap() { return mlMap; }

  function clear3dAll() {
    mlMarkers.forEach(m => { try { m.remove(); } catch {} }); mlMarkers = [];
    if (mlMap) mlRouteLayers.forEach(id => { try { mlMap.removeLayer(id); mlMap.removeSource(id); } catch {} });
    mlRouteLayers = [];
    mlStopMarkers.forEach(m => { try { m.remove(); } catch {} }); mlStopMarkers = [];
    mlBikeMarkers.forEach(m => { try { m.remove(); } catch {} }); mlBikeMarkers = [];
    mlRouteStopMarkers.forEach(m => { try { m.remove(); } catch {} }); mlRouteStopMarkers = [];
    if (mlUserMarker) { try { mlUserMarker.remove(); } catch {} mlUserMarker = null; }
  }

  function clear3dState() {
    mlMarkers = []; mlRouteLayers = []; mlStopMarkers = []; mlBikeMarkers = []; mlRouteStopMarkers = []; mlUserMarker = null;
  }

  function makeMlMarker(lat, lon, html, className, onClick) {
    if (!mlMap || lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
    const el = document.createElement('div');
    el.innerHTML = html;
    const child = el.firstChild || el;
    if (className) child.className = className;
    if (onClick) child.addEventListener('click', () => onClick(lat, lon));
    try {
      const m = new maplibregl.Marker({ element: child });
      m.setLngLat([lon, lat]);
      m.addTo(mlMap);
      if (className === 'bike-marker') console.log('makeMlMarker: created bike marker at', lat, lon);
      return m;
    } catch (e) {
      if (className === 'bike-marker') console.warn('makeMlMarker: FAILED for bike marker at', lat, lon, e);
      return null;
    }
  }

  function addRoute3d(points, color) {
    if (!mlMap || !points || points.length < 2) return null;
    const id = 'route3d_' + (routeIdCounter++);
    const glowId = id + '_glow';
    const coords = points.map(p => [p[1], p[0]]);
    mlMap.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
    mlMap.addLayer({ id: glowId, type: 'line', source: id, paint: { 'line-color': color || '#0019a8', 'line-width': 10, 'line-opacity': 0.2, 'line-blur': 4 } });
    mlMap.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color || '#0019a8', 'line-width': 4, 'line-opacity': 0.85 } });
    mlRouteLayers.push(id, glowId);
    return id;
  }

  function addMarker(lat, lon, label, color) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
    const isFrom = label && label.includes('From:');
    const isTo = label && label.includes('To:');
    const size = (isFrom || isTo) ? 32 : 18;
    const border = (isFrom || isTo) ? '4px' : '3px';
    const html = `<div style="position:relative;background:${color||'#0019a8'};width:${size}px;height:${size}px;border-radius:50%;border:${border} solid white;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white">${isFrom ? 'A' : isTo ? 'B' : ''}</div>`;
    const icon = L.divIcon({
      className: 'custom-marker',
      html: html + `<div style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:white;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;font-weight:600">${(label||'').replace(/^(From:|To:)\s*/,'')}</div>`,
      iconSize: [size + 10, 50], iconAnchor: [(size + 10) / 2, size / 2]
    });
    const m = L.marker([lat, lon], { icon }).addTo(map);
    markers.push(m);
    markerData.push({ lat, lon, label, color, html });
    const mlm = makeMlMarker(lat, lon, html, 'custom-marker');
    if (mlm) mlMarkers.push(mlm);
    return m;
  }

  function addRoute(points, color, label) {
    if (!points || points.length === 0) return;
    const polyline = L.polyline(points, { color: color || '#0019a8', weight: 4, opacity: 0.8 }).addTo(map);
    routes.push(polyline);
    routeData.push({ points, color, label });
    if (label) {
      const mid = points[Math.floor(points.length / 2)];
      const lbl = L.marker([mid[0], mid[1]], {
        icon: L.divIcon({ className: 'route-label', html: label, iconSize: [0, 0] })
      }).addTo(map);
      routes.push(lbl);
    }
    addRoute3d(points, color);
    return polyline;
  }

  function fitBounds(pointsList) {
    if (!pointsList || !pointsList.length) return;
    const all = pointsList.flat();
    if (all.length < 2) return;
    map.fitBounds(all, { padding: [50, 50] });
    if (mlMap && mlMap.isStyleLoaded()) {
      const lats = all.map(p => p[0]), lons = all.map(p => p[1]);
      const sw = [Math.min(...lons), Math.min(...lats)];
      const ne = [Math.max(...lons), Math.max(...lats)];
      mlMap.fitBounds([sw, ne], { padding: 50, duration: 600 });
    }
  }

  function clearRoutes() {
    routes.forEach(r => map.removeLayer(r)); routes = [];
    mlRouteLayers.forEach(id => { try { if (mlMap) { mlMap.removeLayer(id); mlMap.removeSource(id); } } catch {} });
    mlRouteLayers = [];
    routeData = [];
  }
  function clearMarkers() {
    markers.forEach(m => map.removeLayer(m)); markers = [];
    mlMarkers.forEach(m => m.remove()); mlMarkers = [];
    markerData = [];
  }
  function clearAll() { clearRoutes(); clearMarkers(); hideStopMarkers(); hideBikeMarkers(); hideRouteStopMarkers(); }

  function onClick(cb) { map.on('click', (e) => cb(e.latlng.lat, e.latlng.lng)); }
  function flyTo(lat, lon, zoom) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return;
    map.flyTo([lat, lon], zoom || 15, { duration: 0.6 });
    if (mlMap) mlMap.flyTo({ center: [lon, lat], zoom: (zoom || 15) - 1, duration: 600 });
  }
  function getActiveCenter() {
    if (mlMap) {
      const c = mlMap.getCenter();
      return { lat: c.lat, lng: c.lng };
    }
    return map.getCenter();
  }

  const modeIcons = { bus: '🚌', tube: '🚇', dlr: '🚈', overground: '🚆', 'elizabeth-line': '🚄', 'national-rail': '🚂', tram: '🚊', riverBus: '⛴️', cableCar: '🚡' };
  const modeColors = { bus: '#e32017', tube: '#0019a8', dlr: '#00a94f', overground: '#f86c00', 'elizabeth-line': '#6950a0', 'national-rail': '#003688', tram: '#66cc00', riverBus: '#00a4a7', cableCar: '#e21836' };

  function showStopLivePopup(stopId, stopName, lat, lon, opts = {}) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return;
    const modeStr = opts.modeStr || '';
    const distance = opts.distance != null ? `<span style="font-size:10px;color:#888">(${Math.round(opts.distance)}m)</span>` : '';
    const routeTags = opts.routeTags ? opts.routeTags.slice(0, 8).map(r => `<span class="popup-route-tag">${r}</span>`).join('') : '';
    const extraLine = opts.extraLine || '';
    const is3d = mlMap && document.getElementById('map-3d')?.style.display !== 'none';
    let popup = null, mlPopup = null;
    if (!is3d) {
      popup = L.popup({ className: 'stop-detail-popup', closeButton: true, maxWidth: 300 })
        .setLatLng([lat, lon])
        .setContent(`<div class="stop-popup"><div class="stop-popup-header"><strong>🚏 ${stopName}</strong></div>${modeStr ? `<div class="stop-popup-modes">${modeStr} ${distance}</div>` : ''}${extraLine}<div class="stop-popup-loading"><div class="spinner"></div><span>Loading departures...</span></div></div>`)
        .openOn(map);
    }
    if (mlMap) {
      try {
        mlPopup = new maplibregl.Popup({ className: 'stop-detail-popup', closeButton: true, maxWidth: '300px' });
        mlPopup.setLngLat([lon, lat]);
        mlPopup.setHTML(`<div class="stop-popup"><div class="stop-popup-header"><strong>🚏 ${stopName}</strong></div>${modeStr ? `<div class="stop-popup-modes">${modeStr} ${distance}</div>` : ''}${extraLine}<div class="stop-popup-loading"><div class="spinner"></div><span>Loading departures...</span></div></div>`);
        mlPopup.addTo(mlMap);
      } catch {}
    }
    (async () => {
      let departuresHtml = '';
      try {
        const arrivals = await Stops.getArrivals(stopId);
        if (arrivals.length) {
          const grouped = Stops.groupArrivals(arrivals);
          grouped.forEach(g => {
            if (!g.lines.length) return;
            g.lines.forEach(([lineName, lineArrivals, dir, plat]) => {
              lineArrivals.slice(0, 5).forEach((a, i) => {
                if (i === 0) {
                  let label = `${modeIcons[g.mode]||''} ${g.mode} · ${lineName}`;
                  if (dir) label += ` <span style="font-weight:400;font-size:10px">${dir}</span>`;
                  if (plat && !plat.match(/^(Westbound|Eastbound|Northbound|Southbound)/i)) label += ` <span style="font-weight:400;font-size:10px">Stop ${plat}</span>`;
                  departuresHtml += `<div class="popup-mode-group"><span class="popup-mode-label">${label}</span></div>`;
                }
                const dueText = a.timeToStation <= 0 ? 'Due' : a.timeToStation === 1 ? '1 min' : `${a.timeToStation} min`;
                const bg = modeColors[g.mode] || '#333';
                departuresHtml += `<div class="popup-arrival"><span class="popup-line-badge" style="background:${bg}">${lineName}</span><span class="popup-dest">${a.destination || dir || ''}</span><span class="popup-time">${dueText}</span></div>`;
              });
            });
          });
          if (arrivals.length > 8) departuresHtml += `<div style="font-size:9px;color:#888;padding:2px 0">+${arrivals.length - 8} more departures</div>`;
        } else {
          departuresHtml = `<div style="font-size:10px;color:#888;padding:6px 0;text-align:center">No arrivals at this time</div>`;
        }
      } catch { departuresHtml = `<div style="font-size:10px;color:#888;padding:6px 0;text-align:center">Error loading departures</div>`; }
      const btnHtml = `<button class="stop-popup-btn" data-id="${stopId}" data-name="${stopName}" data-lat="${lat}" data-lon="${lon}">📋 View Full Timetable</button>`;
      const finalHtml = `<div class="stop-popup"><div class="stop-popup-header"><strong>🚏 ${stopName}</strong></div>${modeStr ? `<div class="stop-popup-modes">${modeStr} ${distance}</div>` : ''}${extraLine}${routeTags ? `<div class="stop-popup-routes">${routeTags}</div>` : ''}<div class="popup-departures-list">${departuresHtml}</div>${btnHtml}</div>`;
      if (popup) popup.setContent(finalHtml);
      if (mlPopup) mlPopup.setHTML(finalHtml);
      setTimeout(() => {
        document.querySelectorAll('.stop-popup-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const b = e.currentTarget;
            if (popup) { try { map.closePopup(); } catch {} }
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
      const icon = L.divIcon({ className: 'stop-marker', html, iconSize: [14,14], iconAnchor: [7,7] });
      const m = L.marker([s.lat, s.lon], { icon }).addTo(map);
      const modeStr = s.modes.map(mo => modeIcons[mo] || '').filter(Boolean).join('');
      const routeStr = s.lines && s.lines.length ? `${s.lines.slice(0,5).join(', ')}${s.lines.length>5?'...':''}` : '';
      m.bindTooltip(`<strong>${s.name}</strong><br>${modeStr} ${routeStr ? '· '+routeStr : ''}`, { direction:'top', className:'stop-tooltip' });
      const popupEl = document.createElement('div');
      popupEl.innerHTML = `<div class="stop-popup"><div class="stop-popup-header"><strong>🚏 ${s.name}</strong></div><div class="stop-popup-loading"><div class="spinner"></div><span>Loading departures...</span></div></div>`;
      const popContent = popupEl.firstElementChild;
      (async () => {
        try {
          const arr = await Stops.getArrivals(s.id);
          if (arr.length) {
            const grp = Stops.groupArrivals(arr);
            let h = '';
            grp.forEach(g => {
              if (!g.lines.length) return;
              g.lines.forEach(([ln, la, dir, plat]) => {
                la.slice(0,4).forEach((a,i) => {
                  if (i===0) {
                    let lb = `${modeIcons[g.mode]||''} ${g.mode} · ${ln}`;
                    if (dir) lb += ` <span style="font-weight:400;font-size:10px">${dir}</span>`;
                    if (plat && !plat.match(/^West|East|North|South/i)) lb += ` <span style="font-weight:400;font-size:10px">Stop ${plat}</span>`;
                    h += `<div class="popup-mode-group"><span class="popup-mode-label">${lb}</span></div>`;
                  }
                  const dt = a.timeToStation <= 0 ? 'Due' : a.timeToStation === 1 ? '1 min' : `${a.timeToStation} min`;
                  const bgc = modeColors[g.mode] || '#333';
                  h += `<div class="popup-arrival"><span class="popup-line-badge" style="background:${bgc}">${ln}</span><span class="popup-dest">${a.destination || ''}</span><span class="popup-time">${dt}</span></div>`;
                });
              });
            });
            if (arr.length > 8) h += `<div style="font-size:9px;color:#888;padding:2px 0">+${arr.length-8} more</div>`;
            h += `<button class="stop-popup-btn" style="margin-top:6px" data-sid="${s.id}" data-sname="${s.name}" data-slat="${s.lat}" data-slon="${s.lon}">📋 View Full Timetable</button>`;
            popContent.innerHTML = `<div class="stop-popup-header"><strong>🚏 ${s.name}</strong></div><div class="popup-departures-list">${h}</div>`;
            popContent.querySelector('.stop-popup-btn')?.addEventListener('click', (e) => {
              const b = e.currentTarget;
              map.closePopup();
              document.dispatchEvent(new CustomEvent('open-departures', { detail: { id: b.dataset.sid, name: b.dataset.sname, lat: +b.dataset.slat, lon: +b.dataset.slon } }));
            });
          } else {
            popContent.innerHTML = `<div class="stop-popup-header"><strong>🚏 ${s.name}</strong></div><div style="font-size:10px;color:#888;padding:6px 0;text-align:center">No arrivals at this time</div>`;
          }
        } catch {
          popContent.innerHTML = `<div class="stop-popup-header"><strong>🚏 ${s.name}</strong></div><div style="font-size:10px;color:#888;padding:6px 0;text-align:center">Error loading departures</div>`;
        }
      })();
      m.on('click', () => {
        L.popup({ className: 'stop-detail-popup', closeButton: true, maxWidth: 300 })
          .setLatLng([s.lat, s.lon])
          .setContent(popContent)
          .openOn(map);
        document.dispatchEvent(new CustomEvent('open-departures', { detail: { id: s.id, name: s.name, lat: s.lat, lon: s.lon } }));
      });
      stopMarkers.push(m);
      const mlm = makeMlMarker(s.lat, s.lon, html, 'stop-marker', () => showStopLivePopup(s.id, s.name, s.lat, s.lon, { modeStr, distance: s.distance, routeTags: s.lines }));
      if (mlm) { mlStopMarkers.push(mlm); stopMarkerData.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, html, modes: s.modes, lines: s.lines, distance: s.distance, modeStr }); }
    });
  }

  function hideStopMarkers() {
    stopMarkers.forEach(m => map.removeLayer(m)); stopMarkers = [];
    mlStopMarkers.forEach(m => m.remove()); mlStopMarkers = [];
    stopMarkerData = [];
  }

  function showBikeMarkers(points) {
    hideBikeMarkers();
    bikeMarkerData = [];
    points.forEach(b => {
      if (b.lat == null || b.lon == null || isNaN(b.lat) || isNaN(b.lon)) return;
      const pct = b.docks > 0 ? (b.bikes / b.docks) * 100 : 0;
      const color = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
      const html = `<div style="background:${color};width:22px;height:22px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:11px;cursor:pointer">🚲</div>`;
      const icon = L.divIcon({ className:'bike-marker', html, iconSize:[26,26], iconAnchor:[13,13] });
      const m = L.marker([b.lat, b.lon], { icon }).addTo(map);
      m.bindTooltip(`${b.name}<br>🚲 ${b.bikes} · 🅿️ ${b.spaces}`, { direction:'top', className:'bike-tooltip' });
      const popContent = document.createElement('div');
      popContent.style.width = '200px';
      popContent.innerHTML = `
        <div style="font-size:13px;font-weight:700;margin-bottom:4px">🚲 ${b.name}</div>
        <div style="font-size:11px;line-height:1.5">
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Available bikes</span><strong>${b.bikes}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Empty docks</span><strong>${b.spaces}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Total docks</span><strong>${b.docks}</strong></div>
          <div style="margin-top:4px;height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .3s"></div>
          </div>
          <div style="font-size:9px;color:var(--text2);margin-top:2px">${Math.round(pct)}% occupied</div>
        </div>
        <button class="stop-popup-btn" style="margin-top:6px">🚶 Route here</button>`;
      m.bindPopup(popContent, { className:'stop-detail-popup', maxWidth:240 });
      m.on('click', () => {
        // Draw route immediately on marker click
        document.dispatchEvent(new CustomEvent('bike-route-to', { detail: { lat: b.lat, lon: b.lon, name: b.name } }));
        setTimeout(() => {
          m.openPopup();
          const btn = m.getPopup()?.getElement()?.querySelector('.stop-popup-btn');
          if (btn) btn.onclick = () => {
            document.dispatchEvent(new CustomEvent('bike-route-to', { detail: { lat: b.lat, lon: b.lon, name: b.name } }));
            m.closePopup();
          };
        }, 10);
      });
      bikeMarkers.push(m);
      bikeMarkerData.push({ lat: b.lat, lon: b.lon, bikes: b.bikes, docks: b.docks, spaces: b.spaces, name: b.name });
      const mlm = makeMlMarker(b.lat, b.lon, html, 'bike-marker');
      if (mlm) {
        mlm.addEventListener('click', () => {
          MapView.getMap().setView([b.lat, b.lon], 17);
          setTimeout(() => m.openPopup(), 200);
        });
        mlBikeMarkers.push(mlm);
      }
    });
  }

  function hideBikeMarkers() {
    bikeMarkers.forEach(m => map.removeLayer(m)); bikeMarkers = [];
    mlBikeMarkers.forEach(m => m.remove()); mlBikeMarkers = [];
    bikeMarkerData = [];
  }

  function showRouteStopMarkers(stops, color) {
    hideRouteStopMarkers();
    routeStopMarkerData = [];
    stops.slice(0,60).forEach((s,i) => {
      if (s.lat == null || s.lon == null || isNaN(s.lat) || isNaN(s.lon)) return;
      const html = `<div style="background:${color||'#e32017'};width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer"><span class="rs-inner-dot">${i+1}</span></div>`;
      const icon = L.divIcon({ className:'stop-marker route-stop-marker', html, iconSize:[14,14], iconAnchor:[7,7] });
      const m = L.marker([s.lat, s.lon], { icon }).addTo(map);
      m.bindTooltip(`${i+1}. ${s.name}`, { direction:'top', className:'stop-tooltip' });
      const rsClick = () => showStopLivePopup(s.id, s.name, s.lat, s.lon, { extraLine: `<div class="stop-popup-modes" style="margin-bottom:6px">Stop #${i+1}</div>` });
      m.on('click', rsClick);
      routeStopMarkers.push(m);
      routeStopMarkerData.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, html, color });
      const mlm = makeMlMarker(s.lat, s.lon, html, 'route-stop-marker', rsClick);
      if (mlm) mlRouteStopMarkers.push(mlm);
    });
  }

  function hideRouteStopMarkers() {
    routeStopMarkers.forEach(m => map.removeLayer(m)); routeStopMarkers = [];
    mlRouteStopMarkers.forEach(m => m.remove()); mlRouteStopMarkers = [];
    routeStopMarkerData = [];
  }

  function showUserLocation(lat, lng) {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
    hideUserLocation();
    userLocData = { lat, lng };
    const html = '<div class="user-loc-inner"><div class="pulse-ring"></div></div>';
    const icon = L.divIcon({ className:'user-location-marker', html, iconSize:[24,24], iconAnchor:[12,12] });
    userMarker = L.marker([lat, lng], { icon, zIndexOffset: 10000 }).addTo(map);
    const mlm = makeMlMarker(lat, lng, html, 'user-location-marker');
    if (mlm) { mlUserMarker = mlm; mlm.getElement().style.zIndex = '10000'; }
    return userMarker;
  }

  function hideUserLocation() {
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (mlUserMarker) { mlUserMarker.remove(); mlUserMarker = null; }
    userLocData = null;
  }

  function isUserLocationVisible() { return userMarker !== null; }
  function setFollowMode(on) { followMode = on; }
  function isFollowMode() { return followMode; }

  let moveEndHandler = null;
  function onMoveEnd(cb) {
    offMoveEnd();
    moveEndHandler = () => { followMode = false; if (cb) cb(map.getCenter()); };
    map.on('moveend', moveEndHandler);
  }
  function offMoveEnd() {
    if (moveEndHandler) { map.off('moveend', moveEndHandler); moveEndHandler = null; }
  }

  function resync3d() {
    if (!mlMap) return;
    try { clear3dAll(); } catch (e) { console.warn('clear3dAll error:', e); }
    try {
      if (userLocData) {
        const html = '<div class="user-loc-inner"><div class="pulse-ring"></div></div>';
        const mlm = makeMlMarker(userLocData.lat, userLocData.lng, html, 'user-location-marker');
        if (mlm) { mlUserMarker = mlm; mlm.getElement().style.zIndex = '10000'; }
      }
      markerData.forEach(d => {
        try { const mlm = makeMlMarker(d.lat, d.lon, d.html, 'custom-marker'); if (mlm) mlMarkers.push(mlm); } catch {}
      });
      routeData.forEach(d => { try { addRoute3d(d.points, d.color); } catch {} });
      stopMarkerData.forEach(s => {
        try {
          const stopClick = () => { showStopLivePopup(s.id, s.name, s.lat, s.lon, { modeStr: s.modeStr, distance: s.distance, routeTags: s.lines }); document.dispatchEvent(new CustomEvent('open-departures', { detail: { id: s.id, name: s.name, lat: s.lat, lon: s.lon } })); };
          const mlm = makeMlMarker(s.lat, s.lon, s.html, 'stop-marker', stopClick);
          if (mlm) mlStopMarkers.push(mlm);
        } catch {}
      });
      syncBikeMarkers3d();
      routeStopMarkerData.forEach(s => {
        try {
          const rsClick = () => showStopLivePopup(s.id, s.name, s.lat, s.lon, { extraLine: `<div class="stop-popup-modes" style="margin-bottom:6px">Stop</div>` });
          const mlm = makeMlMarker(s.lat, s.lon, s.html, 'route-stop-marker', rsClick);
          if (mlm) mlRouteStopMarkers.push(mlm);
        } catch {}
      });
    } catch (e) { console.warn('resync3d error:', e); }
  }

  function syncBikeMarkers3d() {
    if (!mlMap) { console.warn('syncBikeMarkers3d: mlMap is null'); return; }
    console.log('syncBikeMarkers3d: processing', bikeMarkerData.length, 'markers');
    mlBikeMarkers.forEach(m => { try { m.remove(); } catch {} }); mlBikeMarkers = [];
    bikeMarkerData.forEach(b => {
      try {
        const pct = b.docks > 0 ? (b.bikes / b.docks) * 100 : 0;
        const color = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
        const el = document.createElement('div');
        el.style.cssText = `background:${color};width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;position:absolute;z-index:99999`;
        el.textContent = '🚲';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          document.dispatchEvent(new CustomEvent('bike-route-to', { detail: { lat: b.lat, lon: b.lon, name: b.name } }));
          try {
            const popup = new maplibregl.Popup({ className: 'stop-detail-popup', closeButton: true, maxWidth: '240px' });
            popup.setLngLat([b.lon, b.lat]);
            popup.setHTML(`
              <div style="font-size:13px;font-weight:700;margin-bottom:4px">🚲 ${b.name}</div>
              <div style="font-size:11px;line-height:1.5">
                <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Available bikes</span><strong>${b.bikes}</strong></div>
                <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Empty docks</span><strong>${b.spaces}</strong></div>
                <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Total docks</span><strong>${b.docks}</strong></div>
                <div style="margin-top:4px;height:6px;background:#2d545e;border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
                </div>
                <div style="font-size:9px;color:#8b949e;margin-top:2px">${Math.round(pct)}% occupied</div>
              </div>
              <button class="stop-popup-btn" style="margin-top:6px;background:#2d545e;color:#e1b382;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px">🚶 Route here</button>`);
            popup.addTo(mlMap);
            setTimeout(() => {
              const btn = popup.getElement()?.querySelector('.stop-popup-btn');
              if (btn) btn.onclick = () => {
                document.dispatchEvent(new CustomEvent('bike-route-to', { detail: { lat: b.lat, lon: b.lon, name: b.name } }));
                popup.remove();
              };
            }, 10);
          } catch {}
        });
        const m = new maplibregl.Marker({ element: el });
        m.setLngLat([b.lon, b.lat]);
        m.addTo(mlMap);
        mlBikeMarkers.push(m);
      } catch (e) {
        console.warn('syncBikeMarkers3d: direct marker failed for', b.lat, b.lon, e);
        // Fallback
        try {
          const container = mlMap.getContainer();
          if (!container) return;
          const pt = mlMap.project([b.lon, b.lat]);
          const d = document.createElement('div');
          d.style.cssText = `background:${b.docks > 0 && b.bikes / b.docks * 100 > 50 ? '#22c55e' : b.docks > 0 && b.bikes / b.docks * 100 > 20 ? '#f59e0b' : '#ef4444'};width:16px;height:16px;border-radius:50%;border:2px solid white;position:absolute;left:${pt.x}px;top:${pt.y}px;z-index:99999`;
          container.appendChild(d);
          mlBikeMarkers.push({ remove: () => { try { if (d.parentNode) d.parentNode.removeChild(d); } catch {} }, getElement: () => d });
        } catch {}
      }
    });
  }

  return { init, addMarker, addRoute, fitBounds, clearRoutes, clearMarkers, clearAll, onClick, flyTo, getActiveCenter, getMap: () => map, showStopMarkers, hideStopMarkers, showBikeMarkers, hideBikeMarkers, showRouteStopMarkers, hideRouteStopMarkers, showUserLocation, hideUserLocation, isUserLocationVisible, setFollowMode, isFollowMode, onMoveEnd, offMoveEnd, showStopLivePopup, set3dMap, get3dMap, clear3dAll, clear3dState, resync3d, syncBikeMarkers3d };
})();
