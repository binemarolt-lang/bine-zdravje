/*
 * Varnostna kopija podatkov (localStorage bine_* ključi). Brez IndexedDB fotografij in brez žetonov/skrivnosti.
 * Izvoz: navigator.share (datoteka) -> prenos -> kopiranje. Uvoz: validacija formata in verzije, potrditev pred prepisom.
 */
(function (root) {
  'use strict';

  var FORMAT = 'bine-zdravje-backup';
  var VERSION = 1;
  var PREFIX = 'bine_';
  var MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  var EXCLUDE_RE = /token|secret|password|passwd|apikey|api_key|errors_v1/i;
  var BTN_ID = 'backupOpenBtn';

  function isBackupKey(k) {
    return typeof k === 'string' && k.indexOf(PREFIX) === 0 && !EXCLUDE_RE.test(k);
  }

  // Čista funkcija (testabilna): iz objekta {key: value} naredi dokument za izvoz.
  function buildBackup(storage, now) {
    var data = {};
    var keys = [];
    for (var i = 0; i < storage.length; i++) keys.push(storage.key(i));
    keys.sort().forEach(function (k) {
      if (!isBackupKey(k)) return;
      var v = storage.getItem(k);
      if (typeof v === 'string') data[k] = v;
    });
    return {
      format: FORMAT,
      version: VERSION,
      exported_at: new Date(now || Date.now()).toISOString(),
      count: Object.keys(data).length,
      data: data
    };
  }

  // Čista validacija: vrne {ok:true, data} ali {ok:false, error}. Nikoli ne vpiše ničesar.
  function validateBackup(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Datoteka je prazna.' };
    if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'Datoteka je prevelika.' };
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'Datoteka ni veljaven JSON.' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'Neveljavna struktura.' };
    if (obj.format !== FORMAT) return { ok: false, error: 'To ni varnostna kopija Bine Zdravje.' };
    if (typeof obj.version !== 'number' || obj.version > VERSION || obj.version < 1) {
      return { ok: false, error: 'Nepodprta verzija formata (' + obj.version + '). Posodobi aplikacijo.' };
    }
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) return { ok: false, error: 'Manjkajo podatki.' };
    var clean = {};
    var keys = Object.keys(obj.data);
    if (keys.length > 500) return { ok: false, error: 'Preveč ključev.' };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = obj.data[k];
      if (!isBackupKey(k)) return { ok: false, error: 'Neznan ali zaščiten ključ: ' + k.slice(0, 60) };
      if (typeof v !== 'string') return { ok: false, error: 'Vrednost ključa ' + k + ' ni niz.' };
      clean[k] = v;
    }
    if (!keys.length) return { ok: false, error: 'Kopija ne vsebuje podatkov.' };
    return { ok: true, data: clean, count: keys.length, exported_at: obj.exported_at || null };
  }

  // ---------- UI ----------
  var overlay = null, statusEl = null, fileInput = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle('is-error', !!isErr);
    statusEl.hidden = false;
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  function exportAll() {
    var doc = buildBackup(localStorage);
    var text = JSON.stringify(doc, null, 2);
    var name = 'bine-zdravje-kopija-' + stamp() + '.json';
    var file = null;
    try { file = new File([text], name, { type: 'application/json' }); } catch (e) { file = null; }

    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      return navigator.share({ files: [file], title: 'Bine Zdravje – varnostna kopija' })
        .then(function () { setStatus('Kopija (' + doc.count + ' ključev) je pripravljena za deljenje.', false); })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return setStatus('Izvoz preklicano.', false);
          return download(text, name, doc.count);
        });
    }
    return download(text, name, doc.count);
  }

  function download(text, name, count) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      setStatus('Kopija (' + count + ' ključev) prenesena: ' + name, false);
      return Promise.resolve();
    } catch (e) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text)
          .then(function () { setStatus('Prenos ni uspel. Kopija je v odložišču.', false); })
          .catch(function () { setStatus('Izvoz ni uspel.', true); });
      }
      setStatus('Izvoz ni uspel.', true);
      return Promise.resolve();
    }
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setStatus('Datoteka je prevelika.', true);
    var reader = new FileReader();
    reader.onload = function () {
      var v = validateBackup(String(reader.result || ''));
      if (!v.ok) return setStatus(v.error, true);
      var when = v.exported_at ? ' z dne ' + v.exported_at.slice(0, 10) : '';
      var msg = 'Uvozim ' + v.count + ' ključev iz kopije' + when + '. Trenutni podatki za te ključe bodo PREPISANI. Nadaljujem?';
      if (!window.confirm(msg)) return setStatus('Uvoz preklican. Nič ni bilo spremenjeno.', false);
      try {
        Object.keys(v.data).forEach(function (k) { localStorage.setItem(k, v.data[k]); });
      } catch (e) {
        return setStatus('Uvoz ni uspel (shramba je polna). Nič ni bilo dokončno spremenjeno.', true);
      }
      setStatus('Uvoženih ' + v.count + ' ključev. Osveži stran, da se vse prikaže.', false);
    };
    reader.onerror = function () { setStatus('Datoteke ni mogoče prebrati.', true); };
    reader.readAsText(file);
  }

  function openPanel() {
    if (!overlay) return;
    overlay.classList.add('open');
    setStatus('', false);
    statusEl.hidden = true;
  }
  function closePanel() { if (overlay) overlay.classList.remove('open'); }

  function injectStyles() {
    if ($('backupStyles')) return;
    var css = [
      '#backupOpenBtn { min-width: 44px; min-height: 44px; border-radius: 12px; border: 1px solid var(--edge-2, rgba(255,255,255,0.10));',
      '  background: var(--surface-2, #14171A); color: var(--text-1, #F4F5F6); font-size: 0.85rem; font-weight: 700; padding: 0 10px;',
      '  cursor: pointer; font-family: inherit; touch-action: manipulation; }',
      '#backupSheet.assistant-overlay { z-index: 10020; align-items: flex-end; }',
      '#backupSheet .bk-sheet { width: 100%; max-width: 500px; background: var(--surface-1, #0E1012); border-radius: 20px 20px 0 0;',
      '  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; }',
      '#backupSheet .bk-title { font-weight: 800; font-size: 1rem; color: var(--text-1, #F4F5F6); margin-bottom: 6px; }',
      '#backupSheet .bk-help { font-size: 0.85rem; color: var(--text-2, #A1A7B0); line-height: 1.4; margin-bottom: 12px; }',
      '#backupSheet .bk-btn { display: block; width: 100%; min-height: 44px; margin: 8px 0; border-radius: 12px; font-weight: 700;',
      '  font-size: 0.95rem; font-family: inherit; cursor: pointer; touch-action: manipulation; box-sizing: border-box; }',
      '#backupSheet .bk-go { border: none; background: var(--rec-green, #00E676); color: #08090A; }',
      '#backupSheet .bk-alt { border: 1px solid var(--edge-2, rgba(255,255,255,0.10)); background: transparent; color: var(--text-1, #F4F5F6); }',
      '#backupSheet .bk-close { border: none; background: transparent; color: var(--text-2, #A1A7B0); min-height: 44px; width: 100%; font-family: inherit; cursor: pointer; }',
      '#backupSheet .bk-status { font-size: 0.85rem; color: var(--rec-green, #00E676); margin-top: 8px; overflow-wrap: anywhere; }',
      '#backupSheet .bk-status.is-error { color: #FFB4A0; }',
      '#backupSheet input { font-size: 16px; }',
      '@media (min-width: 641px) { #backupSheet.assistant-overlay { align-items: center; } #backupSheet .bk-sheet { border-radius: 20px; } }'
    ].join('\n');
    var st = el('style');
    st.id = 'backupStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildPanel() {
    injectStyles();
    overlay = el('div', 'modal-overlay assistant-overlay');
    overlay.id = 'backupSheet';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Varnostna kopija');
    var sheet = el('div', 'bk-sheet');
    sheet.appendChild(el('div', 'bk-title', 'Varnostna kopija'));
    sheet.appendChild(el('div', 'bk-help',
      'Podatki so shranjeni samo v tem brskalniku. Shrani kopijo v datoteko, da jih ne izgubiš (npr. po čiščenju brskalnika). ' +
      'Fotografije in povezovalni žetoni niso vključeni.'));

    var exp = el('button', 'bk-btn bk-go', 'Izvozi vse podatke');
    exp.type = 'button';
    exp.addEventListener('click', function () { exportAll(); });

    var imp = el('button', 'bk-btn bk-alt', 'Uvozi iz datoteke');
    imp.type = 'button';
    fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    imp.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      importFile(f);
    });

    statusEl = el('div', 'bk-status');
    statusEl.setAttribute('role', 'status');
    statusEl.hidden = true;

    var close = el('button', 'bk-close', 'Zapri');
    close.type = 'button';
    close.addEventListener('click', closePanel);

    sheet.appendChild(exp);
    sheet.appendChild(imp);
    sheet.appendChild(fileInput);
    sheet.appendChild(statusEl);
    sheet.appendChild(close);
    overlay.appendChild(sheet);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePanel(); });
    document.body.appendChild(overlay);
  }

  // Gumb v glavi pomočnikovega panela (če panel obstaja), sicer plavajoč gumb na dnu nastavitev ni potreben.
  function mountButton(tries) {
    if ($(BTN_ID)) return;
    var hdr = document.querySelector('#assistantSheet .as-header');
    if (!hdr) {
      if ((tries || 0) < 40) setTimeout(function () { mountButton((tries || 0) + 1); }, 250);
      return;
    }
    var btn = el('button', null, 'Varnostna kopija');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Varnostna kopija podatkov');
    btn.addEventListener('click', openPanel);
    hdr.insertBefore(btn, hdr.lastElementChild);
  }

  function requestPersistence() {
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(function () { /* brez učinka */ });
      }
    } catch (e) { /* brez učinka */ }
  }

  function boot() {
    requestPersistence();
    buildPanel();
    mountButton(0);
  }

  root.BackupUI = { open: openPanel, close: closePanel, buildBackup: buildBackup, validateBackup: validateBackup, isBackupKey: isBackupKey };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.BackupUI;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
