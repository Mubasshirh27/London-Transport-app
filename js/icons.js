const Icon = (() => {
  const S = (d, vb = '0 0 20 20') =>
    `<svg viewBox="${vb}" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  const icons = {
    tube: S('<circle cx="10" cy="10" r="8"/><text x="10" y="10" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none" font-size="9" font-weight="700">U</text>'),
    bus: S('<rect x="1.5" y="3" width="17" height="14" rx="2.5"/><rect x="4" y="6.5" width="4" height="2.5" rx="0.5" fill="currentColor" opacity=".3" stroke="none"/><rect x="12" y="6.5" width="4" height="2.5" rx="0.5" fill="currentColor" opacity=".3" stroke="none"/><circle cx="6" cy="15.5" r="2" fill="currentColor" stroke="none"/><circle cx="14" cy="15.5" r="2" fill="currentColor" stroke="none"/>'),
    dlr: S('<rect x="2" y="4" width="16" height="12" rx="2"/><line x1="6" y1="10" x2="14" y2="10"/><line x1="10" y1="6" x2="10" y2="14"/><circle cx="5" cy="15" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.5" fill="currentColor" stroke="none"/>'),
    overground: S('<rect x="2.5" y="4" width="15" height="12" rx="2"/><circle cx="7" cy="10" r="2" fill="currentColor" stroke="none"/><circle cx="13" cy="10" r="2" fill="currentColor" stroke="none"/><line x1="7" y1="10" x2="13" y2="10"/>'),
    elizabeth: S('<rect x="2" y="4" width="16" height="12" rx="1.5"/><text x="10" y="10" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none" font-size="8" font-weight="700">EL</text>'),
    walk: S('<circle cx="10" cy="4" r="2" fill="currentColor" stroke="none"/><line x1="10" y1="6" x2="10" y2="12"/><line x1="10" y1="8" x2="6" y2="11"/><line x1="10" y1="8" x2="14" y2="11"/><line x1="10" y1="12" x2="8" y2="17"/><line x1="10" y1="12" x2="12" y2="17"/>'),
    bike: S('<circle cx="6" cy="14" r="3.5"/><circle cx="14" cy="14" r="3.5"/><line x1="6" y1="14" x2="9" y2="7"/><line x1="14" y1="14" x2="11" y2="7"/><line x1="9" y1="7" x2="14" y2="7"/><line x1="11" y1="7" x2="8" y2="3"/><line x1="8" y1="3" x2="5" y2="3"/><circle cx="5" cy="3.5" r="1" fill="currentColor" stroke="none"/>'),
    search: S('<circle cx="9" cy="9" r="5.5"/><line x1="13" y1="13" x2="18" y2="18"/>'),
    clock: S('<circle cx="10" cy="10" r="7.5"/><line x1="10" y1="6" x2="10" y2="10"/><line x1="10" y1="10" x2="13" y2="12"/>'),
    star: S('<path d="M10 1.5l2.5 5.2 5.7.8-4.1 4 1 5.5-5.1-2.7-5.1 2.7 1-5.5-4.1-4 5.7-.8L10 1.5z"/>'),
    pin: S('<path d="M10 2.5c-3.3 0-6 2.7-6 6 0 4.5 6 9 6 9s6-4.5 6-9c0-3.3-2.7-6-6-6z"/><circle cx="10" cy="8.5" r="2.5" fill="currentColor" stroke="none"/>'),
    map: S('<rect x="2.5" y="2.5" width="15" height="15" rx="1.5"/><line x1="2.5" y1="7" x2="17.5" y2="7"/><line x1="10" y1="2.5" x2="10" y2="17.5"/><circle cx="10" cy="12" r="2" fill="currentColor" stroke="none"/>'),
    close: S('<line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>'),
    swap: S('<line x1="3" y1="7" x2="17" y2="7"/><polyline points="13,3 17,7 13,11"/><line x1="17" y1="13" x2="3" y2="13"/><polyline points="7,9 3,13 7,17"/>'),
    refresh: S('<path d="M17 10a7 7 0 01-12.3 4.6M3 10a7 7 0 0112.3-4.6"/><polyline points="15 3 17 10 10 10"/><polyline points="5 17 3 10 10 10"/>'),
    journey: S('<circle cx="4" cy="10" r="2" fill="currentColor" stroke="none"/><line x1="7" y1="10" x2="13" y2="10"/><polyline points="11,7 14,10 11,13"/>'),
    route: S('<path d="M3 16c3-6 5-10 7-4s4 7 7 1" fill="none"/><circle cx="3" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="11" r="1.5" fill="currentColor" stroke="none"/>'),
    status: S('<rect x="3" y="13" width="3" height="4.5" rx="0.5"/><rect x="8.5" y="9.5" width="3" height="8" rx="0.5"/><rect x="14" y="6" width="3" height="11.5" rx="0.5"/>'),
    gps: S('<circle cx="10" cy="10" r="3" fill="currentColor" opacity=".25" stroke="none"/><circle cx="10" cy="10" r="7"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="19"/><line x1="1" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="19" y2="10"/>'),
    nearby: S('<circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><path d="M10 4a6 6 0 016 6"/>'),
    timetable: S('<rect x="3" y="2" width="14" height="16" rx="1.5"/><line x1="3" y1="7" x2="17" y2="7"/><line x1="8" y1="2" x2="8" y2="7"/><line x1="12" y1="2" x2="12" y2="7"/><text x="10" y="13" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none" font-size="6" font-weight="600">12</text><text x="10" y="16" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none" font-size="3" font-weight="600">PM</text>'),
    departures: S('<rect x="3" y="2.5" width="14" height="15" rx="1.5"/><line x1="6" y1="6" x2="14" y2="6"/><line x1="6" y1="10" x2="14" y2="10"/><line x1="6" y1="14" x2="11" y2="14"/>'),
    chevron_down: S('<polyline points="6,8 10,12 14,8"/>'),
    chevron_up: S('<polyline points="14,12 10,8 6,12"/>'),
    arrow_right: S('<line x1="3" y1="10" x2="17" y2="10"/><polyline points="12,5 17,10 12,15"/>'),
    arrow_left: S('<line x1="17" y1="10" x2="3" y2="10"/><polyline points="8,5 3,10 8,15"/>'),
    home: S('<path d="M3 10l7-7 7 7"/><path d="M5 8.5V17h4v-4h4v4h4V8.5"/>'),
    info: S('<circle cx="10" cy="10" r="8"/><line x1="10" y1="9" x2="10" y2="15"/><circle cx="10" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>'),
    warning: S('<path d="M10 2.5L1 17.5h18L10 2.5z"/><line x1="10" y1="8" x2="10" y2="12"/><circle cx="10" cy="14.5" r="0.5" fill="currentColor" stroke="none"/>'),
    check: S('<polyline points="4,11 8.5,15.5 16.5,5.5"/>'),
    minus: S('<line x1="5" y1="10" x2="15" y2="10"/>'),
    plus: S('<line x1="5" y1="10" x2="15" y2="10"/><line x1="10" y1="5" x2="10" y2="15"/>'),
    filter: S('<line x1="3" y1="5" x2="17" y2="5"/><line x1="6" y1="10" x2="14" y2="10"/><line x1="8.5" y1="15" x2="11.5" y2="15"/>'),
    more: S('<circle cx="5" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/>'),
    share: S('<circle cx="6" cy="10" r="3.5"/><circle cx="15" cy="4.5" r="3.5"/><circle cx="15" cy="15.5" r="3.5"/><line x1="9" y1="11.5" x2="12" y2="13.5"/><line x1="9" y1="8.5" x2="12" y2="6.5"/>'),
    walk_bike: S('<line x1="10" y1="3" x2="10" y2="8"/><line x1="10" y1="6" x2="7" y2="9"/><line x1="10" y1="6" x2="13" y2="9"/><circle cx="10" cy="15" r="3"/><line x1="10" y1="10" x2="10" y2="12"/>'),
    accessible: S('<circle cx="10" cy="3.5" r="1.5" fill="currentColor" stroke="none"/><path d="M7.5 6.5h5l-1.5 4h3L12 17h-2l1-4h-3l-1 4H5l1.5-4H6l1-3.5z"/>'),
    night: S('<path d="M17 12.5A7.5 7.5 0 017.5 3a7.5 7.5 0 109.5 9.5z"/>'),
    tram: S('<rect x="2" y="6" width="16" height="8" rx="1.5"/><line x1="6" y1="14" x2="4" y2="18"/><line x1="14" y1="14" x2="16" y2="18"/><rect x="4.5" y="8.5" width="3" height="3" rx="0.3" fill="currentColor" opacity=".3" stroke="none"/><rect x="12.5" y="8.5" width="3" height="3" rx="0.3" fill="currentColor" opacity=".3" stroke="none"/>'),
    train: S('<rect x="2" y="5" width="16" height="10" rx="2"/><rect x="3" y="7" width="3" height="3" rx="0.5" fill="currentColor" opacity=".3" stroke="none"/><rect x="14" y="7" width="3" height="3" rx="0.5" fill="currentColor" opacity=".3" stroke="none"/><rect x="7.5" y="7" width="5" height="3" rx="0.5" fill="currentColor" opacity=".3" stroke="none"/><circle cx="5" cy="16" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1.8" fill="currentColor" stroke="none"/>'),
    cable_car: S('<circle cx="6" cy="15" r="3"/><circle cx="14" cy="15" r="3"/><line x1="6" y1="12" x2="14" y2="12"/><line x1="10" y1="3" x2="10" y2="12"/><line x1="10" y1="3" x2="3" y2="8"/><line x1="10" y1="3" x2="17" y2="8"/>'),
    alert: S('<circle cx="10" cy="10" r="8"/><line x1="10" y1="6" x2="10" y2="11"/><circle cx="10" cy="14" r="0.5" fill="currentColor" stroke="none"/>'),
    arrow_up: S('<polyline points="14,14 10,6 6,14"/>'),
    arrow_down: S('<polyline points="6,6 10,14 14,6"/>'),
    back: S('<line x1="17" y1="10" x2="3" y2="10"/><polyline points="8,5 3,10 8,15"/>'),
    forward: S('<line x1="3" y1="10" x2="17" y2="10"/><polyline points="12,5 17,10 12,15"/>'),
    user: S('<circle cx="10" cy="6" r="3.5"/><path d="M3 18c0-4 3.1-7 7-7s7 3 7 7"/>'),
    fullscreen: S('<path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5"/>'),
  };

  function inject(target) {
    const els = target ? target.querySelectorAll('[data-ic]') : document.querySelectorAll('[data-ic]');
    els.forEach(el => {
      const name = el.dataset.ic;
      if (icons[name]) {
        el.innerHTML = icons[name];
        el.removeAttribute('data-ic');
      }
    });
  }

  let observer = null;

  return {
    get(name) {
      return icons[name] || '';
    },
    html(name, extra = '') {
      return `<span class="ic" data-ic="${name}">${icons[name] || ''}</span>${extra ? ' ' + extra : ''}`;
    },
    txt(name) {
      return icons[name] || '';
    },
    named(name) {
      return `<span class="ic-label">${icons[name] || ''}<span>${name.charAt(0).toUpperCase() + name.slice(1)}</span></span>`;
    },
    inject,
    init() {
      inject();
      if (window.MutationObserver && !observer) {
        observer = new MutationObserver(() => inject());
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }
  };
})();
