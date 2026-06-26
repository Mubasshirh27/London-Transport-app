(function() {
  const UI = window.UI = window.UI || {};
  UI.showRouteStopList = function(stops, routeName, routeId, mode, fromTerminus, toTerminus) {
    const el = document.getElementById('route-results');
    if (!stops || !stops.length) {
      el.innerHTML = '<div class="no-data">No stop data for this route — try a different route number</div>';
      return;
    }
    mode = mode || 'bus';
    const modeIcon = Stops.getModeIcon(mode);
    const modeColor = Stops.getModeColor(mode);
    const isNight = routeName && routeName.toUpperCase().startsWith('N');
    const nightTag = isNight ? '<span class="night-badge">\u{1F319} Night Bus</span>' : '';
    const terminiStr = fromTerminus && toTerminus ? fromTerminus + ' \u2192 ' + toTerminus : '';
    const modeName = mode === 'bus' ? 'Bus' : mode.charAt(0).toUpperCase() + mode.slice(1);

    el.innerHTML = '<div class="route-info-header">'
      + '<span class="route-info-number" style="color:' + modeColor + '">' + modeIcon + ' ' + routeName + '</span>'
      + nightTag
      + '<span class="route-info-stops">' + stops.length + ' stops</span>'
      + '</div>'
      + (terminiStr ? '<div class="route-termini" style="color:' + modeColor + '">' + modeIcon + ' ' + modeName + ' \u00b7 ' + terminiStr + '</div>' : '')
      + '<div class="route-stop-list">'
      + stops.map((s, i) => {
        const sName = Helpers.esc(s.name), sId = Helpers.esc(s.stopId || s.id), sLetter = Helpers.esc(s.stopLetter || '');
        const stopCodeHtml = (s.stopId || s.id) ? '<span class="stop-code">' + sId + '</span>' : '';
        const stopLetterHtml = s.stopLetter ? '<span class="stop-letter">' + sLetter + '</span>' : '';
        return '<div class="route-stop-item" data-stop-id="' + sId + '" data-lat="' + s.lat + '" data-lon="' + s.lon + '" data-stop-name="' + sName + '" data-stop-letter="' + sLetter + '">'
          + '<span class="rs-index">' + (i + 1) + '</span>'
          + '<span class="rs-dot" style="background:' + modeColor + '"></span>'
          + '<span class="rs-name">' + sName + '</span>'
          + stopCodeHtml
          + stopLetterHtml
          + '</div>';
      }).join('')
      + '</div>';
    el.querySelectorAll('.route-stop-item').forEach(item => {
      item.addEventListener('click', () => {
        UI.showDepartures(item.dataset.stopId, item.dataset.stopName, item.dataset.stopLetter || '');
        MapView.flyTo(parseFloat(item.dataset.lat), parseFloat(item.dataset.lon));
      });
    });
  };
  window.UI = UI;
})();