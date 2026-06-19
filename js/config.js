const CONFIG = {
  tflApiKey: window.__TFL_API_KEY || (location.search.match(/[?&]apikey=([^&]+)/) || [])[1] || '52d9e0ba4a8e4a15a7b2b5487ac3a55f',
  tflApiBase: 'https://api.tfl.gov.uk',
  mapCenter: [51.5074, -0.1278],
  mapZoom: 13,
  nearbyRadius: 500,
  addressApiKey: '',
  tileProviders: [
    { name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a>', maxZoom: 19 },
    { name: 'Esri World Street', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri', maxZoom: 18 },
    { name: 'CartoDB Positron', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19 }
  ],
  tileProvider3d: [
    { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19 },
    { name: 'Esri World Street', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
    { name: 'CartoDB Positron', url: 'https://tiles.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', maxZoom: 19 }
  ]
};
