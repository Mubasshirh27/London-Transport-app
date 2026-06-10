(function() {
  const UI = window.UI = window.UI || {};

  let statusLines = [];
  let mapOpen = false;

  UI.init = function() {
    setupTabs();
    setupStatusBar();
    setupMapToggle();
    setupTimeSelector();
    setupModeFilter();
    setupQuickLinks();
    setupPinButtons();
    setupFavButtons();
    setupActionButtons();
    if (UI._initStopCheck) UI._initStopCheck();
    if (UI._initJourneyAutocomplete) UI._initJourneyAutocomplete();
    loadStatus();
  };

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        btn.classList.add('active');
        const tabEl = document.getElementById('tab-' + btn.dataset.tab);
        if (tabEl) tabEl.classList.add('active');
        // Init bike autocomplete when bikes tab shown
        if (btn.dataset.tab === 'bikes' && UI._setupBikeAutocomplete) {
          UI._setupBikeAutocomplete();
        } else if (typeof MapView !== 'undefined' && MapView.hideBikeMarkers) {
          MapView.hideBikeMarkers();
          if (UI.toggleBikeMarkers) UI.toggleBikeMarkers(false);
        }
      });
    });
  }

  function setupTimeSelector() {
    const timePicker = document.getElementById('time-picker');
    const datePicker = document.getElementById('date-picker');
    function switchToDepart() {
      const activeMode = document.querySelector('.time-btn.active')?.dataset.mode;
      if (activeMode === 'now') {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.time-btn[data-mode="depart"]')?.classList.add('active');
        timePicker.disabled = false;
        datePicker.disabled = false;
      }
    }
    timePicker.addEventListener('change', switchToDepart);
    timePicker.addEventListener('input', switchToDepart);
    datePicker.addEventListener('change', switchToDepart);
    datePicker.addEventListener('input', switchToDepart);
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        if (mode === 'now') { timePicker.value = ''; datePicker.value = ''; }
        timePicker.disabled = mode === 'now';
        datePicker.disabled = mode === 'now';
        if (mode !== 'now') {
          const now = new Date();
          const hour = now.getHours();
          if (!timePicker.value) {
            if (hour >= 0 && hour < 4) {
              timePicker.value = '06:00';
            } else {
              timePicker.value = now.toTimeString().slice(0, 5);
            }
          }
          if (!datePicker.value) {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            datePicker.value = `${y}-${m}-${d}`;
          }
        }
      });
    });
  }

  function setupModeFilter() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
  }

  function setupQuickLinks() {
    document.querySelectorAll('[data-q]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.activeElement === UI.getFromInput() ? UI.getFromInput() : UI.getToInput();
        target.value = btn.dataset.q;
        target.dispatchEvent(new Event('input'));
      });
    });
  }

  function setupPinButtons() {
    document.querySelectorAll('.map-pin').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('map-pin-mode', { detail: btn.dataset.target }));
      });
    });
    // Clicking anywhere on the search row (outside the input) activates pin mode
    document.querySelectorAll('.search-row').forEach(row => {
      const pinBtn = row.querySelector('.map-pin');
      if (!pinBtn) return;
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        document.dispatchEvent(new CustomEvent('map-pin-mode', { detail: pinBtn.dataset.target }));
      });
    });
  }

  function setupFavButtons() {
    document.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        UI._showFavoritesDropdown(btn.dataset.target);
      });
    });
  }

  function setupActionButtons() {
    document.getElementById('plan-btn').addEventListener('click', () => document.dispatchEvent(new Event('plan-journey')));
    document.getElementById('swap-btn').addEventListener('click', swapLocations);
    document.getElementById('clear-btn').addEventListener('click', clearAll);
    document.getElementById('explore-route-btn').addEventListener('click', () => document.dispatchEvent(new Event('explore-route')));
    document.getElementById('route-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.dispatchEvent(new Event('explore-route'));
    });
    document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
    document.getElementById('live-toggle').addEventListener('click', () => document.dispatchEvent(new Event('toggle-live')));
  }

  function setupMapToggle() {
    const pinCheck = () => { if (window.UI && window.UI.isPinModeActive && window.UI.isPinModeActive()) { UI.clearMapPinMode(); return true; } return false; };
    document.getElementById('map-fab').addEventListener('click', () => { if (!pinCheck()) toggleMap(); });
    document.getElementById('close-map-btn').addEventListener('click', () => {
      if (window.UI && window.UI.isPinModeActive && window.UI.isPinModeActive()) { UI.clearMapPinMode(); return; }
      toggleMap();
    });
    document.getElementById('map-toggle-btn').addEventListener('click', () => { if (!pinCheck()) toggleMap(); });
  }

  function toggleMap() {
    const overlay = document.getElementById('map-overlay');
    if (overlay.classList.contains('floating') || overlay.dataset.tripFs) return;
    const fab = document.getElementById('map-fab');
    const btn = document.getElementById('map-toggle-btn');
    mapOpen = !overlay.classList.contains('open');
    overlay.classList.toggle('open', mapOpen);
    fab.innerHTML = mapOpen ? '<span class="ic" data-ic="close"></span>' : '<span class="ic" data-ic="map"></span>';
    btn.innerHTML = mapOpen ? '<span class="ic" data-ic="close"></span> Close' : '<span class="ic" data-ic="map"></span> Map';
    document.body.style.overflow = mapOpen ? 'hidden' : '';
    if (mapOpen && typeof MapView !== 'undefined') {
      setTimeout(() => {
        const map = MapView.getMap();
        if (map) map.invalidateSize();
      }, 100);
    }
  }

  function setupStatusBar() {
    const statusContent = document.getElementById('status-content');
    if (!statusContent) return;
    statusContent.addEventListener('click', e => {
      const hdr = e.target.closest('.status-accordion-header');
      if (hdr) {
        const target = document.getElementById(hdr.dataset.target);
        if (target) {
          const expanded = target.classList.toggle('expanded');
          hdr.querySelector('.accordion-arrow').textContent = expanded ? '▼' : '▶';
          if (expanded && hdr.dataset.target === 'status-buses') {
            setTimeout(() => target.querySelector('.bus-search')?.focus(), 100);
          }
        }
      }
    });
    statusContent.addEventListener('input', e => {
      if (!e.target.classList.contains('bus-search')) return;
      const q = e.target.value.toLowerCase().trim();
      const container = e.target.closest('.status-accordion-body');
      const results = container.querySelector('.bus-results');
      if (!results) return;
      const hint = results.querySelector('.bus-hint');
      if (hint) hint.remove();
      const lines = results.querySelectorAll('.status-line');
      const reasons = results.querySelectorAll('.status-reason');
      if (!q) { lines.forEach(l => l.classList.remove('visible')); reasons.forEach(r => r.classList.remove('visible')); return; }
      let count = 0;
      const busRegex = new RegExp('(^|\\D)' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)', 'i');
      lines.forEach(l => {
        const match = l.dataset.bus && busRegex.test(l.dataset.bus);
        l.classList.toggle('visible', match);
        if (match) count++;
      });
      reasons.forEach(r => r.classList.toggle('visible', r.dataset.bus && busRegex.test(r.dataset.bus)));
      if (!count) {
        const d = document.createElement('div');
        d.className = 'bus-hint';
        d.textContent = 'No routes found';
        results.appendChild(d);
      }
    });
  }

  async function loadStatus() {
    try {
      statusLines = await Status.fetchAll();
      const el = document.getElementById('status-content');
      if (statusLines && statusLines.length) {
        el.innerHTML = Status.render(statusLines);
        const overall = Status.getOverall(statusLines);
        const el2 = document.getElementById('status-indicator');
        if (el2) {
          el2.className = 'status-indicator ' + overall.cls;
          el2.textContent = '● ' + overall.text;
        }
        const disruptions = await Status.fetchDisruptions();
        if (disruptions && disruptions.length) {
          el.innerHTML += Status.renderDisruptions(disruptions);
        }
      }
    } catch {}
  }

  function swapLocations() {
    const from = UI.getFromInput(), to = UI.getToInput();
    [from.value, to.value] = [to.value, from.value];
    [UI._fromValue, UI._toValue] = [UI._toValue, UI._fromValue];
  }

  function clearAll() {
    UI.getFromInput().value = ''; UI.getToInput().value = '';
    UI._fromValue = null; UI._toValue = null;
    document.dispatchEvent(new Event('clear-all'));
  }

  UI.swapLocations = swapLocations;
  UI.clearAll = clearAll;
  UI._getStatusLines = function() { return statusLines; };
  UI.loadStatus = loadStatus;
  UI.getTimeOpts = function() {
    const active = document.querySelector('.time-btn.active');
    const mode = active ? active.dataset.mode : 'now';
    return { timeMode: mode, time: document.getElementById('time-picker').value, date: document.getElementById('date-picker').value };
  };
  UI.getActiveModes = function() {
    return Array.from(document.querySelectorAll('.mode-btn.active')).map(b => b.dataset.mode);
  };

  window.UI = UI;
})();
