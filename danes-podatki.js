/* Danes: pravi podatki ure (Fitbit Air → Google Health → Firestore → VPS /api/dnevno).
 * Zamenja trdo zapisane številke na zaslonu Danes (82 %, 74 ms / 54, 7h 42m, arhitektura spanja).
 * Dostop: zasebni žeton (X-Dnevno-Token), ki ga telefon dobi enkrat (?dnevno=… ali vpis) in hrani v localStorage.
 * Brez žetona ali brez povezave pokaže pošten prazen prikaz, nikoli izmišljenih številk.
 */
(function () {
  'use strict';
  const LS_TOKEN = 'bine_zdravje_dnevno_token';
  const LS_CACHE = 'bine_zdravje_dnevno_cache_v1';

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

  window.DanesPodatki = { osvezi, povezi, _izracunaj: izracunaj };
  if (typeof document !== 'undefined') {
    const go = () => { osvezi(); setInterval(osvezi, 15 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (!document.hidden) osvezi(); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
