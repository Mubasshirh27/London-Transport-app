const Geocoder = (() => {
  let searchId = 0;

  function fetchWithTimeout(url, timeout, headers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, { signal: ctrl.signal, headers: headers || {} }).finally(() => clearTimeout(timer));
  }

  async function searchNominatim(query, id) {
    try {
      const q = query.replace(/ /g, '+');
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=20`;
      const res = await fetchWithTimeout(url, 8000, { 'User-Agent': 'LondonTransportApp/1.0' });
      if (!res.ok || id !== searchId) return [];
      const data = await res.json();
      if (id !== searchId) return [];
      if (!Array.isArray(data) || !data.length) return [];
      return data.map(p => {
        const name = (p.display_name || '').split(',')[0];
        const pcMatch = (p.display_name || '').match(/[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}/i);
        return {
          type: 'place',
          label: name + (pcMatch ? ', ' + pcMatch[0] : ''),
          fullLabel: p.display_name || '',
          lat: parseFloat(p.lat),
          lon: parseFloat(p.lon)
        };
      }).filter(r => r.label && !isNaN(r.lat) && !isNaN(r.lon));
    } catch { return []; }
  }

  async function searchPhoton(query, id) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=15`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok || id !== searchId) return [];
      const data = await res.json();
      if (id !== searchId) return [];
      if (!data || !data.features || !data.features.length) return [];
      return data.features.map(f => {
        const props = f.properties || {};
        const coords = f.geometry ? f.geometry.coordinates : null;
        if (!coords || coords.length < 2) return null;
        return {
          type: 'place',
          label: [props.name || props.street, props.postcode].filter(Boolean).join(', '),
          fullLabel: [props.name || props.street, props.city, props.postcode, props.country].filter(Boolean).join(', '),
          lat: coords[1],
          lon: coords[0]
        };
      }).filter(r => r && r.label && !isNaN(r.lat) && !isNaN(r.lon));
    } catch { return []; }
  }

  async function searchTflStops(query, id) {
    try {
      const data = await Api.searchStops(query);
      if (id !== searchId) return [];
      if (!data || !data.matches) return [];
      return data.matches.map(m => ({
        type: 'stop',
        label: m.name,
        fullLabel: `${m.name} (${m.modes ? m.modes.join(', ') : 'stop'})`,
        lat: m.lat,
        lon: m.lon,
        stopId: m.id,
        modes: m.modes || []
      }));
    } catch { return []; }
  }

  const addressCache = JSON.parse(localStorage.getItem('lt_addressCache') || '{}');

  function saveAddressCache() {
    try { localStorage.setItem('lt_addressCache', JSON.stringify(addressCache)); } catch {}
  }

  async function searchUKAddress(query, id) {
    if (!CONFIG.addressApiKey) return [];
    const cacheKey = query.trim().toLowerCase();
    const cached = addressCache[cacheKey];
    if (cached && Array.isArray(cached)) return cached;
    try {
      const q = encodeURIComponent(query.trim());
      const res = await fetchWithTimeout(`https://api.getaddress.io/autocomplete/${q}?api-key=${CONFIG.addressApiKey}&all=true&top=8`, 5000);
      if (!res.ok || id !== searchId) return [];
      const data = await res.json();
      if (id !== searchId) return [];
      if (!data || !data.suggestions || !data.suggestions.length) return [];
      const items = data.suggestions.map(s => {
        const addr = s.address || '';
        const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
        return {
          type: 'place',
          label: parts[0] || addr,
          fullLabel: addr,
          lat: null, lon: null
        };
      }).filter(r => r.label);
      if (!items.length) return [];
      const geocoded = await Promise.allSettled(items.map(async item => {
        try {
          const gUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(item.fullLabel)}&limit=1`;
          const gRes = await fetchWithTimeout(gUrl, 4000);
          if (gRes.ok) {
            const gData = await gRes.json();
            if (gData && gData.features && gData.features.length) {
              const c = gData.features[0].geometry.coordinates;
              item.lat = c[1]; item.lon = c[0];
              return item;
            }
          }
          const pcMatch = item.fullLabel.match(/[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}/i);
          if (pcMatch) {
            const pcRes = await fetchWithTimeout(`https://api.postcodes.io/postcodes/${encodeURIComponent(pcMatch[0].replace(/ /g, ''))}`, 3000);
            if (pcRes.ok) {
              const pcData = await pcRes.json();
              if (pcData && pcData.result) {
                item.lat = pcData.result.latitude; item.lon = pcData.result.longitude;
              }
            }
          }
        } catch {}
        return item;
      }));
      const result = geocoded.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
      addressCache[cacheKey] = result;
      saveAddressCache();
      return result;
    } catch { return []; }
  }

  async function searchPostcodes(query, id) {
    try {
      const res = await fetchWithTimeout(`https://api.postcodes.io/postcodes?q=${encodeURIComponent(query.trim())}&limit=5`, 4000);
      if (!res.ok || id !== searchId) return [];
      const data = await res.json();
      if (id !== searchId) return [];
      if (data && Array.isArray(data.result)) {
        return data.result.map(r => ({
          type: 'place',
          label: r.postcode,
          fullLabel: `${r.postcode}, ${r.country || 'UK'}`,
          lat: r.latitude,
          lon: r.longitude
        }));
      }
      return [];
    } catch { return []; }
  }

  async function enrichPostcodes(items) {
    const groups = new Map();
    items.forEach(item => {
      if (item.lat == null || item.lon == null || isNaN(item.lat) || isNaN(item.lon)) return;
      const key = `${item.lat.toFixed(4)},${item.lon.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    await Promise.allSettled([...groups.entries()].map(async ([key, group]) => {
      const [lat, lon] = key.split(',').map(Number);
      try {
        const res = await fetchWithTimeout(`https://api.postcodes.io/postcodes?lon=${lon}&lat=${lat}&limit=1`, 3000);
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.result && data.result.length && data.result[0].postcode) {
          const pc = data.result[0].postcode;
          group.forEach(item => {
            if (!item.label.includes(pc) && !item.fullLabel.includes(pc)) {
              item.label = item.label + ', ' + pc;
              item.fullLabel = item.fullLabel + ', ' + pc;
            }
          });
        }
      } catch {}
    }));
  }

  async function search(query) {
    searchId++;
    const id = searchId;

    const results = await Promise.all([
      searchPostcodes(query, id).catch(() => []),
      searchTflStops(query, id).catch(() => []),
      searchNominatim(query, id).catch(() => []),
      searchPhoton(query, id).catch(() => []),
      searchUKAddress(query, id).catch(() => [])
    ]);

    if (id !== searchId) return [];

    const [postcodes, stops, nominatim, photon, ukAddr] = results;
    console.log('[Geocoder] nominatim='+nominatim.length+' photon='+photon.length+' stops='+stops.length+' postcodes='+postcodes.length+' ukAddr='+ukAddr.length);
    const all = [...ukAddr, ...postcodes, ...stops, ...nominatim, ...photon];

    const seen = new Set();
    let deduped = all.filter(r => {
      if (!r || !r.label) return false;
      if (r.lat != null && r.lon != null && !isNaN(r.lat) && !isNaN(r.lon)) {
        const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    }).slice(0, 25);

    const toEnrich = deduped.filter(r => r.lat != null && r.lon != null && !isNaN(r.lat) && !isNaN(r.lon));
    if (toEnrich.length) {
      await Promise.race([
        enrichPostcodes(toEnrich),
        new Promise(r => setTimeout(r, 2000))
      ]);
    }

    return deduped;
  }

  // Test function — run Geocoder.test("place name") in console
  async function test(query) {
    console.log('=== Geocoder Test for "'+query+'" ===');
    let results = {};
    try { const r = await searchNominatim(query, -1); results.nominatim = r.length + ' results: ' + r.map(x=>x.label).join(', '); } catch(e) { results.nominatim = 'ERROR: '+e.message; }
    try { const r = await searchPhoton(query, -1); results.photon = r.length + ' results: ' + r.map(x=>x.label).join(', '); } catch(e) { results.photon = 'ERROR: '+e.message; }
    try { const r = await searchPostcodes(query, -1); results.postcodes = r.length + ' results: ' + r.map(x=>x.label).join(', '); } catch(e) { results.postcodes = 'ERROR: '+e.message; }
    try { const r = await searchTflStops(query, -1); results.tflStops = r.length + ' results: ' + r.map(x=>x.label).join(', '); } catch(e) { results.tflStops = 'ERROR: '+e.message; }
    console.table(results);
    return results;
  }

  return { search, test };
})();
