/* Danes: pravi podatki ure (Fitbit Air → Google Health → Firestore → VPS /api/dnevno).
 * Zamenja trdo zapisane številke na zaslonu Danes (82 %, 74 ms / 54, 7h 42m, arhitektura spanja).
 * Dostop: zasebni žeton (X-Dnevno-Token), ki ga telefon dobi enkrat (?dnevno=… ali vpis) in hrani v localStorage.
 * Brez žetona ali brez povezave pokaže pošten prazen prikaz, nikoli izmišljenih številk.
 *
 * Dodano: informativna vrstica »Danes še ni vpisano« (brez push obvestil), graf teže iz weightHistory
 * (samo branje), prikaz zgodovine tlaka, povzetek za zdravnika (natisni/PDF ali kopiraj).
 */
(function () {
  'use strict';
  const LS_TOKEN = 'bine_zdravje_dnevno_token';
  const LS_CACHE = 'bine_zdravje_dnevno_cache_v1';
  const LS_DANES = 'bine_zdravje_danes_vnos';
  const LS_TLAK = 'bine_zdravje_tlak_log';
  const LS_WEIGHT = 'bine_zdravje_weight_history';
  const LS_CIKEL = 'bine_cikel_plan_v1';
  const LS_BW = 'bine_zdravje_bloodwork_data';

  // --- žeton: enkratni prevzem iz URL (?dnevno=...), nato odstranimo iz naslovne vrstice
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get('dnevno');
    if (t) {
      localStorage.setItem(LS_TOKEN, t.trim());
      u.searchParams.delete('dnevno');
      history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
    }
  } catch (e) { /* ignore */ }

  const token = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } };
  const $ = (id) => document.getElementById(id);
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const hm = (min) => min == null ? '–' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayIso = () => new Date().toLocaleDateString('sv-SE');
  function readJson(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; } catch (e) { return fb; }
  }

  async function endpoints() {
    const list = [];
    try {
      const r = await fetch('./food-vision-endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.url) list.push(j.url); }
    } catch (e) { /* ignore */ }
    if (location.protocol !== 'https:') list.push('http://100.101.68.31:8091');
    return [...new Set(list.map((u) => u.replace(/\/$/, '')))];
  }

  async function fetchDnevno() {
    const t = token();
    if (!t) return { status: 'no-token' };
    let last = 'offline';
    for (const ep of await endpoints()) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(ep + '/api/dnevno', { headers: { 'X-Dnevno-Token': t }, cache: 'no-store', signal: ctrl.signal });
        clearTimeout(to);
        if (r.status === 401) return { status: 'bad-token' };
        if (!r.ok) { last = 'HTTP ' + r.status; continue; }
        const j = await r.json();
        try { localStorage.setItem(LS_CACHE, JSON.stringify({ t: Date.now(), j })); } catch (e) { /* poln */ }
        return { status: 'ok', data: j };
      } catch (e) { last = e.name === 'AbortError' ? 'timeout' : 'offline'; }
    }
    try {
      const c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
      if (c && c.j) return { status: 'cache', data: c.j, cacheAge: Date.now() - c.t, err: last };
    } catch (e) { /* ignore */ }
    return { status: 'offline', err: last };
  }

  /** Iz zadnjih dni izračuna ključne vrednosti. Regeneracija = HRV in RHR proti lastni 30-dnevni osnovi (+spanje). */
  function izracunaj(dnevi) {
    const danes = new Date().toLocaleDateString('sv-SE');
    // zadnji poln dan z nočnimi meritvami (HRV ali spanje)
    const polni = dnevi.filter((d) => d.datum !== danes || num(d.spanjeMin) != null);
    const z = [...polni].reverse().find((d) => num(d.hrv) != null || num(d.spanjeMin) != null);
    if (!z) return null;
    const pred = dnevi.filter((d) => d.datum < z.datum).slice(-30);
    const hrvOsn = avg(pred.map((d) => num(d.hrv)));
    const rhrOsn = avg(pred.map((d) => num(d.rhr)));
    const spOsn = avg(pred.map((d) => num(d.spanjeMin)));
    const hrv = num(z.hrv), rhr = num(z.rhr), sp = num(z.spanjeMin);

    // Ocena regeneracije 0–100 (orientacijska): 50 % HRV, 25 % RHR, 25 % spanje glede na 8 h potrebe.
    let rec = null;
    const deli = [];
    if (hrv != null && hrvOsn) deli.push([0.5, clamp(50 + (hrv / hrvOsn - 1) * 150, 0, 100)]);
    if (rhr != null && rhrOsn) deli.push([0.25, clamp(50 - (rhr / rhrOsn - 1) * 300, 0, 100)]);
    if (sp != null) deli.push([0.25, clamp((sp / 480) * 100, 0, 100)]);
    if (deli.length) { const w = deli.reduce((a, [x]) => a + x, 0); rec = Math.round(deli.reduce((a, [x, v]) => a + x * v, 0) / w); }

    const bud = num(z.budnoMin), lah = num(z.spanjeLahkoMin), glo = num(z.spanjeGlobokoMin), rem = num(z.spanjeRemMin);
    const vsota = [bud, lah, glo, rem].reduce((a, b) => a + (b || 0), 0);
    return {
      datum: z.datum, hrv, rhr, sp, hrvOsn, rhrOsn, spOsn, rec,
      hrvRel: hrv != null && hrvOsn ? Math.round((hrv / hrvOsn - 1) * 100) : null,
      faze: vsota > 0 ? { bud, lah, glo, rem, vsota } : null,
      spanjeOd: z.spanjeOd, spanjeDo: z.spanjeDo,
      koraki: num((dnevi.find((d) => d.datum === danes) || {}).koraki),
      azm: num((dnevi.find((d) => d.datum === danes) || {}).azm),
      korakiVceraj: num(z.koraki), azmVceraj: num(z.azm),
    };
  }

  function setRing(id, dash, frac) {
    const el = $(id); if (!el) return;
    el.setAttribute('stroke-dashoffset', String(dash * (1 - clamp(frac, 0, 1))));
  }

  function prikazi(v, res) {
    const recEl = $('heroRecoveryNum');
    if (recEl) recEl.textContent = v && v.rec != null ? v.rec + '%' : '–';
    setRing('ringRecovery', 477.5, v && v.rec != null ? v.rec / 100 : 0);

    const hrvEl = $('heroHrvRhr');
    if (hrvEl) hrvEl.innerHTML = v && (v.hrv != null || v.rhr != null)
      ? `${v.hrv != null ? Math.round(v.hrv) : '–'}<span class="enota"> ms</span><div class="hero-rhr">${v.rhr != null ? Math.round(v.rhr) : '–'}<span class="enota"> bpm mir.</span></div>`
      : '–';
    const hrvSub = $('heroHrvSub');
    if (hrvSub) {
      if (v && v.hrvRel != null) {
        hrvSub.textContent = `${v.hrvRel >= 0 ? '+' : ''}${v.hrvRel} % proti osnovi`;
        hrvSub.style.color = v.hrvRel >= -5 ? 'var(--rec-green)' : 'var(--rec-yellow, #FFC23D)';
      } else { hrvSub.textContent = 'ni osnove'; hrvSub.style.color = 'var(--text-3)'; }
    }
    const spEl = $('heroSpanje');
    if (spEl) spEl.textContent = v ? hm(v.sp) : '–';
    const spSub = $('heroSpanjeSub');
    if (spSub) spSub.textContent = v && v.sp != null ? `${Math.round((v.sp / 480) * 100)} % od 8 h` : '–';

    // aktivnost: koraki danes (če jih še ni, včerajšnji dan), zunanji obroč = aktivne minute / 22
    const kEl = $('heroStrainNum'), kSub = $('heroStrainSub');
    const imaDanes = v && v.koraki != null;
    const k = v ? (imaDanes ? v.koraki : v.korakiVceraj) : null;
    const azm = v ? (imaDanes ? v.azm : v.azmVceraj) : null;
    if (kEl) kEl.textContent = k != null ? Math.round(k).toLocaleString('sl-SI') : '–';
    if (kSub) kSub.textContent = k == null ? '–' : `korakov ${imaDanes ? 'danes' : 'zadnji dan'}${azm != null ? ` · ${Math.round(azm)} akt. min` : ''}`;
    setRing('ringStrain', 596.9, azm != null ? azm / 22 : 0);

    // arhitektura spanja
    const f = v && v.faze;
    const kosi = { hypnoAwake: f && f.bud, hypnoLight: f && f.lah, hypnoDeep: f && f.glo, hypnoRem: f && f.rem };
    const imena = { hypnoAwake: 'Budno', hypnoLight: 'Lahko', hypnoDeep: 'Globoko', hypnoRem: 'REM' };
    for (const [id, min] of Object.entries(kosi)) {
      const seg = $(id); const leg = $(id + 'Leg');
      const pct = f ? Math.round(((min || 0) / f.vsota) * 100) : 0;
      if (seg) { seg.style.width = (f ? pct : 0) + '%'; seg.title = `${imena[id]} (${hm(min)})`; }
      if (leg) leg.textContent = f ? `${imena[id]} ${pct} % · ${hm(min)}` : `${imena[id]} –`;
    }
    const glob = $('hypnoSummary');
    if (glob) glob.textContent = f ? `Globoko: ${hm(f.glo)}${v.spanjeOd ? ` · ${v.spanjeOd}–${v.spanjeDo}` : ''}` : '';

    // izvor podatkov
    const vir = $('danesVir');
    if (vir) {
      let t = '', c = 'var(--text-3)';
      if (res.status === 'no-token') { t = '⚪ Podatki ure niso povezani — tapni za vnos kode'; }
      else if (res.status === 'bad-token') { t = '🔴 Koda za podatke ure ni veljavna — tapni za novo'; c = '#FF6B5B'; }
      else if (res.status === 'offline') { t = '🟡 Strežnik nedosegljiv, ni shranjenih podatkov'; c = '#FFC23D'; }
      else {
        const dni = v ? Math.round((Date.parse(new Date().toLocaleDateString('sv-SE')) - Date.parse(v.datum)) / 864e5) : null;
        const kdaj = dni == null ? '' : dni <= 0 ? 'nocoj' : dni === 1 ? 'pretekla noč' : `pred ${dni} dnevi`;
        const s = res.data && res.data.sinhronizacija;
        const zastarelo = (dni != null && dni > 1) || (s && s.stanje === 'napaka');
        t = `${zastarelo ? '🟡' : '🟢'} Fitbit Air · ${kdaj} (${v ? v.datum : '–'})${res.status === 'cache' ? ' · shranjeno' : ''}`;
        if (s && s.stanje === 'napaka') t += ' · sinhronizacija ne teče (Google prijava potekla)';
        c = zastarelo || (s && s.stanje === 'napaka') ? '#FFC23D' : 'var(--rec-green)';
      }
      vir.textContent = t; vir.style.color = c;
    }
  }

  function povezi() {
    const t = prompt('Vpiši kodo za podatke ure (dobiš jo od Hermesa / iz QR):', token());
    if (t === null) return;
    try { t.trim() ? localStorage.setItem(LS_TOKEN, t.trim()) : localStorage.removeItem(LS_TOKEN); } catch (e) { /* ignore */ }
    osvezi();
  }

  let tece = false;
  async function osvezi() {
    if (tece) return; tece = true;
    try {
      const res = await fetchDnevno();
      const v = res.data && Array.isArray(res.data.dnevi) ? izracunaj(res.data.dnevi) : null;
      prikazi(v, res);
      return { res, v };
    } finally { tece = false; }
  }

  // ---------- Zgodovina teže (samo branje weightHistory) ----------
  /** Vnosi teže: prehranaState.weightHistory (če je dostopen), sicer shranjena kopija v localStorage. Samo branje. */
  function weightSeries() {
    let h = null;
    try { if (typeof prehranaState !== 'undefined' && prehranaState && Array.isArray(prehranaState.weightHistory)) h = prehranaState.weightHistory; } catch (e) { h = null; }
    if (!h) h = readJson(LS_WEIGHT, []);
    return (Array.isArray(h) ? h : [])
      .filter((x) => x && x.date && num(x.weightKg) != null)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-30);
  }

  function weightChartHtml(s) {
    if (s.length < 2) return '<div style="font-size:0.8rem;color:var(--text-3);padding:8px 0;">Premalo podatkov</div>';
    const W = 320, H = 130, P = 22;
    const vals = s.map((x) => num(x.weightKg));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 0.5) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x = (i) => P + (W - 2 * P) * i / (s.length - 1);
    const y = (v) => H - P - (H - 2 * P) * (v - lo) / (hi - lo);
    const line = s.map((p, i) => x(i).toFixed(1) + ',' + y(num(p.weightKg)).toFixed(1)).join(' ');
    const dots = s.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(num(p.weightKg)).toFixed(1)}" r="2.5" fill="var(--rec-green)"><title>${esc(p.date)}: ${num(p.weightKg)} kg</title></circle>`).join('');
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Graf teže">' +
      '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P) + '" y2="' + (H - P) + '" stroke="rgba(255,255,255,0.12)"/>' +
      '<polyline points="' + line + '" fill="none" stroke="var(--rec-green)" stroke-width="2"/>' + dots +
      '</svg>' +
      '<div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-3);margin-top:2px;">' +
        '<span>' + esc(s[0].date) + '</span>' +
        '<span>min ' + minV.toFixed(1) + ' · max ' + maxV.toFixed(1) + ' kg · ' + s.length + ' vnosov</span>' +
        '<span>' + esc(s[s.length - 1].date) + '</span>' +
      '</div>';
  }

  // ---------- Današnji vpisi (informativno; brez push obvestil) ----------
  function vpisiDanes() {
    const t = todayIso();
    const dv = readJson(LS_DANES, null) || {};
    const tlakLog = readJson(LS_TLAK, []);
    const cikel = readJson(LS_CIKEL, {});
    const tlak = (Array.isArray(tlakLog) && tlakLog.some((x) => x.date === t)) || (dv.day === t && !!dv.tlak);
    const teza = (dv.day === t && !!dv.teza) || weightSeries().some((x) => x.date === t);
    const planZacet = !!(cikel && cikel.start);
    const vbod = planZacet ? !!(cikel.done && cikel.done[t]) : null; // null = plan ni začet, vrstica ga ne šteje
    return { tlak, teza, vbod };
  }

  function renderMissing() {
    const host = $('danesMissing');
    if (!host) return;
    const v = vpisiDanes();
    const manjka = [];
    if (!v.tlak) manjka.push('tlak');
    if (!v.teza) manjka.push('teža');
    if (v.vbod === false) manjka.push('vbod');
    const vpisano = [];
    if (v.tlak) vpisano.push('tlak');
    if (v.teza) vpisano.push('teža');
    if (v.vbod === true) vpisano.push('vbod');
    if (!manjka.length) {
      host.textContent = 'Danes vpisano: ' + vpisano.join(' / ') + '.';
      host.style.color = 'var(--rec-green)';
    } else {
      host.textContent = 'Danes še ni vpisano: ' + manjka.join(' / ');
      host.style.color = 'var(--text-2)';
    }
  }

  function renderWeight() {
    const host = $('weightChartRoot');
    if (!host) return;
    host.innerHTML = '<div class="bento-label" style="margin-bottom:6px;">Teža (zadnjih 30 vnosov)</div>' + weightChartHtml(weightSeries());
  }

  // ---------- Povzetek za zdravnika ----------
  function povzetekPodatki() {
    const CP = window.CikelPlan;
    const izvidi = (CP && CP.bloodworkHistory) ? CP.bloodworkHistory() : (() => {
      const old = readJson(LS_BW, null); return old && old.datum ? [old] : [];
    })();
    const tlak = readJson(LS_TLAK, []).slice(-14);
    const teza = weightSeries();
    return { izvidi, tlak, teza };
  }

  const f1 = (v) => v == null || isNaN(Number(v)) ? '–' : String(Number(v));

  function povzetekText(d) {
    const L = ['Povzetek za zdravnika · ' + todayIso(), 'Samo vpisani podatki, brez diagnoz in priporočil.', ''];
    L.push('IZVIDI (datum · HCT % · E2 pg/mL · skupni T ng/dL · GGT U/L)');
    if (!d.izvidi.length) L.push('  ni shranjenih izvidov');
    d.izvidi.forEach((x) => L.push(`  ${x.datum || '–'} · ${f1(x.hct)} · ${f1(x.e2)} · ${f1(x.totalT)} · ${f1(x.ggt)}`));
    L.push('');
    L.push('KRVNI TLAK (zadnjih 14: datum ura · sis/dia · pulz)');
    if (!d.tlak.length) L.push('  ni meritev');
    d.tlak.forEach((x) => L.push(`  ${x.date} ${x.time || ''} · ${x.sys}/${x.dia}${x.pulse ? ' · ' + x.pulse : ''}`));
    L.push('');
    L.push('TEŽA (zadnjih 30 vnosov: datum · kg)');
    if (!d.teza.length) L.push('  ni vnosov');
    d.teza.forEach((x) => L.push(`  ${x.date} · ${num(x.weightKg)}`));
    return L.join('\n');
  }

  function povzetekHtml(d) {
    const tbl = (head, rows) => '<table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + head.length + '">ni podatkov</td></tr>') +
      '</tbody></table>';
    return '<!doctype html><html lang="sl"><head><meta charset="utf-8"><title>Povzetek za zdravnika</title>' +
      '<style>body{font-family:-apple-system,system-ui,sans-serif;color:#111;margin:16px;font-size:13px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#eee}.note{color:#555;font-size:12px}@media print{button{display:none}}</style>' +
      '</head><body><h1 style="font-size:17px;margin:0">Povzetek za zdravnika</h1><div class="note">' + esc(todayIso()) + ' · samo vpisani podatki, brez diagnoz in priporočil</div>' +
      '<h2>Izvidi</h2>' + tbl(['Datum', 'HCT %', 'E2 pg/mL', 'Skupni T ng/dL', 'GGT U/L'],
        d.izvidi.map((x) => [x.datum || '–', f1(x.hct), f1(x.e2), f1(x.totalT), f1(x.ggt)])) +
      '<h2>Krvni tlak (zadnjih 14)</h2>' + tbl(['Datum', 'Ura', 'Sis/Dia mmHg', 'Pulz'],
        d.tlak.map((x) => [x.date, x.time || '', x.sys + '/' + x.dia, x.pulse || ''])) +
      '<h2>Teža (zadnjih 30 vnosov)</h2>' + tbl(['Datum', 'kg'],
        d.teza.map((x) => [x.date, f1(x.weightKg)])) +
      '<p><button onclick="window.print()">Natisni</button></p></body></html>';
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

  function toastMsg(msg) {
    if (typeof showMascotNotification === 'function') showMascotNotification(msg);
    else console.log('[Zdravnik]', msg);
  }

  /** mode: 'print' (okno za tiskanje/PDF) ali 'copy' (kopiraj besedilo). */
  function exportDoctor(mode) {
    const d = povzetekPodatki();
    if (mode === 'copy') {
      copyText(povzetekText(d)).then((ok) => toastMsg(ok ? 'Povzetek kopiran' : 'Kopiranje ni uspelo'));
      return;
    }
    const w = window.open('', '_blank');
    if (!w) {
      copyText(povzetekText(d)).then((ok) => toastMsg(ok ? 'Okno za tisk je blokirano — povzetek kopiran' : 'Okno za tisk je blokirano'));
      return;
    }
    w.document.open();
    w.document.write(povzetekHtml(d));
    w.document.close();
  }

  /** Osveži vse danes-vezane dele (vrstica, graf teže, zgodovina tlaka). */
  function renderDanes() {
    renderMissing();
    renderWeight();
    if (window.BpVision && BpVision.renderHistory) BpVision.renderHistory('bpHistRoot');
  }

  window.DanesPodatki = { osvezi, povezi, renderDanes, exportDoctor, _izracunaj: izracunaj, _vpisiDanes: vpisiDanes };
  if (typeof document !== 'undefined') {
    const go = () => {
      renderDanes();
      osvezi();
      setInterval(osvezi, 15 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { osvezi(); renderDanes(); } });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
