/*
 * Bine Zdravje — Globalni nadzor in zbiranje napak.
 * Napake se zbirajo v localStorage 'bine_error_log_v1' (zadnjih 50),
 * z gumbom za kopiranje in brez motečih pojavnih oken.
 */
(function (root) {
  'use strict';

  var KEY = 'bine_error_log_v1';
  var OLD_KEY = 'bine_zdravje_errors_v1';
  var MAX = 50;

  function safeGet() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        // Migracija iz starega ključa, če obstaja
        var oldRaw = localStorage.getItem(OLD_KEY);
        if (oldRaw) {
          var oldList = JSON.parse(oldRaw);
          if (Array.isArray(oldList)) {
            localStorage.setItem(KEY, JSON.stringify(oldList.slice(-MAX)));
            return oldList.slice(-MAX);
          }
        }
        return [];
      }
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function record(kind, msg, src) {
    try {
      var list = safeGet();
      list.push({
        t: new Date().toISOString(),
        kind: String(kind || 'error').slice(0, 30),
        msg: String(msg || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
        src: String(src || '').replace(/^.*[\\\/]/, '').slice(0, 100),
        path: (typeof location !== 'undefined' && location.pathname ? location.pathname : '').slice(0, 120)
      });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
      }
      updateButtonBadge();
    } catch (e) {
      // Polna shramba ali zasebni način: ignoriramo
    }
  }

  function getFormattedLog() {
    var list = safeGet();
    if (!list.length) return 'Dnevnik napak je prazen (0 napak).';
    var lines = ['=== BINE ZDRAVJE DNEVNIK NAPAK (zadnjih ' + list.length + ') ==='];
    list.forEach(function (e, idx) {
      lines.push('[' + (idx + 1) + '] ' + (e.t || '') + ' | ' + (e.kind || 'error').toUpperCase());
      lines.push('  Sporočilo: ' + (e.msg || '–'));
      if (e.src) lines.push('  Vir: ' + e.src);
      if (e.path) lines.push('  Pot: ' + e.path);
    });
    return lines.join('\n');
  }

  function copyText(text) {
    var fallback = function () {
      if (typeof document === 'undefined') return false;
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  function copyErrors() {
    var list = safeGet();
    var text = getFormattedLog();
    return copyText(text).then(function (ok) {
      return {
        ok: ok,
        count: list.length,
        text: text,
        msg: ok
          ? (list.length ? 'Kopiranih ' + list.length + ' napak v odložišče.' : 'Dnevnik je prazen (0 napak).')
          : 'Kopiranje ni uspelo.'
      };
    });
  }

  function clearErrors() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(KEY);
      }
      updateButtonBadge();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- Gumb za kopiranje napak v UI ----------

  var BTN_ID = 'errorGuardCopyBtn';

  function updateButtonBadge() {
    if (typeof document === 'undefined') return;
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    var count = safeGet().length;
    btn.textContent = count ? '📋 Napake (' + count + ')' : '📋 Napake';
  }

  function mountCopyButton(tries) {
    if (typeof document === 'undefined') return;
    if (document.getElementById(BTN_ID)) return;

    // Najprej poskusimo vstaviti v glavo pomočnika (#assistantSheet .as-header) poleg varnostne kopije
    var hdr = document.querySelector('#assistantSheet .as-header');
    if (!hdr) {
      if ((tries || 0) < 40) {
        setTimeout(function () { mountCopyButton((tries || 0) + 1); }, 250);
      }
      return;
    }

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Kopiraj dnevnik napak');
    btn.title = 'Kopiraj zbrane napake (bine_error_log_v1)';
    btn.style.cssText = [
      'min-width: 44px', 'min-height: 44px', 'border-radius: 12px',
      'border: 1px solid var(--edge-2, rgba(255,255,255,0.10))',
      'background: var(--surface-2, #14171A)', 'color: var(--text-2, #A1A7B0)',
      'font-size: 0.8rem', 'font-weight: 700', 'padding: 0 10px',
      'cursor: pointer', 'font-family: inherit', 'touch-action: manipulation'
    ].join(';');

    var count = safeGet().length;
    btn.textContent = count ? '📋 Napake (' + count + ')' : '📋 Napake';

    btn.addEventListener('click', function () {
      btn.disabled = true;
      copyErrors().then(function (res) {
        btn.textContent = res.ok ? '✓ Kopirano!' : 'Napaka pri kopiranju';
        setTimeout(function () {
          btn.disabled = false;
          updateButtonBadge();
        }, 2000);
      });
    });

    hdr.insertBefore(btn, hdr.lastElementChild);
  }

  // Poslušalci globalnih napak (brez pojavnih oken)
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('error', function (e) {
      if (!e || !e.message) return;
      record('error', e.message, e.filename);
    });

    root.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      var msg = (r && r.message) || String(r || 'unhandled rejection');
      var src = (r && r.stack) ? String(r.stack).split('\n')[1] : '';
      record('rejection', msg, src);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { mountCopyButton(0); });
    } else {
      mountCopyButton(0);
    }
  }

  var api = {
    record: record,
    list: safeGet,
    copy: copyErrors,
    copyErrors: copyErrors,
    clear: clearErrors,
    getFormattedLog: getFormattedLog,
    mountCopyButton: mountCopyButton,
    KEY: KEY,
    OLD_KEY: OLD_KEY,
    MAX: MAX
  };

  root.ErrorGuard = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));