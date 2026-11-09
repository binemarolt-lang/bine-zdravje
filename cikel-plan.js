/* Cikel plan: Dinamični načrt cikla, farmakokinetika in kontrole krvi (Bine Zdravje)
 * Shramba v bine_cikel_plan_v2 (stari ključ bine_cikel_plan_v1 se bere kot izhodišče, ne briše).
 * Aplikacija ne predlaga odmerkov in ne določa zdravljenja — le preračuna vnesene podatke:
 *   - enote U-100 na dnevno injekcijo (mg/teden / 7 / konc * 100),
 *   - oceno relativne ravni v času (1-kompartmentni model),
 *   - datum ~90 % in ~ravnovesja (≈5 razpolovnih časov) po zadnji spremembi odmerka,
 *   - kontrolni seznam manjkajočih preiskav krvi (izvid 2.11.2026) z opombo »Termin in obseg določi zdravnik.«
 * Ohranja rotacijo mest vboda in trend izvidov v bine_zdravje_bloodwork_history_v1.
 */
(function () {
  'use strict';

  const LS_KEY_V1 = 'bine_cikel_plan_v1';
  const LS_KEY_V2 = 'bine_cikel_plan_v2';
  const LS_BW = 'bine_zdravje_bloodwork_data';
  const LS_BW_HIST = 'bine_zdravje_bloodwork_history_v1';

  const DAY = 86400000;

  // Mesta vboda (rotacija L↔D). Neuporabljeno ima prednost.
  const SITES = [
    { id: 'LT', label: 'L trebuh' }, { id: 'DT', label: 'D trebuh' },
    { id: 'LS', label: 'L stegno' }, { id: 'DS', label: 'D stegno' },
    { id: 'LD', label: 'L delta' },  { id: 'DD', label: 'D delta' }
  ];

  // Manjkajoče laboratorijske preiskave glede na izvid 2.11.2026 (Porto)
  const MISSING_BLOOD_TESTS = [
    { id: 'shbg', name: 'SHBG', desc: 'Spolne hormone vežoči globulin – nujen za izračun prostega T' },
    { id: 'hct', name: 'Hematokrit / celoten hemogram', desc: 'Spremljanje viskoznosti krvi in eritrocitov' },
    { id: 'apob', name: 'ApoB', desc: 'Ključni kazalnik aterogenih lipidnih delcev' },
    { id: 'hscrp', name: 'hs-CRP', desc: 'Visoko občutljiv označevalec sistemskega vnetja' },
    { id: 'albumin', name: 'Albumin', desc: 'Vezavni serumski protein in jetrni status' },
    { id: 'cystatin_c', name: 'Cistatin C', desc: 'Natančna ocena ledvične funkcije (eGFR) neodvisno od mišične mase' },
    { id: 'hba1c', name: 'HbA1c', desc: '3-mesečni profil urejenosti glikemije' },
    { id: 'insulin', name: 'Inzulin (na tešče)', desc: 'Inzulinska občutljivost / ocena HOMA-IR' },
    { id: 'ferritin', name: 'Feritin', desc: 'Zaloge železa in podpora eritropoezi' },
    { id: 'prolactin', name: 'Prolaktin', desc: 'Hipofizni hormon, razpoloženje in libido' }
  ];

  // Privzeto stanje iz potrjenega protokola v KONTEKST.md
  const DEFAULT_SUBSTANCES = [
    {
      id: 'sub_test',
      name: 'Testosteron cipionat',
      conc: 250,        // mg/mL
      halfLife: 6,      // dni
      changes: [
        { date: '2026-09-27', doseMgWeekly: 200 }
      ]
    },
    {
      id: 'sub_eq',
      name: 'Boldenon undecilenat (EQ)',
      conc: 264,        // mg/mL
      halfLife: 14,     // dni
      changes: [
        { date: '2026-11-05', doseMgWeekly: 185 }
      ]
    }
  ];

  // Stanje obrazcev v UI (odprto urejanje, izbira mesta)
  const uiState = {
    pickingSite: false,
    formMode: null, // 'add_substance' | 'edit_substance' | 'add_change'
    selectedSubId: null
  };

  // Pomožne funkcije za datum
  function isoDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function parseIso(s) {
    if (!s || typeof s !== 'string') return new Date();
    const parts = s.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return new Date();
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function addDays(isoStr, n) {
    const d = parseIso(isoStr);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function dayDiff(startIso, endIso) {
    return Math.round((parseIso(endIso) - parseIso(startIso)) / DAY);
  }
  function formatSlo(isoStr) {
    if (!isoStr) return '–';
    const parts = String(isoStr).split('-');
    if (parts.length !== 3) return isoStr;
    return `${Number(parts[2])}. ${Number(parts[1])}. ${parts[0]}`;
  }

  function el(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(v) {
    return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  }

  // ---------- Izračuni in farmakokinetika ----------

  /**
   * Izračun dnevnih enot U-100: (mg/teden / 7 / konc) * 100
   */
  function calcUnitsPerDay(doseMgWeekly, conc) {
    const d = num(doseMgWeekly);
    const c = num(conc);
    if (!d || d <= 0 || !c || c <= 0) return 0;
    return (d / 7 / c) * 100;
  }

  /**
   * Število dni do dosega določenega deleža ravnovesja (1-kompartment, eliminacija 1. reda).
   * Privzeto 90 %: ~3.322 * t½.
   * Za ravnovesje (≈5 t½): 5 * t½ (~97 % steady-state).
   */
  function calcSteadyStateDays(halfLife, fraction) {
    const hl = num(halfLife);
    if (!hl || hl <= 0) return 0;
    const f = (fraction == null) ? 0.9 : Number(fraction);
    if (f >= 0.99 || f === 1) {
      return Math.round(5 * hl);
    }
    if (f <= 0) return 0;
    return Math.round(hl * (-Math.log(1 - f) / Math.LN2));
  }

  /**
   * Izračuna datum dosega ravnovesja od določenega datuma spremembe naprej.
   */
  function calcSteadyStateDate(fromDateStr, halfLife, fraction) {
    const days = calcSteadyStateDays(halfLife, fraction);
    return addDays(fromDateStr || isoDate(new Date()), days);
  }

  /**
   * Vrne odmerek snovi (mg/teden), veljaven na dan `dateStr`.
   */
  function getDoseOnDate(substance, dateStr) {
    if (!substance || !Array.isArray(substance.changes) || substance.changes.length === 0) return 0;
    const sorted = substance.changes.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let activeDose = 0;
    for (let i = 0; i < sorted.length; i++) {
      if ((sorted[i].date || '') <= dateStr) {
        activeDose = num(sorted[i].doseMgWeekly) || 0;
      } else {
        break;
      }
    }
    return activeDose;
  }

  /**
   * Vrne trenutni veljavni odmerek (mg/teden) za danes.
   */
  function getCurrentDose(substance, todayIso) {
    const t = todayIso || isoDate(new Date());
    return getDoseOnDate(substance, t);
  }

  /**
   * Vrne zadnjo zabeleženo spremembo odmerka.
   */
  function getLastChange(substance) {
    if (!substance || !Array.isArray(substance.changes) || substance.changes.length === 0) {
      return { date: isoDate(new Date()), doseMgWeekly: 0 };
    }
    const sorted = substance.changes.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return sorted[sorted.length - 1];
  }

  // ---------- Shramba in migracija ----------

  /**
   * Migrira staro stanje v1 v novo obliko v2 brez brisanja ali izgube podatkov.
   */
  function migrateV1toV2(v1) {
    const v2 = {
      version: 2,
      substances: JSON.parse(JSON.stringify(DEFAULT_SUBSTANCES)),
      done: {},
      sites: [],
      diaryIds: {},
      bloodChecklist: {}
    };

    if (!v1 || typeof v1 !== 'object') return v2;

    if (v1.done && typeof v1.done === 'object') v2.done = Object.assign({}, v1.done);
    if (Array.isArray(v1.sites)) v2.sites = v1.sites.slice();
    if (v1.diaryIds && typeof v1.diaryIds === 'object') v2.diaryIds = Object.assign({}, v1.diaryIds);
    if (v1.bloodChecklist && typeof v1.bloodChecklist === 'object') v2.bloodChecklist = Object.assign({}, v1.bloodChecklist);
    if (Array.isArray(v1.substances) && v1.substances.length > 0) {
      v2.substances = v1.substances;
    }

    // Ohranimo vse morebitne dodatne uporabniške ključe iz v1
    Object.keys(v1).forEach(k => {
      if (!(k in v2) && k !== 'tedni' && k !== 'testUnits' && k !== 'eqUnits' && k !== 'kontrole' && k !== 'naziv') {
        v2[k] = v1[k];
      }
    });

    return v2;
  }

  function load() {
    let v2 = null;
    if (typeof localStorage !== 'undefined') {
      try { v2 = JSON.parse(localStorage.getItem(LS_KEY_V2) || 'null'); } catch (e) { v2 = null; }
    }
    if (v2 && Array.isArray(v2.substances) && v2.substances.length > 0) {
      v2.done = v2.done || {};
      v2.sites = Array.isArray(v2.sites) ? v2.sites : [];
      v2.diaryIds = v2.diaryIds || {};
      v2.bloodChecklist = v2.bloodChecklist || {};
      return v2;
    }

    // Če v2 še ne obstaja, preberi v1 kot izhodišče
    let v1 = null;
    if (typeof localStorage !== 'undefined') {
      try { v1 = JSON.parse(localStorage.getItem(LS_KEY_V1) || 'null'); } catch (e) { v1 = null; }
    }
    const migrated = migrateV1toV2(v1);
    save(migrated);
    return migrated;
  }

  function save(state) {
    if (typeof localStorage === 'undefined' || !state) return;
    try {
      localStorage.setItem(LS_KEY_V2, JSON.stringify(state));
    } catch (e) {}

    // Sinhroniziramo bistvena polja tudi v v1, da obstoječi bralci (npr. danes-podatki.js) nemoteno delujejo
    try {
      let v1 = {};
      try { v1 = JSON.parse(localStorage.getItem(LS_KEY_V1) || '{}'); } catch (e) { v1 = {}; }
      v1.done = state.done || {};
      v1.sites = state.sites || [];
      v1.diaryIds = state.diaryIds || {};
      let earliest = '2026-09-27';
      if (Array.isArray(state.substances)) {
        state.substances.forEach(sub => {
          (sub.changes || []).forEach(ch => {
            if (ch.date && (!earliest || ch.date < earliest)) earliest = ch.date;
          });
        });
      }
      v1.start = v1.start || earliest;
      localStorage.setItem(LS_KEY_V1, JSON.stringify(v1));
    } catch (e) {}
  }

  // ---------- Kinetična simulacija ----------

  /**
   * Simulira kinetični profil za poljuben nabor snovi.
   * Vrne dnevne točke z relativnim deležem (% ciljnega ravnovesja za trenutni odmerek).
   */
  function simulate(substances, startDateStr, totalDays) {
    const subs = Array.isArray(substances) && substances.length > 0 ? substances : DEFAULT_SUBSTANCES;
    let earliest = startDateStr;
    if (!earliest) {
      earliest = '2026-09-27';
      subs.forEach(s => {
        (s.changes || []).forEach(c => {
          if (c.date && c.date < earliest) earliest = c.date;
        });
      });
    }

    const start = parseIso(earliest);
    const days = totalDays || 120;
    const today = isoDate(new Date());

    const meta = subs.map(sub => {
      const hl = Math.max(1, num(sub.halfLife) || 7);
      const k = Math.LN2 / hl;
      const curDose = getCurrentDose(sub, today);
      const curDaily = curDose / 7;
      const targetSs = curDaily > 0 ? curDaily / k : 1;
      return { sub, k, accum: 0, targetSs };
    });

    const out = [];
    for (let d = 0; d < days; d++) {
      const curDate = new Date(start.getTime() + d * DAY);
      const curIso = isoDate(curDate);
      const point = { d: d + 1, date: curIso, levels: {}, pcts: {} };

      meta.forEach(({ sub, k, targetSs }, idx) => {
        const doseW = getDoseOnDate(sub, curIso);
        const doseD = doseW / 7;
        meta[idx].accum = meta[idx].accum * Math.exp(-k) + doseD;
        const ref = targetSs > 0 ? targetSs : (doseD / k || 1);
        const pct = ref > 0 ? (meta[idx].accum / ref) * 100 : 0;
        point.levels[sub.id] = meta[idx].accum;
        point.pcts[sub.id] = pct;
        if (idx === 0) point.t = pct;
        if (idx === 1) point.e = pct;
      });

      out.push(point);
    }
    return out;
  }

  // ---------- Mesta vboda ----------

  function siteLabel(id) {
    return (SITES.find(s => s.id === id) || { label: '–' }).label;
  }

  function nextSite(sites) {
    const list = Array.isArray(sites) ? sites : [];
    let best = null, bestIdx = Infinity;
    SITES.forEach(st => {
      let last = -1;
      list.forEach((x, i) => { if (x.site === st.id) last = i; });
      if (last < bestIdx) { bestIdx = last; best = st; }
    });
    return best;
  }

  function siteHistoryHtml(sites) {
    const recent = (sites || []).slice(-5).reverse();
    const nxt = nextSite(sites);
    const rows = recent.length
      ? recent.map(x => `<span style="display:inline-block;padding:4px 8px;margin:2px 4px 2px 0;border:1px solid var(--edge-1);border-radius:8px;font-size:0.74rem;">${esc(formatSlo(x.date))} · ${esc(siteLabel(x.site))}</span>`).join('')
      : '<span style="font-size:0.78rem;color:var(--text-3);">Še ni zabeleženih mest vboda.</span>';

    return `
      <div style="margin-top:12px;">
        <div class="bento-label" style="margin-bottom:6px;">Zadnja mesta vboda (5)</div>
        <div>${rows}</div>
        <div style="font-size:0.8rem;margin-top:8px;">Naslednje priporočeno mesto (rotacija): <strong>${nxt ? esc(nxt.label) : '–'}</strong></div>
        <div style="font-size:0.7rem;color:var(--text-3);margin-top:2px;">Organizacijska pomoč za enakomerno menjavo mest — ni medicinski nasvet.</div>
      </div>`;
  }

  function chooserHtml() {
    const btns = SITES.map(st =>
      `<button type="button" class="btn secondary" style="min-height:44px;padding:10px;font-weight:700;font-size:0.82rem;" onclick="CikelPlan.markToday('${st.id}')">${esc(st.label)}</button>`
    ).join('');
    return `
      <div style="margin-top:10px;">
        <div class="bento-label" style="margin-bottom:6px;">Kam si se vbrizgal danes?</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">${btns}</div>
        <button type="button" class="btn secondary" style="width:100%;min-height:44px;padding:10px;font-size:0.8rem;margin-top:8px;" onclick="CikelPlan.cancelPick()">Prekliči</button>
      </div>`;
  }

  // ---------- Graf kinetike (SVG) ----------

  function drawChart(sim, todayIso, substances) {
    const svg = el('cpChart');
    if (!svg) return;
    const W = 360, H = 160, padX = 24, padY = 16;
    const maxVal = 120;
    const n = sim.length;
    if (n < 2) return;

    const x = i => padX + (W - padX * 2) * i / (n - 1);
    const y = v => H - padY - (H - padY * 2) * Math.min(Math.max(v, 0), maxVal) / maxVal;

    const colors = ['var(--strain-blue)', 'var(--c-kinetics)', 'var(--rec-green)', '#FFB74D', '#F06292'];

    let grid = '';
    [0, 50, 100].forEach(v => {
      grid += `<line x1="${padX}" x2="${W - padX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,0.08)"/>`;
      grid += `<text x="2" y="${(y(v) + 3).toFixed(1)}" fill="rgba(255,255,255,0.4)" font-size="8">${v}%</text>`;
    });

    // Oznake tednov ob dnu
    for (let i = 0; i < n; i += 28) {
      const dStr = sim[i].date ? sim[i].date.slice(5) : `d${i}`;
      grid += `<text x="${x(i).toFixed(1)}" y="${H - 2}" fill="rgba(255,255,255,0.35)" font-size="7.5" text-anchor="middle">${dStr}</text>`;
    }

    // Črta za danes
    const todayIdx = sim.findIndex(p => p.date === todayIso);
    let todayLine = '';
    if (todayIdx >= 0) {
      const tx = x(todayIdx).toFixed(1);
      todayLine = `<line x1="${tx}" x2="${tx}" y1="${padY}" y2="${H - padY}" stroke="rgba(255,255,255,0.6)" stroke-dasharray="3,3"/>` +
        `<text x="${tx}" y="${padY - 2}" fill="rgba(255,255,255,0.8)" font-size="7.5" text-anchor="middle">danes</text>`;
    }

    let paths = '';
    substances.forEach((sub, sIdx) => {
      const color = colors[sIdx % colors.length];
      const dStr = sim.map((p, i) => {
        const val = (p.pcts && p.pcts[sub.id] != null) ? p.pcts[sub.id] : 0;
        return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(val).toFixed(1);
      }).join(' ');
      paths += `<path d="${dStr}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    });

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = grid + todayLine + paths;
  }

  // ---------- Izris glavnega pogleda ----------

  function render() {
    const root = el('cikelPlanRoot');
    if (!root) return;

    // Ohrani položaj drsenja (odpravlja glitch ob osvežitvi)
    const scrollY = (typeof window !== 'undefined' && window.scrollY != null) ? window.scrollY : 0;

    const s = load();
    const today = isoDate(new Date());
    const substances = Array.isArray(s.substances) && s.substances.length > 0 ? s.substances : DEFAULT_SUBSTANCES;

    // Preračuni za danes
    let totalUnits = 0;
    const subCalcs = substances.map(sub => {
      const dose = getCurrentDose(sub, today);
      const units = calcUnitsPerDay(dose, sub.conc);
      totalUnits += units;
      const lastCh = getLastChange(sub);
      const date90 = calcSteadyStateDate(lastCh.date, sub.halfLife, 0.9);
      const dateSs = calcSteadyStateDate(lastCh.date, sub.halfLife, 1.0);
      const daysTo90 = dayDiff(today, date90);
      const daysToSs = dayDiff(today, dateSs);
      return {
        sub,
        dose,
        units,
        lastCh,
        date90,
        dateSs,
        daysTo90,
        daysToSs
      };
    });

    // Simulacija kinetike
    const sim = simulate(substances, null, 120);
    const todayPoint = sim.find(p => p.date === today) || sim[sim.length - 1] || { pcts: {} };

    // Vbod danes
    const done = (s.done || {})[today];
    const sites = Array.isArray(s.sites) ? s.sites : [];
    const doneSite = (sites.slice().reverse().find(x => x.date === today) || {}).site;

    let vbodBtnHtml;
    if (done) {
      vbodBtnHtml = `<button type="button" class="btn secondary" style="width:100%;min-height:44px;padding:11px;font-weight:700;margin-top:10px;" onclick="CikelPlan.toggleToday()">✓ Danes vbrizgano (${done}${doneSite ? ' · ' + esc(siteLabel(doneSite)) : ''}) · klikni za razveljavitev</button>`;
    } else if (uiState.pickingSite) {
      vbodBtnHtml = chooserHtml();
    } else {
      vbodBtnHtml = `<button type="button" class="btn" style="width:100%;min-height:44px;padding:11px;font-weight:700;margin-top:10px;" onclick="CikelPlan.pickSite()">💉 Označi današnji vbod</button>`;
    }

    // Navodilo za brizgo
    let syringeInstructions = '';
    if (subCalcs.length > 0) {
      let cumulative = 0;
      const steps = subCalcs.map(sc => {
        cumulative += sc.units;
        return `${esc(sc.sub.name)} do ${cumulative.toFixed(1)} enot`;
      });
      syringeInstructions = `Najprej ${steps.join(', nato ')}. En s.c. vbod dnevno, rotiraj mesta L↔D. Brizga samo enkrat.`;
    }

    // Bento kartice za snovi
    const colors = ['var(--strain-blue)', 'var(--c-kinetics)', 'var(--rec-green)', '#FFB74D', '#F06292'];
    const bentoHtml = subCalcs.map((sc, idx) => {
      const col = colors[idx % colors.length];
      const curPct = Math.round(todayPoint.pcts[sc.sub.id] || 0);
      return `
        <div class="bento-cell" style="border-left:3px solid ${col};">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span class="bento-label" style="color:#fff;font-weight:700;">${esc(sc.sub.name)}</span>
            <span style="font-size:0.7rem;color:var(--text-3);">${sc.sub.conc} mg/mL</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:6px;margin:4px 0;">
            <span class="bento-val" style="color:${col};font-size:1.4rem;">${curPct}%</span>
            <span class="bento-sub">relativna raven</span>
          </div>
          <div style="font-size:0.76rem;color:var(--text-2);">
            <strong>${sc.dose} mg/teden</strong> (${sc.units.toFixed(1)} enot/dan)
          </div>
          <div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;">
            ~90% ravnovesja: <strong style="color:#fff;">${formatSlo(sc.date90)}</strong> ${sc.daysTo90 <= 0 ? '(že doseženo)' : `(čez ${sc.daysTo90} dni)`}<br>
            ~ravnovesje (≈5 t½): <strong style="color:#fff;">${formatSlo(sc.dateSs)}</strong> ${sc.daysToSs <= 0 ? '(doseženo)' : `(čez ${sc.daysToSs} dni)`}
          </div>
        </div>`;
    }).join('');

    // Kontrolni seznam krvi
    const blCheck = s.bloodChecklist || {};
    const checkedCount = MISSING_BLOOD_TESTS.filter(item => !!blCheck[item.id]).length;
    const checklistHtml = MISSING_BLOOD_TESTS.map(item => {
      const isChecked = !!blCheck[item.id];
      return `
        <label style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-2);border:1px solid ${isChecked ? 'var(--rec-green)' : 'var(--edge-1)'};border-radius:10px;margin-bottom:8px;min-height:44px;box-sizing:border-box;cursor:pointer;">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="CikelPlan.toggleBloodCheck('${item.id}')" style="width:22px;height:22px;min-width:22px;min-height:22px;margin:0;accent-color:var(--rec-green);cursor:pointer;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:0.84rem;color:${isChecked ? 'var(--rec-green)' : 'var(--text-1)'};">${isChecked ? '✓ ' : ''}${esc(item.name)}</div>
            <div style="font-size:0.72rem;color:var(--text-3);line-height:1.3;margin-top:2px;">${esc(item.desc)}</div>
          </div>
        </label>`;
    }).join('');

    // Obrazci za upravljanje snovi in odmerkov
    let formHtml = '';
    if (uiState.formMode === 'add_substance') {
      formHtml = `
        <div style="background:var(--surface-2);border:1px solid var(--edge-2);border-radius:12px;padding:14px;margin-top:12px;">
          <div style="font-weight:700;font-size:0.88rem;margin-bottom:8px;">➕ Dodaj novo snov</div>
          <div style="margin-bottom:8px;">
            <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Ime snovi</label>
            <input type="text" id="cpNewSubName" placeholder="npr. Testosteron enantat" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <div>
              <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Koncentracija (mg/mL)</label>
              <input type="number" id="cpNewSubConc" placeholder="250" step="1" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Razpolovni čas (dni)</label>
              <input type="number" id="cpNewSubHalf" placeholder="6" step="0.5" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div>
              <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Začetni datum</label>
              <input type="date" id="cpNewSubDate" value="${today}" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Odmerek (mg/teden)</label>
              <input type="number" id="cpNewSubDose" placeholder="200" step="5" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" style="flex:1;min-height:44px;" onclick="CikelPlan.saveNewSubstance()">Shrani snov</button>
            <button type="button" class="btn secondary" style="flex:1;min-height:44px;" onclick="CikelPlan.cancelForm()">Prekliči</button>
          </div>
        </div>`;
    } else if (uiState.formMode === 'add_change') {
      const sub = substances.find(x => x.id === uiState.selectedSubId);
      formHtml = `
        <div style="background:var(--surface-2);border:1px solid var(--edge-2);border-radius:12px;padding:14px;margin-top:12px;">
          <div style="font-weight:700;font-size:0.88rem;margin-bottom:8px;">📈 Nova sprememba odmerka za: <strong>${esc(sub ? sub.name : '')}</strong></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div>
              <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Datum spremembe</label>
              <input type="date" id="cpChangeDate" value="${today}" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;font-weight:700;">Nov odmerek (mg/teden)</label>
              <input type="number" id="cpChangeDose" placeholder="npr. 250" step="5" style="width:100%;min-height:44px;font-size:16px;padding:8px;margin-top:4px;background:var(--surface-1);border:1px solid var(--edge-1);border-radius:6px;color:#fff;box-sizing:border-box;">
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" style="flex:1;min-height:44px;" onclick="CikelPlan.saveNewChange('${uiState.selectedSubId}')">Shrani spremembo</button>
            <button type="button" class="btn secondary" style="flex:1;min-height:44px;" onclick="CikelPlan.cancelForm()">Prekliči</button>
          </div>
        </div>`;
    }

    // Seznam snovi z zgodovino odmerkov
    const subManagerHtml = substances.map(sub => {
      const changes = (sub.changes || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const changeRows = changes.map((ch, cIdx) => {
        const u = calcUnitsPerDay(ch.doseMgWeekly, sub.conc);
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.78rem;">
            <span>${formatSlo(ch.date)}: <strong>${ch.doseMgWeekly} mg/teden</strong> (${u.toFixed(1)} enot/dan)</span>
            ${changes.length > 1 ? `<button type="button" class="btn secondary" style="min-height:36px;padding:2px 8px;font-size:0.7rem;" onclick="CikelPlan.removeChange('${sub.id}', ${cIdx})">Odstrani</button>` : '<span style="font-size:0.7rem;color:var(--text-3);">Začetek</span>'}
          </div>`;
      }).join('');

      return `
        <div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:12px;padding:12px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-weight:700;font-size:0.86rem;">${esc(sub.name)}</span>
            <span style="font-size:0.72rem;color:var(--text-3);">${sub.conc} mg/mL · t½ ${sub.halfLife} d</span>
          </div>
          <div style="margin:8px 0;">
            <div style="font-size:0.7rem;color:var(--text-3);text-transform:uppercase;font-weight:700;margin-bottom:4px;">Zgodovina odmerkov (${changes.length})</div>
            ${changeRows}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="button" class="btn secondary" style="flex:1;min-height:44px;font-size:0.76rem;padding:6px;" onclick="CikelPlan.openAddChange('${sub.id}')">📈 Spremeni odmerek</button>
            <button type="button" class="btn secondary" style="min-height:44px;font-size:0.76rem;padding:6px 12px;color:var(--rec-red);" onclick="CikelPlan.removeSubstance('${sub.id}')">Odstrani snov</button>
          </div>
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="card-header">
        <div class="card-title">🗓️ Načrt cikla & Farmakokinetika</div>
        <span class="status-pill">${substances.length} snovi</span>
      </div>

      <!-- Dnevni odmerek v brizgo -->
      <div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:14px;padding:14px;margin-bottom:12px;">
        <div class="bento-label">Danes v brizgo (U-100)</div>
        <div style="display:flex;gap:12px;align-items:baseline;margin:8px 0;flex-wrap:wrap;">
          ${subCalcs.map((sc, i) => `
            <div>
              <span style="font-size:1.6rem;font-weight:800;color:${colors[i % colors.length]};">${sc.units.toFixed(1)}</span>
              <span style="color:var(--text-3);font-size:0.78rem;">enot ${esc(sc.sub.name.split(' ')[0])}</span>
            </div>
          `).join('<span style="color:var(--text-3);font-weight:700;">+</span>')}
          <span style="font-size:1.1rem;font-weight:700;margin-left:auto;color:#fff;">= ${totalUnits.toFixed(1)} enot skupaj</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-3);line-height:1.4;">${syringeInstructions}</div>
        ${vbodBtnHtml}
        ${siteHistoryHtml(sites)}
      </div>

      <!-- Bento pregled snovi in ravnovesja -->
      <div class="bento-grid" style="margin-bottom:12px;">
        ${bentoHtml}
      </div>

      <!-- Graf kinetičnega profila -->
      <div style="margin-top:4px;margin-bottom:12px;">
        <div class="bento-label" style="margin-bottom:6px;">Kinetični profil (1-kompartmentni model deleža ravnovesja)</div>
        <div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:12px;height:170px;padding:8px;">
          <svg id="cpChart" width="100%" height="100%"></svg>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-3);margin-top:6px;flex-wrap:wrap;gap:6px;">
          ${substances.map((sub, i) => `<span style="color:${colors[i % colors.length]}; font-weight:700;">— ${esc(sub.name)}</span>`).join('')}
          <span style="color:rgba(255,255,255,0.7);">| danes</span>
        </div>
      </div>

      <!-- Kontrole krvi za zdravnika -->
      <div style="background:rgba(0,230,118,0.06);border:1px solid rgba(0,230,118,0.25);border-radius:14px;padding:14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <div style="font-weight:800;font-size:0.92rem;color:var(--rec-green);">🩸 Kontrole krvi & Raven ravnovesja</div>
          <span style="font-size:0.72rem;color:var(--text-3);">${checkedCount} / ${MISSING_BLOOD_TESTS.length} naročeno</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-2);line-height:1.4;margin-bottom:10px;">
          Datumi ~90 % in polnega ravnovesja za posvet z zdravnikom. <strong>Termin in obseg določi zdravnik.</strong>
        </div>

        <div style="background:var(--surface-1);border-radius:10px;padding:10px;margin-bottom:10px;font-size:0.76rem;">
          ${subCalcs.map(sc => `
            <div style="margin-bottom:6px;">
              <strong>${esc(sc.sub.name)}</strong> (zadnja sprememba: ${formatSlo(sc.lastCh.date)} · ${sc.lastCh.doseMgWeekly} mg/t):<br>
              <span style="color:var(--text-3);">
                • ~90% ravnovesja: <strong style="color:#fff;">${formatSlo(sc.date90)}</strong> ${sc.daysTo90 <= 0 ? '(doseženo)' : `(čez ${sc.daysTo90} dni)`}<br>
                • ~ravnovesje (≈5 t½): <strong style="color:#fff;">${formatSlo(sc.dateSs)}</strong> ${sc.daysToSs <= 0 ? '(doseženo)' : `(čez ${sc.daysToSs} dni)`}
              </span>
            </div>
          `).join('')}
        </div>

        <div style="font-size:0.76rem;font-weight:700;color:#fff;margin-bottom:6px;">
          Seznam preiskav, manjkajočih pri izvidu 2.11.2026 (kontrolni seznam za zdravnika):
        </div>
        ${checklistHtml}
        <div style="font-size:0.7rem;color:var(--text-3);margin-top:6px;">
          Opomba: Aplikacija ne predpisuje preiskav in ne svetuje odmerkov. Termin in obseg laboratorijskih preiskav določi zdravnik.
        </div>
      </div>

      <!-- Upravljanje snovi in odmerkov -->
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div class="bento-label">Nastavitve snovi in zgodovina odmerkov</div>
          <button type="button" class="btn secondary" style="min-height:44px;font-size:0.78rem;padding:6px 12px;" onclick="CikelPlan.openAddSubstance()">➕ Dodaj snov</button>
        </div>
        ${subManagerHtml}
        ${formHtml}
      </div>

      <!-- Varovalke in rdeče črte (brez priporočil odmerkov) -->
      <details style="margin-top:10px;font-size:0.8rem;line-height:1.5;">
        <summary style="cursor:pointer;font-weight:700;padding:6px 0;">⚠️ Mejne vrednosti in opozorila</summary>
        <ul style="padding-left:18px;margin:6px 0;color:var(--text-2);">
          <li><strong>HCT ≥ 52 %</strong>: opozorilna meja, spremljaj hidracijo. <strong>HCT ≥ 54 %</strong>: takojšen posvet z zdravnikom / flebotomija.</li>
          <li><strong>Krvni tlak</strong>: merjenje 2× tedensko; več dni &gt; 150/95 zahteva zdravniško obravnavo.</li>
          <li><strong>Bolečina v prsih, nenadna zasoplost, enostransko oteklo meče</strong>: takojšnja nujna medicinska pomoč (urgenca).</li>
          <li><strong>Prilagoditve protokola</strong>: Aplikacija ne predlaga odmerkov. Morebitne spremembe načrta določa uporabnik v sodelovanju z zdravnikom.</li>
        </ul>
      </details>
    `;

    drawChart(sim, today, substances);

    // Obnovi položaj drsenja
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, scrollY);
    }
  }

  // ---------- Izvidi: zgodovina in sparkline (ohranjeno) ----------

  function readOldBw() {
    if (typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(LS_BW) || 'null'); } catch (e) { return null; }
  }

  function normBw(x) {
    return { datum: String(x.datum || ''), hct: num(x.hct), e2: num(x.e2), totalT: num(x.totalT), ggt: num(x.ggt) };
  }

  function bwHistory() {
    let h = null;
    if (typeof localStorage !== 'undefined') {
      try { h = JSON.parse(localStorage.getItem(LS_BW_HIST) || 'null'); } catch (e) { h = null; }
    }
    if (Array.isArray(h)) return h;
    const old = readOldBw();
    return old && old.datum ? [normBw(old)] : [];
  }

  function appendBloodwork(bw) {
    const h = bwHistory();
    h.push(Object.assign(normBw(bw), { ts: Date.now() }));
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(LS_BW_HIST, JSON.stringify(h)); } catch (e) {}
    }
    renderBloodworkTrend();
  }

  function sparkHtml(series, band) {
    const pts = series.filter(p => p.v != null);
    if (pts.length < 2) return '<div style="font-size:0.78rem;color:var(--text-3);">Premalo podatkov (potrebna sta vsaj 2 izvida).</div>';
    const W = 300, H = 64, P = 6;
    let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
    if (band) { lo = Math.min(lo, band.lo); hi = Math.max(hi, band.alarm != null ? band.alarm : band.hi); }
    const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const x = i => P + (W - 2 * P) * i / (pts.length - 1);
    const y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo);
    let bandSvg = '';
    if (band) {
      bandSvg += `<rect x="${P}" y="${y(band.hi).toFixed(1)}" width="${W - 2 * P}" height="${(y(band.lo) - y(band.hi)).toFixed(1)}" fill="rgba(0,230,118,0.12)"/>`;
      if (band.alarm != null) bandSvg += `<line x1="${P}" x2="${W - P}" y1="${y(band.alarm).toFixed(1)}" y2="${y(band.alarm).toFixed(1)}" stroke="#FF3D00" stroke-dasharray="3,3"/>`;
    }
    const line = pts.map((p, i) => x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
    const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" fill="var(--strain-blue)"><title>${esc(p.d)}: ${p.v}</title></circle>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Trend">${bandSvg}<polyline points="${line}" fill="none" stroke="var(--strain-blue)" stroke-width="2"/>${dots}</svg>`;
    const list = pts.map(p => `<span style="display:inline-block;margin:1px 6px 1px 0;">${esc(formatSlo(p.d))} <strong style="color:#fff;">${p.v}</strong></span>`).join('');
    return svg + `<div style="font-size:0.7rem;color:var(--text-3);line-height:1.6;margin-top:2px;">${list}</div>`;
  }

  function renderBloodworkTrend() {
    const host = el('bwTrendRoot');
    if (!host) return;
    const h = bwHistory();
    const series = (key, label, band, refTxt) => {
      const pts = h.map(x => ({ d: x.datum, v: x[key] })).filter(p => p.d);
      const last = pts.length ? pts[pts.length - 1] : null;
      return `<div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:12px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.8rem;">
          <span style="font-weight:700;">${label}</span>
          <span style="color:var(--text-3);font-size:0.74rem;">${last && last.v != null ? 'zadnji: <strong style="color:#fff;">' + last.v + '</strong> (' + esc(formatSlo(last.d)) + ')' : '–'}</span>
        </div>
        <div style="margin-top:6px;">${sparkHtml(pts.map(p => ({ d: p.d, v: p.v })), band)}</div>
        <div style="font-size:0.68rem;color:var(--text-3);margin-top:4px;">${refTxt}</div>
      </div>`;
    };
    host.innerHTML = `
      <div class="card-header"><div class="card-title">📈 Trend izvidov</div><span class="status-pill">${h.length} izvidov</span></div>
      ${series('hct', 'Hematokrit (HCT, %)', { lo: 42, hi: 50, alarm: 54 }, 'Ref. iz kode: optimum 42–50 %, alarm ≥ 54 % (zelena cona, rdeča črtkana).')}
      ${series('e2', '17-β E2 (pg/mL)', null, 'Referenčnih območij v kodi ni.')}
      ${series('totalT', 'Skupni T (ng/dL)', null, 'Referenčnih območij v kodi ni.')}
      ${series('ggt', 'GGT (U/L)', null, 'Referenčnih območij v kodi ni.')}`;
  }

  // ---------- Javni API ----------

  const CikelPlan = {
    // Matematične in modelske funkcije
    calcUnitsPerDay,
    calcSteadyStateDays,
    calcSteadyStateDate,
    getDoseOnDate,
    getCurrentDose,
    getLastChange,
    migrateV1toV2,
    load,
    save,
    simulate,
    render,

    // Vbod in rotacija
    pickSite() { uiState.pickingSite = true; render(); },
    cancelPick() { uiState.pickingSite = false; render(); },
    markToday(siteId) {
      if (!SITES.some(st => st.id === siteId)) return;
      const s = load();
      s.done = s.done || {};
      s.sites = Array.isArray(s.sites) ? s.sites : [];
      const k = isoDate(new Date());
      if (s.done[k]) { uiState.pickingSite = false; render(); return; }

      const timeStr = new Date().toTimeString().slice(0, 5);
      s.done[k] = timeStr;
      s.sites.push({ date: k, site: siteId, time: timeStr });
      s.diaryIds = s.diaryIds || {};

      if (typeof window !== 'undefined' && window.ProtocolDiary) {
        try {
          const subParts = [];
          (s.substances || []).forEach(sub => {
            const d = getCurrentDose(sub, k);
            if (d > 0) {
              const u = calcUnitsPerDay(d, sub.conc);
              subParts.push(`${sub.name}: ${u.toFixed(1)} enot (${d} mg/t)`);
            }
          });
          const totalU = (s.substances || []).reduce((acc, sub) => acc + calcUnitsPerDay(getCurrentDose(sub, k), sub.conc), 0);
          const entry = window.ProtocolDiary.addEntry({
            substance: (s.substances || []).map(x => x.name).join(' + '),
            dose: totalU.toFixed(1),
            unit: 'enot (U-100)',
            category: 'anabolik',
            slot: 'MORNING_FASTED',
            notes: `Dnevni vbod (${subParts.join(' · ')}) · mesto: ${siteLabel(siteId)}`
          });
          if (entry && entry.id) s.diaryIds[k] = entry.id;
        } catch (e) {}
      }

      uiState.pickingSite = false;
      save(s);
      render();
      if (typeof window !== 'undefined' && window.ProtocolDiaryUI) {
        try { window.ProtocolDiaryUI.refreshActiveViews(); } catch (e) {}
      }
    },
    toggleToday() {
      const s = load();
      s.done = s.done || {};
      const k = isoDate(new Date());
      s.diaryIds = s.diaryIds || {};
      if (s.done[k]) {
        delete s.done[k];
        if (s.diaryIds[k] && typeof window !== 'undefined' && window.ProtocolDiary && window.ProtocolDiary.deleteEntry) {
          try { window.ProtocolDiary.deleteEntry(s.diaryIds[k]); } catch (e) {}
        }
        delete s.diaryIds[k];
        s.sites = (s.sites || []).filter(x => x.date !== k);
        save(s);
        render();
        if (typeof window !== 'undefined' && window.ProtocolDiaryUI) {
          try { window.ProtocolDiaryUI.refreshActiveViews(); } catch (e) {}
        }
      } else {
        uiState.pickingSite = true;
        render();
      }
    },

    // Kontrole krvi checklist
    toggleBloodCheck(id) {
      const s = load();
      s.bloodChecklist = s.bloodChecklist || {};
      s.bloodChecklist[id] = !s.bloodChecklist[id];
      save(s);
      render();
    },

    // Upravljanje snovi in odmerkov
    openAddSubstance() {
      uiState.formMode = 'add_substance';
      uiState.selectedSubId = null;
      render();
    },
    saveNewSubstance() {
      const name = (el('cpNewSubName') || {}).value || '';
      const conc = num((el('cpNewSubConc') || {}).value);
      const half = num((el('cpNewSubHalf') || {}).value);
      const date = (el('cpNewSubDate') || {}).value || isoDate(new Date());
      const dose = num((el('cpNewSubDose') || {}).value);

      if (!name.trim()) { alert('Vnesi ime snovi.'); return; }
      if (!conc || conc <= 0) { alert('Vnesi veljavno koncentracijo (mg/mL).'); return; }
      if (!half || half <= 0) { alert('Vnesi razpolovni čas (dni).'); return; }
      if (dose == null || dose < 0) { alert('Vnesi začetni odmerek (mg/teden).'); return; }

      const s = load();
      s.substances = s.substances || [];
      const newId = 'sub_' + Date.now();
      s.substances.push({
        id: newId,
        name: name.trim(),
        conc,
        halfLife: half,
        changes: [{ date, doseMgWeekly: dose }]
      });
      uiState.formMode = null;
      save(s);
      render();
    },
    removeSubstance(id) {
      const s = load();
      const sub = (s.substances || []).find(x => x.id === id);
      const name = sub ? sub.name : 'snov';
      if (typeof confirm === 'function' && !confirm(`Ali res želiš odstraniti snov "${name}"?`)) return;
      s.substances = (s.substances || []).filter(x => x.id !== id);
      uiState.formMode = null;
      save(s);
      render();
    },
    openAddChange(subId) {
      uiState.formMode = 'add_change';
      uiState.selectedSubId = subId;
      render();
    },
    saveNewChange(subId) {
      const date = (el('cpChangeDate') || {}).value || isoDate(new Date());
      const dose = num((el('cpChangeDose') || {}).value);
      if (dose == null || dose < 0) { alert('Vnesi veljaven nov odmerek (mg/teden).'); return; }

      const s = load();
      const sub = (s.substances || []).find(x => x.id === subId);
      if (sub) {
        sub.changes = sub.changes || [];
        // Če že obstaja sprememba na isti datum, jo posodobi, sicer dodaj novo
        const existing = sub.changes.find(c => c.date === date);
        if (existing) {
          existing.doseMgWeekly = dose;
        } else {
          sub.changes.push({ date, doseMgWeekly: dose });
        }
        sub.changes.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      }
      uiState.formMode = null;
      uiState.selectedSubId = null;
      save(s);
      render();
    },
    removeChange(subId, index) {
      const s = load();
      const sub = (s.substances || []).find(x => x.id === subId);
      if (sub && Array.isArray(sub.changes) && sub.changes.length > 1) {
        sub.changes.splice(index, 1);
        save(s);
        render();
      }
    },
    cancelForm() {
      uiState.formMode = null;
      uiState.selectedSubId = null;
      render();
    },

    // Združljivost s starimi klici
    start() { render(); },
    reset() {
      if (typeof confirm === 'function' && !confirm('Ponastavim plan na privzete snovi in odmerke?')) return;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LS_KEY_V2);
      }
      uiState.formMode = null;
      uiState.pickingSite = false;
      render();
    },

    // Izvidi
    appendBloodwork,
    renderBloodworkTrend,
    bloodworkHistory: bwHistory,
    SITES,
    MISSING_BLOOD_TESTS,
    DEFAULT_SUBSTANCES,

    // Objekt za združljivost
    get PLAN() {
      const s = load();
      return {
        naziv: (s.substances || []).map(x => `${getCurrentDose(x, isoDate(new Date()))} mg ${x.name}`).join(' + ') || 'Protokol',
        substances: s.substances || []
      };
    }
  };

  const rootObj = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
  if (rootObj) rootObj.CikelPlan = CikelPlan;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CikelPlan;
  }

  function boot() {
    render();
    renderBloodworkTrend();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
