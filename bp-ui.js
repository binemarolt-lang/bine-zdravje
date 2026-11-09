/**
 * Bine Zdravje — Foto branje merilnika krvnega tlaka (Beurer BM 27 in drugi)
 * ter zgodovina meritev po ESC/ESH smernicah.
 *
 * Tok: 📷 -> stiskanje -> POST /api/bp-photo (VPS, vision model) -> {sys, dia, pulse}
 *      -> OBVEZNA potrditev/popravek (sedemsegmentni zaslon zamenja 1/7, 3/8) -> shrani.
 * Shranjevanje: polje vnosTlak ("sys/dia") + dnevnik bine_zdravje_tlak_log (datum, ura, sys, dia, pulz).
 * Brez potrditve se ne zapiše nič.
 *
 * Zgodovina: tabela meritev + mini SVG graf sistolični/diastolični/pulz po dnevih,
 * povprečje 7 dni, jutranje vs večerne meritve (po uri), razvrstitev po ESC/ESH
 * kategorijah kot nevtralna oznaka brez diagnoze (»pokaži zdravniku«).
 */
(function (root) {
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
  const COL_SYS = '#FF6B5B';
  const COL_DIA = '#00B0FF';
  const COL_PULSE = '#34D399';

  function toast(msg) {
    if (typeof root.showMascotNotification === 'function') {
      root.showMascotNotification(msg);
    } else if (typeof console !== 'undefined' && console.log) {
      console.log('[BP]', msg);
    }
  }

  // ---------- Čiste funkcije za analizo in ESC/ESH razvrstitev ----------

  /**
   * Razvrstitev po smernicah ESC/ESH (European Society of Cardiology / European Society of Hypertension).
   * Nevtralna oznaka brez diagnoze. Če sistolični in diastolični spadata v različni kategoriji,
   * velja višja.
   *
   * Kategorije:
   * - Optimalno: sys < 120 in dia < 80
   * - Normalno: sys 120–129 in/ali dia 80–84
   * - Visoko normalno: sys 130–139 in/ali dia 85–89
   * - Stopnja 1: sys 140–159 in/ali dia 90–99
   * - Stopnja 2: sys 160–179 in/ali dia 100–109
   * - Stopnja 3: sys >= 180 in/ali dia >= 110
   * - Izolirana sistolična: sys >= 140 in dia < 90
   */
  function classifyBp(sys, dia) {
    const s = Number(sys);
    const d = Number(dia);
    if (!s || !d || isNaN(s) || isNaN(d) || s <= 0 || d <= 0) return null;

    // Izolirana sistolična: sys >= 140 in dia < 90
    if (s >= 140 && d < 90) {
      return {
        key: 'ish',
        label: 'Izoliran sistolični (ESC/ESH)',
        shortLabel: 'Izol. sistolični',
        category: 'Izolirana sistolična',
        color: '#FF8A65',
        doctorAdvice: true,
        note: 'pokaži zdravniku'
      };
    }

    // Stopnja 3 hipertenzija
    if (s >= 180 || d >= 110) {
      return {
        key: 'grade3',
        label: 'Stopnja 3 (ESC/ESH)',
        shortLabel: 'Stopnja 3',
        category: 'Stopnja 3',
        color: '#FF5252',
        doctorAdvice: true,
        note: 'pokaži zdravniku'
      };
    }

    // Stopnja 2 hipertenzija
    if (s >= 160 || d >= 100) {
      return {
        key: 'grade2',
        label: 'Stopnja 2 (ESC/ESH)',
        shortLabel: 'Stopnja 2',
        category: 'Stopnja 2',
        color: '#FF7043',
        doctorAdvice: true,
        note: 'pokaži zdravniku'
      };
    }

    // Stopnja 1 hipertenzija
    if (s >= 140 || d >= 90) {
      return {
        key: 'grade1',
        label: 'Stopnja 1 (ESC/ESH)',
        shortLabel: 'Stopnja 1',
        category: 'Stopnja 1',
        color: '#FFA726',
        doctorAdvice: true,
        note: 'pokaži zdravniku'
      };
    }

    // Visoko normalno
    if (s >= 130 || d >= 85) {
      return {
        key: 'high_normal',
        label: 'Visoko normalno (ESC/ESH)',
        shortLabel: 'Visoko norm.',
        category: 'Visoko normalno',
        color: '#FFD54F',
        doctorAdvice: false,
        note: ''
      };
    }

    // Normalno
    if (s >= 120 || d >= 80) {
      return {
        key: 'normal',
        label: 'Normalno (ESC/ESH)',
        shortLabel: 'Normalno',
        category: 'Normalno',
        color: '#81C784',
        doctorAdvice: false,
        note: ''
      };
    }

    // Optimalno
    return {
      key: 'optimal',
      label: 'Optimalno (ESC/ESH)',
      shortLabel: 'Optimalno',
      category: 'Optimalno',
      color: '#4CAF50',
      doctorAdvice: false,
      note: ''
    };
  }

  /**
   * Izračuna povprečje meritev za zadnjih 7 dni.
   * Če je podan referenceDate (YYYY-MM-DD ali Date), gleda 7 dni nazaj od njega.
   * Če v oknu ni meritev, pogleda zadnjih 7 koledarskih dni z meritvami.
   */
  function calculate7DayAverage(log, referenceDate) {
    if (!Array.isArray(log) || !log.length) {
      return { count: 0, avgSys: null, avgDia: null, avgPulse: null, classification: null };
    }

    const ref = referenceDate ? new Date(referenceDate) : new Date();
    const pad = n => String(n).padStart(2, '0');
    const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const refIso = toIso(ref);
    const minD = new Date(ref);
    minD.setDate(minD.getDate() - 6);
    const minIso = toIso(minD);

    let inWindow = log.filter(e => e && e.date && e.date >= minIso && e.date <= refIso);

    // Če v točnem oknu ni meritev, vzamemo zadnjih 7 dni glede na zadnji zabeležen datum v dnevniku
    if (!inWindow.length) {
      const latestDate = log.reduce((max, e) => (!max || (e && e.date > max)) ? (e && e.date) : max, null);
      if (latestDate) {
        const lD = new Date(latestDate);
        const lMin = new Date(lD);
        lMin.setDate(lMin.getDate() - 6);
        const lMinIso = toIso(lMin);
        inWindow = log.filter(e => e && e.date >= lMinIso && e.date <= latestDate);
      }
    }

    if (!inWindow.length) {
      return { count: 0, avgSys: null, avgDia: null, avgPulse: null, classification: null };
    }

    let sumSys = 0;
    let sumDia = 0;
    let sumPulse = 0;
    let pulseCount = 0;

    inWindow.forEach(e => {
      sumSys += Number(e.sys) || 0;
      sumDia += Number(e.dia) || 0;
      if (e.pulse != null && !isNaN(Number(e.pulse)) && Number(e.pulse) > 0) {
        sumPulse += Number(e.pulse);
        pulseCount++;
      }
    });

    const avgSys = Math.round((sumSys / inWindow.length) * 10) / 10;
    const avgDia = Math.round((sumDia / inWindow.length) * 10) / 10;
    const avgPulse = pulseCount ? Math.round((sumPulse / pulseCount) * 10) / 10 : null;

    return {
      count: inWindow.length,
      avgSys,
      avgDia,
      avgPulse,
      classification: classifyBp(avgSys, avgDia)
    };
  }

  /**
   * Razdeli meritve na jutranje in večerne po uri meritve.
   * Jutranje: 04:00 - 11:59
   * Večerne:  17:00 - 23:59
   * Ostalo:   12:00 - 16:59 ali 00:00 - 03:59
   */
  function splitMorningEvening(log) {
    const morning = [];
    const evening = [];
    const other = [];

    (log || []).forEach(e => {
      if (!e || e.sys == null || e.dia == null) return;
      let hour = null;
      if (e.time && typeof e.time === 'string') {
        const parts = e.time.split(':');
        const h = parseInt(parts[0], 10);
        if (!isNaN(h)) hour = h;
      }

      if (hour !== null && hour >= 4 && hour < 12) {
        morning.push(e);
      } else if (hour !== null && hour >= 17 && hour <= 23) {
        evening.push(e);
      } else {
        other.push(e);
      }
    });

    function calcStats(list) {
      if (!list.length) {
        return { count: 0, avgSys: null, avgDia: null, avgPulse: null, classification: null };
      }
      let sumS = 0;
      let sumD = 0;
      let sumP = 0;
      let pCnt = 0;

      list.forEach(e => {
        sumS += Number(e.sys) || 0;
        sumD += Number(e.dia) || 0;
        if (e.pulse != null && !isNaN(Number(e.pulse)) && Number(e.pulse) > 0) {
          sumP += Number(e.pulse);
          pCnt++;
        }
      });

      const avgS = Math.round((sumS / list.length) * 10) / 10;
      const avgD = Math.round((sumD / list.length) * 10) / 10;
      const avgP = pCnt ? Math.round((sumP / pCnt) * 10) / 10 : null;

      return {
        count: list.length,
        avgSys: avgS,
        avgDia: avgD,
        avgPulse: avgP,
        classification: classifyBp(avgS, avgD)
      };
    }

    return {
      morning: calcStats(morning),
      evening: calcStats(evening),
      other: calcStats(other)
    };
  }

  // ---------- Omrežje in vision branje ----------

  async function endpoints() {
    const list = [];
    const manual = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_ENDPOINT) : null;
    if (manual) list.push(manual);
    try {
      const r = await fetch('./food-vision-endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.url) list.push(j.url); }
    } catch (e) { /* ni objavljen */ }
    for (const f of FALLBACK_ENDPOINTS) {
      if (typeof location !== 'undefined' && !(location.protocol === 'https:' && f.startsWith('http:'))) {
        list.push(f);
      }
    }
    return [...new Set(list.map(u => u.replace(/\/$/, '')))];
  }

  async function readMeter(dataUrl) {
    const token = (typeof localStorage !== 'undefined') ? (localStorage.getItem(LS_TOKEN) || '') : '';
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

  // ---------- Shramba v localStorage (ključ ohranjen) ----------

  function getLog() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const v = JSON.parse(localStorage.getItem(LS_LOG) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function todayIso() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function addLog(sys, dia, pulse) {
    const log = getLog();
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    log.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      sys: Number(sys),
      dia: Number(dia),
      pulse: (pulse != null && !isNaN(Number(pulse))) ? Number(pulse) : null
    });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_LOG, JSON.stringify(log.slice(-1000)));
    }
  }

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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_LOG, JSON.stringify(log));
    }
    return true;
  }

  // ---------- Modal za potrditev foto branja ----------

  let rootEl = null;

  function close() {
    if (rootEl) { rootEl.remove(); rootEl = null; }
    if (typeof root.unlockBodyScroll === 'function') {
      try { root.unlockBodyScroll(); } catch (e) {}
    }
  }

  function el(html) {
    const t = document.createElement('div');
    t.innerHTML = html.trim();
    return t.firstChild;
  }

  function open(inner) {
    if (!rootEl) {
      rootEl = el('<div id="bpModal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:flex-end;justify-content:center;"></div>');
      rootEl.addEventListener('click', e => { if (e.target === rootEl) close(); });
      document.body.appendChild(rootEl);
    }
    rootEl.innerHTML = '<div style="width:100%;max-width:480px;background:var(--surface-1,#101215);border:1px solid var(--edge-2,#2a2d33);border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom, 0px));color:#fff;">' + inner + '</div>';
  }

  const inputCss = 'width:100%;min-height:44px;padding:10px;background:var(--surface-2,#181b20);border:1px solid var(--edge-2,#2a2d33);border-radius:10px;color:#fff;font-size:16px;font-weight:800;text-align:center;box-sizing:border-box;';
  const labelCss = 'font-size:.72rem;color:var(--text-3,#8b9097);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px;';

  function renderLoading(msg) {
    open('<div style="text-align:center;padding:24px 0;font-weight:700;">⏳ ' + msg + '</div>');
  }

  function renderError(msg) {
    open(
      '<div style="font-weight:800;margin-bottom:8px;">Branje ni uspelo</div>' +
      '<div style="font-size:.85rem;color:var(--text-2,#b4b9c0);margin-bottom:14px;"></div>' +
      '<button type="button" class="btn" style="width:100%;min-height:44px;padding:12px;font-weight:700;" id="bpRetry">📷 Poskusi znova</button>' +
      '<button type="button" class="btn secondary" style="width:100%;min-height:44px;padding:12px;margin-top:8px;" id="bpManual">✍️ Vpiši ročno</button>'
    );
    rootEl.querySelector('div > div:nth-child(2)').textContent = msg;
    rootEl.querySelector('#bpRetry').onclick = () => { close(); pick(); };
    rootEl.querySelector('#bpManual').onclick = () => renderConfirm({ found: true, sys: '', dia: '', pulse: '', confidence: 0, note: '' });
  }

  function renderConfirm(r) {
    const low = r.found && r.confidence != null && r.confidence < 0.8;
    open(
      '<div style="font-weight:800;margin-bottom:4px;">Preveri številke z zaslona merilnika (Beurer BM 27)</div>' +
      '<div id="bpHint" style="font-size:.8rem;margin-bottom:12px;"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">' +
      '<div><label style="' + labelCss + '">Sistolični</label><input id="bpSys" type="number" inputmode="numeric" style="' + inputCss + '"></div>' +
      '<div><label style="' + labelCss + '">Diastolični</label><input id="bpDia" type="number" inputmode="numeric" style="' + inputCss + '"></div>' +
      '<div><label style="' + labelCss + '">Pulz</label><input id="bpPulse" type="number" inputmode="numeric" style="' + inputCss + '"></div>' +
      '</div>' +
      '<div id="bpCategoryPreview" style="margin-top:10px;font-size:.8rem;padding:6px 10px;border-radius:8px;background:var(--surface-2,#181b20);display:none;"></div>' +
      '<button type="button" class="btn" style="width:100%;min-height:44px;padding:12px;font-weight:700;margin-top:14px;" id="bpSave">✅ Potrdi in shrani</button>' +
      '<button type="button" class="btn secondary" style="width:100%;min-height:44px;padding:10px;margin-top:8px;" id="bpCancel">Prekliči</button>'
    );
    rootEl.querySelector('#bpSys').value = r.sys;
    rootEl.querySelector('#bpDia').value = r.dia;
    rootEl.querySelector('#bpPulse').value = r.pulse == null ? '' : r.pulse;

    const hint = rootEl.querySelector('#bpHint');
    hint.style.color = low ? '#ffb454' : 'var(--text-3,#8b9097)';
    hint.textContent = low
      ? '⚠️ Model ni povsem prepričan' + (r.note ? ' — ' + r.note : '') + '. Primerjaj z zaslonom (1/7, 3/8, 5/6 se rade zamenjajo).'
      : 'Primerjaj z zaslonom (1/7, 3/8, 5/6 se rade zamenjajo).' + (r.note ? ' ' + r.note : '');

    const catBox = rootEl.querySelector('#bpCategoryPreview');
    function updateCatPreview() {
      const s = parseInt(rootEl.querySelector('#bpSys').value, 10);
      const d = parseInt(rootEl.querySelector('#bpDia').value, 10);
      const cat = classifyBp(s, d);
      if (cat) {
        catBox.style.display = 'block';
        catBox.innerHTML = 'Kategorija: <strong style="color:' + cat.color + ';">' + esc(cat.label) + '</strong>' +
          (cat.doctorAdvice ? ' · <span style="color:#FFA726;">»pokaži zdravniku«</span>' : '');
      } else {
        catBox.style.display = 'none';
      }
    }

    rootEl.querySelector('#bpSys').addEventListener('input', updateCatPreview);
    rootEl.querySelector('#bpDia').addEventListener('input', updateCatPreview);
    updateCatPreview();

    rootEl.querySelector('#bpCancel').onclick = close;
    rootEl.querySelector('#bpSave').onclick = () => {
      const sys = parseInt(rootEl.querySelector('#bpSys').value, 10);
      const dia = parseInt(rootEl.querySelector('#bpDia').value, 10);
      const pulse = parseInt(rootEl.querySelector('#bpPulse').value, 10);
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
    if (typeof document !== 'undefined') {
      const field = document.getElementById('vnosTlak');
      if (field) field.value = sys + '/' + dia;
      if (typeof root.saveDanesVnos === 'function') {
        try { root.saveDanesVnos(); } catch (e) { console.error(e); }
      }
      renderHistory('bpHistRoot');
    }
    close();
    toast('Tlak shranjen: ' + sys + '/' + dia + (pulse ? ' · pulz ' + pulse : ''));
  }

  // ---------- Zgodovina: vizualizacija, tabela, statistika ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toCsv(log) {
    return ['datum,ura,sistolicni,diastolicni,pulz,esc_kategorija']
      .concat(log.map(e => {
        const cat = classifyBp(e.sys, e.dia);
        return [
          e.date,
          e.time || '',
          e.sys,
          e.dia,
          e.pulse == null ? '' : e.pulse,
          cat ? cat.shortLabel : ''
        ].join(',');
      }))
      .join('\n');
  }

  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }

  /**
   * Mini SVG graf: sistolični, diastolični in pulz po dnevih.
   */
  function chartHtml(pts) {
    if (!pts || pts.length < 2) {
      return '<div style="color:var(--text-3);font-size:.8rem;padding:10px 0;text-align:center;">Premalo podatkov za graf (potrebni sta vsaj 2 meritvi).</div>';
    }

    const W = 360, H = 160, P = 24;
    const allSysDia = pts.flatMap(p => [p.sys, p.dia]);
    const allPulse = pts.map(p => p.pulse).filter(v => v != null && !isNaN(v) && v > 0);
    const allVals = allSysDia.concat(allPulse);

    const lo = Math.max(30, Math.min(...allVals) - 10);
    const hi = Math.min(220, Math.max(...allVals) + 10);

    const x = i => P + (W - 2 * P) * i / (pts.length - 1);
    const y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo);

    const line = key => pts
      .filter(p => p[key] != null && !isNaN(p[key]))
      .map((p, i) => x(i).toFixed(1) + ',' + y(p[key]).toFixed(1))
      .join(' ');

    const dots = (key, col) => pts
      .filter(p => p[key] != null && !isNaN(p[key]))
      .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3" fill="${col}" stroke="#101215" stroke-width="1"/>`)
      .join('');

    // Referenčne črte: 120 (sistolični optimalni prag) in 80 (diastolični prag)
    let refLines = '';
    if (120 >= lo && 120 <= hi) {
      refLines += `<line x1="${P}" x2="${W - P}" y1="${y(120).toFixed(1)}" y2="${y(120).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2,2"/>` +
        `<text x="${W - P}" y="${(y(120) - 2).toFixed(1)}" fill="rgba(255,255,255,0.25)" font-size="9" text-anchor="end">120</text>`;
    }
    if (80 >= lo && 80 <= hi) {
      refLines += `<line x1="${P}" x2="${W - P}" y1="${y(80).toFixed(1)}" y2="${y(80).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2,2"/>` +
        `<text x="${W - P}" y="${(y(80) - 2).toFixed(1)}" fill="rgba(255,255,255,0.25)" font-size="9" text-anchor="end">80</text>`;
    }

    // Datumske oznake na X osi (prva, srednja, zadnja)
    const labelIndices = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    const xLabels = labelIndices.map(idx => {
      const p = pts[idx];
      if (!p || !p.date) return '';
      const parts = p.date.split('-');
      const dLabel = parts.length === 3 ? `${parts[2]}.${parts[1]}.` : p.date;
      const anchor = idx === 0 ? 'start' : (idx === pts.length - 1 ? 'end' : 'middle');
      return `<text x="${x(idx).toFixed(1)}" y="${H - 4}" fill="var(--text-3,#8b9097)" font-size="9" text-anchor="${anchor}">${esc(dLabel)}</text>`;
    }).join('');

    const hasPulse = pts.some(p => p.pulse != null);

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Graf tlaka: sistolični, diastolični in pulz">' +
      '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P) + '" y2="' + (H - P) + '" stroke="rgba(255,255,255,0.12)"/>' +
      refLines +
      '<polyline points="' + line('sys') + '" fill="none" stroke="' + COL_SYS + '" stroke-width="2"/>' +
      '<polyline points="' + line('dia') + '" fill="none" stroke="' + COL_DIA + '" stroke-width="2"/>' +
      (hasPulse ? '<polyline points="' + line('pulse') + '" fill="none" stroke="' + COL_PULSE + '" stroke-width="1.5" stroke-dasharray="3,2"/>' : '') +
      dots('sys', COL_SYS) +
      dots('dia', COL_DIA) +
      (hasPulse ? dots('pulse', COL_PULSE) : '') +
      xLabels +
      '</svg>' +
      '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;font-size:.72rem;color:var(--text-3,#8b9097);margin-top:4px;">' +
        '<span><b style="color:' + COL_SYS + ';">●</b> sistolični</span>' +
        '<span><b style="color:' + COL_DIA + ';">●</b> diastolični</span>' +
        '<span><b style="color:' + COL_PULSE + ';">●</b> pulz</span>' +
        '<span>razpon ' + Math.min(...allVals) + '–' + Math.max(...allVals) + '</span>' +
      '</div>';
  }

  /**
   * Tabela meritev z ESC/ESH oznako in gumbom za izbris.
   */
  function tableHtml(recent) {
    if (!recent.length) {
      return '<div style="color:var(--text-3,#8b9097);font-size:.8rem;padding:12px;text-align:center;">Še ni zabeleženih meritev tlaka.</div>';
    }

    const rows = recent.slice().reverse().map(x => {
      const e = x.e;
      const cat = classifyBp(e.sys, e.dia);
      const isMorning = e.time && parseInt(e.time.split(':')[0], 10) >= 4 && parseInt(e.time.split(':')[0], 10) < 12;
      const isEvening = e.time && parseInt(e.time.split(':')[0], 10) >= 17 && parseInt(e.time.split(':')[0], 10) <= 23;
      const icon = isMorning ? '🌅' : (isEvening ? '🌙' : '⏱️');

      const parts = (e.date || '').split('-');
      const dateStr = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : e.date;

      let badgeHtml = '';
      if (cat) {
        badgeHtml = '<span style="display:inline-block;padding:2px 6px;border-radius:6px;font-size:.68rem;font-weight:700;background:' + cat.color + '22;color:' + cat.color + ';border:1px solid ' + cat.color + '44;">' +
          esc(cat.shortLabel) + (cat.doctorAdvice ? ' · pokaži zdravniku' : '') + '</span>';
      }

      return '<tr style="border-bottom:1px solid var(--edge-1,rgba(255,255,255,0.06));">' +
        '<td style="padding:8px 6px;font-size:.75rem;color:var(--text-2,#b4b9c0);white-space:nowrap;">' +
          icon + ' ' + esc(dateStr) + (e.time ? '<div style="font-size:.68rem;color:var(--text-3);">' + esc(e.time) + '</div>' : '') +
        '</td>' +
        '<td style="padding:8px 6px;font-weight:800;font-variant-numeric:tabular-nums;font-size:.85rem;white-space:nowrap;">' +
          esc(e.sys) + '/' + esc(e.dia) +
        '</td>' +
        '<td style="padding:8px 6px;font-size:.78rem;font-variant-numeric:tabular-nums;color:var(--text-2);text-align:center;">' +
          (e.pulse ? esc(e.pulse) : '–') +
        '</td>' +
        '<td style="padding:8px 6px;">' + badgeHtml + '</td>' +
        '<td style="padding:8px 2px;text-align:right;">' +
          '<button type="button" data-bp-act="del" data-idx="' + x.i + '" aria-label="Izbriši meritev" ' +
            'style="min-width:44px;min-height:44px;background:none;border:none;cursor:pointer;font-size:1rem;color:var(--text-3);padding:0;touch-action:manipulation;">🗑️</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:8px;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:.78rem;text-align:left;">' +
        '<thead>' +
          '<tr style="border-bottom:1px solid var(--edge-2,rgba(255,255,255,0.12));font-size:.68rem;color:var(--text-3);text-transform:uppercase;">' +
            '<th style="padding:6px;font-weight:700;">Datum/Ura</th>' +
            '<th style="padding:6px;font-weight:700;">Tlak</th>' +
            '<th style="padding:6px;font-weight:700;text-align:center;">Pulz</th>' +
            '<th style="padding:6px;font-weight:700;">ESC/ESH</th>' +
            '<th style="padding:6px;text-align:right;"></th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
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
      if (root.DanesPodatki && root.DanesPodatki.renderDanes) root.DanesPodatki.renderDanes();
      else renderHistory('bpHistRoot');
    }
  }

  /**
   * Prikaz zgodovine: kartice povprečij (7 dni, jutro vs večer), mini SVG graf, tabela.
   */
  function renderHistory(rootId) {
    if (typeof document === 'undefined') return;
    const host = document.getElementById(rootId || 'bpHistRoot');
    if (!host) return;

    const log = getLog();
    const avg7 = calculate7DayAverage(log);
    const split = splitMorningEvening(log);
    const recent = log.map((e, i) => ({ e, i })).slice(-HIST_N);
    const pts = recent.map(x => ({
      date: x.e.date,
      sys: Number(x.e.sys),
      dia: Number(x.e.dia),
      pulse: x.e.pulse != null ? Number(x.e.pulse) : null
    }));

    // Povzetek v karticah
    let statCardsHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">';

    // 7-dnevno povprečje
    statCardsHtml += '<div style="background:var(--surface-2,#181b20);border:1px solid var(--edge-1,#2a2d33);border-radius:12px;padding:10px;">' +
      '<div style="font-size:.68rem;color:var(--text-3,#8b9097);font-weight:700;text-transform:uppercase;">Povprečje 7 dni</div>' +
      (avg7.count ? (
        '<div style="font-size:1.15rem;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums;">' +
          avg7.avgSys + '/' + avg7.avgDia +
          (avg7.avgPulse ? ' <span style="font-size:.72rem;color:var(--text-3);font-weight:600;">· ' + avg7.avgPulse + ' bpm</span>' : '') +
        '</div>' +
        (avg7.classification ? (
          '<div style="font-size:.7rem;margin-top:3px;color:' + avg7.classification.color + ';font-weight:700;">' +
            esc(avg7.classification.shortLabel) +
            (avg7.classification.doctorAdvice ? ' · »pokaži zdravniku«' : '') +
          '</div>'
        ) : '')
      ) : '<div style="font-size:.8rem;color:var(--text-3);margin-top:4px;">Ni meritev (7 d)</div>') +
    '</div>';

    // Jutro vs Večer
    statCardsHtml += '<div style="background:var(--surface-2,#181b20);border:1px solid var(--edge-1,#2a2d33);border-radius:12px;padding:10px;">' +
      '<div style="font-size:.68rem;color:var(--text-3,#8b9097);font-weight:700;text-transform:uppercase;">Jutro vs. Večer</div>' +
      '<div style="font-size:.75rem;margin-top:4px;display:flex;flex-direction:column;gap:2px;">' +
        '<div>🌅 Jutro: ' + (split.morning.count ? ('<strong style="font-variant-numeric:tabular-nums;">' + split.morning.avgSys + '/' + split.morning.avgDia + '</strong> <span style="color:var(--text-3);font-size:.68rem;">(' + split.morning.count + ')</span>') : '<span style="color:var(--text-3);">–</span>') + '</div>' +
        '<div>🌙 Večer: ' + (split.evening.count ? ('<strong style="font-variant-numeric:tabular-nums;">' + split.evening.avgSys + '/' + split.evening.avgDia + '</strong> <span style="color:var(--text-3);font-size:.68rem;">(' + split.evening.count + ')</span>') : '<span style="color:var(--text-3);">–</span>') + '</div>' +
      '</div>' +
    '</div>';

    statCardsHtml += '</div>';

    let html = '<div style="margin-bottom:8px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<span style="font-weight:800;font-size:.88rem;color:var(--text-1,#F4F5F6);">🩺 Krvni tlak (Beurer BM 27)</span>' +
        '<button type="button" class="btn secondary" data-bp-act="csv"' + (log.length ? '' : ' disabled') +
        ' style="min-height:44px;padding:8px 12px;font-size:.75rem;touch-action:manipulation;">📋 CSV</button>' +
      '</div>' +
      '<div style="font-size:.72rem;color:var(--text-3,#8b9097);margin-bottom:10px;">' +
        'Nevtralna razvrstitev po ESC/ESH smernicah brez diagnoze. Ob odstopanjih pokaži zdravniku.' +
      '</div>' +
      statCardsHtml +
      chartHtml(pts) +
      '<div style="margin-top:12px;">' +
        '<div style="font-size:.72rem;color:var(--text-3,#8b9097);font-weight:700;text-transform:uppercase;margin-bottom:4px;">' +
          'Zgodovina meritev (' + recent.length + ' od ' + log.length + ')' +
        '</div>' +
        tableHtml(recent) +
      '</div>' +
    '</div>';

    host.innerHTML = html;
    if (!host.__bpBound) {
      host.__bpBound = true;
      host.addEventListener('click', onHistClick);
    }
  }

  // ---------- Vstopne točke ----------

  function pick() {
    if (typeof document === 'undefined') return;
    let inp = document.getElementById('bpPhotoInput');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.id = 'bpPhotoInput';
      inp.style.display = 'none';
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
      if (typeof root.compressAndResizeImage !== 'function') {
        throw new Error('compressAndResizeImage ni na voljo.');
      }
      const res = await root.compressAndResizeImage(file, { maxDim: 1400, initialQuality: 0.85, maxSizeKB: 400 });
      renderLoading('Berem zaslon merilnika…');
      const r = await readMeter(res.dataUrl);
      if (!r.found) return renderError(r.note || 'Na sliki ne vidim zaslona merilnika.');
      renderConfirm(r);
    } catch (e) {
      renderError(e && e.message ? e.message : String(e));
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => renderHistory('bpHistRoot'));
    } else {
      renderHistory('bpHistRoot');
    }
  }

  const api = {
    pick,
    handleFile,
    getLog,
    save,
    syncManual,
    deleteAt,
    renderHistory,
    classifyBp,
    calculate7DayAverage,
    splitMorningEvening,
    toCsv,
    LS_LOG
  };

  root.BpVision = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));