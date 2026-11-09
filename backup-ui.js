/*
 * Bine Zdravje — Varnostna kopija podatkov (localStorage bine_* ključi).
 *
 * Izvoz: navigator.share (datoteka JSON; optimizirano za iOS Safari) -> prenos -> odložišče.
 * Uvoz: validacija formata in verzije. Uvoz NIKOLI ne prepiše brez izrecne potrditve
 *       in uporabniku natančno pokaže, kaj bo zamenjal.
 */
(function (root) {
  'use strict';

  var FORMAT = 'bine-zdravje-backup';
  var VERSION = 1;
  var PREFIX = 'bine_';
  var MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  var BTN_ID = 'backupOpenBtn';

  function isBackupKey(k) {
    return typeof k === 'string' && k.indexOf(PREFIX) === 0;
  }

  // Čista funkcija: iz objekta shrambe naredi dokument za izvoz
  function buildBackup(storage, now) {
    var data = {};
    var keys = [];
    var len = (storage && typeof storage.length === 'number') ? storage.length : 0;
    for (var i = 0; i < len; i++) {
      var k = (typeof storage.key === 'function') ? storage.key(i) : null;
      if (k) keys.push(k);
    }
    // Podpora tudi za shrambe v testih (navadni objekti ali mocki brez .key)
    if (!keys.length && storage) {
      try {
        var allK = Object.keys(storage);
        for (var j = 0; j < allK.length; j++) {
          var cand = allK[j];
          if (cand !== 'getItem' && cand !== 'setItem' && cand !== 'removeItem' && cand !== 'clear' && cand !== 'key') {
            keys.push(cand);
          }
        }
      } catch (e) {}
    }

    keys.sort().forEach(function (k) {
      if (!isBackupKey(k)) return;
      var v = (storage.getItem && typeof storage.getItem === 'function') ? storage.getItem(k) : storage[k];
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

  // Čista validacija dokumenta
  function validateBackup(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Datoteka je prazna.' };
    if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'Datoteka je prevelika.' };
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'Datoteka ni veljaven JSON.' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'Neveljavna struktura.' };
    if (obj.format !== FORMAT) return { ok: false, error: 'To ni varnostna kopija Bine Zdravje (neveljaven format).' };
    if (typeof obj.version !== 'number' || obj.version > VERSION || obj.version < 1) {
      return { ok: false, error: 'Nepodprta verzija formata (' + obj.version + '). Posodobi aplikacijo.' };
    }
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) return { ok: false, error: 'Manjkajo podatki.' };

    var clean = {};
    var keys = Object.keys(obj.data);
    if (keys.length > 1000) return { ok: false, error: 'Preveč ključev v datoteki.' };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = obj.data[k];
      if (!isBackupKey(k)) return { ok: false, error: 'Neznan ključ (mora se začeti z bine_): ' + String(k).slice(0, 60) };
      if (typeof v !== 'string') return { ok: false, error: 'Vrednost ključa ' + k + ' ni niz.' };
      clean[k] = v;
    }
    if (!keys.length) return { ok: false, error: 'Kopija ne vsebuje podatkov.' };
    return { ok: true, data: clean, count: keys.length, exported_at: obj.exported_at || null };
  }

  /**
   * Čista primerjava med trenutnim stanjem v shrambi in uvoženimi podatki.
   * Vrne seznam zamenjav, novih ključev in nespremenjenih ključev.
   */
  function diffBackup(storage, backupData) {
    var overwrite = [];
    var create = [];
    var identical = [];
    var bKeys = Object.keys(backupData || {}).sort();

    bKeys.forEach(function (k) {
      var cur = (storage && storage.getItem && typeof storage.getItem === 'function')
        ? storage.getItem(k)
        : (storage ? storage[k] : null);

      if (cur !== null && cur !== undefined) {
        if (cur === backupData[k]) {
          identical.push(k);
        } else {
          overwrite.push({
            key: k,
            curLen: cur.length,
            newLen: backupData[k].length
          });
        }
      } else {
        create.push({
          key: k,
          newLen: backupData[k].length
        });
      }
    });

    // Ključi v trenutni shrambi, ki jih ni v kopiji
    var untouched = [];
    var sLen = (storage && typeof storage.length === 'number') ? storage.length : 0;
    for (var i = 0; i < sLen; i++) {
      var sk = storage.key(i);
      if (sk && isBackupKey(sk) && !(sk in backupData)) {
        untouched.push(sk);
      }
    }

    return {
      overwrite: overwrite,
      create: create,
      identical: identical,
      untouched: untouched
    };
  }

  // ---------- UI ----------
  var overlay = null, statusEl = null, fileInput = null, mainActionsEl = null, previewEl = null;

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
    statusEl.hidden = !msg;
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  function exportAll() {
    var doc = buildBackup(localStorage);
    var text = JSON.stringify(doc, null, 2);
    var name = 'bine-zdravje-kopija-' + stamp() + '.json';
    var file = null;
    try {
      file = new File([text], name, { type: 'application/json' });
    } catch (e) {
      file = null;
    }

    // Podpora za iOS Safari prek navigator.share
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      return navigator.share({
        files: [file],
        title: 'Bine Zdravje – varnostna kopija',
        text: 'Varnostna kopija podatkov Bine Zdravje (' + doc.count + ' ključev, ' + stamp() + ')'
      })
        .then(function () {
          setStatus('Kopija (' + doc.count + ' ključev) je bila uspešno deljena.', false);
        })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return setStatus('Izvoz preklican.', false);
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

  function clearPreview() {
    if (previewEl) previewEl.innerHTML = '';
    if (mainActionsEl) mainActionsEl.style.display = 'block';
  }

  /**
   * Prikaz natančnega pregleda pred uvozom in zahteva po potrditvi.
   * Uvoz NIKOLI ne prepiše ničesar brez klika na potrditev.
   */
  function showImportPreview(validatedDoc) {
    if (!previewEl) return;
    var data = validatedDoc.data;
    var diff = diffBackup(localStorage, data);

    mainActionsEl.style.display = 'none';
    previewEl.innerHTML = '';

    var box = el('div', 'bk-preview-box');

    var title = el('div', 'bk-preview-title', '⚠️ Pregled pred uvozom podatkov');
    box.appendChild(title);

    var when = validatedDoc.exported_at ? 'z dne ' + validatedDoc.exported_at.replace('T', ' ').slice(0, 16) : '';
    var meta = el('div', 'bk-preview-meta', 'Kopija vsebuje ' + validatedDoc.count + ' ključev ' + when + '.');
    box.appendChild(meta);

    // 1. Zamenjani ključi
    if (diff.overwrite.length > 0) {
      var owHeader = el('div', 'bk-preview-sect', '🔴 PREPISANI BODO NASLEDNJI OBSTOJEČI KLJUČI (' + diff.overwrite.length + '):');
      box.appendChild(owHeader);
      var owList = el('ul', 'bk-preview-list');
      diff.overwrite.forEach(function (item) {
        var li = el('li', null);
        li.innerHTML = '<strong>' + item.key + '</strong> <span style="color:var(--text-3,#8b9097);font-size:.75rem;">(trenutno ' +
          item.curLen + ' B → novo ' + item.newLen + ' B)</span>';
        owList.appendChild(li);
      });
      box.appendChild(owList);
    } else {
      box.appendChild(el('div', 'bk-preview-ok', '✓ Noben obstoječi ključ ne bo prepisan (ni konfliktov).'));
    }

    // 2. Novi ključi
    if (diff.create.length > 0) {
      var crHeader = el('div', 'bk-preview-sect', '🟢 Dodani bodo novi ključi (' + diff.create.length + '):');
      box.appendChild(crHeader);
      var crList = el('ul', 'bk-preview-list');
      diff.create.forEach(function (item) {
        var li = el('li', null);
        li.innerHTML = '<strong>' + item.key + '</strong> <span style="color:var(--text-3);font-size:.75rem;">(' + item.newLen + ' B)</span>';
        crList.appendChild(li);
      });
      box.appendChild(crList);
    }

    // 3. Nespremenjeni ključi
    if (diff.identical.length > 0) {
      var idText = el('div', 'bk-preview-info', 'ℹ️ ' + diff.identical.length + ' ključev je že identičnih trenutnemu stanju.');
      box.appendChild(idText);
    }

    var warnMsg = el('div', 'bk-preview-warn',
      'OPOZORILO: Prepis podatkov je dokončen in prepiše trenutno stanje v tem brskalniku. Pred uvozom lahko po želji izvoziš trenutno kopijo.');
    box.appendChild(warnMsg);

    // Gumba za potrditev / preklic
    var btnRow = el('div', 'bk-action-row');

    var cancelBtn = el('button', 'bk-btn bk-alt', '❌ Prekliči');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', function () {
      clearPreview();
      setStatus('Uvoz preklican. Nič ni bilo spremenjeno.', false);
    });

    var confirmBtn = el('button', 'bk-btn bk-danger', '⚠️ Potrdi in prepiši (' + validatedDoc.count + ' ključev)');
    confirmBtn.type = 'button';
    confirmBtn.addEventListener('click', function () {
      var confirmMsg = 'Ali res želiš uvoziti kopijo? Zamenjanih bo ' + diff.overwrite.length + ' obstoječih ključev. Nadaljujem?';
      if (!window.confirm(confirmMsg)) {
        setStatus('Uvoz preklican. Nič ni bilo spremenjeno.', false);
        return;
      }

      try {
        Object.keys(data).forEach(function (k) {
          localStorage.setItem(k, data[k]);
        });
        clearPreview();
        setStatus('✓ Uspešno uvoženih ' + validatedDoc.count + ' ključev (zamenjano: ' + diff.overwrite.length + ', dodano: ' + diff.create.length + '). Osveži stran, da se posodobijo vsi zavihki.', false);
      } catch (e) {
        setStatus('Uvoz ni uspel (shramba je polna). Napaka: ' + (e && e.message ? e.message : e), true);
      }
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    box.appendChild(btnRow);

    previewEl.appendChild(box);
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setStatus('Datoteka je prevelika.', true);
    var reader = new FileReader();
    reader.onload = function () {
      var v = validateBackup(String(reader.result || ''));
      if (!v.ok) return setStatus(v.error, true);
      showImportPreview(v);
    };
    reader.onerror = function () { setStatus('Datoteke ni mogoče prebrati.', true); };
    reader.readAsText(file);
  }

  function openPanel() {
    if (!overlay) return;
    clearPreview();
    overlay.classList.add('open');
    setStatus('', false);
  }

  function closePanel() {
    if (overlay) {
      clearPreview();
      overlay.classList.remove('open');
    }
  }

  function injectStyles() {
    if ($('backupStyles')) return;
    var css = [
      '#backupOpenBtn { min-width: 44px; min-height: 44px; border-radius: 12px; border: 1px solid var(--edge-2, rgba(255,255,255,0.10));',
      '  background: var(--surface-2, #14171A); color: var(--text-1, #F4F5F6); font-size: 0.85rem; font-weight: 700; padding: 0 10px;',
      '  cursor: pointer; font-family: inherit; touch-action: manipulation; }',
      '#backupSheet.assistant-overlay { z-index: 10020; align-items: flex-end; }',
      '#backupSheet .bk-sheet { width: 100%; max-width: 500px; max-height: 90dvh; overflow-y: auto; background: var(--surface-1, #0E1012); border-radius: 20px 20px 0 0;',
      '  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; }',
      '#backupSheet .bk-title { font-weight: 800; font-size: 1.05rem; color: var(--text-1, #F4F5F6); margin-bottom: 6px; }',
      '#backupSheet .bk-help { font-size: 0.82rem; color: var(--text-2, #A1A7B0); line-height: 1.4; margin-bottom: 12px; }',
      '#backupSheet .bk-btn { display: block; width: 100%; min-height: 44px; margin: 8px 0; border-radius: 12px; font-weight: 700;',
      '  font-size: 0.92rem; font-family: inherit; cursor: pointer; touch-action: manipulation; box-sizing: border-box; }',
      '#backupSheet .bk-go { border: none; background: var(--rec-green, #00E676); color: #08090A; }',
      '#backupSheet .bk-alt { border: 1px solid var(--edge-2, rgba(255,255,255,0.10)); background: var(--surface-2, #14171A); color: var(--text-1, #F4F5F6); }',
      '#backupSheet .bk-danger { border: none; background: #FF5252; color: #fff; }',
      '#backupSheet .bk-close { border: none; background: transparent; color: var(--text-2, #A1A7B0); min-height: 44px; width: 100%; font-family: inherit; cursor: pointer; }',
      '#backupSheet .bk-status { font-size: 0.85rem; color: var(--rec-green, #00E676); margin-top: 8px; overflow-wrap: anywhere; }',
      '#backupSheet .bk-status.is-error { color: #FFB4A0; }',
      '#backupSheet .bk-preview-box { background: var(--surface-2, #14171A); border: 1px solid var(--edge-2, rgba(255,255,255,0.12)); border-radius: 14px; padding: 12px; margin: 8px 0; }',
      '#backupSheet .bk-preview-title { font-weight: 800; font-size: 0.95rem; color: #FFA726; margin-bottom: 4px; }',
      '#backupSheet .bk-preview-meta { font-size: 0.8rem; color: var(--text-2, #A1A7B0); margin-bottom: 8px; }',
      '#backupSheet .bk-preview-sect { font-size: 0.75rem; font-weight: 700; color: var(--text-1, #F4F5F6); margin-top: 8px; margin-bottom: 4px; }',
      '#backupSheet .bk-preview-list { list-style: none; padding: 0; margin: 0 0 8px 0; max-height: 140px; overflow-y: auto; font-size: 0.8rem; }',
      '#backupSheet .bk-preview-list li { padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); overflow-wrap: anywhere; }',
      '#backupSheet .bk-preview-ok { font-size: 0.8rem; color: var(--rec-green, #00E676); margin: 6px 0; }',
      '#backupSheet .bk-preview-info { font-size: 0.78rem; color: var(--text-2, #A1A7B0); margin: 4px 0; }',
      '#backupSheet .bk-preview-warn { font-size: 0.75rem; color: #FFA726; background: rgba(255,167,38,0.1); padding: 8px; border-radius: 8px; margin: 8px 0; line-height: 1.35; }',
      '#backupSheet .bk-action-row { display: flex; gap: 8px; margin-top: 10px; }',
      '#backupSheet .bk-action-row .bk-btn { margin: 0; }',
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
    sheet.appendChild(el('div', 'bk-title', '💾 Varnostna kopija podatkov'));
    sheet.appendChild(el('div', 'bk-help',
      'Podatki so shranjeni v localStorage tega brskalnika. Shrani JSON kopijo vseh bine_* ključev, ' +
      'da jih ne izgubiš ob čiščenju predpomnilnika ali menjavi naprave.'));

    previewEl = el('div', 'bk-preview-host');
    sheet.appendChild(previewEl);

    mainActionsEl = el('div', 'bk-main-actions');

    var exp = el('button', 'bk-btn bk-go', '📤 Izvozi vse podatke (JSON)');
    exp.type = 'button';
    exp.addEventListener('click', function () { exportAll(); });

    var imp = el('button', 'bk-btn bk-alt', '📥 Uvozi iz datoteke (JSON)');
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

    // Gumb za kopiranje dnevnika napak (povezano z ErrorGuard)
    var copyErrBtn = el('button', 'bk-btn bk-alt', '📋 Kopiraj dnevnik napak (bine_error_log_v1)');
    copyErrBtn.type = 'button';
    copyErrBtn.addEventListener('click', function () {
      if (root.ErrorGuard && typeof root.ErrorGuard.copy === 'function') {
        root.ErrorGuard.copy().then(function (res) {
          setStatus(res.msg, !res.ok);
        });
      } else {
        setStatus('ErrorGuard ni na voljo.', true);
      }
    });

    mainActionsEl.appendChild(exp);
    mainActionsEl.appendChild(imp);
    mainActionsEl.appendChild(copyErrBtn);
    mainActionsEl.appendChild(fileInput);

    sheet.appendChild(mainActionsEl);

    statusEl = el('div', 'bk-status');
    statusEl.setAttribute('role', 'status');
    statusEl.hidden = true;
    sheet.appendChild(statusEl);

    var close = el('button', 'bk-close', 'Zapri');
    close.type = 'button';
    close.addEventListener('click', closePanel);
    sheet.appendChild(close);

    overlay.appendChild(sheet);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePanel(); });
    document.body.appendChild(overlay);
  }

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
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(function () { /* brez učinka */ });
      }
    } catch (e) { /* brez učinka */ }
  }

  function boot() {
    requestPersistence();
    buildPanel();
    mountButton(0);
  }

  var api = {
    open: openPanel,
    close: closePanel,
    buildBackup: buildBackup,
    validateBackup: validateBackup,
    diffBackup: diffBackup,
    isBackupKey: isBackupKey,
    exportAll: exportAll
  };

  root.BackupUI = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));