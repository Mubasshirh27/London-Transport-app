(function() {
  const UI = window.UI = window.UI || {};

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  UI.showBikePanel = function(points, centerLat, centerLon) {
    const list = document.getElementById('bike-list');
    if (!points || !points.length) {
      list.innerHTML = '<div class="no-data">No bike stations found</div>';
      return;
    }
    const sorted = [...points].map(p => {
      const d = Math.round(haversine(centerLat || 51.5, centerLon || -0.12, p.lat, p.lon));
      return { ...p, dist: d };
    }).sort((a, b) => a.dist - b.dist);

    const totalBikes = sorted.reduce((s, p) => s + p.bikes, 0);

    list.innerHTML = sorted.map(p => {
      const pct = p.docks > 0 ? Math.round((p.bikes / p.docks) * 100) : 0;
      const barColor = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
      const codeHtml = p.id ? '<span class="stop-code">' + p.id.replace('BikePoints_', '') + '</span>' : '';
      return '<div class="stop-item" data-stop-id="' + (p.id || '') + '" data-lat="' + p.lat + '" data-lon="' + p.lon + '"><span class="stop-icon">🚲</span><span class="stop-name">' + p.name + '</span>' + codeHtml + '<span style="font-size:10px;color:#60a5fa;min-width:30px;text-align:right">' + p.dist + 'm</span><span style="font-size:10px;display:flex;align-items:center;gap:2px"><span style="color:' + barColor + ';font-weight:700">' + p.bikes + '</span><span style="color:var(--text2)">/ ' + p.docks + '</span></span></div>';
    }).join('');

    if (!window._bikeRouteLayers) window._bikeRouteLayers = [];
    window._bikeRouteLayers.forEach(l => { try { l.remove(); } catch {} });
    window._bikeRouteLayers = [];

    list.querySelectorAll('.stop-item').forEach(item => {
      item.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('bike-route-to', { detail: { lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon), name: '' } }));
      });
    });
  };

  window.UI = UI;
})();