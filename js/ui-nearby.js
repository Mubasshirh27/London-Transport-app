(function() {
  const UI = window.UI = window.UI || {};
  function esc(s) { return String(s).replace(/[&<>"']/g, function(m) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }

  function showPanel(panelId) {
    const panel = document.getElementById(panelId);
    panel.style.display = 'flex';
    return panel;
  }

  let liveTracking = false;

  UI.showNearbyStops = async function(lat, lon, preserveScroll) {
    const panel = document.getElementById('nearby-panel');
    if (liveTracking && panel.style.display === 'none') return;
    panel.style.display = 'flex';
    const h3 = panel.querySelector('h3');
    h3.innerHTML = liveTracking
      ? '📍 Nearby Stops <span class="live-badge">LIVE</span>'
      : '📍 Nearby Stops';
    const list = document.getElementById('nearby-list');
    const savedScroll = preserveScroll ? list.scrollTop : 0;
    if (!preserveScroll) {
      list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    }
    try {
      const stops = await Stops.getNearby(lat, lon);
      if (!stops.length) {
        if (!preserveScroll) list.innerHTML = '<div class="no-data">No stops nearby</div>';
        return;
      }
      const modeOrder = { bus: 0, tube: 1, 'national-rail': 2, 'elizabeth-line': 3, dlr: 4, overground: 5, tram: 6 };
      stops.sort((a, b) => {
        const mA = modeOrder[a.modes[0]] ?? 9, mB = modeOrder[b.modes[0]] ?? 9;
        return mA - mB || a.distance - b.distance;
      });
      list.innerHTML = stops.slice(0, 20).map(s => {
        const pm = s.modes.includes('bus') ? 'bus' : (s.modes[0] || '');
        const stopLetterHtml = s.stopLetter ? '<span class="stop-letter">' + esc(s.stopLetter) + '</span>' : '';
        return '<div class="stop-item" data-stop-id="' + esc(s.id) + '" data-lat="' + s.lat + '" data-lon="' + s.lon + '" data-stop-letter="' + esc(s.stopLetter || '') + '"><span class="stop-icon">' + Stops.getModeIcon(pm) + '</span><span class="stop-name">' + esc(s.name) + '</span>' + stopLetterHtml + '<span class="stop-dist">' + Math.round(s.distance) + 'm</span><span class="stop-modes">' + s.modes.map(function(m) { return Stops.getModeIcon(m); }).join('') + '</span></div>';
      }).join('');
      list.querySelectorAll('.stop-item').forEach(function(item) {
        item.addEventListener('click', async function() {
          UI.showDepartures(item.dataset.stopId, item.querySelector('.stop-name').textContent, item.dataset.stopLetter);
          MapView.flyTo(parseFloat(item.dataset.lat), parseFloat(item.dataset.lon));
        });
      });
      if (savedScroll) {
        requestAnimationFrame(function() { list.scrollTop = savedScroll; });
      }
      MapView.showStopMarkers(stops);
    } catch(e) {
      if (!preserveScroll) list.innerHTML = '<div class="no-data">Could not load stops</div>';
    }
    panel.querySelector('.panel-close').onclick = function() { panel.style.display = 'none'; };
  };

  UI.setLiveTracking = function(on) {
    liveTracking = on;
    document.getElementById('live-toggle')?.classList.toggle('active', on);
  };

  UI.isLiveTracking = function() { return liveTracking; };

  let bikeMarkersVisible = false;

  UI.toggleBikeMarkers = function(val) {
    bikeMarkersVisible = val !== undefined ? val : !bikeMarkersVisible;
    return bikeMarkersVisible;
  };

  UI.isBikeMarkersVisible = function() { return bikeMarkersVisible; };

  UI.setMapPinInteractive = function(mode) {
    const overlay = document.getElementById('map-overlay');
    if (!overlay.classList.contains('open')) {
      document.dispatchEvent(new CustomEvent('toggle-map', { detail: { open: true } }));
    }
    UI.showError(mode === 'bike' ? 'Tap map to set bike search location' : 'Tap map to set location');
  };

  window.UI = UI;
})();