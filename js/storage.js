const Store = (() => {
  const KEYS = {
    favorites: 'lt_favorites',
    recent: 'lt_recent',
    settings: 'lt_settings'
  };

  function get(key) {
    try { return JSON.parse(localStorage.getItem(key)) ?? null; } catch { return null; }
  }
  function set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function getFavorites() { return get(KEYS.favorites) || []; }
  function saveFavorites(favs) { set(KEYS.favorites, favs); }

  function addFavorite(item) {
    const favs = getFavorites();
    if (favs.some(f => f.label === item.label && f.lat === item.lat)) return favs;
    favs.unshift({ id: Date.now(), ...item });
    saveFavorites(favs.slice(0, 20));
    return favs;
  }

  function removeFavorite(item) {
    const favs = getFavorites();
    const filtered = favs.filter(f => !(f.label === item.label && f.lat === item.lat));
    saveFavorites(filtered);
    return filtered;
  }

  function isFavorite(item) {
    return getFavorites().some(f => f.label === item.label && f.lat === item.lat);
  }

  function getRecent() { return get(KEYS.recent) || []; }
  function saveRecent(recents) { set(KEYS.recent, recents); }

  function addRecent(item) {
    const recents = getRecent();
    const filtered = recents.filter(r => !(r.label === item.label && r.lat === item.lat));
    filtered.unshift({ label: item.label, lat: item.lat, lon: item.lon, type: item.type, ts: Date.now() });
    saveRecent(filtered.slice(0, 15));
    return filtered;
  }

  function clearRecent() {
    set(KEYS.recent, []);
    return [];
  }

  function clearFavorites() {
    set(KEYS.favorites, []);
    return [];
  }

  function getSettings() {
    const defaults = { timeMode: 'now', time: '', date: '', modes: [] };
    return { ...defaults, ...(get(KEYS.settings) || {}) };
  }
  function saveSettings(s) { set(KEYS.settings, s); }

  const LINES_KEY = 'lt_savedLines';

  function getSavedLines() { return get(LINES_KEY) || []; }

  function saveSavedLines(lines) { set(LINES_KEY, lines); }

  function toggleSavedLine(line) {
    const lines = getSavedLines();
    const idx = lines.findIndex(l => l.id === line.id);
    if (idx >= 0) { lines.splice(idx, 1); saveSavedLines(lines); return false; }
    lines.unshift({ id: line.id, name: line.name, mode: line.mode, savedAt: Date.now() });
    saveSavedLines(lines.slice(0, 20));
    return true;
  }

  function isLineSaved(lineId) { return getSavedLines().some(l => l.id === lineId); }

  return { getFavorites, saveFavorites, addFavorite, removeFavorite, isFavorite, clearFavorites, getRecent, addRecent, clearRecent, getSettings, saveSettings, getSavedLines, saveSavedLines, toggleSavedLine, isLineSaved };
})();
