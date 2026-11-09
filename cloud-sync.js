/**
 * Bine Zdravje — Sinhronizacija podatkov v oblak (CloudSync)
 *
 * Prestreže localStorage.setItem in z zamikom 4 s spremembe samodejno
 * pošilja na /api/shramba na VPS. Ob zagonu preveri stanje v oblaku in
 * po potrebi obnovi manjkajoče ali starejše podatke (npr. ob menjavi telefona).
 *
 * Zasebni žeton se pridobi enako kot v danes-podatki.js (URL ?dnevno=... ali
 * ključ 'bine_zdravje_dnevno_token'). Brez žetona deluje tiho.
 */
(function () {
  'use strict';

  const LS_TOKEN = 'bine_zdravje_dnevno_token';
  const LS_META = 'bine_cloudsync_meta_v1';

  let originalSetItem = null;
  let customEndpoints = null;
  const pendingKeys = new Set();
  let debounceTimer = null;
  let isSyncing = false;
  let lastSyncTime = null;
  let lastError = null;

  function getStorage() {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof global !== 'undefined' && global.localStorage) return global.localStorage;
    return null;
  }

  function shouldSyncKey(key) {
    if (!key || typeof key !== 'string') return false;
    if (!key.startsWith('bine_')) return false;
    const lower = key.toLowerCase();
    if (lower.includes('token')) return false;
    if (lower.includes('endpoint')) return false;
    if (lower.includes('cache')) return false;
    if (key === LS_META || lower.includes('cloudsync')) return false;
    return true;
  }

  function rawSetItem(key, value) {
    if (originalSetItem) {
      originalSetItem(key, String(value));
    } else {
      const s = getStorage();
      if (s) s.setItem(key, String(value));
    }
  }

  function loadMeta() {
    const storage = getStorage();
    if (!storage) return {};
    try {
      const raw = storage.getItem(LS_META);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveMeta(meta) {
    try {
      rawSetItem(LS_META, JSON.stringify(meta));
    } catch (e) {
      /* poln localStorage */
    }
  }

  function getToken() {
    const storage = getStorage();
    if (!storage) return '';
    try {
      if (typeof location !== 'undefined' && location.search) {
        const u = new URL(location.href);
        const t = u.searchParams.get('dnevno');
        if (t) {
          rawSetItem(LS_TOKEN, t.trim());
          u.searchParams.delete('dnevno');
          if (typeof history !== 'undefined' && history.replaceState) {
            history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
          }
        }
      }
    } catch (e) {
      /* ignoriraj napake URL razčlenjevanja */
    }
    try {
      return (storage.getItem(LS_TOKEN) || '').trim();
    } catch (e) {
      return '';
    }
  }

  async function endpoints() {
    if (customEndpoints && customEndpoints.length) return customEndpoints;
    const list = [];
    try {
      const r = await fetch('./food-vision-endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.url) list.push(j.url);
      }
    } catch (e) {
      /* ignoriraj */
    }
    try {
      if (typeof location !== 'undefined' && location.protocol !== 'https:') {
        list.push('http://100.101.68.31:8091');
      }
    } catch (e) {
      /* ignoriraj */
    }
    return [...new Set(list.map((u) => u.replace(/\/$/, '')))];
  }

  function getAllStorageKeys() {
    const storage = getStorage();
    if (!storage) return [];
    const keys = [];
    if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k) keys.push(k);
      }
    } else {
      for (const k of Object.keys(storage)) {
        if (typeof storage[k] !== 'function') keys.push(k);
      }
    }
    return keys;
  }

  function handleKeyChange(key) {
    const meta = loadMeta();
    meta[key] = new Date().toISOString();
    saveMeta(meta);
    pendingKeys.add(key);
    updateIndicator();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushPending();
    }, 4000);
  }

  async function sendOneKey(ep, token, key, value, isoTime) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
    try {
      const r = await fetch(ep + '/api/shramba', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dnevno-Token': token
        },
        body: JSON.stringify({
          kljuc: key,
          vrednost: value,
          posodobljeno: isoTime
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      return r;
    } catch (e) {
      if (timer) clearTimeout(timer);
      throw e;
    }
  }

  async function uploadKey(key, value, isoTime) {
    const tok = getToken();
    if (!tok) return false;
    const eps = await endpoints();
    if (!eps || !eps.length) {
      lastError = 'no-endpoint';
      return false;
    }
    let ok = false;
    let lastErr = null;
    for (const ep of eps) {
      try {
        const res = await sendOneKey(ep, tok, key, value, isoTime);
        if (res.ok) {
          ok = true;
          break;
        } else if (res.status === 401) {
          lastErr = 'bad-token';
          break;
        } else {
          lastErr = 'HTTP ' + res.status;
        }
      } catch (e) {
        lastErr = e && e.name === 'AbortError' ? 'timeout' : 'offline';
      }
    }
    if (ok) {
      lastError = null;
      return true;
    } else {
      lastError = lastErr;
      return false;
    }
  }

  async function flushPending() {
    if (isSyncing) return;
    const tok = getToken();
    if (!tok) return; // Brez žetona ne dela nič (tiho)
    if (pendingKeys.size === 0) return;

    isSyncing = true;
    updateIndicator();
    try {
      const storage = getStorage();
      if (!storage) return;
      const meta = loadMeta();
      const keysToSync = Array.from(pendingKeys);
      for (const key of keysToSync) {
        const val = storage.getItem(key);
        if (val === null) {
          pendingKeys.delete(key);
          continue;
        }
        const iso = meta[key] || new Date().toISOString();
        const success = await uploadKey(key, val, iso);
        if (success) {
          pendingKeys.delete(key);
          lastSyncTime = new Date().toISOString();
          lastError = null;
        } else {
          // Napaka pri pošiljanju (npr. brez povezave) — poskusi znova naslednjič
          break;
        }
      }
    } finally {
      isSyncing = false;
      updateIndicator();
    }
  }

  async function restoreFromCloud() {
    const tok = getToken();
    if (!tok) return { ok: false, reason: 'no-token' }; // tiho
    const eps = await endpoints();
    if (!eps.length) {
      lastError = 'no-endpoint';
      return { ok: false, reason: 'no-endpoint' };
    }

    let cloudData = null;
    let lastErr = null;
    for (const ep of eps) {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
        const res = await fetch(ep + '/api/shramba', {
          headers: { 'X-Dnevno-Token': tok },
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (res.status === 401) {
          lastError = 'bad-token';
          return { ok: false, reason: 'bad-token' };
        }
        if (!res.ok) {
          lastErr = 'HTTP ' + res.status;
          continue;
        }
        cloudData = await res.json();
        break;
      } catch (e) {
        lastErr = e && e.name === 'AbortError' ? 'timeout' : 'offline';
      }
    }

    if (!cloudData) {
      lastError = lastErr;
      return { ok: false, reason: lastErr };
    }

    lastError = null;
    const storage = getStorage();
    if (!storage) return { ok: true, restored: 0 };
    const meta = loadMeta();
    let metaChanged = false;
    let restored = 0;

    // 1. Obdelaj ključe iz oblaka
    for (const [key, item] of Object.entries(cloudData)) {
      if (!shouldSyncKey(key)) continue;
      if (!item || typeof item !== 'object') continue;
      const remoteVal = item.vrednost;
      const remoteIso = item.posodobljeno;
      const remoteTime = remoteIso ? new Date(remoteIso).getTime() : 0;

      const localVal = storage.getItem(key);
      const isLocalEmpty = localVal === null || localVal === undefined || localVal === '';
      const localIso = meta[key];
      const localTime = localIso ? new Date(localIso).getTime() : 0;

      if (isLocalEmpty) {
        // Lokalno prazen -> obnovi iz oblaka
        if (remoteVal !== null && remoteVal !== undefined) {
          rawSetItem(key, remoteVal);
          meta[key] = remoteIso || new Date().toISOString();
          metaChanged = true;
          restored++;
        }
      } else if (localTime > 0 && remoteTime > localTime) {
        // Lokalni obstaja, ampak je starejši -> obnovi iz oblaka
        if (remoteVal !== null && remoteVal !== undefined) {
          rawSetItem(key, remoteVal);
          meta[key] = remoteIso;
          metaChanged = true;
          restored++;
        }
      } else if (localTime > 0 && localTime > remoteTime) {
        // Lokalni je NOVEJŠI -> nikoli ne prepiši z starejšim iz oblaka!
        pendingKeys.add(key);
      }
    }

    // 2. Preveri še lokalne ključe, ki jih v oblaku morda še ni
    const allKeys = getAllStorageKeys();
    for (const k of allKeys) {
      if (shouldSyncKey(k) && !cloudData[k]) {
        if (!meta[k]) {
          meta[k] = new Date().toISOString();
          metaChanged = true;
        }
        pendingKeys.add(k);
      }
    }

    if (metaChanged) {
      saveMeta(meta);
    }
    lastSyncTime = new Date().toISOString();
    if (pendingKeys.size > 0 && !debounceTimer) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushPending();
      }, 4000);
    }
    updateIndicator();
    return { ok: true, restored };
  }

  function hookLocalStorage(targetStorage) {
    const storage = targetStorage || getStorage();
    if (!storage) return;
    if (storage._cloudSyncHooked && storage.setItem === storage._cloudSyncWrapper) return;
    const orig = storage.setItem.bind(storage);
    originalSetItem = orig;
    const wrapper = function (key, value) {
      orig(key, String(value));
      try {
        if (key === LS_TOKEN) {
          restoreFromCloud().catch(() => {});
        } else if (shouldSyncKey(key)) {
          handleKeyChange(key);
        }
      } catch (err) {
        /* ignoriraj */
      }
    };
    storage.setItem = wrapper;
    storage._cloudSyncHooked = true;
    storage._cloudSyncWrapper = wrapper;
  }

  function status() {
    return {
      zadnja: lastSyncTime,
      napaka: lastError,
      cakajoci: pendingKeys.size
    };
  }

  function updateIndicator() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('cloudSyncStatus') || document.getElementById('cloudSyncPill');
    const icon = document.getElementById('cloudSyncIcon');
    if (!el && !icon) return;
    const s = status();
    let iconText = '☁️';
    let title = 'Sinhronizacija v oblak';
    if (s.cakajoci > 0) {
      iconText = '☁️⏳';
      title = `Sinhronizacija poteka (${s.cakajoci} v vrsti)`;
    } else if (s.napaka) {
      iconText = '☁️⚠️';
      title = `Napaka shrambe: ${s.napaka}`;
    } else if (s.zadnja) {
      iconText = '☁️✓';
      try {
        title = `Sinhronizirano: ${new Date(s.zadnja).toLocaleTimeString('sl-SI')}`;
      } catch (e) {
        title = `Sinhronizirano: ${s.zadnja}`;
      }
    }
    if (icon) icon.textContent = iconText;
    else if (el) el.textContent = iconText;
    if (el) el.setAttribute('title', title);
  }

  const CloudSync = {
    status,
    syncNow: flushPending,
    restore: restoreFromCloud,
    setEndpoints: (eps) => { customEndpoints = eps; },
    setOriginalSetItem: (fn) => { originalSetItem = fn; },
    init: (st) => {
      hookLocalStorage(st);
      return restoreFromCloud();
    },
    shouldSyncKey,
    _getPendingKeys: () => Array.from(pendingKeys),
    _clearPending: () => { pendingKeys.clear(); if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } }
  };

  // Samodejni zagon v brskalniku
  if (typeof window !== 'undefined') {
    window.CloudSync = CloudSync;
    hookLocalStorage();
    if (getToken()) {
      setTimeout(() => {
        restoreFromCloud().catch(() => {});
      }, 500);
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        if (pendingKeys.size > 0) flushPending();
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CloudSync;
  }
})();
