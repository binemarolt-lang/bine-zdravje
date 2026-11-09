/**
 * casovnica-ui.js
 * Časovna krivulja z oznakami sprememb protokola (RHR, HRV, globoki spanec).
 * Ročni SVG, brez zunanjih knjižnic, slog prilagojen aplikaciji Bine Zdravje.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasovnicaUI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LS_EVENTS_KEY = 'bine_casovnica_dogodki_v1';
  const LS_WATCH_CACHE = 'bine_zdravje_dnevno_cache_v1';

  // Privzeti dogodki iz KONTEKST.md
  const PRIVZETI_DOGODKI = [
    { id: 'ev-2026-09-27', datum: '2026-09-27', opis: 'Začetek: Testosteron + Dutasterid + Tadalafil' },
    { id: 'ev-2026-10-15', datum: '2026-10-15', opis: 'Uveden Vitamin D3 (4000 IU)' },
    { id: 'ev-2026-10-18', datum: '2026-10-18', opis: 'Uvedena večerna mešanica (glicin, NAC, vit C, badelj)' },
    { id: 'ev-2026-10-26', datum: '2026-10-26', opis: 'Ustavljen bor' },
    { id: 'ev-2026-11-02', datum: '2026-11-02', opis: 'Krvni izvid (Luís Marinho, Porto)' },
    { id: 'ev-2026-11-05', datum: '2026-11-05', opis: 'Dodan Boldenon (EQ 185 mg/t)' },
    { id: 'ev-2026-11-07', datum: '2026-11-07', opis: 'Dodan Ezetimib (10 mg)' }
  ];

  // Interno stanje UI komponente
  const state = {
    containerId: null,
    activeMode: 'vse', // 'vse' | 'rhr' | 'hrv' | 'globoki'
    selectedEventId: null,
    selectedDate: null,
    customDnevi: null // omogoča ročno injiciranje podatkov za testiranje
  };

  // --- DATUMSKI IN MATEMATIČNI POMOČNIKI (UTC varna aritmetika) ---
  function parseDateUtc(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.trim().split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(Date.UTC(y, m - 1, d));
  }

  function formatDateUtc(date) {
    if (!date) return '';
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(dateStr, n) {
    const dt = parseDateUtc(dateStr);
    if (!dt) return dateStr;
    dt.setUTCDate(dt.getUTCDate() + n);
    return formatDateUtc(dt);
  }

  function dateDiffInDays(dateStrA, dateStrB) {
    const dtA = parseDateUtc(dateStrA);
    const dtB = parseDateUtc(dateStrB);
    if (!dtA || !dtB) return 0;
    const msPerDay = 86400000;
    return Math.round((dtA.getTime() - dtB.getTime()) / msPerDay);
  }

  function formatDisplayDate(dateStr) {
    const dt = parseDateUtc(dateStr);
    if (!dt) return dateStr || '–';
    const dnevi = ['ned.', 'pon.', 'tor.', 'sre.', 'čet.', 'pet.', 'sob.'];
    const meseci = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'avg.', 'sep.', 'okt.', 'nov.', 'dec.'];
    const d = dt.getUTCDate();
    const m = meseci[dt.getUTCMonth()];
    const w = dnevi[dt.getUTCDay()];
    return `${w}, ${d}. ${m} ${dt.getUTCFullYear()}`;
  }

  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // --- UPRAVLJANJE DOGODKOV (localStorage) ---
  function loadEvents() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_EVENTS_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));
        }
      }
    } catch (e) {
      console.error('[CasovnicaUI] Napaka pri branju dogodkov:', e);
    }
    const privzeti = PRIVZETI_DOGODKI.slice().sort((a, b) => a.datum.localeCompare(b.datum));
    saveEvents(privzeti);
    return privzeti;
  }

  function saveEvents(events) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(events));
      }
    } catch (e) {
      console.error('[CasovnicaUI] Napaka pri shranjevanju dogodkov:', e);
    }
  }

  function addEvent(datum, opis) {
    if (!datum || !opis || typeof datum !== 'string' || typeof opis !== 'string') return null;
    const dClean = datum.trim();
    const oClean = opis.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dClean) || !oClean) return null;
    const events = loadEvents();
    const newEv = {
      id: 'ev-' + dClean + '-' + Math.random().toString(36).slice(2, 8),
      datum: dClean,
      opis: oClean
    };
    events.push(newEv);
    events.sort((a, b) => a.datum.localeCompare(b.datum));
    saveEvents(events);
    return newEv;
  }

  function deleteEvent(id) {
    if (!id) return false;
    const events = loadEvents();
    const filtered = events.filter(e => e.id !== id);
    if (filtered.length !== events.length) {
      saveEvents(filtered);
      return true;
    }
    return false;
  }

  // --- BRANJE PODATKOV URE ---
  function setDnevi(dnevi) {
    state.customDnevi = dnevi;
  }

  function getDnevi() {
    if (state.customDnevi) return state.customDnevi;
    if (typeof window !== 'undefined' && window.DanesPodatki) {
      if (Array.isArray(window.DanesPodatki.dnevi)) return window.DanesPodatki.dnevi;
      if (Array.isArray(window.DanesPodatki.vsiDnevi)) return window.DanesPodatki.vsiDnevi;
      if (Array.isArray(window.DanesPodatki.zadnjiDnevi)) return window.DanesPodatki.zadnjiDnevi;
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LS_WATCH_CACHE);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed) {
            if (parsed.j && Array.isArray(parsed.j.dnevi)) return parsed.j.dnevi;
            if (Array.isArray(parsed.dnevi)) return parsed.dnevi;
            if (Array.isArray(parsed)) return parsed;
          }
        }
      }
    } catch (e) {
      console.error('[CasovnicaUI] Napaka pri branju podatkov ure:', e);
    }
    return [];
  }

  function parseWatchDay(d) {
    if (!d || !d.datum) return null;
    return {
      datum: d.datum,
      rhr: numOrNull(d.rhr),
      hrv: numOrNull(d.hrv),
      globokiMin: numOrNull(d.spanjeGlobokoMin != null ? d.spanjeGlobokoMin : (d.globokiMin != null ? d.globokiMin : null))
    };
  }

  // --- KOLEDARSKI DNEVI IN OBVLADOVANJE LUKENJ ---
  function generateCalendarDays(startDate, endDate, rawDnevi) {
    const map = new Map();
    if (Array.isArray(rawDnevi)) {
      for (const item of rawDnevi) {
        if (item && item.datum) {
          map.set(item.datum, parseWatchDay(item));
        }
      }
    }
    const result = [];
    let cur = startDate;
    while (dateDiffInDays(cur, endDate) <= 0) {
      result.push({
        datum: cur,
        data: map.get(cur) || null
      });
      cur = addDays(cur, 1);
    }
    return result;
  }

  // --- IZRAČUN PRIMERJAVE »7 DNI PRED / 7 DNI PO« ---
  function calculatePrePost(eventDateStr, rawDnevi) {
    if (!eventDateStr || typeof eventDateStr !== 'string') return null;

    const map = new Map();
    if (Array.isArray(rawDnevi)) {
      for (const item of rawDnevi) {
        if (item && item.datum) {
          map.set(item.datum, parseWatchDay(item));
        }
      }
    }

    const preDates = [];
    for (let i = 7; i >= 1; i--) {
      preDates.push(addDays(eventDateStr, -i));
    }

    const postDates = [];
    for (let i = 1; i <= 7; i++) {
      postDates.push(addDays(eventDateStr, i));
    }

    function calcMetric(key) {
      const preVals = [];
      preDates.forEach(d => {
        const row = map.get(d);
        if (row && row[key] != null) preVals.push(row[key]);
      });

      const postVals = [];
      postDates.forEach(d => {
        const row = map.get(d);
        if (row && row[key] != null) postVals.push(row[key]);
      });

      const preCount = preVals.length;
      const postCount = postVals.length;
      const preAvg = preCount > 0 ? (preVals.reduce((a, b) => a + b, 0) / preCount) : null;
      const postAvg = postCount > 0 ? (postVals.reduce((a, b) => a + b, 0) / postCount) : null;
      const diff = (preAvg != null && postAvg != null) ? (postAvg - preAvg) : null;
      const premalo = preCount < 4 || postCount < 4;

      return {
        preAvg: preAvg != null ? Math.round(preAvg * 10) / 10 : null,
        postAvg: postAvg != null ? Math.round(postAvg * 10) / 10 : null,
        diff: diff != null ? Math.round(diff * 10) / 10 : null,
        preCount,
        postCount,
        premalo
      };
    }

    const rhr = calcMetric('rhr');
    const hrv = calcMetric('hrv');
    const globokiMin = calcMetric('globokiMin');
    const splosnoPremalo = rhr.premalo || hrv.premalo || globokiMin.premalo;

    return {
      eventDate: eventDateStr,
      rhr,
      hrv,
      globokiMin,
      premalo: splosnoPremalo,
      opomba: 'Sočasnost, ne vzrok. Manj kot 4 dni podatkov = premalo.'
    };
  }

  // --- ISKANJE DOGODKOV V OBMOČJU ±3 DNI ---
  function findEventsNearDate(targetDateStr, events, rangeDays = 3) {
    if (!targetDateStr || !Array.isArray(events)) return [];
    const res = [];
    events.forEach(ev => {
      if (!ev || !ev.datum) return;
      const diff = dateDiffInDays(ev.datum, targetDateStr);
      if (Math.abs(diff) <= rangeDays) {
        res.push({
          ...ev,
          diffInDays: diff
        });
      }
    });
    return res.sort((a, b) => a.datum.localeCompare(b.datum));
  }

  // --- ROČNI SVG IZRIS GRAFA S PREKINITVIJO ČRT PRI LUKNJAH ---
  function buildSvgPathWithGaps(calDays, metric, getY, getX) {
    const paths = [];
    const dots = [];
    let currentSegment = [];

    for (let i = 0; i < calDays.length; i++) {
      const day = calDays[i];
      const val = (day.data && day.data[metric] != null) ? day.data[metric] : null;

      if (val !== null) {
        const x = getX(i);
        const y = getY(val);
        currentSegment.push({ x, y, val, datum: day.datum });
        dots.push({ x, y, val, datum: day.datum });
      } else {
        if (currentSegment.length > 1) {
          const d = currentSegment.map((p, idx) => (idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ');
          paths.push(d);
        }
        currentSegment = [];
      }
    }

    if (currentSegment.length > 1) {
      const d = currentSegment.map((p, idx) => (idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ');
      paths.push(d);
    }

    return {
      pathData: paths.join(' '),
      dots
    };
  }

  // --- GLAVNI IZRIS KOMPONENTE ---
  function render(containerId) {
    if (!containerId && state.containerId) containerId = state.containerId;
    if (!containerId) return;
    state.containerId = containerId;

    if (typeof document === 'undefined') return;
    const host = document.getElementById(containerId);
    if (!host) return;

    // Ohrani položaj drsenja in fokus (Pravilo 7 in 21)
    const prevScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    const activeElId = document.activeElement ? document.activeElement.id : null;

    const events = loadEvents();
    const rawDnevi = getDnevi();

    // Določi datumski razpon za časovnico
    let minD = '2026-09-25';
    let maxD = new Date().toLocaleDateString('sv-SE');

    if (rawDnevi.length > 0) {
      const watchDates = rawDnevi.map(d => d.datum).filter(Boolean).sort();
      if (watchDates.length > 0) {
        if (watchDates[0] < minD) minD = watchDates[0];
        if (watchDates[watchDates.length - 1] > maxD) maxD = watchDates[watchDates.length - 1];
      }
    }
    if (events.length > 0) {
      const evDates = events.map(e => e.datum).filter(Boolean).sort();
      if (evDates.length > 0) {
        if (evDates[0] < minD) minD = evDates[0];
        if (evDates[evDates.length - 1] > maxD) maxD = evDates[evDates.length - 1];
      }
    }

    const calDays = generateCalendarDays(minD, maxD, rawDnevi);
    if (calDays.length === 0) {
      host.innerHTML = '<div class="card" style="padding:16px;color:var(--text-3);text-align:center;">Ni podatkov za prikaz časovnice.</div>';
      return;
    }

    // Privzeti izbiri
    if (!state.selectedEventId && events.length > 0) {
      state.selectedEventId = events[events.length - 1].id;
    }
    if (!state.selectedDate) {
      // Izberi zadnji dan s podatki ali zadnji dan
      const zadnjiZMeritvami = [...calDays].reverse().find(d => d.data && (d.data.rhr != null || d.data.hrv != null));
      state.selectedDate = zadnjiZMeritvami ? zadnjiZMeritvami.datum : calDays[calDays.length - 1].datum;
    }

    const selectedEvent = events.find(e => e.id === state.selectedEventId) || events[0] || null;
    const selectedDayObj = calDays.find(d => d.datum === state.selectedDate) || calDays[calDays.length - 1];
    const prePostStats = selectedEvent ? calculatePrePost(selectedEvent.datum, rawDnevi) : null;
    const eventsNearDay = findEventsNearDate(state.selectedDate, events, 3);

    // Dimenzije SVG grafa
    const SVG_W = 500;
    const SVG_H = 240;
    const padL = 42;
    const padR = 20;
    const padT = 28;
    const padB = 34;
    const plotW = SVG_W - padL - padR;
    const plotH = SVG_H - padT - padB;

    const getX = (idx) => padL + (calDays.length > 1 ? (idx / (calDays.length - 1)) * plotW : plotW / 2);

    // Določi ekstreme metrik
    const rhrVals = calDays.map(d => d.data ? d.data.rhr : null).filter(v => v != null);
    const hrvVals = calDays.map(d => d.data ? d.data.hrv : null).filter(v => v != null);
    const globVals = calDays.map(d => d.data ? d.data.globokiMin : null).filter(v => v != null);

    const getExtremes = (vals, fallbackMin, fallbackMax) => {
      if (!vals.length) return { min: fallbackMin, max: fallbackMax };
      let mn = Math.min(...vals);
      let mx = Math.max(...vals);
      if (mn === mx) { mn -= 5; mx += 5; }
      const span = mx - mn;
      return { min: mn - span * 0.08, max: mx + span * 0.08 };
    };

    const extRhr = getExtremes(rhrVals, 45, 75);
    const extHrv = getExtremes(hrvVals, 40, 100);
    const extGlob = getExtremes(globVals, 20, 120);

    // Funkcije za Y koordinate glede na način
    let getY_Rhr, getY_Hrv, getY_Glob;
    let yAxisLabels = [];

    if (state.activeMode === 'vse') {
      // Vse krivulje normalizirane 0–100 %
      getY_Rhr = (val) => (padT + plotH) - ((val - extRhr.min) / (extRhr.max - extRhr.min)) * plotH;
      getY_Hrv = (val) => (padT + plotH) - ((val - extHrv.min) / (extHrv.max - extHrv.min)) * plotH;
      getY_Glob = (val) => (padT + plotH) - ((val - extGlob.min) / (extGlob.max - extGlob.min)) * plotH;
      yAxisLabels = [
        { y: padT, text: '100%' },
        { y: padT + plotH * 0.5, text: '50%' },
        { y: padT + plotH, text: '0%' }
      ];
    } else if (state.activeMode === 'rhr') {
      getY_Rhr = (val) => (padT + plotH) - ((val - extRhr.min) / (extRhr.max - extRhr.min)) * plotH;
      yAxisLabels = [
        { y: padT, text: `${Math.round(extRhr.max)}` },
        { y: padT + plotH * 0.5, text: `${Math.round((extRhr.max + extRhr.min) / 2)}` },
        { y: padT + plotH, text: `${Math.round(extRhr.min)} bpm` }
      ];
    } else if (state.activeMode === 'hrv') {
      getY_Hrv = (val) => (padT + plotH) - ((val - extHrv.min) / (extHrv.max - extHrv.min)) * plotH;
      yAxisLabels = [
        { y: padT, text: `${Math.round(extHrv.max)}` },
        { y: padT + plotH * 0.5, text: `${Math.round((extHrv.max + extHrv.min) / 2)}` },
        { y: padT + plotH, text: `${Math.round(extHrv.min)} ms` }
      ];
    } else {
      getY_Glob = (val) => (padT + plotH) - ((val - extGlob.min) / (extGlob.max - extGlob.min)) * plotH;
      yAxisLabels = [
        { y: padT, text: `${Math.round(extGlob.max)}m` },
        { y: padT + plotH * 0.5, text: `${Math.round((extGlob.max + extGlob.min) / 2)}m` },
        { y: padT + plotH, text: `${Math.round(extGlob.min)}m` }
      ];
    }

    // Horizontalne mrežne črte
    const gridLines = [0, 0.25, 0.5, 0.75, 1.0].map(frac => {
      const y = padT + plotH * (1 - frac);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${SVG_W - padR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />`;
    }).join('');

    // Oznake Y osi
    const yAxisSvg = yAxisLabels.map(l =>
      `<text x="${padL - 6}" y="${(l.y + 3).toFixed(1)}" fill="var(--text-3, #71767B)" font-size="10" text-anchor="end" font-family="'JetBrains Mono', monospace">${l.text}</text>`
    ).join('');

    // Oznake X osi (datumi)
    const stepDays = Math.max(7, Math.floor(calDays.length / 5));
    const xAxisSvg = [];
    for (let i = 0; i < calDays.length; i += stepDays) {
      const x = getX(i);
      const dtParts = calDays[i].datum.split('-');
      const label = `${parseInt(dtParts[2], 10)}.${parseInt(dtParts[1], 10)}.`;
      xAxisSvg.push(`<text x="${x.toFixed(1)}" y="${(SVG_H - 12)}" fill="var(--text-3, #71767B)" font-size="10" text-anchor="middle" font-family="Inter, sans-serif">${label}</text>`);
      xAxisSvg.push(`<line x1="${x.toFixed(1)}" y1="${padT + plotH}" x2="${x.toFixed(1)}" y2="${padT + plotH + 4}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />`);
    }

    // Poti krivulj
    let curvesSvg = '';
    const showRhr = state.activeMode === 'vse' || state.activeMode === 'rhr';
    const showHrv = state.activeMode === 'vse' || state.activeMode === 'hrv';
    const showGlob = state.activeMode === 'vse' || state.activeMode === 'globoki';

    if (showRhr && getY_Rhr) {
      const r = buildSvgPathWithGaps(calDays, 'rhr', getY_Rhr, getX);
      if (r.pathData) {
        curvesSvg += `<path d="${r.pathData}" fill="none" stroke="var(--rec-red, #FF3D00)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />`;
      }
      r.dots.forEach(d => {
        curvesSvg += `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="2" fill="var(--rec-red, #FF3D00)" opacity="0.75" />`;
      });
    }

    if (showHrv && getY_Hrv) {
      const h = buildSvgPathWithGaps(calDays, 'hrv', getY_Hrv, getX);
      if (h.pathData) {
        curvesSvg += `<path d="${h.pathData}" fill="none" stroke="var(--rec-green, #00E676)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />`;
      }
      h.dots.forEach(d => {
        curvesSvg += `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="2" fill="var(--rec-green, #00E676)" opacity="0.75" />`;
      });
    }

    if (showGlob && getY_Glob) {
      const g = buildSvgPathWithGaps(calDays, 'globokiMin', getY_Glob, getX);
      if (g.pathData) {
        curvesSvg += `<path d="${g.pathData}" fill="none" stroke="var(--strain-blue, #00E5FF)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />`;
      }
      g.dots.forEach(d => {
        curvesSvg += `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="2" fill="var(--strain-blue, #00E5FF)" opacity="0.75" />`;
      });
    }

    // Navpične oznake sprememb protokola
    let eventMarkersSvg = '';
    events.forEach((ev, evIdx) => {
      const idx = calDays.findIndex(d => d.datum === ev.datum);
      if (idx >= 0) {
        const x = getX(idx);
        const isSelected = selectedEvent && selectedEvent.id === ev.id;
        const col = isSelected ? 'var(--rec-yellow, #FFD600)' : 'rgba(255, 214, 0, 0.45)';
        const sw = isSelected ? '2' : '1.2';
        const dash = isSelected ? 'none' : '3,3';
        // Rahlo zamakni višino romba za sosednje dogodke, da se ne prekrivajo
        const yOffset = (evIdx % 2 === 0) ? 0 : 5;
        const topY = padT - 8 - yOffset;

        eventMarkersSvg += `
          <g class="casovnica-event-marker" style="cursor: pointer;" onclick="CasovnicaUI.selectEvent('${ev.id}')">
            <line x1="${x.toFixed(1)}" y1="${padT - 6}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dash}" />
            <polygon points="${x.toFixed(1)},${topY} ${(x + 4.5).toFixed(1)},${topY - 5} ${x.toFixed(1)},${topY - 10} ${(x - 4.5).toFixed(1)},${topY - 5}" fill="${isSelected ? 'var(--rec-yellow, #FFD600)' : '#E6B800'}" stroke="#08090A" stroke-width="1" />
            <title>${escHtml(ev.datum)}: ${escHtml(ev.opis)}</title>
          </g>
        `;
      }
    });

    // Oznaka izbranega dneva (kazalec ob dotiku)
    let selectedCursorSvg = '';
    const selIdx = calDays.findIndex(d => d.datum === state.selectedDate);
    if (selIdx >= 0) {
      const x = getX(selIdx);
      selectedCursorSvg += `
        <line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="#FFFFFF" stroke-width="1.5" stroke-dasharray="2,2" opacity="0.7" pointer-events="none" />
        <circle cx="${x.toFixed(1)}" cy="${padT}" r="3" fill="#FFFFFF" pointer-events="none" />
      `;

      // Izpostavljene točke na krivuljah za izbrani dan
      const curData = selectedDayObj && selectedDayObj.data;
      if (curData) {
        if (showRhr && curData.rhr != null && getY_Rhr) {
          selectedCursorSvg += `<circle cx="${x.toFixed(1)}" cy="${getY_Rhr(curData.rhr).toFixed(1)}" r="4" fill="var(--rec-red, #FF3D00)" stroke="#fff" stroke-width="1.5" pointer-events="none" />`;
        }
        if (showHrv && curData.hrv != null && getY_Hrv) {
          selectedCursorSvg += `<circle cx="${x.toFixed(1)}" cy="${getY_Hrv(curData.hrv).toFixed(1)}" r="4" fill="var(--rec-green, #00E676)" stroke="#fff" stroke-width="1.5" pointer-events="none" />`;
        }
        if (showGlob && curData.globokiMin != null && getY_Glob) {
          selectedCursorSvg += `<circle cx="${x.toFixed(1)}" cy="${getY_Glob(curData.globokiMin).toFixed(1)}" r="4" fill="var(--strain-blue, #00E5FF)" stroke="#fff" stroke-width="1.5" pointer-events="none" />`;
        }
      }
    }

    // HTML sestava celotnega modula
    const selData = selectedDayObj ? selectedDayObj.data : null;
    const rhrDisplay = selData && selData.rhr != null ? `${selData.rhr} bpm` : '–';
    const hrvDisplay = selData && selData.hrv != null ? `${selData.hrv} ms` : '–';
    const globDisplay = selData && selData.globokiMin != null ? `${selData.globokiMin} min (${Math.floor(selData.globokiMin / 60)}h ${selData.globokiMin % 60}m)` : '–';

    const html = `
      <div class="card" id="casovnicaCard" style="border-top: 2px solid var(--rec-green, #00E676); background: var(--surface-1, #0E1012); border-radius: 14px; padding: 14px; margin-bottom: 16px;">
        <!-- Glava časovnice -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 8px;">
          <div>
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-1, #F4F5F6); display: flex; align-items: center; gap: 6px;">
              <span>📈 Časovna Krivulja & Spremembe Protokola</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-3, #71767B); margin-top: 2px;">
              RHR, HRV in globoki spanec z oznakami posegov (Fitbit Air)
            </div>
          </div>
          <span class="status-pill" style="font-size: 0.7rem; border-color: var(--edge-2); white-space: nowrap;">
            ${calDays.length} dni
          </span>
        </div>

        <!-- Preklopnik načina normalizacije (Segmented Control) -->
        <div style="display: flex; gap: 4px; background: var(--surface-2, #14171A); padding: 4px; border-radius: 10px; border: 1px solid var(--edge-1); margin-bottom: 12px; overflow-x: auto;">
          <button type="button" class="btn ${state.activeMode === 'vse' ? '' : 'secondary'}" style="flex: 1; min-height: 44px; padding: 6px 8px; font-size: 0.75rem; font-weight: 700; border-radius: 8px; cursor: pointer; white-space: nowrap;" onclick="CasovnicaUI.setMode('vse')">
            ✨ Vse (0–100%)
          </button>
          <button type="button" class="btn ${state.activeMode === 'rhr' ? '' : 'secondary'}" style="flex: 1; min-height: 44px; padding: 6px 8px; font-size: 0.75rem; font-weight: 700; border-radius: 8px; cursor: pointer; white-space: nowrap; color: ${state.activeMode === 'rhr' ? '#08090A' : 'var(--rec-red, #FF3D00)'};" onclick="CasovnicaUI.setMode('rhr')">
            🔴 RHR
          </button>
          <button type="button" class="btn ${state.activeMode === 'hrv' ? '' : 'secondary'}" style="flex: 1; min-height: 44px; padding: 6px 8px; font-size: 0.75rem; font-weight: 700; border-radius: 8px; cursor: pointer; white-space: nowrap; color: ${state.activeMode === 'hrv' ? '#08090A' : 'var(--rec-green, #00E676)'};" onclick="CasovnicaUI.setMode('hrv')">
            🟢 HRV
          </button>
          <button type="button" class="btn ${state.activeMode === 'globoki' ? '' : 'secondary'}" style="flex: 1; min-height: 44px; padding: 6px 8px; font-size: 0.75rem; font-weight: 700; border-radius: 8px; cursor: pointer; white-space: nowrap; color: ${state.activeMode === 'globoki' ? '#08090A' : 'var(--strain-blue, #00E5FF)'};" onclick="CasovnicaUI.setMode('globoki')">
            🔵 Spanec
          </button>
        </div>

        <!-- Legenda -->
        <div style="display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 0.72rem; color: var(--text-2, #A1A7B0); margin-bottom: 8px; padding: 0 4px;">
          <span style="display: flex; align-items: center; gap: 5px;">
            <b style="color: var(--rec-red, #FF3D00);">―</b> RHR (bpm)
          </span>
          <span style="display: flex; align-items: center; gap: 5px;">
            <b style="color: var(--rec-green, #00E676);">―</b> HRV (ms)
          </span>
          <span style="display: flex; align-items: center; gap: 5px;">
            <b style="color: var(--strain-blue, #00E5FF);">―</b> Globoki spanec (min)
          </span>
          <span style="display: flex; align-items: center; gap: 5px;">
            <span style="color: var(--rec-yellow, #FFD600); font-size: 0.8rem;">◆</span> Protokol
          </span>
        </div>

        <!-- SVG Graf z interaktivno plastjo -->
        <div style="position: relative; width: 100%; background: var(--surface-2, #14171A); border: 1px solid var(--edge-1); border-radius: 12px; overflow: hidden; touch-action: pan-y;">
          <svg id="casovnicaSvg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" height="${SVG_H}" style="display: block; width: 100%; height: auto; max-height: 260px;" role="img" aria-label="Časovni graf RHR, HRV in globokega spanca">
            <!-- Mrežne črte -->
            ${gridLines}
            <!-- Y os -->
            ${yAxisSvg}
            <!-- Krivulje -->
            ${curvesSvg}
            <!-- Navpične oznake protokola -->
            ${eventMarkersSvg}
            <!-- Kazalec izbranega dneva -->
            ${selectedCursorSvg}
            <!-- X os -->
            ${xAxisSvg.join('')}
            <!-- Interaktivni transparentni pravokotnik za dotik/klik -->
            <rect id="casovnicaTouchOverlay" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair;" />
          </svg>
        </div>

        <!-- Inšpektor izbranega dneva (Dotik na graf) -->
        <div style="background: var(--surface-2, #14171A); border: 1px solid var(--edge-2); border-radius: 12px; padding: 12px; margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-1);">
              📅 ${formatDisplayDate(state.selectedDate)}
            </span>
            <span style="font-size: 0.7rem; color: var(--text-3);">Dotakni se grafa za drug dan</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 6px; text-align: center;">
            <div style="background: var(--surface-1); padding: 8px 4px; border-radius: 8px; border: 1px solid var(--edge-1);">
              <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">RHR</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: var(--rec-red, #FF3D00); margin-top: 2px;">${rhrDisplay}</div>
            </div>
            <div style="background: var(--surface-1); padding: 8px 4px; border-radius: 8px; border: 1px solid var(--edge-1);">
              <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">HRV</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: var(--rec-green, #00E676); margin-top: 2px;">${hrvDisplay}</div>
            </div>
            <div style="background: var(--surface-1); padding: 8px 4px; border-radius: 8px; border: 1px solid var(--edge-1);">
              <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Globoki spanec</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: var(--strain-blue, #00E5FF); margin-top: 2px;">${globDisplay}</div>
            </div>
          </div>

          <!-- Dogodki v območju ±3 dni -->
          <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--edge-1); font-size: 0.75rem;">
            <div style="font-weight: 700; color: var(--text-2); margin-bottom: 4px;">
              Spremembe protokola v območju ±3 dni:
            </div>
            ${eventsNearDay.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 5px;">
                ${eventsNearDay.map(ev => {
                  let relText = '';
                  if (ev.diffInDays === 0) relText = '<span style="color:var(--rec-yellow); font-weight:700;">(isti dan)</span>';
                  else if (ev.diffInDays === -1) relText = '<span style="color:var(--text-3);">(1 dan prej)</span>';
                  else if (ev.diffInDays === 1) relText = '<span style="color:var(--text-3);">(1 dan kasneje)</span>';
                  else if (ev.diffInDays < 0) relText = `<span style="color:var(--text-3);">(${Math.abs(ev.diffInDays)} dni prej)</span>`;
                  else relText = `<span style="color:var(--text-3);">(${ev.diffInDays} dni kasneje)</span>`;

                  return `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-1); padding: 6px 8px; border-radius: 6px; border: 1px solid var(--edge-1);">
                      <div>
                        <strong>${escHtml(ev.datum)}</strong> ${relText}: ${escHtml(ev.opis)}
                      </div>
                      <button type="button" class="btn secondary" style="min-height: 44px; padding: 4px 10px; font-size: 0.72rem; cursor: pointer; white-space: nowrap;" onclick="CasovnicaUI.selectEvent('${ev.id}')">
                        Primerjaj →
                      </button>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div style="color: var(--text-3); font-style: italic;">
                V območju ±3 dni ni zabeleženih sprememb protokola.
              </div>
            `}
          </div>
        </div>

        <!-- Primerjava »7 dni pred / 7 dni po« izbranem dogodku -->
        <div style="background: var(--surface-2, #14171A); border: 1px solid var(--edge-2); border-radius: 12px; padding: 12px; margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-1);">
              ⚖️ Primerjava: 7 dni pred vs. 7 dni po dogodku
            </div>
            <!-- Izbirnik dogodka za primerjavo -->
            <select id="casovnicaSelectEvent" style="background: var(--surface-1); color: #fff; border: 1px solid var(--edge-2); border-radius: 8px; padding: 6px 10px; min-height: 44px; font-size: 16px; max-width: 100%; cursor: pointer;" onchange="CasovnicaUI.selectEvent(this.value)">
              ${events.map(ev => `
                <option value="${ev.id}" ${selectedEvent && selectedEvent.id === ev.id ? 'selected' : ''}>
                  ${ev.datum}: ${ev.opis.slice(0, 32)}${ev.opis.length > 32 ? '…' : ''}
                </option>
              `).join('')}
            </select>
          </div>

          ${selectedEvent && prePostStats ? `
            <div style="background: var(--surface-1); border: 1px solid var(--edge-1); border-radius: 10px; padding: 10px; margin-bottom: 8px;">
              <div style="font-weight: 700; font-size: 0.82rem; color: var(--rec-yellow, #FFD600); margin-bottom: 2px;">
                📌 ${escHtml(selectedEvent.datum)} — ${escHtml(selectedEvent.opis)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-3);">
                7 dni pred (${addDays(selectedEvent.datum, -7)} do ${addDays(selectedEvent.datum, -1)}) vs. 7 dni po (${addDays(selectedEvent.datum, 1)} do ${addDays(selectedEvent.datum, 7)})
              </div>
            </div>

            <!-- Tabela primerjave -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <!-- RHR vrstica -->
              <div style="display: grid; grid-template-columns: 1.1fr 1fr 1fr 1fr; gap: 6px; align-items: center; background: var(--surface-1); padding: 8px 10px; border-radius: 8px; font-size: 0.74rem;">
                <div>
                  <strong style="color: var(--rec-red);">RHR</strong>
                  <div style="font-size: 0.65rem; color: var(--text-3);">${prePostStats.rhr.preCount}/7 vs ${prePostStats.rhr.postCount}/7 dni</div>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Pred:</span><br>
                  <strong>${prePostStats.rhr.preAvg != null ? prePostStats.rhr.preAvg + ' bpm' : '–'}</strong>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Po:</span><br>
                  <strong>${prePostStats.rhr.postAvg != null ? prePostStats.rhr.postAvg + ' bpm' : '–'}</strong>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Razlika:</span><br>
                  <strong style="color: ${prePostStats.rhr.diff != null ? (prePostStats.rhr.diff <= 0 ? 'var(--rec-green)' : 'var(--rec-red)') : 'var(--text-3)'};">
                    ${prePostStats.rhr.diff != null ? (prePostStats.rhr.diff > 0 ? '+' : '') + prePostStats.rhr.diff + ' bpm' : '–'}
                  </strong>
                </div>
              </div>

              <!-- HRV vrstica -->
              <div style="display: grid; grid-template-columns: 1.1fr 1fr 1fr 1fr; gap: 6px; align-items: center; background: var(--surface-1); padding: 8px 10px; border-radius: 8px; font-size: 0.74rem;">
                <div>
                  <strong style="color: var(--rec-green);">HRV</strong>
                  <div style="font-size: 0.65rem; color: var(--text-3);">${prePostStats.hrv.preCount}/7 vs ${prePostStats.hrv.postCount}/7 dni</div>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Pred:</span><br>
                  <strong>${prePostStats.hrv.preAvg != null ? prePostStats.hrv.preAvg + ' ms' : '–'}</strong>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Po:</span><br>
                  <strong>${prePostStats.hrv.postAvg != null ? prePostStats.hrv.postAvg + ' ms' : '–'}</strong>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Razlika:</span><br>
                  <strong style="color: ${prePostStats.hrv.diff != null ? (prePostStats.hrv.diff >= 0 ? 'var(--rec-green)' : 'var(--rec-red)') : 'var(--text-3)'};">
                    ${prePostStats.hrv.diff != null ? (prePostStats.hrv.diff > 0 ? '+' : '') + prePostStats.hrv.diff + ' ms' : '–'}
                  </strong>
                </div>
              </div>

              <!-- Globoki spanec vrstica -->
              <div style="display: grid; grid-template-columns: 1.1fr 1fr 1fr 1fr; gap: 6px; align-items: center; background: var(--surface-1); padding: 8px 10px; border-radius: 8px; font-size: 0.74rem;">
                <div>
                  <strong style="color: var(--strain-blue);">Glob. spanec</strong>
                  <div style="font-size: 0.65rem; color: var(--text-3);">${prePostStats.globokiMin.preCount}/7 vs ${prePostStats.globokiMin.postCount}/7 dni</div>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Pred:</span><br>
                  <strong>${prePostStats.globokiMin.preAvg != null ? prePostStats.globokiMin.preAvg + ' m' : '–'}</strong>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Po:</span><br>
                  <strong>${prePostStats.globokiMin.postAvg != null ? prePostStats.globokiMin.postAvg + ' m' : '–'}</strong>
                </div>
                <div>
                  <span style="color: var(--text-3); font-size: 0.65rem;">Razlika:</span><br>
                  <strong style="color: ${prePostStats.globokiMin.diff != null ? (prePostStats.globokiMin.diff >= 0 ? 'var(--rec-green)' : 'var(--rec-red)') : 'var(--text-3)'};">
                    ${prePostStats.globokiMin.diff != null ? (prePostStats.globokiMin.diff > 0 ? '+' : '') + prePostStats.globokiMin.diff + ' m' : '–'}
                  </strong>
                </div>
              </div>
            </div>

            <!-- Opozorilo ob premalo podatkih -->
            ${prePostStats.premalo ? `
              <div style="background: rgba(255, 214, 0, 0.08); border: 1px solid rgba(255, 214, 0, 0.3); border-radius: 8px; padding: 8px 10px; font-size: 0.72rem; color: var(--rec-yellow, #FFD600); margin-top: 8px; display: flex; align-items: center; gap: 6px;">
                <span>⚠️</span>
                <span>Premalo podatkov (&lt; 4 dni z meritvami v oknu). Številke so zgolj informativne.</span>
              </div>
            ` : ''}

            <!-- Obvezna opomba -->
            <div style="font-size: 0.7rem; color: var(--text-3); margin-top: 8px; font-style: italic; text-align: center;">
              Sočasnost, ne vzrok. Manj kot 4 dni podatkov = premalo.
            </div>
          ` : `
            <div style="color: var(--text-3); font-size: 0.75rem; text-align: center; padding: 12px 0;">
              Ni izbranega dogodka za primerjavo.
            </div>
          `}
        </div>

        <!-- Obrazec za dodajanje in urejanje dogodkov -->
        <div style="background: var(--surface-2, #14171A); border: 1px solid var(--edge-2); border-radius: 12px; padding: 12px; margin-top: 12px;">
          <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-1); margin-bottom: 8px;">
            ➕ Dodaj ali uredi oznako spremembe protokola
          </div>

          <form id="casovnicaAddForm" onsubmit="CasovnicaUI.handleAddEvent(event)" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px;">
              <div>
                <label for="casovnicaInpDatum" style="display: block; font-size: 0.68rem; color: var(--text-3); font-weight: 700; text-transform: uppercase; margin-bottom: 2px;">Datum</label>
                <input type="date" id="casovnicaInpDatum" value="${new Date().toLocaleDateString('sv-SE')}" required style="width: 100%; min-height: 44px; font-size: 16px !important; background: var(--surface-1); border: 1px solid var(--edge-2); border-radius: 8px; color: #fff; padding: 8px 10px; box-sizing: border-box;">
              </div>
              <div>
                <label for="casovnicaInpOpis" style="display: block; font-size: 0.68rem; color: var(--text-3); font-weight: 700; text-transform: uppercase; margin-bottom: 2px;">Opis spremembe</label>
                <input type="text" id="casovnicaInpOpis" placeholder="npr. Uvedba kreatina 5g" required style="width: 100%; min-height: 44px; font-size: 16px !important; background: var(--surface-1); border: 1px solid var(--edge-2); border-radius: 8px; color: #fff; padding: 8px 10px; box-sizing: border-box;">
              </div>
            </div>
            <button type="submit" class="btn" style="min-height: 44px; padding: 10px; font-weight: 700; cursor: pointer; border-radius: 8px; margin-top: 2px;">
              💾 Shrani Oznako Protokola
            </button>
          </form>

          <!-- Seznam shranjenih dogodkov -->
          <div style="margin-top: 14px; border-top: 1px solid var(--edge-1); padding-top: 10px;">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-2); margin-bottom: 8px;">
              Shranjene spremembe (${events.length}):
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px;">
              ${events.map(ev => `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; background: var(--surface-1); border: 1px solid var(--edge-1); padding: 8px 10px; border-radius: 8px; gap: 8px;">
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-size: 0.72rem; color: var(--rec-yellow, #FFD600); font-weight: 700;">${escHtml(ev.datum)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-1); line-height: 1.35; margin-top: 2px; word-break: break-word;">${escHtml(ev.opis)}</div>
                  </div>
                  <div style="display: flex; gap: 4px; flex-shrink: 0; margin-top: 2px;">
                    <button type="button" class="btn secondary" style="min-height: 44px; padding: 4px 8px; font-size: 0.72rem; cursor: pointer; white-space: nowrap;" title="Primerjaj 7 dni pred/po" onclick="CasovnicaUI.selectEvent('${ev.id}')">
                      🔍 Primerjaj
                    </button>
                    <button type="button" class="btn secondary danger" style="min-height: 44px; min-width: 44px; padding: 4px 10px; font-size: 0.8rem; cursor: pointer; color: var(--rec-red);" title="Izbriši dogodek" onclick="CasovnicaUI.handleDeleteEvent('${ev.id}')">
                      🗑️
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    host.innerHTML = html;

    // Poveži poslušalce dogodkov za dotik / premik po grafu
    attachOverlayEvents(plotW, padL, calDays);

    // Povrni položaj drsenja in fokus (Pravilo 7 in 21)
    if (typeof window !== 'undefined' && prevScrollY) {
      window.scrollTo(0, prevScrollY);
    }
    if (activeElId) {
      const el = document.getElementById(activeElId);
      if (el && typeof el.focus === 'function') el.focus();
    }
  }

  // --- INTERAKCIJA Z GRAFOM (DOTIK IN MIŠKA) ---
  function attachOverlayEvents(plotW, padL, calDays) {
    if (typeof document === 'undefined') return;
    const overlay = document.getElementById('casovnicaTouchOverlay');
    const svgEl = document.getElementById('casovnicaSvg');
    if (!overlay || !svgEl) return;

    const handlePointer = (e) => {
      const rect = svgEl.getBoundingClientRect();
      const clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
      if (clientX == null) return;

      const normX = ((clientX - rect.left) / rect.width) * 500;
      const frac = (normX - padL) / plotW;
      const clampedFrac = Math.max(0, Math.min(1, frac));
      const idx = Math.round(clampedFrac * (calDays.length - 1));

      if (idx >= 0 && idx < calDays.length) {
        const targetDate = calDays[idx].datum;
        if (targetDate !== state.selectedDate) {
          state.selectedDate = targetDate;
          render();
        }
      }
    };

    overlay.addEventListener('pointerdown', (e) => {
      overlay.setPointerCapture(e.pointerId);
      handlePointer(e);
    });

    overlay.addEventListener('pointermove', (e) => {
      if (e.buttons > 0) {
        handlePointer(e);
      }
    });

    overlay.addEventListener('click', handlePointer);
  }

  // --- JAVNE KONTROLNE FUNKCIJE ---
  function setMode(mode) {
    if (['vse', 'rhr', 'hrv', 'globoki'].includes(mode)) {
      state.activeMode = mode;
      render();
    }
  }

  function selectEvent(eventId) {
    const events = loadEvents();
    const ev = events.find(e => e.id === eventId);
    if (ev) {
      state.selectedEventId = eventId;
      state.selectedDate = ev.datum;
      render();
    }
  }

  function selectDate(dateStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      state.selectedDate = dateStr;
      render();
    }
  }

  function handleAddEvent(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (typeof document === 'undefined') return;
    const datumEl = document.getElementById('casovnicaInpDatum');
    const opisEl = document.getElementById('casovnicaInpOpis');
    if (!datumEl || !opisEl) return;

    const datum = datumEl.value;
    const opis = opisEl.value;
    const newEv = addEvent(datum, opis);
    if (newEv) {
      state.selectedEventId = newEv.id;
      state.selectedDate = newEv.datum;
      render();
    }
  }

  function handleDeleteEvent(id) {
    if (deleteEvent(id)) {
      if (state.selectedEventId === id) {
        state.selectedEventId = null;
      }
      render();
    }
  }

  return {
    render,
    setMode,
    selectEvent,
    selectDate,
    handleAddEvent,
    handleDeleteEvent,
    loadEvents,
    saveEvents,
    addEvent,
    deleteEvent,
    setDnevi,
    getDnevi,
    calculatePrePost,
    findEventsNearDate,
    generateCalendarDays,
    buildSvgPathWithGaps,
    PRIVZETI_DOGODKI,
    _state: state
  };
}));
