/**
 * Bine Zdravje — WorkoutEngine: e1RM, volumen, PR-ji, progresija, prejšnje serije, ploščice, ogrevanje,
 * tedenske serije po mišicah. Čiste funkcije nad zgodovino (podatkovni model: trening-roj/POGODBA.md).
 *
 * Formule e1RM: Epley, Brzycki, Lombardi, O'Conner, Mayhew, Wathan, Lander (standardne objavljene oblike).
 * "weighted" = mediana-uteženo povprečje (pri nizkih ponovitvah prevladata Epley/Brzycki).
 * RIR se prišteje ponovitvam (efektivne ponovitve do odpovedi), npr. Helms in sod. 2016 (RIR-RPE).
 */
(function (root) {
  'use strict';

  const REP_CAP = 15;
  const FORMULAS = {
    epley: (w, r) => w * (1 + r / 30),
    brzycki: (w, r) => r >= 37 ? NaN : w * 36 / (37 - r),
    lombardi: (w, r) => w * Math.pow(r, 0.1),
    oconner: (w, r) => w * (1 + r / 40),
    mayhew: (w, r) => (w * 100) / (52.2 + 41.9 * Math.exp(-0.055 * r)),
    wathan: (w, r) => (w * 100) / (48.8 + 53.8 * Math.exp(-0.075 * r)),
    lander: (w, r) => (w * 100) / (101.3 - 2.67123 * r),
  };

  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const isWork = s => s && s.done !== false && s.type !== 'warmup';
  const r1 = v => Math.round(v * 10) / 10;

  function e1rm(w, reps, rir = 0, formula = 'weighted') {
    w = num(w); reps = num(reps); rir = num(rir) || 0;
    if (!w || w <= 0 || !reps || reps <= 0) return null;
    const r = reps + Math.max(0, Math.min(5, rir));
    if (r > REP_CAP) return null;
    if (r === 1) return r1(w);
    if (formula !== 'weighted') {
      if (r > 12) return null;
      const f = FORMULAS[formula] || FORMULAS.epley;
      return r1(f(w, r));
    }
    const vals = Object.values(FORMULAS).map(f => f(w, r)).filter(v => isFinite(v) && v > 0);
    // Pri nizkih ponovitvah zaupamo Epley+Brzycki bolj, pri višjih enakomerno vsem
    const ep = FORMULAS.epley(w, r), br = FORMULAS.brzycki(w, r);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const k = r <= 6 ? 0.6 : 0.3;
    return r1(k * (ep + br) / 2 + (1 - k) * mean);
  }

  function bestSetE1rm(sets, formula) {
    let best = null;
    for (const s of sets || []) {
      if (!isWork(s)) continue;
      const v = e1rm(s.w, s.reps, s.rir, formula);
      if (v && (!best || v > best.e1rm)) best = { e1rm: v, set: s };
    }
    return best;
  }

  function setVolume(s) {
    const w = num(s && s.w), r = num(s && s.reps);
    if (!isWork(s) || !r) return 0;
    return Math.max(0, (w || 0)) * r;
  }

  function exInfo(db, exId) {
    if (!db) return null;
    if (db._byId) return db._byId[exId] || null;
    const list = db.exercises || db;
    if (!Array.isArray(list)) return null;
    Object.defineProperty(db, '_byId', { value: Object.fromEntries(list.map(e => [e.id, e])), enumerable: false });
    return db._byId[exId] || null;
  }

  function muscleWeights(info) {
    if (!info) return {};
    if (info.wt && Object.keys(info.wt).length) return info.wt;
    const o = {};
    (info.pri || []).forEach(m => o[m] = 1);
    (info.sec || []).forEach(m => { if (!o[m]) o[m] = 0.5; });
    return o;
  }

  function workoutStats(workout, db) {
    let volumeKg = 0, sets = 0, reps = 0;
    const muscleSets = {};
    for (const ex of (workout && workout.exercises) || []) {
      const mw = muscleWeights(exInfo(db, ex.exId));
      for (const s of ex.sets || []) {
        if (!isWork(s)) continue;
        sets++; reps += num(s.reps) || 0; volumeKg += setVolume(s);
        for (const [m, w] of Object.entries(mw)) if (w > 0) muscleSets[m] = r1((muscleSets[m] || 0) + w);
      }
    }
    const end = workout && (workout.end || null);
    const durationMin = workout && workout.start && end ? Math.round((end - workout.start) / 60000) : null;
    return { volumeKg: Math.round(volumeKg), sets, reps, durationMin, muscleSets };
  }

  function sortedHistory(history) {
    return [...(history || [])].sort((a, b) => (a.start || 0) - (b.start || 0) || String(a.date).localeCompare(String(b.date)));
  }

  /** Najboljši dosežki za vajo v dani zgodovini. */
  function recordsFor(exId, history) {
    const rec = { e1rm: 0, weight: 0, volume: 0, repsAt: {} };
    for (const w of history || []) for (const ex of w.exercises || []) {
      if (ex.exId !== exId) continue;
      for (const s of ex.sets || []) {
        if (!isWork(s)) continue;
        const e = e1rm(s.w, s.reps, s.rir) || 0;
        const kg = num(s.w) || 0, r = num(s.reps) || 0;
        rec.e1rm = Math.max(rec.e1rm, e);
        rec.weight = Math.max(rec.weight, kg);
        rec.volume = Math.max(rec.volume, kg * r);
        if (kg > 0) rec.repsAt[kg] = Math.max(rec.repsAt[kg] || 0, r);
      }
    }
    return rec;
  }

  function detectPRs(workout, history, db) {
    const prior = (history || []).filter(h => h.id !== workout.id && (h.start || 0) < (workout.start || Infinity));
    const out = [];
    for (const ex of workout.exercises || []) {
      const prev = recordsFor(ex.exId, prior);
      const had = prior.some(h => (h.exercises || []).some(e => e.exId === ex.exId));
      if (!had) continue; // prvi zapis vaje ni "rekord"
      const cur = recordsFor(ex.exId, [workout]);
      if (cur.e1rm > prev.e1rm + 0.05) out.push({ exId: ex.exId, name: ex.name, kind: 'e1rm', value: cur.e1rm, prev: prev.e1rm });
      if (cur.weight > prev.weight) out.push({ exId: ex.exId, name: ex.name, kind: 'weight', value: cur.weight, prev: prev.weight });
      if (cur.volume > prev.volume) out.push({ exId: ex.exId, name: ex.name, kind: 'volume', value: cur.volume, prev: prev.volume });
      for (const [kg, r] of Object.entries(cur.repsAt)) {
        if (prev.repsAt[kg] !== undefined && r > prev.repsAt[kg] && Number(kg) >= prev.weight * 0.6) {
          out.push({ exId: ex.exId, name: ex.name, kind: 'reps@weight', value: r, prev: prev.repsAt[kg], weight: Number(kg) });
        }
      }
    }
    return out;
  }

  function lastSessionsOf(exId, history, n = 2) {
    const res = [];
    for (const w of sortedHistory(history).reverse()) {
      const ex = (w.exercises || []).find(e => e.exId === exId);
      if (ex) { res.push({ workout: w, ex }); if (res.length >= n) break; }
    }
    return res;
  }

  function previousSets(exId, history) {
    const last = lastSessionsOf(exId, history, 1)[0];
    return last ? last.ex.sets.map(s => ({ ...s })) : [];
  }

  function isLowerCompound(info) {
    if (!info) return false;
    const pri = info.pri || [];
    return info.bp === 'upper legs' || pri.some(m => ['quadriceps', 'hamstring', 'gluteal'].includes(m));
  }

  function incrementFor(info) {
    const eq = (info && info.eq) || '';
    if (eq === 'dumbbell' || eq === 'kettlebell') return 2;
    if (eq === 'cable' || eq === 'leverage machine' || eq === 'machine') return 2.5;
    if (eq === 'body weight') return 0;
    return isLowerCompound(info) && eq === 'barbell' ? 5 : 2.5;
  }

  function roundTo(v, step) { return step > 0 ? Math.round(v / step) * step : v; }

  /**
   * Dvojna progresija: delaj v razponu ponovitev; ko vse delovne serije dosežejo vrh (in RIR >= 1 ali neznan),
   * dvigni težo in pojdi na dno razpona. Dvakrat zapored pod dnom -> deload 10 %.
   */
  function suggestNext(exId, history, opts = {}) {
    const [lo, hi] = opts.repRange || [6, 10];
    const info = exInfo(opts.db, exId);
    const sessions = lastSessionsOf(exId, history, 2);
    if (!sessions.length) return null;
    const work = s => (s.ex.sets || []).filter(isWork);
    const lastSets = work(sessions[0]);
    if (!lastSets.length) return null;
    const nSets = lastSets.length;
    const topW = Math.max(...lastSets.map(s => num(s.w) || 0));
    const atTop = lastSets.filter(s => (num(s.w) || 0) === topW);
    const inc = opts.increment != null ? opts.increment : incrementFor(info);
    const bw = topW === 0;

    // RIR varovalka (MacroFactor/Alpha): dvig šele, ko je vrh dosežen z rezervo >= ciljnega RIR - 1
    const tRir = opts.targetRir != null ? opts.targetRir : 2;
    const allTop = atTop.every(s => (num(s.reps) || 0) >= hi && (s.rir == null || s.rir >= Math.max(1, tRir - 1)));
    const belowLo = sets => sets.some(s => (num(s.reps) || 0) < lo);
    if (!bw && belowLo(atTop) && sessions[1] && belowLo(work(sessions[1]))) {
      const w = roundTo(topW * 0.9, inc || 2.5);
      return { w, reps: lo, sets: nSets, reason: `Dvakrat zapored pod ${lo} ponovitev → deload 10 % (${w} kg).` };
    }
    if (allTop) {
      if (bw || inc === 0) return { w: topW || null, reps: hi + 1, sets: nSets, reason: `Vse serije na ${hi}+ ponovitvah → poskusi ${hi + 1} (ali dodaj utež).` };
      const w = r1(topW + inc);
      return { w, reps: lo, sets: nSets, reason: `Vse serije dosegle ${hi} ponovitev → +${inc} kg na ${w} kg, nazaj na ${lo} ponovitev.` };
    }
    const minReps = Math.min(...atTop.map(s => num(s.reps) || 0));
    const target = Math.min(hi, Math.max(lo, minReps + 1));
    return { w: topW || null, reps: target, sets: nSets, reason: `Ostani na ${topW || 'lastni teži'}${topW ? ' kg' : ''}, cilj ${target} ponovitev v vsaki seriji.` };
  }

  function plates(totalKg, settings = {}) {
    const bar = settings.barKg != null ? settings.barKg : 20;
    const avail = [...(settings.plates || [25, 20, 15, 10, 5, 2.5, 1.25])].sort((a, b) => b - a);
    let side = (Number(totalKg) - bar) / 2;
    const perSide = [];
    if (side < 0) return { perSide, achieved: bar, bar };
    for (const p of avail) {
      while (side + 1e-9 >= p) { perSide.push(p); side -= p; }
    }
    const achieved = r1(bar + 2 * perSide.reduce((a, b) => a + b, 0));
    return { perSide, achieved, bar };
  }

  function warmups(workKg, settings = {}) {
    const bar = settings.barKg != null ? settings.barKg : 20;
    const w = Number(workKg) || 0;
    if (w <= bar) return [];
    const out = [{ w: bar, reps: 10, type: 'warmup', done: false }];
    for (const [pct, reps] of [[0.4, 8], [0.6, 5], [0.8, 3]]) {
      const kg = roundTo(w * pct, 2.5);
      if (kg > out[out.length - 1].w && kg < w) out.push({ w: kg, reps, type: 'warmup', done: false });
    }
    return out;
  }

  function weeklyMuscleSets(history, db, endDate) {
    const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();
    const start = end - 7 * 864e5;
    const out = {};
    for (const w of history || []) {
      const t = w.start || new Date(w.date + 'T12:00:00').getTime();
      if (t < start || t > end) continue;
      const st = workoutStats(w, db).muscleSets;
      for (const [m, v] of Object.entries(st)) out[m] = r1((out[m] || 0) + v);
    }
    return out;
  }

  /** Časovna vrsta e1RM po treningih (za graf). */
  function e1rmSeries(exId, history) {
    return sortedHistory(history).map(w => {
      const ex = (w.exercises || []).find(e => e.exId === exId);
      const b = ex && bestSetE1rm(ex.sets);
      return b ? { date: w.date, t: w.start, e1rm: b.e1rm, w: num(b.set.w), reps: num(b.set.reps) } : null;
    }).filter(Boolean);
  }

  const api = { REP_CAP, FORMULAS, e1rm, bestSetE1rm, setVolume, workoutStats, detectPRs, suggestNext, previousSets, plates, warmups, weeklyMuscleSets, e1rmSeries, recordsFor, incrementFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.WorkoutEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
