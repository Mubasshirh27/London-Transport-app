const Modes = (() => {
  const iconMap = {
    bus: 'bus',
    tube: 'tube',
    dlr: 'dlr',
    overground: 'overground',
    'elizabeth-line': 'elizabeth',
    'national-rail': 'nationalrail',
    tram: 'tram',
    'cable-car': 'cable_car',
    'river-bus': 'river',
    walking: 'walk',
    cycling: 'bike'
  };

  const colorMap = {
    bus: '#e32017',
    tube: '#0019a8',
    dlr: '#00a94f',
    overground: '#f86c00',
    'elizabeth-line': '#6950a0',
    'national-rail': '#003688',
    tram: '#66cc00',
    'cable-car': '#e21836',
    'river-bus': '#00a4a7',
    walking: '#666666',
    cycling: '#fcbb03'
  };

  function normalize(mode) {
    return mode.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  function getIconName(mode) {
    return iconMap[normalize(mode)] || 'bus';
  }

  function getColor(mode) {
    return colorMap[normalize(mode)] || '#666666';
  }

  function getIconSVG(mode) {
    if (typeof Icon !== 'undefined') {
      return Icon.get(getIconName(mode));
    }
    return '';
  }

  function getIcon(mode) {
    const svg = getIconSVG(mode);
    if (svg) return svg;
    const fallback = {
      bus: '🚌', tube: '🚇', dlr: '🚈', overground: '🚆',
      'elizabeth-line': '🚄', 'national-rail': '🚂', tram: '🚊',
      'cable-car': '🚡', 'river-bus': '⛴️', walking: '🚶', cycling: '🚲'
    };
    return fallback[normalize(mode)] || '➡️';
  }

  return {
    iconMap,
    colorMap,
    getIconName,
    getColor,
    getIconSVG,
    getIcon
  };
})();