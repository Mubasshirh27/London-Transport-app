(function() {
  const UI = window.UI = window.UI || {};

  UI.showToast = function(msg, duration) {
    const el = document.createElement('div');
    const sb = getComputedStyle(document.documentElement).getPropertyValue('--safe-b').trim() || '0px';
    el.style.cssText = 'position:fixed;bottom:calc(20px + ' + sb + ');left:50%;transform:translateX(-50%);background:#1a1a2e;color:#e8e8f0;padding:8px 16px;border-radius:8px;font-size:12px;z-index:9999;border:1px solid var(--accent);box-shadow:0 4px 20px rgba(0,0,0,.5);opacity:0;transition:opacity .2s';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, duration || 2000);
  };

  UI.showLoading = function() {
    document.getElementById('results-panel').innerHTML = '<div class="loading"><div class="spinner"></div><span>Planning your journey...</span></div>';
  };

  UI.showError = function(msg) {
    document.getElementById('results-panel').innerHTML = `<div class="error-msg">⚠️ ${msg}</div>`;
  };

  UI.showRouteLoading = function() {
    document.getElementById('route-results').innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading route...</span></div>';
  };

  UI.showRouteError = function(msg) {
    document.getElementById('route-results').innerHTML = `<div class="error-msg">⚠️ ${msg}</div>`;
  };

  window.UI = UI;
})();
