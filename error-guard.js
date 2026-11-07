/*
 * Globalni nadzor napak: window.onerror + unhandledrejection -> prijazen toast (največ 1 na 10 s).
 * Zadnjih 20 napak v localStorage 'bine_zdravje_errors_v1' (brez osebnih podatkov, sporočilo skrajšano).
 */
(function (root) {
  'use strict';

  var KEY = 'bine_zdravje_errors_v1';
  var MAX = 20;
  var TOAST_GAP_MS = 10000;
  var MSG = 'Nekaj je šlo narobe. Podatki so varni; poskusi znova.';
  var lastToast = 0;
  var toastEl = null, hideTimer = null;

  function safeGet() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function record(kind, msg, src) {
    try {
      var list = safeGet();
      list.push({
        t: new Date().toISOString(),
        kind: kind,
        msg: String(msg || '').replace(/[\r\n]+/g, ' ').slice(0, 200),
        src: String(src || '').replace(/^.*\//, '').slice(0, 80),
        path: (location.pathname || '').slice(0, 120)
      });
      localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    } catch (e) { /* polna shramba ali zasebni način: ignoriramo */ }
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.id = 'errorGuardToast';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.style.cssText = [
      'position: fixed', 'left: 12px', 'right: 12px',
      'bottom: calc(12px + env(safe-area-inset-bottom, 0px))', 'z-index: 20000',
      'max-width: 480px', 'margin: 0 auto', 'padding: 12px 14px', 'border-radius: 12px',
      'background: #14171A', 'color: #F4F5F6', 'border: 1px solid rgba(255,61,0,0.45)',
      'font: 600 0.9rem/1.35 system-ui, sans-serif', 'box-shadow: 0 8px 24px rgba(0,0,0,0.5)',
      'display: none', 'overflow-wrap: anywhere'
    ].join(';');
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function toast() {
    var now = Date.now();
    if (now - lastToast < TOAST_GAP_MS) return;
    lastToast = now;
    var t = ensureToast();
    t.textContent = MSG;
    t.style.display = 'block';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { t.style.display = 'none'; }, 6000);
  }

  function handle(kind, msg, src) {
    record(kind, msg, src);
    if (document.body) toast();
  }

  root.addEventListener('error', function (e) {
    // Napake virov (img/script brez onerror) niso JS napake: ignoriramo.
    if (!e || !e.message) return;
    handle('error', e.message, e.filename);
  });
  root.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    handle('rejection', (r && r.message) || String(r || 'unhandled rejection'), r && r.stack ? String(r.stack).split('\n')[1] : '');
  });

  root.ErrorGuard = { record: record, list: safeGet, KEY: KEY, MAX: MAX, _toast: toast };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ErrorGuard;
})(typeof window !== 'undefined' ? window : globalThis);
