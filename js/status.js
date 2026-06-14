const Status = (() => {
  let cached = null;
  let cacheTime = 0;

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function severityCls(desc) {
    const d = (desc || '').toLowerCase();
    if (d.includes('good') || d === 'bus service') return 'good';
    if (d.includes('special') || d.includes('minor') || d.includes('reduced')) return 'minor';
    if (d.includes('severe')) return 'severe';
    if (d.includes('closed') || d.includes('suspended') || d.includes('closure')) return 'closed';
    return 'info';
  }

  let disruptionsCached = null;
  let disruptionsCacheTime = 0;

  async function fetchDisruptions() {
    const now = Date.now();
    if (disruptionsCached && now - disruptionsCacheTime < 120000) return disruptionsCached;
    try {
      const data = await Api.getDisruptions();
      if (!Array.isArray(data)) return disruptionsCached || [];
      disruptionsCached = data.filter(d => d && d.status === 'current');
      disruptionsCacheTime = Date.now();
      return disruptionsCached;
    } catch { return disruptionsCached || []; }
  }

  async function fetchAll() {
    const now = Date.now();
    if (cached && now - cacheTime < 60000) return cached;
    try {
      const data = await Api.fetchTfl('/Line/Mode/tube,dlr,overground,elizabeth-line,national-rail,bus,tram,cable-car/Status');
      if (!Array.isArray(data)) return cached || [];
      cached = data.map(line => {
        const status = line.lineStatuses?.[0];
        const desc = status?.statusSeverityDescription || 'Good Service';
        return {
          id: line.id,
          name: line.name,
          mode: line.modeName,
          color: '#' + (line.lineColours?.primaryColor || '0019a8'),
          statusText: desc,
          statusCls: severityCls(desc),
          reason: status?.reason || '',
          disruption: status?.disruption || null
        };
      });
      cacheTime = Date.now();
      return cached;
    } catch { return cached || []; }
  }

  function getOverall(lines) {
    if (!lines || !lines.length) return { text: 'Checking...', cls: '' };
    const worst = lines.reduce((w, l) => {
      const order = { good: 0, minor: 1, info: 1, severe: 2, closed: 3 };
      return (order[l.statusCls] || 0) > (order[w.statusCls] || 0) ? l : w;
    });
    return { text: worst.statusText, cls: worst.statusCls };
  }

  const MODE_GROUPS = {
    'tube': 'Tube Lines',
    'dlr': 'DLR',
    'overground': 'London Overground',
    'elizabeth-line': 'Elizabeth Line',
    'national-rail': 'National Rail',
    'tram': 'Tram',
    'cable-car': 'Cable Car'
  };

  function renderAccordion(lines, modeFilter) {
    const filtered = lines.filter(l => l.mode === modeFilter);
    if (!filtered.length) return '';
    const worst = getOverall(filtered);
    const id = 's-' + modeFilter.replace(/[^a-z0-9-]/g, '');
    return `
      <div class="status-accordion">
        <div class="status-accordion-header" data-target="${id}">
          <span class="status-bullet ${worst.cls}"></span>
          <span class="status-name">${MODE_GROUPS[modeFilter] || modeFilter}</span>
          <span class="status-text ${worst.cls}">${worst.text}</span>
          <span class="accordion-arrow">▶</span>
        </div>
        <div class="status-accordion-body" id="${id}">
              ${filtered.map(l => `
            <div class="status-line">
              <span class="status-bullet" style="background:${l.color}"></span>
              <span class="status-name">${esc(l.name)}</span>
              <span class="status-text ${l.statusCls}">${esc(l.statusText)}</span>
            </div>
            ${l.reason ? `<div class="status-reason">${esc(l.reason)}</div>` : ''}
          `).join('')}
        </div>
      </div>`;
  }

  function render(lines) {
    if (!lines || !lines.length) return '<div class="no-data">Loading status...</div>';
    const overall = getOverall(lines);
    const busLines = lines.filter(l => l.mode === 'bus');
    const busWorst = getOverall(busLines);
    const trainModes = ['tube','dlr','overground','elizabeth-line','national-rail','tram','cable-car'];
    const trainLines = lines.filter(l => trainModes.includes(l.mode));
    const trainWorst = getOverall(trainLines);

    return `
      <div class="status-overview ${overall.cls}">
        <span class="status-dot ${overall.cls}"></span>
        <span>Network: <strong>${overall.text}</strong></span>
      </div>
      <div class="status-categories">
        <div class="status-accordion">
          <div class="status-accordion-header" data-target="status-trains">
            <span class="status-bullet ${trainWorst.cls}"></span>
            <span class="status-name">Trains</span>
            <span class="status-text ${trainWorst.cls}">${trainWorst.text}</span>
            <span class="accordion-arrow">▶</span>
          </div>
          <div class="status-accordion-body" id="status-trains">
            ${trainModes.map(m => renderAccordion(lines, m)).join('')}
          </div>
        </div>
        <div class="status-accordion">
          <div class="status-accordion-header" data-target="status-buses">
            <span class="status-bullet ${busWorst.cls}"></span>
            <span class="status-name">Buses</span>
            <span class="status-text ${busWorst.cls}">${busWorst.text}</span>
            <span class="accordion-arrow">▶</span>
          </div>
          <div class="status-accordion-body" id="status-buses">
            <input class="bus-search" type="text" placeholder="Search bus route (e.g. 24, N73, SL7)..." />
            <div class="bus-results">
              <div class="bus-hint">Type a bus route number above</div>
              ${busLines.map(l => `
                <div class="status-line" data-bus="${l.name.toLowerCase()}">
                  <span class="status-bullet" style="background:${l.color}"></span>
                  <span class="status-name">${esc(l.name)}</span>
                  <span class="status-text ${l.statusCls}">${esc(l.statusText)}</span>
                </div>
                ${l.reason ? `<div class="status-reason" data-bus="${l.name.toLowerCase()}">${esc(l.reason)}</div>` : ''}
              `).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderDisruptions(disruptions) {
    if (!disruptions || !disruptions.length) return '';
    return `
      <div class="status-accordion disruption-section">
        <div class="status-accordion-header" data-target="disruptions-body">
          <span class="status-bullet closed"></span>
          <span class="status-name">Disruptions</span>
          <span class="status-text">${disruptions.length} active</span>
          <span class="accordion-arrow">▶</span>
        </div>
        <div class="status-accordion-body" id="disruptions-body">
          ${disruptions.map(d => `
            <div class="disruption-item">
              <div class="disruption-header">
                <span class="disruption-type ${(d.category||'').toLowerCase()}">${esc(d.category || 'Alert')}</span>
                <span class="disruption-summary">${esc(d.summary || d.description || '')}</span>
              </div>
              ${d.description ? `<div class="disruption-desc">${esc(d.description)}</div>` : ''}
              ${d.closureText ? `<div class="disruption-closure">${esc(d.closureText)}</div>` : ''}
              ${d.affectedRoutes && d.affectedRoutes.length ? `<div class="disruption-routes">Affected: ${d.affectedRoutes.map(r => esc(r.name)).filter(Boolean).join(', ')}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function getLineStatus(lines, lineId) {
    if (!lines) return null;
    return lines.find(l => l.id === lineId) || null;
  }

  return { fetchAll, fetchDisruptions, getOverall, render, renderDisruptions, getLineStatus };
})();
