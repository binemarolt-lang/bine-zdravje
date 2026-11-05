/* Cikel plan: Test cip + EQ blast (Bine, nov 2026)
 * Plan: EQ 10 enot (185 mg/teden) od 1. dne, test ramp 12,12,18,24,30 enot.
 * U-100 inzulinka, Test 250 mg/mL, EQ 264 mg/mL, 1 s.c. vbod dnevno.
 * Model: 1-kompartment, t1/2 Test 6 d, EQ 14 d, start s 200 mg/teden testa (saturiran).
 */
(function () {
  'use strict';
  const LS_KEY = 'bine_cikel_plan_v1';
  const PLAN = {
    naziv: 'Blast: 525 mg Test + 185 mg EQ',
    testConc: 250, eqConc: 264,
    // enote na dan po tednih (zadnja vrednost velja naprej)
    testUnits: [12, 12, 18, 24, 30],
    eqUnits: [10],
    tedni: 16,
    halfT: 6, halfE: 14, baseTestWeekly: 200,
    kontrole: [
      { teden: 4, naziv: 'Mini panel', opis: 'Hemogram (HCT), E2, skupni T, GGT pri Dr. Luís Marinho, na tešče, 48 h brez težkega treninga.' },
      { teden: 10, naziv: 'Polni panel', opis: 'Hemogram, E2, skupni T, lipidi, GGT/ALT/AST, kreatinin + cistatin C. Oba skoraj v ravnovesju.' },
      { teden: 16, naziv: 'Konec blasta', opis: 'Panel pred prehodom na cruise (125–150 mg/teden) ali PCT (6–8 tednov po zadnjem EQ).' }
    ]
  };

  const unitsFor = (arr, w) => arr[Math.min(w, arr.length - 1)];
  const mgPerDay = (units, conc) => units / 100 * conc;
  const DAY = 86400000;

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function isoDate(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

  function dayIndex(start, date) { return Math.floor((parseIso(isoDate(date)) - parseIso(start)) / DAY); }

  // simulacija deleža cilja po dnevih
  function simulate(days) {
    const kT = Math.LN2 / PLAN.halfT, kE = Math.LN2 / PLAN.halfE;
    const tFin = mgPerDay(unitsFor(PLAN.testUnits, 99), PLAN.testConc);
    const eFin = mgPerDay(unitsFor(PLAN.eqUnits, 99), PLAN.eqConc);
    const TssF = tFin / kT, EssF = eFin / kE;
    let T = (PLAN.baseTestWeekly / 7) / kT, E = 0;
    const out = [];
    for (let d = 0; d < days; d++) {
      const w = Math.floor(d / 7);
      T = T * Math.exp(-kT) + mgPerDay(unitsFor(PLAN.testUnits, w), PLAN.testConc);
      E = E * Math.exp(-kE) + mgPerDay(unitsFor(PLAN.eqUnits, w), PLAN.eqConc);
      out.push({ d: d + 1, t: T / TssF * 100, e: E / EssF * 100 });
    }
    return out;
  }

  function el(id) { return document.getElementById(id); }

  function render() {
    const root = el('cikelPlanRoot');
    if (!root) return;
    const s = load();

    if (!s.start) {
      root.innerHTML = `
        <div class="card-header"><div class="card-title">🗓️ ${PLAN.naziv}</div><span class="status-pill">Ni začet</span></div>
        <div style="font-size:0.82rem;color:var(--text-2);line-height:1.5;margin-bottom:10px;">
          EQ od 1. dne na 10 enotah, test se dviguje 12 → 12 → 18 → 24 → 30 enot. En s.c. vbod dnevno, največ 40 enot (0,40 mL).
        </div>
        <label style="font-size:0.72rem;color:var(--text-3);font-weight:700;text-transform:uppercase;">Datum prvega vboda</label>
        <input type="date" id="cpStartInput" value="${isoDate(new Date())}" style="width:100%;padding:8px;margin:6px 0 10px;background:var(--surface-2);border:1px solid var(--edge-2);border-radius:6px;color:#fff;">
        <button type="button" class="btn" style="width:100%;padding:10px;font-weight:700;" onclick="CikelPlan.start()">▶ Začni plan</button>`;
      return;
    }

    const today = new Date();
    const di = dayIndex(s.start, today);
    const total = PLAN.tedni * 7;
    const w = Math.max(0, Math.floor(di / 7));
    const tU = unitsFor(PLAN.testUnits, w), eU = unitsFor(PLAN.eqUnits, w);
    const todayKey = isoDate(today);
    const done = (s.done || {})[todayKey];
    const sim = simulate(total);
    const cur = sim[Math.min(Math.max(di, 0), total - 1)];
    const nextUp = (() => {
      for (let ww = w + 1; ww < PLAN.testUnits.length; ww++) if (unitsFor(PLAN.testUnits, ww) !== tU) return { teden: ww + 1, units: unitsFor(PLAN.testUnits, ww) };
      return null;
    })();
    const nextKontrola = PLAN.kontrole.find(k => k.teden >= w + 1);
    const streak = Object.keys(s.done || {}).length;

    const status = di < 0 ? `Začne se čez ${-di} dni` : di >= total ? 'Blast končan' : `Teden ${w + 1} / ${PLAN.tedni} · dan ${di + 1}`;

    // tabela tednov
    let rows = '';
    for (let ww = 0; ww < PLAN.tedni; ww++) {
      const a = unitsFor(PLAN.testUnits, ww), b = unitsFor(PLAN.eqUnits, ww);
      const p = sim[ww * 7 + 6];
      const k = PLAN.kontrole.find(x => x.teden === ww + 1);
      const isCur = ww === w && di >= 0 && di < total;
      rows += `<tr style="${isCur ? 'background:rgba(0,230,118,0.10);font-weight:700;' : ''}">
        <td style="padding:5px 4px;">${ww + 1}${k ? ' 🩸' : ''}</td>
        <td style="padding:5px 4px;color:var(--strain-blue);">${a}</td>
        <td style="padding:5px 4px;color:var(--c-kinetics);">${b}</td>
        <td style="padding:5px 4px;">${a + b}</td>
        <td style="padding:5px 4px;color:var(--text-3);">${Math.round(mgPerDay(a, PLAN.testConc) * 7)} / ${Math.round(mgPerDay(b, PLAN.eqConc) * 7)}</td>
        <td style="padding:5px 4px;color:var(--text-3);">${Math.round(p.t)}% / ${Math.round(p.e)}%</td></tr>`;
    }

    root.innerHTML = `
      <div class="card-header"><div class="card-title">🗓️ ${PLAN.naziv}</div><span class="status-pill">${status}</span></div>

      <div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:14px;padding:14px;margin-bottom:10px;">
        <div class="bento-label">Danes v brizgo (U-100)</div>
        <div style="display:flex;gap:10px;align-items:baseline;margin:6px 0;flex-wrap:wrap;">
          <span style="font-size:1.7rem;font-weight:800;color:var(--strain-blue);">${tU}</span><span style="color:var(--text-3);">enot Test</span>
          <span style="font-size:1.7rem;font-weight:800;color:var(--c-kinetics);">+${eU}</span><span style="color:var(--text-3);">enot EQ</span>
          <span style="font-size:1.1rem;font-weight:700;margin-left:auto;">= ${tU + eU} enot</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-3);">Najprej test do črtice ${tU}, nato EQ do skupne črtice ${tU + eU}. En vbod s.c., rotiraj trebuh/bok L↔D. Brizga samo enkrat.</div>
        <button type="button" class="btn${done ? ' secondary' : ''}" style="width:100%;padding:11px;font-weight:700;margin-top:10px;" onclick="CikelPlan.toggleToday()">${done ? '✓ Danes vbrizgano (' + done + ') · klikni za razveljavitev' : '💉 Označi današnji vbod'}</button>
      </div>

      <div class="bento-grid">
        <div class="bento-cell"><span class="bento-label">Test v krvi</span><span class="bento-val" style="color:var(--strain-blue);">${cur ? Math.round(cur.t) : '–'} %</span><span class="bento-sub">cilja (525 mg/teden)</span></div>
        <div class="bento-cell"><span class="bento-label">EQ v krvi</span><span class="bento-val" style="color:var(--c-kinetics);">${cur ? Math.round(cur.e) : '–'} %</span><span class="bento-sub">cilja (185 mg/teden)</span></div>
        <div class="bento-cell"><span class="bento-label">Naslednji dvig testa</span><span class="bento-val">${nextUp ? nextUp.units + ' enot' : 'poln'}</span><span class="bento-sub">${nextUp ? 'od ' + nextUp.teden + '. tedna' : 'od 5. tedna naprej'}</span></div>
        <div class="bento-cell"><span class="bento-label">Naslednja kri</span><span class="bento-val">${nextKontrola ? nextKontrola.teden + '. teden' : '–'}</span><span class="bento-sub">${nextKontrola ? nextKontrola.naziv : ''} · vbodov: ${streak}</span></div>
      </div>

      <div style="margin-top:10px;">
        <div class="bento-label" style="margin-bottom:6px;">Delež cilja v krvi (model t½ 6 d / 14 d)</div>
        <div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:12px;height:170px;padding:8px;"><svg id="cpChart" width="100%" height="100%"></svg></div>
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-3);margin-top:4px;">
          <span style="color:var(--strain-blue);">— Test</span><span style="color:var(--c-kinetics);">— EQ</span><span>| danes</span>
        </div>
      </div>

      <div style="margin-top:12px;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.76rem;">
          <thead><tr style="color:var(--text-3);text-align:left;">
            <th style="padding:4px;">Ted.</th><th style="padding:4px;">Test</th><th style="padding:4px;">EQ</th><th style="padding:4px;">Skupaj</th><th style="padding:4px;">mg/teden</th><th style="padding:4px;">kri T/EQ</th>
          </tr></thead><tbody>${rows}</tbody></table>
      </div>

      ${nextKontrola ? `<div class="alert-banner" style="display:block;margin-top:10px;"><strong>🩸 ${nextKontrola.teden}. teden – ${nextKontrola.naziv}:</strong> ${nextKontrola.opis}</div>` : ''}

      <details style="margin-top:10px;font-size:0.8rem;line-height:1.5;">
        <summary style="cursor:pointer;font-weight:700;">⚠️ Varovalke in rdeče črte</summary>
        <ul style="padding-left:18px;margin:6px 0;color:var(--text-2);">
          <li><strong>Suhi/boleči sklepi, padec libida, letargija</strong> (E2 prenizek, EQ vodi): EQ zniži na 7 enot. Raloksifen tu ne pomaga.</li>
          <li><strong>Srbeče/boleče bradavice, zatrdlina</strong>: raloksifen 60 mg/dan do izzvenetja.</li>
          <li><strong>HCT ≥ 52 %</strong>: zniži odmerek. <strong>HCT ≥ 54 %</strong>: prekini / flebotomija.</li>
          <li><strong>Tlak</strong> 2× tedensko, cilj &lt;130/80; več dni &gt;150/95 = stop.</li>
          <li><strong>Bolečina v prsih, zasoplost, otekla meča</strong>: takoj urgenca.</li>
          <li>Voda 3,5–4 L/dan, omega-3, kardio cona 2 3×/teden.</li>
          <li>Brez front-loada. PCT šele 6–8 tednov po zadnjem EQ.</li>
        </ul>
      </details>

      <div style="display:flex;gap:8px;margin-top:10px;">
        <button type="button" class="btn secondary" style="flex:1;padding:8px;font-size:0.75rem;" onclick="CikelPlan.changeStart()">Spremeni začetek</button>
        <button type="button" class="btn secondary" style="flex:1;padding:8px;font-size:0.75rem;" onclick="CikelPlan.reset()">Ponastavi plan</button>
      </div>`;

    drawChart(sim, di);
  }

  function drawChart(sim, di) {
    const svg = el('cpChart');
    if (!svg) return;
    const W = svg.clientWidth || 320, H = svg.clientHeight || 150, pad = 18;
    const max = 110, n = sim.length;
    const x = i => pad + (W - pad * 2) * i / (n - 1);
    const y = v => H - pad - (H - pad * 2) * Math.min(v, max) / max;
    const path = key => sim.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1)).join(' ');
    let grid = '';
    [0, 50, 100].forEach(v => { grid += `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.08)"/><text x="2" y="${y(v) + 3}" fill="rgba(255,255,255,0.4)" font-size="8">${v}</text>`; });
    for (let w = 0; w <= PLAN.tedni; w += 4) grid += `<text x="${x(Math.min(w * 7, n - 1)) - 4}" y="${H - 4}" fill="rgba(255,255,255,0.4)" font-size="8">t${w}</text>`;
    const today = di >= 0 && di < n ? `<line x1="${x(di)}" x2="${x(di)}" y1="${pad}" y2="${H - pad}" stroke="rgba(255,255,255,0.5)" stroke-dasharray="3,3"/>` : '';
    svg.innerHTML = grid + today +
      `<path d="${path('t')}" fill="none" stroke="var(--strain-blue)" stroke-width="2"/>` +
      `<path d="${path('e')}" fill="none" stroke="var(--c-kinetics)" stroke-width="2"/>`;
  }

  window.CikelPlan = {
    PLAN, simulate, render,
    start() {
      const v = (el('cpStartInput') || {}).value || isoDate(new Date());
      const s = load(); s.start = v; s.done = s.done || {}; save(s); render();
    },
    toggleToday() {
      const s = load(); s.done = s.done || {};
      const k = isoDate(new Date());
      if (s.done[k]) delete s.done[k];
      else s.done[k] = new Date().toTimeString().slice(0, 5);
      save(s); render();
    },
    changeStart() {
      const s = load();
      const v = prompt('Datum prvega vboda (LLLL-MM-DD):', s.start || isoDate(new Date()));
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) { s.start = v; save(s); render(); }
    },
    reset() {
      if (confirm('Ponastavim plan (začetek in odkljukane vbode)?')) { localStorage.removeItem(LS_KEY); render(); }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
