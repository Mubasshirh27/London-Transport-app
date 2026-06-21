const OfflineManager = (() => {
  let _online = true;
  let _listeners = new Set();
  let _checkTimer = null;
  let _lastCheck = 0;
  let _pendingRequests = [];
  let _pendingRequestKeys = new Set();
  let _isRetrying = false;
  let _checkRunning = false;
  let _processingGeneration = 0;
  let _syncCallbacks = new Set();
  let _cache = new Map();
  let _notifyError = null;
  const _MAX_PENDING = 50;
  const _CACHE_LOCAL_KEY = 'lt_cache_v1';
  const _CACHE_MAX_ENTRIES = 10;
  const _PENDING_META_KEY = 'lt_pending_meta_v1';
  let _requestReplayer = null;

  const CHECK_INTERVAL = 15000;
  const REAL_PING_URL = (typeof CONFIG !== 'undefined' && CONFIG.tflApiBase ? CONFIG.tflApiBase : 'https://api.tfl.gov.uk') + '/Line/Mode/tube/Status?app_key=' + (typeof CONFIG !== 'undefined' && CONFIG.tflApiKey ? CONFIG.tflApiKey : '');
  const RETRY_DELAYS = [2000, 5000, 15000, 30000, 60000];

  async function _realConnectivityCheck() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(REAL_PING_URL, { 
        method: 'GET', 
        cache: 'no-cache',
        signal: controller.signal 
      });
      clearTimeout(timeout);
      return res.ok || res.status === 304;
    } catch {
      return false;
    }
  }

  async function _updateOnlineStatus() {
    if (_checkRunning) return _online;
    _checkRunning = true;
    try {
      const wasOnline = _online;
      const browserOnline = navigator.onLine;
      if (!browserOnline) {
        _online = false;
      } else {
        _online = await _realConnectivityCheck();
      }

      if (wasOnline !== _online) {
        _notifyListeners(_online);
        if (_online) {
          _processingGeneration++;
          _processPendingQueue();
          _runSyncCallbacks();
        } else {
          _persistTripState();
        }
      }
      _lastCheck = Date.now();
      return _online;
    } finally {
      _checkRunning = false;
    }
  }

  function _persistTripState() {
    try {
      const tripData = window.__tripStateSnapshot || {};
      if (tripData.journey && tripData.journey.legs) {
        localStorage.setItem('lt_trip_offline_backup', JSON.stringify({
          ...tripData,
          _savedAt: Date.now()
        }));
      }
    } catch {}
  }

  function _restoreTripState() {
    try {
      const data = localStorage.getItem('lt_trip_offline_backup');
      if (data) {
        const parsed = JSON.parse(data);
        // Only restore if backup is recent (< 2 hours)
        if (Date.now() - (parsed._savedAt || 0) < 2 * 3600 * 1000) {
          localStorage.removeItem('lt_trip_offline_backup');
          return parsed;
        }
      }
    } catch {}
    return null;
  }

  function _notifyListeners(online) {
    _listeners.forEach(cb => {
      try { cb(online); } catch {}
    });
    window.dispatchEvent(new CustomEvent('connectivity-change', { 
      detail: { online, timestamp: Date.now() } 
    }));
  }

  function _scheduleCheck() {
    if (_checkTimer) clearTimeout(_checkTimer);
    _checkTimer = setTimeout(async () => {
      await _updateOnlineStatus();
      _scheduleCheck();
    }, CHECK_INTERVAL);
  }

  function _loadPendingMetadata() {
    try {
      const saved = localStorage.getItem(_PENDING_META_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }

  function _savePendingMetadata(list) {
    try { localStorage.setItem(_PENDING_META_KEY, JSON.stringify(list)); } catch {}
  }

  function _removePendingMetadata(meta) {
    const list = _loadPendingMetadata();
    const idx = list.findIndex(m => m.endpoint === meta.endpoint && JSON.stringify(m.params) === JSON.stringify(meta.params));
    if (idx >= 0) {
      list.splice(idx, 1);
      _savePendingMetadata(list);
    }
  }

  function savePendingRequest(meta) {
    if (!meta || !meta.endpoint) return;
    const list = _loadPendingMetadata();
    // Avoid duplicates
    if (list.some(m => m.endpoint === meta.endpoint && JSON.stringify(m.params) === JSON.stringify(meta.params))) return;
    list.push({ ...meta, _savedAt: Date.now() });
    _savePendingMetadata(list);
  }

  function setRequestReplayer(fn) {
    _requestReplayer = fn;
  }

  function _replayPendingRequests() {
    const list = _loadPendingMetadata();
    if (!list.length || !_requestReplayer) return;
    _savePendingMetadata([]); // Clear after loading
    list.forEach(meta => {
      const fn = () => _requestReplayer(meta);
      const entry = { fn, resolve: () => {}, reject: () => {}, attempt: 0, queuedAt: Date.now() };
      _pendingRequests.push(entry);
    });
    if (_online) _processPendingQueue();
  }

  function _findReqIndex(req) {
    for (let i = 0; i < _pendingRequests.length; i++) {
      if (_pendingRequests[i] === req) return i;
    }
    return -1;
  }

  function _processPendingQueue() {
    if (_isRetrying || _pendingRequests.length === 0) return;
    _isRetrying = true;
    const gen = _processingGeneration;

    const processOne = async (req) => {
      const { resolve, reject, attempt = 0 } = req;

      if (!_online || gen !== _processingGeneration) {
        _isRetrying = false;
        return;
      }

      try {
        const result = await req.fn();
        resolve(result);
        if (req.retryTimer) { clearTimeout(req.retryTimer); req.retryTimer = null; }
        const idx = _findReqIndex(req);
        if (idx >= 0) {
          _pendingRequests.splice(idx, 1);
          if (req._reqKey) _pendingRequestKeys.delete(req._reqKey);
        }
        scheduleNext();
      } catch (e) {
        if (attempt < RETRY_DELAYS.length - 1) {
          req.attempt = attempt + 1;
          req.retryTimer = setTimeout(() => processOne(req), RETRY_DELAYS[attempt]);
        } else {
          if (req.retryTimer) { clearTimeout(req.retryTimer); req.retryTimer = null; }
          const idx = _findReqIndex(req);
          if (idx >= 0) {
            _pendingRequests.splice(idx, 1);
            if (req._reqKey) _pendingRequestKeys.delete(req._reqKey);
          }
          reject(e);
          if (_notifyError) _notifyError('Request failed after retries: ' + (e && e.message ? e.message : 'Unknown error'));
          scheduleNext();
        }
      }
    };

    function scheduleNext() {
      if (_pendingRequests.length === 0 || gen !== _processingGeneration) {
        _isRetrying = false;
        return;
      }
      processOne(_pendingRequests[0]);
    }

    scheduleNext();
  }

  function _runSyncCallbacks() {
    _syncCallbacks.forEach(cb => {
      try { cb(); } catch {}
    });
  }

  function _makeReqKey(fn) {
    if (typeof fn._metaKey === 'string') return fn._metaKey;
    return null;
  }

  function queueRequest(fn, metaKey) {
    if (metaKey) {
      fn._metaKey = metaKey;
      if (_pendingRequestKeys.has(metaKey)) {
        return Promise.reject(new Error('Request already queued'));
      }
      if (_pendingRequestKeys.size >= _MAX_PENDING) {
        return Promise.reject(new Error('Too many pending requests'));
      }
    }
    return new Promise((resolve, reject) => {
      const req = { fn, resolve, reject, attempt: 0, queuedAt: Date.now(), _reqKey: metaKey || null };
      _pendingRequests.push(req);
      if (metaKey) _pendingRequestKeys.add(metaKey);
      if (_online) _processPendingQueue();
    });
  }

  function setErrorHandler(fn) {
    _notifyError = fn;
  }

  function onConnectivityChange(cb) {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  }

  function onSync(cb) {
    _syncCallbacks.add(cb);
    return () => _syncCallbacks.delete(cb);
  }

  function _persistCache() {
    try {
      const obj = {};
      _cache.forEach((entry, key) => { obj[key] = entry; });
      localStorage.setItem(_CACHE_LOCAL_KEY, JSON.stringify(obj));
    } catch {}
  }

  function _loadCache() {
    try {
      const saved = localStorage.getItem(_CACHE_LOCAL_KEY);
      if (!saved) return;
      const obj = JSON.parse(saved);
      const now = Date.now();
      Object.entries(obj).forEach(([key, entry]) => {
        if (now - entry.timestamp < 3600000) {
          _cache.set(key, entry);
        }
      });
    } catch {}
  }

  function cacheResponse(key, data) {
    _cache.set(key, { data, timestamp: Date.now() });
    // Evict oldest if over limit
    if (_cache.size > _CACHE_MAX_ENTRIES) {
      const oldest = _cache.keys().next().value;
      if (oldest) _cache.delete(oldest);
    }
    _persistCache();
  }

  function getCachedResponse(key, maxAge = 3600000) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > maxAge) {
      _cache.delete(key);
      _persistCache();
      return null;
    }
    return entry.data;
  }

  function isOnline() { return _online; }

  function getPendingCount() { return _pendingRequests.length; }

  function forceCheck() { return _updateOnlineStatus(); }

  function init() {
    _loadCache();
    _updateOnlineStatus();
    _replayPendingRequests();
    _scheduleCheck();
    window.addEventListener('online', () => _updateOnlineStatus());
    window.addEventListener('offline', () => _updateOnlineStatus());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _updateOnlineStatus();
    });
  }

  return { init, isOnline, onConnectivityChange, onSync, queueRequest, forceCheck, getPendingCount, cacheResponse, getCachedResponse, restoreTripState: _restoreTripState, savePendingRequest, setRequestReplayer, setErrorHandler };
})();

if (typeof module !== 'undefined') module.exports = OfflineManager;