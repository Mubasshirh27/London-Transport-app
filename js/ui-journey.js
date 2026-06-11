(function() {
  const UI = window.UI = window.UI || {};

  let fromInput, toInput, resultsPanel;
  let departuresTimer = null;

  const journeyAutocomplete = {
    init() {
      fromInput = document.getElementById('from-input');
      toInput = document.getElementById('to-input');
      resultsPanel = document.getElementById('results-panel');
      this._setup(fromInput, 'from-suggestions', (val) => { UI._fromValue = val; });
      this._setup(toInput, 'to-suggestions', (val) => { UI._toValue = val; });
    },

    _setup(input, suggestionsId, onSelect) {
      const el = document.getElementById(suggestionsId);
      let timeout;
      input.addEventListener('input', () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (q.length < 2) { el.innerHTML = ''; el.classList.remove('active'); return; }
        timeout = setTimeout(async () => {
          let geoResults = [], favs = [];
          try { geoResults = await Geocoder.search(q); } catch {}
          try { favs = Store.getFavorites().filter(f => f.label.toLowerCase().includes(q.toLowerCase())); } catch {}
          console.log('Geocoder results for "'+q+'":', geoResults && geoResults.length ? geoResults.map(r=>r.label) : 'empty');
          el.innerHTML = '';
          if (favs.length) {
            el.innerHTML += favs.map(f =>
              '<div class="suggestion-item fav-item" data-label="'+f.label+'" data-lat="'+f.lat+'" data-lon="'+f.lon+'" data-type="fav"><span class="sug-type">⭐</span><span class="sug-label">'+f.label+'</span><span class="sug-sub">Saved place</span></div>'
            ).join('');
          }
          el.innerHTML += geoResults.map(r =>
            '<div class="suggestion-item" data-label="'+r.label+'" data-lat="'+r.lat+'" data-lon="'+r.lon+'" data-type="'+r.type+'"><span class="sug-type">'+(r.type === 'stop' ? '🚏' : '📍')+'</span><span class="sug-label">'+r.label+'</span><span class="sug-sub">'+(r.fullLabel || '').substring(0, 100)+'</span></div>'
          ).join('');
          el.classList.toggle('active', el.children.length > 0);
        }, 200);
      });

      el.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        input.value = item.dataset.label;
        const val = { label: item.dataset.label, lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), type: item.dataset.type };
        onSelect(val);
        Store.addRecent(val);
        el.innerHTML = '';
        el.classList.remove('active');
      });

      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !el.contains(e.target)) {
          el.innerHTML = '';
          el.classList.remove('active');
        }
      });

      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.innerHTML = '';
          el.classList.remove('active');
          if (input.value.trim()) {
            const text = input.value.trim();
            try {
              const results = await Geocoder.search(text);
              if (results && results.length > 0) {
                const r = results[0];
                if (r.lat != null && r.lon != null && !isNaN(r.lat) && !isNaN(r.lon)) {
                  onSelect({ label: r.label || text, lat: r.lat, lon: r.lon, type: r.type });
                  document.dispatchEvent(new Event('plan-journey'));
                } else {
                  onSelect({ label: text });
                }
              } else {
                onSelect({ label: text });
              }
            } catch {
              onSelect({ label: text });
            }
          }
        }
      });
    }
  };

  const stopCheck = {
    init() {
      const input = document.getElementById('stop-check-input');
      const suggestionsEl = document.getElementById('stop-check-suggestions');
      const btn = document.getElementById('stop-check-btn');
      let timeout;

      input.addEventListener('input', () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (q.length < 2) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('active'); return; }
        timeout = setTimeout(async () => {
          try {
            const data = await Api.searchStops(q);
            const stops = (data && data.matches) ? data.matches : [];
            suggestionsEl.innerHTML = stops.length ? stops.slice(0, 15).map(s => {
              const modes = (s.modes || []).map(m => Stops.getModeIcon(m)).join('');
              return '<div class="suggestion-item" data-id="'+s.id+'" data-name="'+(s.commonName || s.name)+'" data-lat="'+s.lat+'" data-lon="'+s.lon+'"><span class="sug-type">🚏</span><span class="sug-label">'+(s.commonName || s.name)+'</span><span class="sug-sub">'+modes+'</span></div>';
            }).join('') : '<div class="suggestion-item" style="cursor:default;color:var(--text2)">No stops found</div>';
            suggestionsEl.classList.toggle('active', suggestionsEl.children.length > 0);
          } catch { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('active'); }
        }, 200);
      });

      suggestionsEl.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item || !item.dataset.id) return;
        const stopId = item.dataset.id, stopName = item.dataset.name;
        const lat = parseFloat(item.dataset.lat), lon = parseFloat(item.dataset.lon);
        input.value = stopName;
        suggestionsEl.innerHTML = '';
        suggestionsEl.classList.remove('active');
        UI.showDepartures(stopId, stopName);
        MapView.flyTo(lat, lon, 16);
      });

      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('active');
        }
      });

      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });

      btn.addEventListener('click', async () => {
        const q = input.value.trim();
        if (!q) return;
        try {
          const data = await Api.searchStops(q);
          const stops = (data && data.matches) ? data.matches : [];
          if (stops.length === 1) {
            const s = stops[0];
            const lat = parseFloat(s.lat), lon = parseFloat(s.lon);
            input.value = s.commonName || s.name;
            UI.showDepartures(s.id, s.commonName || s.name);
            if (!isNaN(lat) && !isNaN(lon)) {
              MapView.flyTo(lat, lon, 16);
            }
          } else if (stops.length > 1) {
            suggestionsEl.innerHTML = stops.slice(0, 15).map(s => {
              const modes = (s.modes || []).map(m => Stops.getModeIcon(m)).join('');
              return '<div class="suggestion-item" data-id="'+s.id+'" data-name="'+(s.commonName || s.name)+'" data-lat="'+s.lat+'" data-lon="'+s.lon+'"><span class="sug-type">🚏</span><span class="sug-label">'+(s.commonName || s.name)+'</span><span class="sug-sub">'+modes+'</span></div>';
            }).join('');
            suggestionsEl.classList.add('active');
          } else { UI.showError('Stop not found. Try a different name.'); }
        } catch { UI.showError('Could not search for stop.'); }
      });
    }
  };

  /* Results */
  UI.showResults = function(journeys) {
    if (!journeys || !journeys.fastest) { UI.showError('No routes found. Try different locations or modes.'); return; }
    const { fastest, cheapest, balanced } = journeys;

    const renderCard = (journey, key, label, icon, color, isDefault) => {
      const durMins = journey.duration;
      const hrs = Math.floor(durMins / 60);
      const mins = durMins % 60;
      const durStr = hrs > 0 ? hrs+'h '+mins+'m' : mins+' min';
      const fareStr = journey.fare != null ? '£'+journey.fare.toFixed(2) :
        journey.estimatedFare != null ? '~£'+journey.estimatedFare.toFixed(2) : '-';
      const start = journey.startTime ? new Date(journey.startTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-';
      const end = journey.arrivalTime ? new Date(journey.arrivalTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-';
      const legIcons = journey.legs.map(l => Router.getModeIcon(l.mode)).join('');
      const legNames = journey.legs.map(l => l.modeName).join(', ');
      const walkDist = journey.walkDuration > 0 ? journey.walkDuration+' min walk' : '';

      return '<div class="journey-card '+(isDefault ? 'active' : '')+'" data-journey-index="'+key+'">'+
        '<div class="jc-header" style="border-left-color:'+color+'">'+
          '<span class="jc-badge" style="background:'+color+'">'+icon+'</span>'+
          '<span class="jc-label">'+label+'</span>'+
          '<span class="jc-time">'+durStr+'</span>'+
          '<span class="jc-fare">'+fareStr+'</span>'+
        '</div>'+
        '<div class="jc-body">'+
          '<div class="jc-times">'+start+' \u2192 '+end+'</div>'+
          '<div class="jc-modes">'+legIcons+' <span class="jc-mode-text">'+legNames+'</span></div>'+
          '<div class="jc-meta">'+
            '<span>'+journey.transfers+' transfer'+(journey.transfers !== 1 ? 's' : '')+'</span>'+
            (walkDist ? '<span>🚶 '+walkDist+'</span>' : '')+
          '</div>'+
        '</div>'+
        '<div class="jc-steps" style="display:none">'+
          journey.legs.map((leg, i) => {
            const depTime = leg.departureTime ? new Date(leg.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            const arrTime = leg.arrivalTime ? new Date(leg.arrivalTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            const timeStr = depTime && arrTime ? depTime+' \u2192 '+arrTime : '';
            const dirStr = leg.direction ? (leg.direction.startsWith('towards') ? leg.direction : 'towards '+leg.direction) : '';
            const locStr = leg.from && leg.to && leg.mode !== 'walking' ? '<span class="step-loc">'+leg.from.name+' \u2192 '+leg.to.name+'</span>' : '';
            const stopCount = leg.stops && leg.stops.length ? leg.stops.length+' stop'+(leg.stops.length !== 1 ? 's' : '') : '';
            const platStr = leg.platformName ? 'Platform '+leg.platformName : '';
            const walkDetail = leg.mode === 'walking' && leg.detail ? leg.detail : '';
            const parts = ['<div class="step">'+
              '<div class="step-icon" style="background:'+Router.getModeColor(leg.mode)+'">'+Router.getModeIcon(leg.mode)+'</div>'+
              '<div class="step-detail">'+
                '<div class="step-header">'+(leg.mode === 'walking' ? 'Walk' : leg.modeName+' '+(leg.routeName || ''))+' '+(dirStr ? '<span class="step-dir">'+dirStr+'</span>' : '')+' <span class="step-dur">'+leg.duration+' min</span></div>'+
                (locStr ? '<div class="step-loc-row">'+locStr+'</div>' : '')+
                (walkDetail ? '<div class="step-instruction">'+walkDetail+'</div>' : '')+
                (leg.instruction && leg.mode !== 'walking' ? '<div class="step-instruction">'+leg.instruction+'</div>' : '')+
                '<div class="step-meta">'+
                  (timeStr ? '<span>'+timeStr+'</span>' : '')+
                  (stopCount ? '<span>'+stopCount+'</span>' : '')+
                  (platStr ? '<span>'+platStr+'</span>' : '')+
                '</div>'+
              '</div>'+
            '</div>'];
            if (i < journey.legs.length - 1) {
              const nextLeg = journey.legs[i + 1];
              if (nextLeg.mode !== 'walking' && leg.arrivalTime && nextLeg.departureTime) {
                const gap = (new Date(nextLeg.departureTime) - new Date(leg.arrivalTime)) / 60000;
                if (gap > 0 && gap < 5) {
                  const cls = gap < 2 ? 'conn-alert-verytight' : 'conn-alert-tight';
                  const text = gap < 2 ? 'Very tight connection \u2014 you may miss this!' : 'Only ' + Math.round(gap) + ' min to change!';
                  parts.push('<div class="conn-warning ' + cls + '">\u26a1 ' + text + '</div>');
                } else if (gap >= 15) {
                  parts.push('<div class="conn-warning conn-long">' + Math.round(gap) + ' min wait</div>');
                }
              }
            }
            return parts;
          }).flat().join('')+
        '</div>'+
      '</div>';
    };

    resultsPanel.innerHTML = '<div class="results-header">'+
      '🏆 Best Routes'+
      '<button id="results-close-btn" class="results-close-btn" title="Close results"><span class="ic" data-ic="close"></span></button>'+
      '<button class="trip-start-btn" id="trip-start-btn">▶ Start Trip</button>'+
      '<button class="trip-end-btn" style="display:none" id="trip-end-btn">⏹ End Trip</button>'+
    '</div>'+
    renderCard(cheapest, 'cheapest', '💰 Cheapest', '💰', '#00a94f', false)+
    renderCard(fastest, 'fastest', '⚡ Fastest', '⚡', '#0019a8', false)+
    renderCard(balanced, 'balanced', '🧠 Smartest', '🧠', '#e32017', false);

    const startBtn = document.getElementById('trip-start-btn');
    const endBtn = document.getElementById('trip-end-btn');
    startBtn.style.display = 'inline-block';
    endBtn.style.display = 'none';

    const resultsCloseBtn = document.getElementById('results-close-btn');
    if (resultsCloseBtn) resultsCloseBtn.onclick = () => { resultsPanel.innerHTML = '<div class="panel-placeholder">Enter a destination and plan your journey</div>'; };

    startBtn.onclick = () => document.dispatchEvent(new CustomEvent('start-trip', { detail: { key: resultsPanel.querySelector('.journey-card.active')?.dataset?.journeyIndex || 'fastest' } }));
    endBtn.onclick = () => document.dispatchEvent(new Event('end-trip'));

    resultsPanel.querySelectorAll('.journey-card').forEach(card => {
      const jKey = card.dataset.journeyIndex;
      const journey = journeys[jKey];
      card.querySelector('.jc-header').addEventListener('click', () => {
        const wasActive = card.classList.contains('active');
        resultsPanel.querySelectorAll('.journey-card').forEach(c2 => {
          if (c2 !== card) { c2.classList.remove('active'); const s2 = c2.querySelector('.jc-steps'); if (s2) s2.style.display = 'none'; }
        });
        card.classList.toggle('active');
        card.querySelector('.jc-steps').style.display = wasActive ? 'none' : 'block';
        if (!wasActive) document.dispatchEvent(new CustomEvent('show-route', { detail: jKey }));
      });

      card.querySelectorAll('.step').forEach((stepEl, legIdx) => {
        stepEl.addEventListener('click', () => {
          const overlay = document.getElementById('map-overlay');
          if (overlay && !overlay.classList.contains('open')) {
            overlay.classList.add('open');
            const toggle = document.getElementById('map-toggle-btn'); if (toggle) toggle.innerHTML = '<span class="ic" data-ic="close"></span> Close';
            document.body.style.overflow = 'hidden';
            setTimeout(() => { const m = MapView.getMap && MapView.getMap(); if (m && m.invalidateSize) m.invalidateSize(); }, 100);
          }
          const leg = journey.legs[legIdx];
          if (!leg) return;
          MapView.clearRoutes(); MapView.clearMarkers();
          document.querySelectorAll('.leaflet-popup, .maplibregl-popup').forEach(p => p.remove());
          const fromPt = leg.from, toPt = leg.to;
          if (leg.path && leg.path.length >= 2) {
            const color = Router.getModeColor(leg.mode);
            MapView.addRoute(leg.path, color, leg.modeName + (leg.routeName ? ' ' + leg.routeName : ''));
            if (fromPt && fromPt.lat != null && fromPt.lon != null) MapView.addMarker(fromPt.lat, fromPt.lon, 'From: ' + (fromPt.name || ''), color);
            if (toPt && toPt.lat != null && toPt.lon != null) MapView.addMarker(toPt.lat, toPt.lon, 'To: ' + (toPt.name || ''), '#e32017');
            MapView.fitBounds([leg.path]);
          } else if (fromPt && fromPt.lat != null && fromPt.lon != null && toPt && toPt.lat != null && toPt.lon != null) {
            MapView.addMarker(fromPt.lat, fromPt.lon, 'From: ' + (fromPt.name || ''), '#0019a8');
            MapView.addMarker(toPt.lat, toPt.lon, 'To: ' + (toPt.name || ''), '#e32017');
            MapView.fitBounds([[fromPt.lat, fromPt.lon], [toPt.lat, toPt.lon]]);
          } else if (fromPt && fromPt.lat != null && fromPt.lon != null) {
            MapView.flyTo(fromPt.lat, fromPt.lon, 15);
          }
          let legBtn = document.getElementById('leg-close-btn');
          if (!legBtn) {
            legBtn = document.createElement('div'); legBtn.id = 'leg-close-btn'; legBtn.innerHTML = '<span class="ic" data-ic="close"></span>';
            document.getElementById('map-overlay').appendChild(legBtn);
          }
          window.__legViewActive = true;
          legBtn._restoreKey = jKey;
          legBtn.onclick = (e) => {
            e.stopPropagation();
            window.__legViewActive = false;
            MapView.clearRoutes(); MapView.clearMarkers();
            document.querySelectorAll('.leaflet-popup, .maplibregl-popup, .stop-detail-popup').forEach(p => p.remove());
            legBtn.style.display = 'none';
            if (legBtn._restoreKey) document.dispatchEvent(new CustomEvent('show-route', { detail: legBtn._restoreKey }));
          };
          legBtn.style.display = 'flex';
        });
      });
    });
  };

  /* Hide panels */
  UI.hidePanels = function() {
    if (UI._clearDeparturesTimer) UI._clearDeparturesTimer();
    if (departuresTimer) clearInterval(departuresTimer);
    departuresTimer = null;
    document.getElementById('nearby-panel').style.display = 'none';
    document.getElementById('departures-panel').style.display = 'none';
  };

  /* Map pin mode */
  UI.setMapPinMode = function(target) {
    document.getElementById('click-target-label').textContent = target;
    document.getElementById('map-click-info').classList.remove('hidden');
  };

  UI.clearMapPinMode = function() {
    document.getElementById('map-click-info').classList.add('hidden');
  };

  /* Getters/Setters */
  UI.getFromValue = () => UI._fromValue;
  UI.getToValue = () => UI._toValue;
  UI.getFromText = () => fromInput ? fromInput.value : '';
  UI.getToText = () => toInput ? toInput.value : '';
  UI.setFromValue = (v) => { UI._fromValue = v; };
  UI.setToValue = (v) => { UI._toValue = v; };
  UI.setFromText = (t) => { if (fromInput) fromInput.value = t; };
  UI.setToText = (t) => { if (toInput) toInput.value = t; };
  UI.getFromInput = () => fromInput;
  UI.getToInput = () => toInput;
  UI.getRouteInput = () => document.getElementById('route-input').value.trim();
  UI._cleanupDeparturesTimer = function() { if (departuresTimer) clearInterval(departuresTimer); departuresTimer = null; };
  UI._setDeparturesTimer = function(t) { departuresTimer = t; };
  UI._initJourneyAutocomplete = function() { journeyAutocomplete.init(); };
  UI._initStopCheck = function() { stopCheck.init(); };

  window.UI = UI;
})();