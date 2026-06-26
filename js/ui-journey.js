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

      async function renderSuggestions(q) {
        let geoResults = [], favs = [], recents = [];
        if (q.length >= 2) { try { geoResults = await Geocoder.search(q); } catch {} }
        try { favs = Store.getFavorites().filter(f => f.label.toLowerCase().includes(q.toLowerCase())); } catch {}
        try { recents = Store.getRecent().filter(r => r.label.toLowerCase().includes(q.toLowerCase())); } catch {}

        if (q.length === 0) {
          const last5 = (recents || []).slice(0, 5);
          el.innerHTML = '';
          if (last5.length) {
            el.innerHTML += '<div class="sug-header">🕐 Recent searches</div>';
            el.innerHTML += last5.map(r =>
              '<div class="suggestion-item recent-item" data-label="'+Helpers.esc(r.label)+'" data-lat="'+r.lat+'" data-lon="'+r.lon+'" data-type="'+(r.type||'')+'"><span class="sug-type">🕐</span><span class="sug-label">'+Helpers.esc(r.label)+'</span><span class="sug-sub">Recent</span></div>'
            ).join('');
            el.innerHTML += '<div class="suggestion-item clear-recent-btn" style="border-bottom:none;color:var(--text2);font-size:10px;justify-content:center;border-top:1px solid #333">✕ Clear recent searches</div>';
          }
          el.classList.toggle('active', el.children.length > 0);
          return;
        }

        el.innerHTML = '';
        if (favs.length) {
          el.innerHTML += favs.map(f =>
            '<div class="suggestion-item fav-item" data-label="'+Helpers.esc(f.label)+'" data-lat="'+f.lat+'" data-lon="'+f.lon+'" data-type="fav"><span class="sug-type">⭐</span><span class="sug-label">'+Helpers.esc(f.label)+'</span><span class="sug-sub">Saved place</span></div>'
          ).join('');
        }
        if (recents.length) {
          el.innerHTML += recents.map(r =>
            '<div class="suggestion-item recent-item" data-label="'+Helpers.esc(r.label)+'" data-lat="'+r.lat+'" data-lon="'+r.lon+'" data-type="'+(r.type||'')+'"><span class="sug-type">🕐</span><span class="sug-label">'+Helpers.esc(r.label)+'</span><span class="sug-sub">Recent</span></div>'
          ).join('');
        }
        el.innerHTML += geoResults.map(r =>
          '<div class="suggestion-item" data-label="'+Helpers.esc(r.label)+'" data-lat="'+r.lat+'" data-lon="'+r.lon+'" data-type="'+r.type+'"><span class="sug-type">'+(r.type === 'stop' ? '🚏' : '📍')+'</span><span class="sug-label">'+Helpers.esc(r.label)+'</span><span class="sug-sub">'+Helpers.esc(r.fullLabel || '').substring(0, 100)+'</span></div>'
        ).join('');
        el.classList.toggle('active', el.children.length > 0);
      }

      input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length === 0) renderSuggestions('');
      });

      input.addEventListener('input', () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (q.length === 0) { renderSuggestions(''); return; }
        if (q.length < 2) { el.innerHTML = ''; el.classList.remove('active'); return; }
        timeout = setTimeout(() => renderSuggestions(q), 200);
      });

      el.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        if (item.classList.contains('clear-recent-btn')) {
          Store.clearRecent();
          renderSuggestions(input.value.trim());
          return;
        }
        input.value = item.dataset.label;
        const val = { label: item.dataset.label, lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), type: item.dataset.type || '' };
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
            }).join('') : '<div class="suggestion-item" style="cursor:default;color:var(--text2)">No stops found — try a different stop name or number</div>';
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
        const { fastest, cheapest, balanced, fewestTransfers, leastWalking } = journeys;

    function hasDisruption(journey) {
      return journey && journey.legs && journey.legs.some(l => l.disruption);
    }

    const renderCard = (journey, key, label, icon, color, isDefault) => {
      const durMins = journey.duration;
      const hrs = Math.floor(durMins / 60);
      const mins = durMins % 60;
      const durStr = hrs > 0 ? hrs+'h '+mins+'m' : mins+' min';
      const fareStr = journey.fare != null ? '£'+journey.fare.toFixed(2) :
        journey.estimatedFare != null ? '~£'+journey.estimatedFare.toFixed(2) : '-';
      let fareTitle = '';
      if (journey.fareBreakdown) {
        const fb = journey.fareBreakdown;
        const parts = [];
        if (fb.peak != null) parts.push(fb.peak ? 'Peak' : 'Off-peak');
        if (fb.ticketType) parts.push(fb.ticketType);
        if (fb.zones && fb.zones.length) parts.push('Zone ' + fb.zones.join(','));
        fareTitle = parts.join(' · ');
      }
      const start = journey.startTime ? new Date(journey.startTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-';
      const end = journey.arrivalTime ? new Date(journey.arrivalTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-';
      const legIcons = journey.legs.map(l => Router.getModeIcon(l.mode)).join('');
      const legNames = journey.legs.map(l => l.modeName).join(', ');
      const walkDist = journey.walkDuration > 0 ? journey.walkDuration+' min walk' : '';
      const disruptCls = hasDisruption(journey) ? journey.legs.find(l => l.disruption).disruption.cls : '';
      const disruptText = hasDisruption(journey) ? journey.legs.find(l => l.disruption).disruption.text : '';

      return '<div class="journey-card '+(isDefault ? 'active' : '')+'" data-journey-index="'+key+'" style="--card-color:'+color+'">'+
        '<div class="jc-header" style="border-left-color:'+color+'">'+
          '<span class="jc-badge" style="background:'+color+'">'+icon+'</span>'+
          '<span class="jc-label">'+label+'</span>'+
          '<span class="jc-time">'+durStr+'</span>'+
          (disruptText ? '<span class="jc-disrupt '+disruptCls+'" title="'+Helpers.esc(disruptText)+'">⚠️</span>' : '')+
          '<span class="jc-fare" '+(fareTitle ? 'title="'+Helpers.esc(fareTitle)+'" style="cursor:help"' : '')+'>'+fareStr+'</span>'+
        '</div>'+
        '<div class="jc-body">'+
          '<div class="jc-times">'+start+' \u2192 '+end+'</div>'+
          '<div class="jc-modes">'+legIcons+' <span class="jc-mode-text">'+legNames+'</span></div>'+
          (disruptText ? '<div class="jc-disrupt-msg '+disruptCls+'">⚠️ '+Helpers.esc(disruptText)+'</div>' : '')+
          (fareTitle ? '<div class="jc-fare-detail">'+Helpers.esc(fareTitle)+'</div>' : '')+
          '<div class="jc-meta">'+
            '<span>'+journey.transfers+' transfer'+(journey.transfers !== 1 ? 's' : '')+'</span>'+
            (walkDist ? '<span>🚶 '+walkDist+'</span>' : '')+
          '</div>'+
        '</div>'+
        '<div class="jc-steps">'+
          journey.legs.map((leg, i) => {
            const depTime = leg.departureTime ? new Date(leg.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            const arrTime = leg.arrivalTime ? new Date(leg.arrivalTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            const timeStr = depTime && arrTime ? depTime+' \u2192 '+arrTime : '';
            const dirStr = leg.direction ? (leg.direction.startsWith('towards') ? leg.direction : 'towards '+leg.direction) : '';
            const locStr = leg.from && leg.to && leg.mode !== 'walking' ? '<span class="step-loc">'+Helpers.esc(leg.from.name)+' \u2192 '+Helpers.esc(leg.to.name)+'</span>' : '';
            const stopCount = leg.stops && leg.stops.length ? leg.stops.length+' stop'+(leg.stops.length !== 1 ? 's' : '') : '';
            const platStr = leg.platformName ? 'Platform '+leg.platformName : '';
            const walkDetail = leg.mode === 'walking' && leg.detail ? leg.detail : '';
            const disruptMsg = leg.disruption ? '<div class="step-disrupt '+leg.disruption.cls+'">⚠️ '+Helpers.esc(leg.disruption.text)+'</div>' : '';
            const parts = ['<div class="step">'+
              '<div class="step-icon" style="background:'+Router.getModeColor(leg.mode)+'">'+Router.getModeIcon(leg.mode)+'</div>'+
              '<div class="step-detail">'+
                '<div class="step-header">'+(leg.mode === 'walking' ? 'Walk' : leg.modeName+' '+(leg.routeName || ''))+' '+(dirStr ? '<span class="step-dir">'+Helpers.esc(dirStr)+'</span>' : '')+' <span class="step-dur">'+leg.duration+' min</span></div>'+
                (locStr ? '<div class="step-loc-row">'+locStr+'</div>' : '')+
                (walkDetail ? '<div class="step-instruction">'+Helpers.esc(walkDetail)+'</div>' : '')+
                (leg.instruction && leg.mode !== 'walking' ? '<div class="step-instruction">'+Helpers.esc(leg.instruction)+'</div>' : '')+
                (disruptMsg)+
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

    const featured = [fastest, cheapest, balanced].filter(Boolean);
    const extraFeatured = [];
    if (journeys.walkingJourney && !featured.includes(journeys.walkingJourney)) extraFeatured.push(journeys.walkingJourney);
    const extraSet = new Set(extraFeatured);

    let html = '<div class="results-header">'+
      '🏆 Best Routes'+
      '<button id="results-close-btn" class="results-close-btn" title="Close results"><span class="ic" data-ic="close"></span></button>'+
      '<button class="trip-start-btn" id="trip-start-btn">▶ Start Trip</button>'+
      '<button class="trip-end-btn" style="display:none" id="trip-end-btn">⏹ End Trip</button>'+
    '</div>';
    if (fastest && cheapest && balanced) {
      const allSame = fastest === cheapest && cheapest === balanced;
      if (allSame) {
        const isWalk = fastest.legs.every(l => l.mode === 'walking');
        const durMins = fastest.duration;
        const hrs = Math.floor(durMins / 60);
        const mins = durMins % 60;
        const durStr = hrs > 0 ? hrs+'h '+mins+'m' : mins+' min';
        const distStr = fastest.legs[0] && fastest.legs[0].instruction ? fastest.legs[0].instruction : '';
        html += '<div class="journey-card active" data-journey-index="fastest" style="--card-color:'+(isWalk ? '#666' : '#fcbb03')+'">'+
          '<div class="jc-header" style="border-left-color:'+(isWalk ? '#666' : '#fcbb03')+'">'+
            '<span class="jc-badge" style="background:'+(isWalk ? '#666' : '#fcbb03')+'">'+(isWalk ? '🚶' : '🚲')+'</span>'+
            '<span class="jc-label">'+(isWalk ? 'Walking' : 'Cycling')+'</span>'+
            '<span class="jc-time">'+durStr+'</span>'+
            '<span class="jc-fare">Free</span>'+
          '</div>'+
          '<div class="jc-body"><div class="jc-modes"><span class="jc-mode-text">'+(distStr ? distStr : (isWalk ? 'Walk the whole way' : 'Cycle the whole way'))+'</span></div></div>'+
          '<div class="jc-steps">'+
            fastest.legs.map((leg, li) => {
              const walkD = isWalk ? (leg.detail || leg.instruction || '') : '';
              const ic = isWalk ? '🚶' : '🚲';
              let stepHtml = '<div class="step"><div class="step-icon" style="background:'+(isWalk ? '#666' : '#fcbb03')+'">'+ic+'</div><div class="step-detail"><div class="step-header">'+(isWalk ? 'Walk' : 'Cycle')+' <span class="step-dur">'+leg.duration+' min</span></div>'+(walkD ? '<div class="step-instruction">'+Helpers.esc(walkD)+'</div>' : '');
              if (isWalk && leg.walkSteps && leg.walkSteps.length) {
                stepHtml += '<div class="walk-steps">' + leg.walkSteps.map(s =>
                  '<div class="walk-step"><span class="walk-step-dir">'+(s.modifier==='turn-left'?'⬅':s.modifier==='turn-right'?'➡':s.modifier==='uturn'?'↩':'⬆')+'</span><span class="walk-step-text">'+Helpers.esc(s.instruction||'Walk')+'</span><span class="walk-step-dist">'+Math.round(s.distance)+'m</span></div>'
                ).join('') + '</div>';
              }
              stepHtml += '</div></div>';
              return stepHtml;
            }).join('')+
          '</div>'+
        '</div>';
      } else {
        const featuredCards = [
          { key: 'cheapest', journey: cheapest, label: '💰 Cheapest', icon: '💰', color: '#00a94f' },
          { key: 'fastest', journey: fastest, label: '⚡ Fastest', icon: '⚡', color: '#0019a8' },
          { key: 'balanced', journey: balanced, label: '🧠 Smartest', icon: '🧠', color: '#e32017' },
          { key: 'fewestTransfers', journey: fewestTransfers, label: '🔄 Fewest Changes', icon: '🔄', color: '#6950a0' },
          { key: 'leastWalking', journey: leastWalking, label: '🚶 Least Walking', icon: '🚶', color: '#f86c00' }
        ];
        const seen = new Set();
        window._featuredJourneys = [];
        featuredCards.forEach(fc => {
          if (fc.journey && !seen.has(fc.journey)) {
            seen.add(fc.journey);
            window._featuredJourneys.push(fc);
          }
        });
        if ((journeys.all || []).length > window._featuredJourneys.length) {
          (journeys.all || []).forEach((j, idx) => {
            if (!seen.has(j)) {
              seen.add(j);
              window._featuredJourneys.push({ key: 'route_' + idx, journey: j, label: 'Route ' + (idx + 1), icon: '🚌', color: '#555' });
            }
          });
        }
        window._featuredJourneys.forEach((fc, i) => {
          html += renderCard(fc.journey, fc.key, fc.label, fc.icon, fc.color, i === 0);
        });
      }
    }
    extraFeatured.forEach(j => {
      const durMins = j.duration;
      const hrs = Math.floor(durMins / 60);
      const mins = durMins % 60;
      const durStr = hrs > 0 ? hrs+'h '+mins+'m' : mins+' min';
      const distStr = j.legs[0] && j.legs[0].instruction ? j.legs[0].instruction : '';
      html += '<div class="journey-card" data-journey-index="walking" style="--card-color:#666">'+
        '<div class="jc-header" style="border-left-color:#666">'+
          '<span class="jc-badge" style="background:#666">🚶</span>'+
          '<span class="jc-label">Walking</span>'+
          '<span class="jc-time">'+durStr+'</span>'+
          '<span class="jc-fare">Free</span>'+
        '</div>'+
        '<div class="jc-body">'+
          '<div class="jc-modes"><span class="jc-mode-text">'+(distStr ? distStr : 'Walk the whole way')+'</span></div>'+
        '</div>'+
        '<div class="jc-steps">'+
          j.legs.map((leg, li) => {
            const walkD = leg.detail || leg.instruction || '';
            let stepHtml = '<div class="step"><div class="step-icon" style="background:#666">🚶</div><div class="step-detail"><div class="step-header">Walk <span class="step-dur">'+leg.duration+' min</span></div>'+(walkD ? '<div class="step-instruction">'+Helpers.esc(walkD)+'</div>' : '');
            if (leg.walkSteps && leg.walkSteps.length) {
              stepHtml += '<div class="walk-steps">' + leg.walkSteps.map(s =>
                '<div class="walk-step"><span class="walk-step-dir">'+(s.modifier==='turn-left'?'⬅':s.modifier==='turn-right'?'➡':s.modifier==='uturn'?'↩':'⬆')+'</span><span class="walk-step-text">'+Helpers.esc(s.instruction||'Walk')+'</span><span class="walk-step-dist">'+Math.round(s.distance)+'m</span></div>'
              ).join('') + '</div>';
            }
            stepHtml += '</div></div>';
            return stepHtml;
          }).join('')+
        '</div>'+
      '</div>';
    });
    const featuredSet = new Set();
    (window._featuredJourneys || []).forEach(fc => featuredSet.add(fc.journey));
    const remainder = (journeys.all || []).filter(j => !featuredSet.has(j));
    if (remainder.length) {
      html += '<div class="all-routes-section"><button class="all-routes-toggle">All ' + journeys.all.length + ' routes <span class="ic" data-ic="chevron_down"></span></button><div class="all-routes-list" style="display:none">' +
        remainder.map((j, i) => {
          const key = 'route_' + journeys.all.indexOf(j);
          const durMins = j.duration;
          const hrs = Math.floor(durMins / 60);
          const mins = durMins % 60;
          const durStr = hrs > 0 ? hrs+'h '+mins+'m' : mins+' min';
          const start = j.startTime ? new Date(j.startTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-';
          const end = j.arrivalTime ? new Date(j.arrivalTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-';
          const legIcons = j.legs.map(l => Router.getModeIcon(l.mode)).join('');
          const legNames = j.legs.map(l => l.modeName).join(', ');
          const walkStr = j.walkDuration > 0 ? '🚶 '+j.walkDuration+'min' : '';
          return '<div class="journey-card" data-journey-index="' + key + '" style="--card-color:#555">'+
            '<div class="jc-header" style="border-left-color:#555">'+
              '<span class="jc-label"># ' + (i + 1) + '</span>'+
              '<span class="jc-time">' + durStr + '</span>'+
              '<span class="jc-fare">' + j.transfers + ' trf</span>'+
            '</div>'+
            '<div class="jc-body">'+
              '<div class="jc-times">' + start + ' → ' + end + '</div>'+
              '<div class="jc-modes">' + legIcons + ' <span class="jc-mode-text">' + legNames + '</span></div>'+
              (walkStr ? '<div class="jc-meta"><span>' + walkStr + '</span></div>' : '')+
            '</div>'+
            '<div class="jc-steps" style="display:none">' +
              j.legs.map((leg, li) => {
                const depTime2 = leg.departureTime ? new Date(leg.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
                const arrTime2 = leg.arrivalTime ? new Date(leg.arrivalTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
                const timeStr2 = depTime2 && arrTime2 ? depTime2+' → '+arrTime2 : '';
                const dirStr2 = leg.direction ? (leg.direction.startsWith('towards') ? leg.direction : 'towards '+leg.direction) : '';
                const locStr2 = leg.from && leg.to && leg.mode !== 'walking' ? '<span class="step-loc">'+Helpers.esc(leg.from.name)+' → '+Helpers.esc(leg.to.name)+'</span>' : '';
                const platStr2 = leg.platformName ? 'Platform '+leg.platformName : '';
                const walkDetail2 = leg.mode === 'walking' && leg.detail ? leg.detail : '';
                const stopCount2 = leg.stops && leg.stops.length ? leg.stops.length+' stops' : '';
                const disrupt2 = leg.disruption ? '<div class="step-disrupt '+leg.disruption.cls+'">⚠️ '+Helpers.esc(leg.disruption.text)+'</div>' : '';
                return '<div class="step" data-leg="'+li+'">'+
                  '<div class="step-icon" style="background:'+Router.getModeColor(leg.mode)+'">'+Router.getModeIcon(leg.mode)+'</div>'+
                  '<div class="step-detail">'+
                    '<div class="step-header">'+(leg.mode === 'walking' ? 'Walk' : leg.modeName+' '+(leg.routeName || ''))+' '+(dirStr2 ? '<span class="step-dir">'+Helpers.esc(dirStr2)+'</span>' : '')+' <span class="step-dur">'+leg.duration+' min</span></div>'+
                    (locStr2 ? '<div class="step-loc-row">'+locStr2+'</div>' : '')+
                    (walkDetail2 ? '<div class="step-instruction">'+Helpers.esc(walkDetail2)+'</div>' : '')+
                    (leg.instruction && leg.mode !== 'walking' ? '<div class="step-instruction">'+Helpers.esc(leg.instruction)+'</div>' : '')+
                    disrupt2+
                    '<div class="step-meta">'+
                      (timeStr2 ? '<span>'+timeStr2+'</span>' : '')+
                      (stopCount2 ? '<span>'+stopCount2+'</span>' : '')+
                      (platStr2 ? '<span>'+platStr2+'</span>' : '')+
                    '</div>'+
                  '</div>'+
                '</div>';
              }).join('') +
            '</div>'+
          '</div>';
        }).join('') +
      '</div></div>';
    }
    resultsPanel.innerHTML = html;
    resultsPanel.classList.add('stagger-in');

    const startBtn = document.getElementById('trip-start-btn');
    const endBtn = document.getElementById('trip-end-btn');
    if (startBtn) { startBtn.style.display = 'inline-block'; startBtn.onclick = () => document.dispatchEvent(new CustomEvent('start-trip', { detail: { key: resultsPanel.querySelector('.journey-card.active')?.dataset?.journeyIndex || 'fastest' } })); }
    if (endBtn) { endBtn.style.display = 'none'; endBtn.onclick = () => document.dispatchEvent(new Event('end-trip')); }

    function getJourneyByKey(k) {
      if (k === 'walking' && journeys.walkingJourney) return journeys.walkingJourney;
      if (journeys[k]) return journeys[k];
      return journeys.all && journeys.all[parseInt(k.replace('route_', ''), 10)];
    }

    resultsPanel.querySelectorAll('.journey-card').forEach(card => {
      const jKey = card.dataset.journeyIndex;
      const journey = getJourneyByKey(jKey);
      if (!journey) return;
      card.querySelector('.jc-header').addEventListener('click', () => {
        const wasActive = card.classList.contains('active');
        resultsPanel.querySelectorAll('.journey-card').forEach(c2 => {
          if (c2 !== card) { c2.classList.remove('active'); const s2 = c2.querySelector('.jc-steps'); if (s2) s2.classList.remove('open'); }
        });
        card.classList.toggle('active');
        card.querySelector('.jc-steps').classList.toggle('open', !wasActive);
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

    const toggleBtn = document.querySelector('.all-routes-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const list = document.querySelector('.all-routes-list');
        if (list) {
          const hidden = list.style.display === 'none';
          list.style.display = hidden ? 'block' : 'none';
          toggleBtn.innerHTML = 'All ' + journeys.all.length + ' routes <span class="ic" data-ic="' + (hidden ? 'chevron_up' : 'chevron_down') + '"></span>';
        }
      });
    }
  };

  /* Hide panels */
  UI.hidePanels = function() {
    if (UI._cleanupDeparturesTimer) UI._cleanupDeparturesTimer();
    if (departuresTimer) clearInterval(departuresTimer);
    departuresTimer = null;
    if (UI._clearDeparturesTimer) UI._clearDeparturesTimer();
    document.getElementById('nearby-panel').classList.remove('open');
    document.getElementById('departures-panel').classList.remove('open');
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
