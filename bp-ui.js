/**
 * Bine Zdravje — Foto branje merilnika krvnega tlaka (Beurer BM 27 in drugi).
 *
 * Tok: 📷 -> stiskanje -> POST /api/bp-photo (VPS, vision model) -> {sys, dia, pulse}
 *      -> OBVEZNA potrditev/popravek (sedemsegmentni zaslon zamenja 1/7, 3/8) -> shrani.
 * Shranjevanje: polje vnosTlak ("sys/dia") + dnevnik bine_zdravje_tlak_log (datum, ura, sys, dia, pulz).
 * Brez potrditve se ne zapiše nič.
 *
 * Zgodovina: zadnjih 14 meritev (seznam + SVG graf sys/dia), brisanje posamezne meritve,
 * kopiranje CSV (celoten dnevnik). Ročni vnos v polje "Krvni tlak" se zapiše v dnevnik preko syncManual().
 *
 * Odvisnosti iz index.html: compressAndResizeImage, saveDanesVnos, showMascotNotification (vse neobvezno razen prve).
 */
(function () {
  'use strict';

  const LS_TOKEN = 'bine_zdravje_fv_token';
  const LS_ENDPOINT = 'bine_zdravje_fv_endpoint';
  const LS_LOG = 'bine_zdravje_tlak_log';
  const FALLBACK_ENDPOINTS = [
    'https://kingdom-optimum-cheapest-gates.trycloudflare.com',
    'http://100.101.68.31:8091',
    'http://127.0.0.1:8091'
  ];
  const HIST_N = 14;
  const COL_SYS = '#FF6B5B', COL_DIA = '#00B0FF';

  function toast(msg) {
    if (typeof showMascotNotification === 'function') showMascotNotification(msg);
    else console.log('[BP]', msg);
  }

  async function endpoints() {
    const list = [];
    const manual = localStorage.getItem(LS_ENDPOINT);
    if (manual) list.push(manual);
    try {
      const r = await fetch('./food-vision-endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.url) list.push(j.url); }
    } catch (e) { /* ni objavljen */ }
    for (const f of FALLBACK_ENDPOINTS) {
      if (!(location.protocol === 'https:' && f.startsWith('http:'))) list.push(f);
    }
    return [...new Set(list.map(u => u.replace(/\/$/, '')))];
  }

  async function readMeter(dataUrl) {
    // Žeton nastavi food-vision-ui.js (isti strežnik, isti žeton).
    const token = localStorage.getItem(LS_TOKEN) || '';
    let lastErr = null;
    for (const ep of await endpoints()) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 25000);
        const r = await fetch(ep + '/api/bp-photo', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'X-Zdravje-Token': token },
          body: JSON.stringify({ image: dataUrl })
        });
        clearTimeout(to);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastErr = new Error(j.error || ('HTTP ' + r.status));
          if (r.status === 401) break;
          continue;
        }
        return j;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Strežnik se ni odzval pravočasno (25 s).') : e;
      }
    }
    throw lastErr || new Error('Strežnik za branje ni dosegljiv.');
  }

  // ---------- Dnevnik ----------
  function getLog() {
    try { return JSON.parse(localStorage.getItem(LS_LOG) || '[]'); } catch (e) { return []; }
  }

  function todayIso() { return new Date().toLocaleDateString('sv-SE'); }

  function addLog(sys, dia, pulse) {
    const log = getLog();
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    log.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      sys, dia, pulse: pulse || null
    });
    localStorage.setItem(LS_LOG, JSON.stringify(log.slice(-1000)));
  }

  /** Ročni vnos v polje "Krvni tlak": zapiše v dnevnik, če je veljaven in ni enak zadnjemu vpisu za ta dan. */
  function syncManual(str) {
    const m = String(str || '').match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
    if (!m) return false;
    const sys = parseInt(m[1], 10), dia = parseInt(m[2], 10);
    if (!(sys >= 60 && sys <= 260 && dia >= 30 && dia <= 160 && sys > dia)) return false;
    const log = getLog();
    const last = log[log.length - 1];
    if (last && last.date === todayIso() && last.sys === sys && last.dia === dia) return false;
    addLog(sys, dia, null);
    return true;
  }

  function deleteAt(idx) {
    const log = getLog();
    if (!(idx >= 0 && idx < log.length)) return false;
    log.splice(idx, 1);
    localStorage.setItem(LS_LOG, JSON.stringify(log));
    return true;
  }

  // ---------- Modal za potrditev ----------
  let root = null;

  function close() {
    if (root) { root.remove(); root = null; }
    if (typeof unlockBodyScroll === 'function') { try { unlockBodyScroll(); } catch (e) {} }
  }

  function el(html) {
    const t = document.createElement('div');
    t.innerHTML = html.trim();
    return t.firstChild;
  }

  function open(inner) {
    if (!root) {
      root = el('<div id="bpModal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center;"></div>');
      root.addEventListener('click', e => { if (e.target === root) close(); });
      document.body.appendChild(root);
    }
    root.innerHTML = '<div style="width:100%;max-width:480px;background:var(--surface-1,#101215);border:1px solid var(--edge-2,#2a2d33);border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));color:#fff;">' + inner + '</div>';
  }

  const inputCss = 'width:100%;padding:10px;background:var(--surface-2,#181b20);border:1px solid var(--edge-2,#2a2d33);border-radius:10px;color:#fff;font-size:1.3rem;font-weight:800;text-align:center;';
  const labelCss = 'font-size:.72rem;color:var(--text-3,#8b9097);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px;';

  function renderLoading(msg) {
    open('<div style="text-align:center;padding:24px 0;font-weight:700;">⏳ ' + msg + '</div>');
  }

  function renderError(msg) {
    open(
      '<div style="font-weight:800;margin-bottom:8px;">Branje ni uspelo</div>' +
      '<div style="font-size:.85rem;color:var(--text-2,#b4b9c0);margin-bottom:14px;"></div>' +
      '<button type="button" class="btn" style="width:100%;padding:12px;font-weight:700;" id="bpRetry">📷 Poskusi znova</button>' +
      '<button type="button" class="btn secondary" style="width:100%;padding:12px;margin-top:8px;" id="bpManual">✍️ Vpiši ročno</button>'
    );
    root.querySelector('div > div:nth-child(2)').textContent = msg;
    root.querySelector('#bpRetry').onclick = () => { close(); pick(); };
    root.querySelector('#bpManual').onclick = () => renderConfirm({ found: true, sys: '', dia: '', pulse: '', confidence: 0, note: '' });
  }

  function renderConfirm(r) {
    const low = r.found && r.confidence != null && r.confidence < 0.8;
    open(
      '<div style="font-weight:800;margin-bottom:4px;">Preveri številke z zaslona merilnika</div>' +
      '<div id="bpHint" style="font-size:.8rem;margin-bottom:12px;"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">' +
      '<div><label style="' + labelCss + '">Sistolični</label><input id="bpSys" type="number" inputmode="numeric" style="' + inputCss + '"></div>' +
      '<div><label style="' + labelCss + '">Diastolični</label><input id="bpDia" type="number" inputmode="numeric" style="' + inputCss + '"></div>' +
      '<div><label style="' + labelCss + '">Pulz</label><input id="bpPulse" type="number" inputmode="numeric" style="' + inputCss + '"></div>' +
      '</div>' +
      '<button type="button" class="btn" style="width:100%;padding:12px;font-weight:700;margin-top:14px;" id="bpSave">✅ Potrdi in shrani</button>' +
      '<button type="button" class="btn secondary" style="width:100%;padding:10px;margin-top:8px;" id="bpCancel">Prekliči</button>'
    );
    root.querySelector('#bpSys').value = r.sys;
    root.querySelector('#bpDia').value = r.dia;
    root.querySelector('#bpPulse').value = r.pulse == null ? '' : r.pulse;
    const hint = root.querySelector('#bpHint');
    hint.style.color = low ? '#ffb454' : 'var(--text-3,#8b9097)';
    hint.textContent = low
      ? '⚠️ Model ni povsem prepričan' + (r.note ? ' — ' + r.note : '') + '. Primerjaj z zaslonom (1/7, 3/8, 5/6 se rade zamenjajo).'
      : 'Primerjaj z zaslonom (1/7, 3/8, 5/6 se rade zamenjajo).' + (r.note ? ' ' + r.note : '');
    root.querySelector('#bpCancel').onclick = close;
    root.querySelector('#bpSave').onclick = () => {
      const sys = parseInt(root.querySelector('#bpSys').value, 10);
      const dia = parseInt(root.querySelector('#bpDia').value, 10);
      const pulse = parseInt(root.querySelector('#bpPulse').value, 10);
      if (!(sys >= 60 && sys <= 260 && dia >= 30 && dia <= 160 && sys > dia)) {
        hint.style.color = '#ff6b6b';
        hint.textContent = 'Vrednosti niso verjetne (sistolični 60–260, diastolični 30–160, sistolični > diastolični).';
        return;
      }
      save(sys, dia, isNaN(pulse) ? null : pulse);
    };
  }

  function save(sys, dia, pulse) {
    addLog(sys, dia, pulse);
    const field = document.getElementById('vnosTlak');
    if (field) field.value = sys + '/' + dia;
    if (typeof saveDanesVnos === 'function') { try { saveDanesVnos(); } catch (e) { console.error(e); } }
    renderHistory('bpHistRoot');
    close();
    toast('Tlak shranjen: ' + sys + '/' + dia + (pulse ? ' · pulz ' + pulse : ''));
  }

  // ---------- Zgodovina: zadnjih 14 meritev, graf, brisanje, CSV ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toCsv(log) {
    return ['datum,ura,sistolicni,diastolicni,pulz']
      .concat(log.map(e => [e.date, e.time || '', e.sys, e.dia, e.pulse == null ? '' : e.pulse].join(',')))
      .join('\n');
  }

  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }

  function chartHtml(pts) {
    if (pts.length < 2) {
      return '<div style="color:var(--text-3);font-size:.8rem;padding:10px 0;">Premalo podatkov za graf (potrebni sta vsaj 2 meritvi).</div>';
    }
    const W = 320, H = 150, P = 22;
    const vals = pts.flatMap(p => [p.sys, p.dia]);
    const lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
    const x = i => P + (W - 2 * P) * i / (pts.length - 1);
    const y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo);
    const line = key => pts.map((p, i) => x(i).toFixed(1) + ',' + y(p[key]).toFixed(1)).join(' ');
    const dots = (key, col) => pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3" fill="${col}"/>`).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Graf tlaka: sistolični in diastolični">' +
      '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P) + '" y2="' + (H - P) + '" stroke="rgba(255,255,255,0.12)"/>' +
      '<polyline points="' + line('sys') + '" fill="none" stroke="' + COL_SYS + '" stroke-width="2"/>' +
      '<polyline points="' + line('dia') + '" fill="none" stroke="' + COL_DIA + '" stroke-width="2"/>' +
      dots('sys', COL_SYS) + dots('dia', COL_DIA) +
      '</svg>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:.72rem;color:var(--text-3);margin-top:4px;">' +
        '<span><b style="color:' + COL_SYS + ';">●</b> sistolični</span>' +
        '<span><b style="color:' + COL_DIA + ';">●</b> diastolični</span>' +
        '<span>min ' + Math.min(...vals) + ' · max ' + Math.max(...vals) + '</span>' +
      '</div>';
  }

  function rowHtml(x) {
    const e = x.e;
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2,#181b20);border:1px solid var(--edge-1,#2a2d33);border-radius:10px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:800;font-variant-numeric:tabular-nums;">' + esc(e.sys) + '/' + esc(e.dia) +
          ' <span style="font-size:.7rem;color:var(--text-3,#8b9097);font-weight:600;">mmHg' + (e.pulse ? ' · pulz ' + esc(e.pulse) : '') + '</span></div>' +
        '<div style="font-size:.72rem;color:var(--text-3,#8b9097);">' + esc(e.date) + (e.time ? ' ob ' + esc(e.time) : '') + '</div>' +
      '</div>' +
      '<button type="button" data-bp-act="del" data-idx="' + x.i + '" aria-label="Izbriši meritev" style="min-width:44px;min-height:44px;background:none;border:1px solid var(--edge-2,#2a2d33);border-radius:10px;cursor:pointer;font-size:1rem;">🗑️</button>' +
    '</div>';
  }

  function onHistClick(ev) {
    const btn = ev.target.closest && ev.target.closest('[data-bp-act]');
    if (!btn) return;
    if (btn.dataset.bpAct === 'csv') {
      const log = getLog();
      copyText(toCsv(log)).then(ok => toast(ok ? 'CSV kopiran (' + log.length + ' meritev)' : 'Kopiranje ni uspelo'));
      return;
    }
    if (btn.dataset.bpAct === 'del') {
      if (!confirm('Izbrišem to meritev tlaka?')) return;
      if (deleteAt(parseInt(btn.dataset.idx, 10))) toast('Meritev izbrisana');
      if (window.DanesPodatki && DanesPodatki.renderDanes) DanesPodatki.renderDanes();
      else renderHistory('bpHistRoot');
    }
  }

  function renderHistory(rootId) {
    const host = document.getElementById(rootId || 'bpHistRoot');
    if (!host) return;
    const log = getLog();
    const recent = log.map((e, i) => ({ e, i })).slice(-HIST_N); // najstarejša prvo (za graf)
    const pts = recent.map(x => ({ sys: Number(x.e.sys), dia: Number(x.e.dia) }));
    let html = chartHtml(pts);
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:10px 0 6px;">' +
      '<span style="font-size:.72rem;color:var(--text-3,#8b9097);font-weight:700;text-transform:uppercase;">Meritve (' + recent.length + ' od ' + log.length + ')</span>' +
      '<button type="button" class="btn secondary" data-bp-act="csv"' + (log.length ? '' : ' disabled') +
      ' style="min-height:44px;padding:8px 12px;font-size:.78rem;">📋 Kopiraj CSV (vse)</button></div>';
    if (!log.length) html += '<div style="color:var(--text-3,#8b9097);font-size:.8rem;">Še ni meritev tlaka.</div>';
    else html += '<div style="display:flex;flex-direction:column;gap:6px;">' + recent.slice().reverse().map(rowHtml).join('') + '</div>';
    host.innerHTML = html;
    if (!host.__bpBound) {
      host.__bpBound = true;
      host.addEventListener('click', onHistClick);
    }
  }

  // ---------- Vstopne točke ----------
  function pick() {
    let inp = document.getElementById('bpPhotoInput');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'bpPhotoInput'; inp.style.display = 'none';
      inp.setAttribute('capture', 'environment');
      inp.addEventListener('change', () => handleFile(inp));
      document.body.appendChild(inp);
    }
    inp.value = '';
    inp.click();
  }

  async function handleFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    renderLoading('Stiskam sliko…');
    try {
      // Večja ločljivost kot pri hrani: majhne številke na LCD.
      const res = await compressAndResizeImage(file, { maxDim: 1400, initialQuality: 0.85, maxSizeKB: 400 });
      renderLoading('Berem zaslon merilnika…');
      const r = await readMeter(res.dataUrl);
      if (!r.found) return renderError(r.note || 'Na sliki ne vidim zaslona merilnika.');
      renderConfirm(r);
    } catch (e) {
      renderError(e && e.message ? e.message : String(e));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => renderHistory('bpHistRoot'));
  else renderHistory('bpHistRoot');

  window.BpVision = { pick, handleFile, getLog, save, syncManual, deleteAt, renderHistory };
})();
