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
  const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
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
  const stdDev = (xs) => {
    const v = xs.filter((x) => x != null);
    if (v.length < 2) return null;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const variance = v.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (v.length - 1);
    return Math.sqrt(variance);
  };
  const hm = (min) => min == null ? '–' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayIso = () => new Date().toLocaleDateString('sv-SE');
  function readJson(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; } catch (e) { return fb; }
  }

  function formatSinhroStarost(ts) {
    if (!ts) return null;
    let ms = 0;
    if (typeof ts === 'number') {
      const numTs = ts < 1e11 ? ts * 1000 : ts;
      ms = Date.now() - numTs;
    } else {
      const parsed = Date.parse(ts);
      if (isNaN(parsed)) return null;
      ms = Date.now() - parsed;
    }
    if (isNaN(ms) || ms < 0) return 'ravnokar';
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'ravnokar';
    if (min === 1) return 'pred 1 min';
    if (min < 60) return `pred ${min} min`;
    const h = Math.floor(min / 60);
    const ostMin = min % 60;
    if (h < 24) {
      return ostMin > 0 ? `pred ${h} h ${ostMin} min` : (h === 1 ? 'pred 1 h' : (h === 2 ? 'pred 2 h' : `pred ${h} h`));
    }
    const d = Math.floor(h / 24);
    if (d === 1) return 'včeraj';
    if (d === 2) return 'pred 2 dnevoma';
    return `pred ${d} dnevi`;
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
        const fetchTime = Date.now();
        try { localStorage.setItem(LS_CACHE, JSON.stringify({ t: fetchTime, j })); } catch (e) { /* poln */ }
        return { status: 'ok', data: j, fetchTime };
      } catch (e) { last = e.name === 'AbortError' ? 'timeout' : 'offline'; }
    }
    try {
      const c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
      if (c && c.j) return { status: 'cache', data: c.j, cacheTime: c.t, cacheAge: Date.now() - c.t, err: last };
    } catch (e) { /* ignore */ }
    return { status: 'offline', err: last };
  }

  /** Iz zadnjih dni izračuna ključne vrednosti. Regeneracija = HRV in RHR proti lastni 30-dnevni osnovi (+spanje).
   * Ob premalo podatkov (<7 dni) vrne rec: null in premaloPodatkov: true (prikaz »premalo podatkov« namesto številke).
   */
  function izracunaj(dnevi) {
    if (typeof window !== 'undefined' && window.RecoveryEngine && typeof window.RecoveryEngine.calculateDailyRecovery === 'function') {
      return window.RecoveryEngine.calculateDailyRecovery(dnevi);
    }
    if (!Array.isArray(dnevi) || dnevi.length === 0) return null;
    const danes = new Date().toLocaleDateString('sv-SE');
    const urejeni = [...dnevi].filter(d => d && d.datum).sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
    if (!urejeni.length) return null;

    // zadnji poln dan z nočnimi meritvami (HRV ali spanje)
    const polni = urejeni.filter((d) => d.datum !== danes || num(d.spanjeMin) != null);
    const z = [...polni].reverse().find((d) => num(d.hrv) != null || num(d.spanjeMin) != null);
    if (!z) return null;

    const pred = urejeni.filter((d) => d.datum < z.datum).slice(-30);
    const hrvVals = pred.map((d) => num(d.hrv)).filter((x) => x != null);
    const rhrVals = pred.map((d) => num(d.rhr)).filter((x) => x != null);
    const dniOsnove = Math.min(hrvVals.length, rhrVals.length);
    const premaloPodatkov = dniOsnove < 7;

    const hrvOsn = hrvVals.length ? avg(hrvVals) : null;
    const rhrOsn = rhrVals.length ? avg(rhrVals) : null;
    const spOsn = avg(pred.map((d) => num(d.spanjeMin)));
    const hrv = num(z.hrv), rhr = num(z.rhr), sp = num(z.spanjeMin);

    const hrvSd = stdDev(hrvVals);
    const rhrSd = stdDev(rhrVals);
    const hrvLo = (hrvOsn != null && hrvSd != null) ? Math.round(hrvOsn - hrvSd) : null;
    const hrvHi = (hrvOsn != null && hrvSd != null) ? Math.round(hrvOsn + hrvSd) : null;
    const rhrLo = (rhrOsn != null && rhrSd != null) ? Math.round(rhrOsn - rhrSd) : null;
    const rhrHi = (rhrOsn != null && rhrSd != null) ? Math.round(rhrOsn + rhrSd) : null;

    // Opozorilo ob odstopanju HRV/RHR od osnovnega pasu (samo ob dovolj podatkih)
    const opozorila = [];
    if (!premaloPodatkov) {
      if (hrv != null && hrvOsn != null && hrvSd != null) {
        if (hrv < hrvLo) {
          opozorila.push({
            tip: 'hrv-pod',
            naslov: 'HRV je danes pod tvojim 30-dnevnim območjem',
            tekst: `HRV je danes pod tvojim 30-dnevnim območjem (${Math.round(hrv)} ms proti običajnemu pasu ${hrvLo}–${hrvHi} ms).`
          });
        } else if (hrv > hrvHi) {
          opozorila.push({
            tip: 'hrv-nad',
            naslov: 'HRV je danes nad tvojim 30-dnevnim območjem',
            tekst: `HRV je danes nad tvojim 30-dnevnim območjem (${Math.round(hrv)} ms proti običajnemu pasu ${hrvLo}–${hrvHi} ms).`
          });
        }
      }
      if (rhr != null && rhrOsn != null && rhrSd != null) {
        if (rhr > rhrHi) {
          opozorila.push({
            tip: 'rhr-nad',
            naslov: 'RHR je danes nad tvojim 30-dnevnim območjem',
            tekst: `Utrip v mirovanju (RHR) je danes nad tvojim 30-dnevnim območjem (${Math.round(rhr)} bpm proti običajnemu pasu ${rhrLo}–${rhrHi} bpm).`
          });
        } else if (rhr < rhrLo) {
          opozorila.push({
            tip: 'rhr-pod',
            naslov: 'RHR je danes pod tvojim 30-dnevnim območjem',
            tekst: `Utrip v mirovanju (RHR) je danes pod tvojim 30-dnevnim območjem (${Math.round(rhr)} bpm proti običajnemu pasu ${rhrLo}–${rhrHi} bpm).`
          });
        }
      }
    }

    // Personaliziran spalni cilj: povprečje zadnjih 14 noči s spodnjo mejo 7 h (420 min). Fallback 8 h (480 min).
    const nocne = urejeni.filter((d) => d.datum <= z.datum && num(d.spanjeMin) != null);
    const zadnjih14 = nocne.slice(-14);
    const avg14Min = avg(zadnjih14.map((d) => num(d.spanjeMin)));
    const spalniCiljMin = avg14Min != null ? Math.max(7 * 60, Math.round(avg14Min)) : 480;

    // Spalni dolg zadnjih 7 dni kot preprosta vsota razlik (cilj - dejansko)
    const zadnjih7 = nocne.slice(-7);
    let spalniDolgMin = null;
    if (zadnjih7.length > 0) {
      spalniDolgMin = zadnjih7.reduce((sum, d) => sum + (spalniCiljMin - num(d.spanjeMin)), 0);
    }

    // Ocena regeneracije 0–100 (orientacijska): 50 % HRV, 25 % RHR, 25 % spanje glede na personaliziran cilj.
    // Če je podatkov osnovne linije premalo (<7 dni), rec ostane null!
    let rec = null;
    if (!premaloPodatkov) {
      const deli = [];
      if (hrv != null && hrvOsn) deli.push([0.5, clamp(50 + (hrv / hrvOsn - 1) * 150, 0, 100)]);
      if (rhr != null && rhrOsn) deli.push([0.25, clamp(50 - (rhr / rhrOsn - 1) * 300, 0, 100)]);
      if (sp != null) deli.push([0.25, clamp((sp / spalniCiljMin) * 100, 0, 100)]);
      if (deli.length) { const w = deli.reduce((a, [x]) => a + x, 0); rec = Math.round(deli.reduce((a, [x, v]) => a + x * v, 0) / w); }
    }

    const bud = num(z.budnoMin), lah = num(z.spanjeLahkoMin), glo = num(z.spanjeGlobokoMin), rem = num(z.spanjeRemMin);
    const vsota = [bud, lah, glo, rem].reduce((a, b) => a + (b || 0), 0);
    return {
      datum: z.datum, hrv, rhr, sp, hrvOsn, rhrOsn, spOsn, rec,
      premaloPodatkov, dniOsnove,
      recStatus: premaloPodatkov ? 'premalo_podatkov' : 'ok',
      recText: premaloPodatkov ? 'premalo podatkov' : (rec != null ? `${rec}%` : '–'),
      hrvSd, rhrSd, hrvLo, hrvHi, rhrLo, rhrHi,
      opozorila,
      spalniCiljMin, spalniDolgMin,
      hrvRel: !premaloPodatkov && hrv != null && hrvOsn ? Math.round((hrv / hrvOsn - 1) * 100) : null,
      faze: vsota > 0 ? { bud, lah, glo, rem, vsota } : null,
      spanjeOd: z.spanjeOd, spanjeDo: z.spanjeDo,
      koraki: num((urejeni.find((d) => d.datum === danes) || {}).koraki),
      azm: num((urejeni.find((d) => d.datum === danes) || {}).azm),
      korakiVceraj: num(z.koraki), azmVceraj: num(z.azm),
      vsiDnevi: urejeni,
    };
  }

  function setRing(id, dash, frac) {
    const el = $(id); if (!el) return;
    el.setAttribute('stroke-dashoffset', String(dash * (1 - clamp(frac, 0, 1))));
  }

  let trendiDni = 7;
  let zadnjiDnevi = null;

  function setTrendiDni(dni) {
    trendiDni = dni === 30 ? 30 : 7;
    renderTrendi(zadnjiDnevi);
  }

  function sparklineSvg(series, unit, colorHex) {
    if (!series || series.length < 2) {
      return '<div style="font-size:0.75rem;color:var(--text-3);padding:10px 0;text-align:center;">Premalo podatkov za to obdobje</div>';
    }
    const W = 320, H = 76, PX = 14, PY = 10;
    const vals = series.map((s) => s.val);
    const m = avg(vals);
    const sd = stdDev(vals);
    const bandLo = (m != null && sd != null) ? m - sd : null;
    const bandHi = (m != null && sd != null) ? m + sd : null;

    let minV = Math.min(...vals);
    let maxV = Math.max(...vals);
    if (bandLo != null) minV = Math.min(minV, bandLo);
    if (bandHi != null) maxV = Math.max(maxV, bandHi);
    if (maxV - minV < 0.1) { minV -= 1; maxV += 1; }
    const pad = (maxV - minV) * 0.1;
    minV -= pad; maxV += pad;

    const getX = (i) => PX + (W - 2 * PX) * i / (series.length - 1);
    const getY = (v) => H - PY - (H - 2 * PY) * (v - minV) / (maxV - minV);

    let bandRect = '';
    let meanLine = '';
    if (bandLo != null && bandHi != null) {
      const topY = getY(bandHi);
      const botY = getY(bandLo);
      const hBand = Math.max(2, botY - topY);
      bandRect = `<rect x="${PX}" y="${topY.toFixed(1)}" width="${W - 2 * PX}" height="${hBand.toFixed(1)}" fill="rgba(255,255,255,0.06)" rx="4"/>`;
      meanLine = `<line x1="${PX}" x2="${W - PX}" y1="${getY(m).toFixed(1)}" y2="${getY(m).toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3"/>`;
    }

    const pts = series.map((s, i) => `${getX(i).toFixed(1)},${getY(s.val).toFixed(1)}`).join(' ');
    const dots = series.map((s, i) => `<circle cx="${getX(i).toFixed(1)}" cy="${getY(s.val).toFixed(1)}" r="2.5" fill="${colorHex}"><title>${esc(s.date)}: ${s.val} ${unit}</title></circle>`).join('');

    const latest = series[series.length - 1].val;
    const firstDate = series[0].date;
    const lastDate = series[series.length - 1].date;

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" style="overflow: visible;">
        ${bandRect}
        ${meanLine}
        <polyline points="${pts}" fill="none" stroke="${colorHex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:var(--text-3);margin-top:2px;margin-bottom:12px;">
        <span>${esc(firstDate)}</span>
        <span>zadnja: <b style="color:#fff;">${latest} ${unit}</b> · pas ±1 SD: ${m != null ? m.toFixed(1) : '–'}${sd != null ? ' ± ' + sd.toFixed(1) : ''} ${unit}</span>
        <span>${esc(lastDate)}</span>
      </div>
    `;
  }

  function renderTrendi(dnevi) {
    const host = $('danesTrendiRoot');
    if (!host) return;

    const btns = document.querySelectorAll('.trendi-btn');
    btns.forEach((b) => {
      const d = Number(b.dataset.dni);
      if (d === trendiDni) {
        b.style.background = 'var(--rec-green)';
        b.style.color = '#08090A';
      } else {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-2)';
      }
    });

    if (!dnevi || !Array.isArray(dnevi) || dnevi.length === 0) {
      host.innerHTML = `
        <div style="text-align: center; padding: 20px 12px; color: var(--text-3); font-size: 0.8rem;">
          <div style="font-size: 1.5rem; margin-bottom: 6px;">📊</div>
          <div style="color: var(--text-2); font-weight: 600; margin-bottom: 4px;">Ni podatkov ure za prikaz trendov</div>
          <div>Ko bo ura povezana in podatki naloženi, se tukaj prikažejo ${trendiDni}-dnevni trendi z osnovnim pasom (±1 SD). Brez povezave se ne prikazujejo izmišljene številke.</div>
        </div>
      `;
      return;
    }

    const slice = dnevi.slice(-trendiDni);
    const hrvSeries = slice.map((d) => ({ date: d.datum, val: num(d.hrv) })).filter((x) => x.val != null);
    const rhrSeries = slice.map((d) => ({ date: d.datum, val: num(d.rhr) })).filter((x) => x.val != null);
    const spSeries = slice.map((d) => ({ date: d.datum, val: num(d.spanjeMin) != null ? Math.round((num(d.spanjeMin) / 60) * 10) / 10 : null })).filter((x) => x.val != null);

    let html = '';
    html += '<div style="margin-bottom: 6px;">';
    html += '<div class="bento-label" style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>HRV (Variabilnost srčnega utripa)</span><span style="color:var(--rec-green);">ms</span></div>';
    html += sparklineSvg(hrvSeries, 'ms', 'var(--rec-green)');
    html += '</div>';

    html += '<div style="margin-bottom: 6px;">';
    html += '<div class="bento-label" style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>RHR (Utrip v mirovanju)</span><span style="color:#FF6B5B;">bpm</span></div>';
    html += sparklineSvg(rhrSeries, 'bpm', '#FF6B5B');
    html += '</div>';

    html += '<div style="margin-bottom: 6px;">';
    html += '<div class="bento-label" style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Spanje (trajanje)</span><span style="color:var(--sleep-purple, #B388FF);">h</span></div>';
    html += sparklineSvg(spSeries, 'h', 'var(--sleep-purple, #B388FF)');
    html += '</div>';

    host.innerHTML = html;
  }

  function posodobiBeastMode(v, res) {
    const overlay = $('beastModeOverlay');
    if (!overlay) return;
    const title = overlay.querySelector('.beast-title');
    const quote = overlay.querySelector('.beast-quote');
    const badge = overlay.querySelector('.beast-badge');

    if (v && v.rec != null && !v.premaloPodatkov) {
      if (title) {
        title.style.display = '';
        title.textContent = `${v.rec}% RECOVERY · ${v.rec >= 85 ? 'MAXIMUM ENERGY' : v.rec >= 70 ? 'DOBRA ENERGIJA' : 'ZMERNA ENERGIJA'}`;
      }
      if (quote) {
        quote.style.display = '';
        if (v.rec >= 85) quote.textContent = '»Telo je spočito, centralni živčni sistem je na vrhuncu. Danes je dan za rušenje rekordov!«';
        else if (v.rec >= 70) quote.textContent = '»Dobra regeneracija. Telo je pripravljeno na produktiven trening.«';
        else quote.textContent = '»Regeneracija je zmerna. Prilagodi volumen in poskrbi za kakovosten počitek.«';
      }
      if (badge) {
        badge.textContent = v.rec >= 85 ? '🔥 BEAST MODE AKTIVEN' : '⚡ REGENERACIJA';
      }
    } else if (v && v.premaloPodatkov) {
      if (title) {
        title.style.display = '';
        title.textContent = 'PREMALO PODATKOV (<7 DNI)';
      }
      if (quote) {
        quote.style.display = '';
        quote.textContent = 'Za zanesljivo oceno regeneracije je potrebnih vsaj 7 zaporednih dni nočnih meritev HRV in RHR.';
      }
      if (badge) {
        badge.textContent = '📊 ZBIRANJE PODATKOV';
      }
    } else {
      // Brez podatkov ure
      if (title) {
        title.style.display = 'none';
        title.textContent = '–';
      }
      if (quote) {
        quote.style.display = '';
        quote.textContent = (res && res.status === 'no-token')
          ? 'Podatki ure niso povezani. Tapni na napis pod obročem in vnesi kodo za povezavo ure.'
          : 'Podatki ure niso na voljo. Poveži uro za spremljanje regeneracije.';
      }
      if (badge) {
        badge.textContent = '⚪ NI PODATKOV';
      }
    }
  }

  function prikazi(v, res) {
    zadnjiDnevi = (v && v.vsiDnevi) ? v.vsiDnevi : (res && res.data && Array.isArray(res.data.dnevi) ? res.data.dnevi : null);

    const recEl = $('heroRecoveryNum');
    if (recEl) {
      if (v && v.rec != null && !v.premaloPodatkov) {
        recEl.textContent = v.rec + '%';
        recEl.style.fontSize = '';
        recEl.style.lineHeight = '';
        recEl.style.color = 'var(--rec-green)';
        recEl.style.textShadow = '';
      } else if (v && v.premaloPodatkov) {
        recEl.textContent = 'premalo podatkov';
        recEl.style.fontSize = '0.95rem';
        recEl.style.lineHeight = '1.2';
        recEl.style.color = 'var(--text-2)';
        recEl.style.textShadow = 'none';
      } else {
        recEl.textContent = '–';
        recEl.style.fontSize = '';
        recEl.style.lineHeight = '';
        recEl.style.color = 'var(--text-3)';
        recEl.style.textShadow = 'none';
      }
    }
    setRing('ringRecovery', 477.5, (v && v.rec != null && !v.premaloPodatkov) ? v.rec / 100 : 0);

    const hrvEl = $('heroHrvRhr');
    if (hrvEl) hrvEl.innerHTML = v && (v.hrv != null || v.rhr != null)
      ? `${v.hrv != null ? Math.round(v.hrv) : '–'}<span class="enota"> ms</span><div class="hero-rhr">${v.rhr != null ? Math.round(v.rhr) : '–'}<span class="enota"> bpm mir.</span></div>`
      : '–';
    const hrvSub = $('heroHrvSub');
    if (hrvSub) {
      if (v && v.premaloPodatkov) {
        hrvSub.textContent = `osnova: ${v.dniOsnove || 0}/7 dni`;
        hrvSub.style.color = 'var(--text-3)';
      } else if (v && v.hrvRel != null) {
        hrvSub.textContent = `${v.hrvRel >= 0 ? '+' : ''}${v.hrvRel} % proti osnovi`;
        hrvSub.style.color = v.hrvRel >= -5 ? 'var(--rec-green)' : 'var(--rec-yellow, #FFC23D)';
      } else if (v && v.hrv != null) {
        hrvSub.textContent = 'ni 30d osnove';
        hrvSub.style.color = 'var(--text-3)';
      } else {
        hrvSub.textContent = (res && res.status === 'no-token') ? 'ni povezave' : 'ni podatka';
        hrvSub.style.color = 'var(--text-3)';
      }
    }
    const spEl = $('heroSpanje');
    if (spEl) spEl.textContent = v && v.sp != null ? hm(v.sp) : '–';
    const spSub = $('heroSpanjeSub');
    if (spSub) {
      if (v && v.sp != null && v.spalniCiljMin != null) {
        const pct = Math.round((v.sp / v.spalniCiljMin) * 100);
        spSub.textContent = `${pct} % od cilja (${hm(v.spalniCiljMin)})`;
      } else if (v && v.sp != null) {
        spSub.textContent = 'brez cilja';
      } else {
        spSub.textContent = '–';
      }
    }

    // Posodobi tudi motivacijski toast za spanje (brez trdo zapisanega 8h)
    const mascotToastText = $('mascotToastText');
    if (mascotToastText) {
      if (v && v.sp != null) {
        mascotToastText.textContent = `${hm(v.sp)} spanja = naravni anabolik!`;
      } else {
        mascotToastText.textContent = 'Kakovosten spanec je naravni anabolik!';
      }
    }

    // Posodobi BEAST MODE overlay z dejansko vrednostjo ali praznim stanjem
    posodobiBeastMode(v, res);

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
    if (glob) {
      let txt = f ? `Globoko: ${hm(f.glo)}${v.spanjeOd ? ` · ${v.spanjeOd}–${v.spanjeDo}` : ''}` : '';
      if (v && v.spalniCiljMin != null) {
        const dolgStr = v.spalniDolgMin != null
          ? (v.spalniDolgMin > 0 ? `+${hm(v.spalniDolgMin)} dolga` : '0 min dolga')
          : '–';
        txt += (txt ? ' · ' : '') + `Cilj: ${hm(v.spalniCiljMin)} · Dolg (7 dni): ${dolgStr}`;
      }
      glob.textContent = txt;
    }

    // Opozorila ob odstopanju HRV / RHR od 30-dnevnega osnovnega pasu
    const alertBox = $('danesHrvAlert');
    if (alertBox) {
      if (v && v.opozorila && v.opozorila.length > 0) {
        alertBox.style.display = 'block';
        alertBox.innerHTML = v.opozorila.map((o) => `
          <div style="background: rgba(255, 194, 61, 0.12); border: 1px solid var(--rec-yellow, #FFC23D); border-radius: 12px; padding: 10px 14px; font-size: 0.8rem; color: #fff; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--rec-yellow, #FFC23D); margin-bottom: 2px;">
              <span>⚡</span> <span>${esc(o.naslov)}</span>
            </div>
            <div>${esc(o.tekst)}</div>
            <div style="font-size: 0.7rem; color: var(--text-3); margin-top: 4px;">Informativno obvestilo o odstopanju od 30-dnevnega pasu ±1 SD (brez medicinske ocene).</div>
          </div>
        `).join('');
      } else {
        alertBox.style.display = 'none';
        alertBox.innerHTML = '';
      }
    }

    // Trendi 7 / 30 dni za HRV, RHR in spanje
    renderTrendi(zadnjiDnevi);

    // izvor podatkov: starost podatkov in stanje povezave
    const vir = $('danesVir');
    if (vir) {
      let t = '', c = 'var(--text-3)';
      if (res.status === 'no-token') {
        t = '⚪ Podatki ure niso povezani — tapni za vnos kode';
        c = 'var(--text-3)';
      } else if (res.status === 'bad-token') {
        t = '🔴 Koda za podatke ure ni veljavna (401) — tapni za ponovni vnos';
        c = '#FF6B5B';
      } else if (res.status === 'offline') {
        t = '🔴 Strežnik nedosegljiv in ni shranjenih podatkov v predpomnilniku';
        c = '#FF6B5B';
      } else if (res.status === 'cache') {
        const starost = formatSinhroStarost(res.cacheTime || (res.cacheAge ? Date.now() - res.cacheAge : null)) || 'pred nekaj časa';
        t = `🟡 Predpomnilnik (strežnik nedosegljiv) · sinhronizirano ${starost} · Fitbit Air`;
        c = '#FFC23D';
      } else {
        const s = res.data && res.data.sinhronizacija;
        const syncTs = s && (s.cas || s.zadnjiUspeh || s.zadnjaSinhronizacija || s.timestamp || s.posodobljeno);
        const starost = formatSinhroStarost(syncTs) || formatSinhroStarost(res.fetchTime) || 'ravnokar';
        const dni = v && v.datum ? Math.round((Date.parse(new Date().toLocaleDateString('sv-SE')) - Date.parse(v.datum)) / 864e5) : null;
        const kdaj = dni == null ? '' : dni <= 0 ? 'nocoj' : dni === 1 ? 'včeraj' : `pred ${dni} dnevi`;
        const zastarelo = (dni != null && dni > 1) || (s && s.stanje === 'napaka');
        t = `${zastarelo ? '🟡' : '🟢'} Fitbit Air · sinhronizirano ${starost}${kdaj ? ` (${kdaj})` : ''}`;
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
    // Prednost ima shranjena zgodovina. Če je ni, prehrana uporablja privzeti TEST_14DAY_HISTORY (testni podatki):
    // takrat graf ne prikaže ničesar, da ne izgleda kot resnična teža.
    const shranjena = readJson(LS_WEIGHT, null);
    let h = Array.isArray(shranjena) ? shranjena : null;
    if (!h) {
      let ph = null;
      try { if (typeof prehranaState !== 'undefined' && prehranaState && Array.isArray(prehranaState.weightHistory)) ph = prehranaState.weightHistory; } catch (e) { ph = null; }
      let testni = false;
      try { testni = typeof TEST_14DAY_HISTORY !== 'undefined' && JSON.stringify(ph) === JSON.stringify(TEST_14DAY_HISTORY); } catch (e) { testni = false; }
      h = (ph && !testni) ? ph : [];
    }
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

  /** Vrne seznam dni iz zadnjega odgovora ali predpomnilnika (uporablja A02 časovnica). */
  function dnevi() {
    if (Array.isArray(zadnjiDnevi) && zadnjiDnevi.length > 0) return zadnjiDnevi;
    try {
      const c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
      if (c && c.j && Array.isArray(c.j.dnevi)) {
        zadnjiDnevi = c.j.dnevi;
        return zadnjiDnevi;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  /** Osveži vse danes-vezane dele (vrstica, graf teže, zgodovina tlaka). */
  function renderDanes() {
    // Takoj posodobi beastModeOverlay in toast (če je že shranjen cache ali prazno stanje),
    // da preprečimo prikaz trdo zapisanega "82% RECOVERY"
    if (zadnjiDnevi === null) {
      try {
        const c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
        if (c && c.j && Array.isArray(c.j.dnevi)) {
          zadnjiDnevi = c.j.dnevi;
          const v = izracunaj(zadnjiDnevi);
          prikazi(v, { status: 'cache', data: c.j, cacheTime: c.t, cacheAge: Date.now() - c.t });
        } else {
          posodobiBeastMode(null, { status: token() ? 'offline' : 'no-token' });
        }
      } catch (e) {
        posodobiBeastMode(null, { status: token() ? 'offline' : 'no-token' });
      }
    }

    renderMissing();
    renderWeight();
    renderTrendi(zadnjiDnevi);
    if (typeof window !== 'undefined' && window.BpVision && BpVision.renderHistory) BpVision.renderHistory('bpHistRoot');
  }

  root.DanesPodatki = {
    osvezi,
    povezi,
    renderDanes,
    exportDoctor,
    setTrendiDni,
    dnevi,
    _izracunaj: izracunaj,
    _vpisiDanes: vpisiDanes,
    _formatSinhroStarost: formatSinhroStarost,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DanesPodatki;
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
