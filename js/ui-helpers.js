(function() {
  const UI = window.UI = window.UI || {};

  UI.showToast = function(msg, duration) {
    const el = document.createElement('div');
    const sb = getComputedStyle(document.documentElement).getPropertyValue('--safe-b').trim() || '0px';
    el.style.cssText = 'position:fixed;bottom:calc(20px + ' + sb + ');left:50%;transform:translateX(-50%) translateY(12px);background:#1a1a2e;color:#e8e8f0;padding:8px 16px;border-radius:8px;font-size:12px;z-index:9999;border:1px solid var(--accent);box-shadow:0 4px 20px rgba(0,0,0,.5);opacity:0;transition:opacity .2s,transform .25s';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(12px)';
      setTimeout(() => el.remove(), 250);
    }, duration || 2000);
  };

  UI.showLoading = function() {
    document.getElementById('results-panel').innerHTML = '<div class="sk-card"><div class="sk-card-row"><div class="sk sk-circle"></div><div class="sk-card-col"><div class="sk sk-line" style="width:55%"></div><div class="sk sk-line-sm"></div></div><div class="sk sk-line" style="width:50px"></div></div><div class="sk-card-row"><div class="sk sk-line" style="width:80%"></div><div class="sk sk-line" style="width:50px"></div></div></div><div class="sk-card"><div class="sk-card-row"><div class="sk sk-circle"></div><div class="sk-card-col"><div class="sk sk-line" style="width:45%"></div><div class="sk sk-line-sm"></div></div><div class="sk sk-line" style="width:50px"></div></div><div class="sk-card-row"><div class="sk sk-line" style="width:70%"></div><div class="sk sk-line" style="width:50px"></div></div></div><div class="sk-card"><div class="sk-card-row"><div class="sk sk-circle"></div><div class="sk-card-col"><div class="sk sk-line" style="width:60%"></div><div class="sk sk-line-sm"></div></div><div class="sk sk-line" style="width:50px"></div></div><div class="sk-card-row"><div class="sk sk-line" style="width:75%"></div><div class="sk sk-line" style="width:50px"></div></div></div>';
  };

  UI.showError = function(msg) {
    document.getElementById('results-panel').innerHTML = `<div class="error-msg">⚠️ ${msg}</div>`;
    const tl = document.getElementById('trip-timeline');
    const navBar = document.getElementById('trip-nav-bar');
    if (tl && navBar && navBar.style.display !== 'none') {
      const note = document.createElement('div');
      note.className = 'reroute-notification';
      note.textContent = msg;
      tl.insertBefore(note, tl.firstChild);
      setTimeout(() => { if (note.parentNode) note.remove(); }, 5000);
    }
  };

  UI.showRouteLoading = function() {
    document.getElementById('route-results').innerHTML = '<div class="sk-card"><div class="sk-card-row"><div class="sk sk-line" style="width:120px"></div><div class="sk sk-line-sm" style="width:40px;margin-left:auto"></div></div><div class="sk-card-row"><div class="sk sk-line" style="width:90%"></div></div><div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;padding:0 4px">' + Array(8).fill('<div class="sk-card-row"><div class="sk sk-circle" style="width:18px;height:18px"></div><div class="sk sk-line" style="width:40%"></div></div>').join('') + '</div></div>';
  };

  UI.showRouteError = function(msg) {
    document.getElementById('route-results').innerHTML = `<div class="error-msg">⚠️ ${msg}</div>`;
  };

  window.UI = UI;
})();
