(function() {
  const UI = window.UI = window.UI || {};

  function showFavoritesDropdown(target) {
    const existing = document.querySelector('.fav-dropdown');
    if (existing) existing.remove();

    const favs = Store.getFavorites();
    const input = target === 'from' ? UI.getFromInput() : UI.getToInput();
    const currentVal = target === 'from' ? UI.getFromValue() : UI.getToValue();
    const inputText = input.value.trim();

    const div = document.createElement('div');
    div.className = 'fav-dropdown';
    let html = '';

    const saveLabel = (currentVal && currentVal.label) ? currentVal.label : (inputText || '');
    if (saveLabel) {
      const saveLat = currentVal ? currentVal.lat : null;
      const saveLon = currentVal ? currentVal.lon : null;
      const isFav = currentVal ? Store.isFavorite(currentVal) : false;
      html += '<div class="fav-dropdown-item save-fav" data-label="' + saveLabel + '" data-lat="' + (saveLat || '') + '" data-lon="' + (saveLon || '') + '"><span>' + (isFav ? '✅' : '➕') + '</span><span class="fav-dd-label">' + (isFav ? 'Remove from saved' : 'Save "' + saveLabel + '"') + '</span></div>';
    }

    if (favs.length) {
      html += favs.map(f =>
        '<div class="fav-dropdown-item" data-target="' + target + '" data-label="' + f.label + '" data-lat="' + f.lat + '" data-lon="' + f.lon + '"><span>⭐</span><span class="fav-dd-label">' + f.label + '</span><button class="fav-dd-remove" data-id="' + f.id + '">✕</button></div>'
      ).join('');
    } else {
      html += '<div class="fav-dropdown-empty">No saved places</div>';
    }

    div.innerHTML = html;
    document.body.appendChild(div);

    const btn = document.querySelector('.fav-btn[data-target="' + target + '"]');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const safeL = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-l')) || 0;
      const safeR = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-r')) || 0;
      const safeT = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0;
      const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0;
      const ddW = Math.min(260, vw - 16 - safeL - safeR);
      let left = Math.max(safeL + 4, rect.left);
      if (left + ddW > vw - safeR - 8) left = vw - ddW - safeR - 8;
      if (left < safeL + 4) left = safeL + 4;
      let top = rect.bottom + 4;
      const estH = 260;
      if (top + estH > vh - safeB && rect.top > estH + safeT) top = rect.top - estH - 4;
      else if (top + estH > vh - safeB) top = vh - estH - safeB - 4;
      div.style.top = Math.max(safeT + 4, top) + 'px';
      div.style.left = left + 'px';
    }

    div.querySelector('.save-fav')?.addEventListener('click', () => {
      const item = div.querySelector('.save-fav');
      const label = item?.dataset.label;
      const lat = item?.dataset.lat ? parseFloat(item.dataset.lat) : null;
      const lon = item?.dataset.lon ? parseFloat(item.dataset.lon) : null;
      if (!label) return;
      document.dispatchEvent(new CustomEvent('star-location', { detail: { label, lat: lat || 51.5, lon: lon || -0.12 } }));
      div.remove();
    });

    div.addEventListener('click', (e) => {
      const item = e.target.closest('.fav-dropdown-item:not(.save-fav)');
      if (!item || e.target.closest('.fav-dd-remove')) return;
      input.value = item.dataset.label;
      (target === 'from' ? UI.setFromValue : UI.setToValue)({ label: item.dataset.label, lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), type: 'fav' });
      div.remove();
    });

    div.querySelectorAll('.fav-dd-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.fav-dropdown-item');
        const label = item?.dataset.label;
        const lat = item?.dataset.lat ? parseFloat(item.dataset.lat) : null;
        const lon = item?.dataset.lon ? parseFloat(item.dataset.lon) : null;
        const updated = Store.getFavorites().filter(f => !(f.label === label && f.lat === lat));
        Store.saveFavorites(updated);
        item.remove();
        if (!div.querySelector('.fav-dropdown-item:not(.save-fav)')) {
          div.innerHTML = '<div class="fav-dropdown-empty">No saved places</div>';
          div.classList.add('just-cleared');
        }
      });
    });

    setTimeout(() => document.addEventListener('click', (e) => { if (!e.target.closest('.fav-dropdown')) div.remove(); }, { once: true }), 0);
  }

  UI.toggleFavorite = function(item) {
    if (Store.isFavorite(item)) { Store.removeFavorite(item); return false; }
    else { Store.addFavorite(item); return true; }
  };

  UI._showFavoritesDropdown = showFavoritesDropdown;

  window.UI = UI;
})();