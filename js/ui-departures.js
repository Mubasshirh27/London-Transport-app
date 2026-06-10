(function() {
  const UI = window.UI = window.UI || {};
  let departuresTimer2 = null;

  UI.showDepartures = function(stopId, stopName, stopLetter) {
    if (departuresTimer2) clearInterval(departuresTimer2);
    const panel = document.getElementById('departures-panel');
    panel.style.display = 'flex';
    panel.dataset.stopId = stopId;
    panel.dataset.stopName = stopName;
    panel.dataset.stopLetter = stopLetter || '';
    delete panel.dataset.dirFilter;
    const list = document.getElementById('departures-list');
    const letterHtml = stopLetter ? '<span class="stop-letter">' + stopLetter + '</span>' : '';
    panel.querySelector('h3').innerHTML = '\u{1F68F} ' + stopName + ' ' + letterHtml + ' <span class="live-badge">LIVE</span>';
    loadArrivals(stopId, list);
    departuresTimer2 = setInterval(async () => {
      if (panel.style.display !== 'none') await loadArrivals(stopId, list, true);
    }, 30000);
    panel.querySelector('.panel-close').onclick = () => {
      panel.style.display = 'none';
      if (departuresTimer2) { clearInterval(departuresTimer2); departuresTimer2 = null; }
    };
    panel.querySelector('.panel-refresh').onclick = () => {
      loadArrivals(stopId, list).catch(() => {});
    };
  };

  async function loadArrivals(stopId, list, silent) {
    try {
      if (!silent) list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      const arrivals = await Stops.getArrivals(stopId);
      const isScheduled = arrivals.length > 0 && arrivals[0]._scheduled;
      const badge = document.getElementById('departures-panel').querySelector('h3 .live-badge');
      if (badge) {
        badge.textContent = isScheduled ? 'SCHEDULED' : 'LIVE';
        badge.className = isScheduled ? 'sched-badge' : 'live-badge';
      }
      if (!arrivals.length) { list.innerHTML = '<div class="no-data">No upcoming departures</div>'; return; }
      const grouped = Stops.groupArrivals(arrivals);
      const allRoutes = [...new Set(arrivals.map(a => a.line).filter(Boolean))];
      const allDirections = [...new Set(arrivals.map(a => a.dirLabel).filter(Boolean))];

      let html = '';

      // Direction filter bar (trains with multiple bounds)
      if (allDirections.length > 1) {
        html += '<div class="dir-filter-bar" id="dir-filter-bar">'
          + '<button class="dir-filter-btn active" data-dir="">All</button>';
        allDirections.forEach(d => {
          html += '<button class="dir-filter-btn" data-dir="' + d.replace(/"/g, '&quot;') + '">' + d + '</button>';
        });
        html += '</div>';
      }

      // Route tags
      if (allRoutes.length > 1) {
        html += '<div class="route-tags"><span class="route-tags-label">Routes:</span>'
          + allRoutes.map(r => '<button class="route-tag" data-route="' + r.replace(/"/g, '&quot;') + '">' + r + '</button>').join('')
          + '</div>';
      }

      grouped.forEach(g => {
        if (!g.lines.length) return;
        const modeLabel = g.mode.charAt(0).toUpperCase() + g.mode.slice(1);
        html += '<div class="mode-group">'
          + '<div class="mode-group-header" style="border-left-color:' + Stops.getModeColor(g.mode) + '">'
          + '<span>' + Stops.getModeIcon(g.mode) + ' ' + modeLabel + '</span>'
          + '<span class="mode-count">' + g.lines.reduce((s, l) => s + l[1].length, 0) + ' departures</span>'
          + '</div>';
        g.lines.forEach(([lineName, lineArrivals, dir, plat]) => {
          const bg = Stops.getModeColor(g.mode);
          const dirLabel = dir ? ' <span class="dir-badge">' + dir + '</span>' : '';
          const boundRe = /^(Westbound|Eastbound|Northbound|Southbound|Inner Rail|Outer Rail)/i;
          const platClean = plat ? plat.replace(boundRe, '').replace(/^\s*[-:]\s*/, '').trim() : '';
          const platLabel = platClean ? (dir ? ' \u00b7 Plat. ' + platClean : ' \u00b7 ' + plat) : '';
          html += '<div class="line-group" data-dir="' + (dir || '') + '">'
            + '<div class="line-header" style="background:' + bg + ';color:#fff">'
            + '<span class="line-badge" style="background:rgba(0,0,0,.3)">' + lineName + '</span>'
            + dirLabel + platLabel
            + '<span class="line-count">' + lineArrivals.length + ' services</span>'
            + '<button class="full-day-btn" data-stop="' + stopId + '" data-line="' + lineName.replace(/"/g, '&quot;') + '"' + (dir ? ' data-dir="' + dir.replace(/"/g, '&quot;') + '"' : '') + '>Full Day</button>'
            + '</div>';
          lineArrivals.forEach(a => {
            const mins = a.timeToStation;
            const cls = mins <= 1 ? 'due' : mins <= 5 ? 'soon' : '';
            const aPlat = a.platformName || '';
            const platDisplay = aPlat ? 'Plat. ' + aPlat.replace(boundRe, '').replace(/^\s*[-:]\s*/, '').trim() : '';
            const dirTag = a.dirLabel ? ' <span class="arr-dir">' + a.dirLabel + '</span>' : '';
            const dueText = mins <= 0 ? '<span class="arr-due">Due</span>' : mins === 1 ? '<span class="arr-min">1 min</span>' : '<span class="arr-min">' + mins + ' min</span>';
            const schedTag = a._scheduled ? ' <span class="sched-mini">SCHED</span>' : '';
            html += '<div class="line-arrival ' + cls + '">'
              + '<span class="arr-dest">' + (a.destination || '') + dirTag + '</span>'
              + '<span class="arr-plat">' + platDisplay + schedTag + '</span>'
              + '<span class="arr-time">' + dueText + '</span>'
              + '</div>';
          });
          html += '</div>';
        });
        html += '</div>';
      });
      list.innerHTML = html;

      // Re-apply previous direction filter if set
      const panel = document.getElementById('departures-panel');
      const savedDir = panel.dataset.dirFilter || '';
      if (savedDir) applyDirFilter(list, savedDir);

      // Direction filter click handler
      list.querySelectorAll('.dir-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          list.querySelectorAll('.dir-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const dir = btn.dataset.dir;
          panel.dataset.dirFilter = dir;
          applyDirFilter(list, dir);
        });
      });

      // Route tag click handler
      list.querySelectorAll('.route-tag').forEach(tag => {
        tag.addEventListener('click', () => {
          const routeNum = tag.dataset.route;
          document.getElementById('route-input').value = routeNum;
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
          document.querySelector('.tab-btn[data-tab="routes"]').classList.add('active');
          document.getElementById('tab-routes').classList.add('active');
          document.dispatchEvent(new Event('explore-route'));
        });
      });
    } catch { if (!silent) list.innerHTML = '<div class="no-data">Could not load departures</div>'; }
  }

  function applyDirFilter(list, dir) {
    list.querySelectorAll('.line-group').forEach(g => {
      g.style.display = !dir || g.dataset.dir === dir ? '' : 'none';
    });
    // Hide mode-groups with no visible line-groups
    list.querySelectorAll('.mode-group').forEach(mg => {
      const hasVisible = mg.querySelector('.line-group:not([style*="display: none"])');
      mg.style.display = hasVisible ? '' : 'none';
      if (mg.style.display !== 'none') {
        const countEl = mg.querySelector('.mode-count');
        if (countEl) {
          const visibleCount = [...mg.querySelectorAll('.line-group:not([style*="display: none"])')]
            .reduce((sum, lg) => sum + parseInt(lg.querySelector('.line-count')?.textContent || '0'), 0);
          countEl.textContent = visibleCount + ' departures';
        }
      }
    });
  }

  UI._clearDeparturesTimer = function() {
    if (departuresTimer2) { clearInterval(departuresTimer2); departuresTimer2 = null; }
  };
  window.UI = UI;
})();
