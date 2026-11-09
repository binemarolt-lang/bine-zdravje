/**
 * Bine Zdravje — RecoveryEngine: regeneracija po mišicah (Fitbod-slog), barve body mape, tedenski volumen (RP MEV/MAV/MRV).
 *
 * Model (domneva, kalibriran na cilje iz POGODBA): vsaka delovna serija doda utrujenost = utež mišice × napor
 * (RIR 0→1.0, 1→0.9, 2→0.8, 3+→0.65, neznan 0.85). Utrujenost eksponentno upada s časovno konstanto tau,
 * izbrano tako, da je ~90 % pobrano v 72 h (velike), 60 h (srednje), 48 h (male mišice): tau = T90 / ln(10).
 * Regeneracija % = 100 × exp(-preostala_utrujenost / CAP), CAP = 3.5 (6 težkih serij včeraj ≈ 45 %, 3 serije pred 3 dnevi ≈ 93 %).
 * Volumenske meje: RP Strength (Israetel) priporočila, rpstrength.com/blogs/articles — okvirne vrednosti.
 */
(function (root) {
  'use strict';

  const H = 3600e3;
  const GROUP = {
    quadriceps: 72, hamstring: 72, gluteal: 72, 'upper-back': 72, 'lower-back': 72, chest: 72,
    'front-deltoids': 60, 'back-deltoids': 60, trapezius: 60, adductor: 60, abductors: 60,
    biceps: 48, triceps: 48, forearm: 48, calves: 48, abs: 48, obliques: 48, neck: 48,
  };
  const CAP = 3.5;

  const LANDMARKS = {
    chest: { mev: 8, mav: [12, 20], mrv: 22 },
    'upper-back': { mev: 10, mav: [14, 22], mrv: 25 },
    quadriceps: { mev: 8, mav: [12, 18], mrv: 20 },
    hamstring: { mev: 6, mav: [10, 16], mrv: 20 },
    gluteal: { mev: 0, mav: [4, 12], mrv: 16 },
    'front-deltoids': { mev: 0, mav: [6, 8], mrv: 12 },
    'back-deltoids': { mev: 8, mav: [16, 22], mrv: 26 },
    biceps: { mev: 8, mav: [14, 20], mrv: 26 },
    triceps: { mev: 6, mav: [10, 14], mrv: 18 },
    calves: { mev: 8, mav: [12, 16], mrv: 20 },
    abs: { mev: 0, mav: [16, 20], mrv: 25 },
    trapezius: { mev: 0, mav: [12, 20], mrv: 26 },
    forearm: { mev: 0, mav: [4, 10], mrv: 14 },
    'lower-back': { mev: 0, mav: [4, 8], mrv: 12 },
    adductor: { mev: 0, mav: [4, 10], mrv: 14 },
    abductors: { mev: 0, mav: [4, 10], mrv: 14 },
    obliques: { mev: 0, mav: [4, 10], mrv: 16 },
    neck: { mev: 0, mav: [2, 8], mrv: 12 },
  };

  const muscleNamesSl = {
    chest: 'Prsne mišice', 'upper-back': 'Zgornji hrbet (lat)', 'lower-back': 'Spodnji hrbet', trapezius: 'Trapez',
    'front-deltoids': 'Sprednja rama', 'back-deltoids': 'Stranska/zadnja rama', biceps: 'Biceps', triceps: 'Triceps',
    forearm: 'Podlaket', abs: 'Trebušne', obliques: 'Poševne trebušne', quadriceps: 'Kvadriceps', hamstring: 'Zadnja loža',
    gluteal: 'Gluteus', adductor: 'Primikalke', abductors: 'Odmikalke', calves: 'Meča', neck: 'Vrat',
    'left-soleus': 'Meča', 'right-soleus': 'Meča', head: 'Glava', knees: 'Kolena',
  };

  function effort(rir) {
    if (rir === null || rir === undefined || rir === '' || isNaN(Number(rir))) return 0.85;
    const r = Number(rir);
    return r <= 0 ? 1.0 : r <= 1 ? 0.9 : r <= 2 ? 0.8 : 0.65;
  }

  function exIndex(db) {
    if (!db) return {};
    if (db._byId) return db._byId;
    const list = db.exercises || [];
    const idx = Object.fromEntries(list.map(e => [e.id, e]));
    try { Object.defineProperty(db, '_byId', { value: idx, enumerable: false }); } catch (e) { /* frozen */ }
    return idx;
  }

  function weightsOf(info) {
    if (!info) return {};
    if (info.wt && Object.keys(info.wt).length) return info.wt;
    const o = {};
    (info.pri || []).forEach(m => o[m] = 1);
    (info.sec || []).forEach(m => { if (!o[m]) o[m] = 0.5; });
    return o;
  }

  function tauOf(m) { return ((GROUP[m] || 60) * H) / Math.log(10); }

  function muscleRecovery(history, db, now) {
    now = now || Date.now();
    const idx = exIndex(db);
    const fat = {}, last = {};
    for (const w of history || []) {
      const base = w.start || new Date((w.date || '') + 'T12:00:00').getTime();
      if (!base || now - base > 10 * 24 * H || base > now) continue;
      const perSession = {}; // omejitev "junk volumna": največ 12 efektivnih serij na mišico na trening (openGym)
      for (const ex of w.exercises || []) {
        const wts = weightsOf(idx[ex.exId]);
        for (const s of ex.sets || []) {
          if (s.done === false || s.type === 'warmup') continue;
          const t = s.ts || w.end || base;
          if (t > now) continue;
          const e = effort(s.rir != null ? s.rir : (s.rpe != null ? 10 - s.rpe : null));
          for (const [m, wt] of Object.entries(wts)) {
            if (!wt) continue;
            if ((perSession[m] || 0) >= 12) continue;
            perSession[m] = (perSession[m] || 0) + wt;
            fat[m] = (fat[m] || 0) + wt * e * Math.exp(-(now - t) / tauOf(m));
            last[m] = Math.max(last[m] || 0, t);
          }
        }
      }
    }
    const out = {};
    for (const m of Object.keys(GROUP)) {
      if (!last[m] || now - last[m] > 7 * 24 * H) { out[m] = { pct: 100, lastTs: last[m] || null, fatigue: 0, status: 'rest' }; continue; }
      const f = fat[m] || 0;
      const pct = Math.round(100 * Math.exp(-f / CAP));
      out[m] = { pct, lastTs: last[m], fatigue: Math.round(f * 100) / 100, status: pct >= 85 ? 'fresh' : pct >= 50 ? 'loaded' : 'fatigued' };
    }
    return out;
  }

  const COLORS = { rest: '#2A313A', fresh: '#30D158', loaded: '#FF9F0A', fatigued: '#FF3D00' };
  function bodyMapColors(rec) {
    const o = {};
    for (const [m, r] of Object.entries(rec || {})) o[m] = COLORS[r.status] || COLORS.rest;
    if (o.calves) { o['left-soleus'] = o.calves; o['right-soleus'] = o.calves; }
    return o;
  }

  function volumeLandmarks(m) { return LANDMARKS[m] || { mev: 0, mav: [4, 10], mrv: 14 }; }

  function statusForWeeklySets(m, sets) {
    const L = volumeLandmarks(m);
    sets = Number(sets) || 0;
    if (sets < L.mev || (L.mev === 0 && sets === 0)) return { code: 'below_mev', label: 'Pod minimalnim učinkovitim volumnom' };
    if (sets <= L.mav[1]) return { code: 'productive', label: sets >= L.mav[0] ? 'Optimalno (MAV)' : 'Produktivno (MEV–MAV)' };
    if (sets <= L.mrv) return { code: 'high', label: 'Visoko – blizu MRV' };
    return { code: 'above_mrv', label: 'Nad MRV – tveganje za preobremenitev' };
  }

  function num(v) {
    return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  }

  function avg(xs) {
    const v = (xs || []).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  function stdDev(xs) {
    const v = (xs || []).filter((x) => x != null);
    if (v.length < 2) return null;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const variance = v.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (v.length - 1);
    return Math.sqrt(variance);
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  /**
   * Izračun dnevne regeneracije na podlagi 30-dnevne osnove HRV in RHR ter spanja.
   * Če je podatkov osnovne linije manj kot 7 dni (<7 dni), vrne rec: null in premaloPodatkov: true,
   * namesto fiktivne ali toge številke.
   */
  function calculateDailyRecovery(dnevi, options) {
    if (!Array.isArray(dnevi) || dnevi.length === 0) return null;
    const opts = options || {};
    const todayStr = opts.today || new Date().toLocaleDateString('sv-SE');

    const urejeni = [...dnevi].filter(d => d && d.datum).sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
    if (!urejeni.length) return null;

    // Zadnji dan z nočnimi meritvami (HRV ali spanje)
    const polni = urejeni.filter((d) => d.datum !== todayStr || num(d.spanjeMin) != null);
    const z = [...polni].reverse().find((d) => num(d.hrv) != null || num(d.spanjeMin) != null);
    if (!z) return null;

    // Osnovna linija zadnjih do 30 dni pred merjenim dnem
    const pred = urejeni.filter((d) => d.datum < z.datum).slice(-30);
    const hrvVals = pred.map((d) => num(d.hrv)).filter((x) => x != null);
    const rhrVals = pred.map((d) => num(d.rhr)).filter((x) => x != null);
    const dniOsnove = Math.min(hrvVals.length, rhrVals.length);

    // Zahteva: vsaj 7 dni podatkov za zanesljivo osnovo (<7 dni = premalo podatkov)
    const premaloPodatkov = dniOsnove < 7;

    const hrvOsn = hrvVals.length ? avg(hrvVals) : null;
    const rhrOsn = rhrVals.length ? avg(rhrVals) : null;
    const spOsn = avg(pred.map((d) => num(d.spanjeMin)));

    const hrv = num(z.hrv);
    const rhr = num(z.rhr);
    const sp = num(z.spanjeMin);

    const hrvSd = stdDev(hrvVals);
    const rhrSd = stdDev(rhrVals);
    const hrvLo = (hrvOsn != null && hrvSd != null) ? Math.round(hrvOsn - hrvSd) : null;
    const hrvHi = (hrvOsn != null && hrvSd != null) ? Math.round(hrvOsn + hrvSd) : null;
    const rhrLo = (rhrOsn != null && rhrSd != null) ? Math.round(rhrOsn - rhrSd) : null;
    const rhrHi = (rhrOsn != null && rhrSd != null) ? Math.round(rhrOsn + rhrSd) : null;

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

    // Spalni dolg zadnjih 7 dni
    const zadnjih7 = nocne.slice(-7);
    let spalniDolgMin = null;
    if (zadnjih7.length > 0) {
      spalniDolgMin = zadnjih7.reduce((sum, d) => sum + (spalniCiljMin - num(d.spanjeMin)), 0);
    }

    // Ocena regeneracije 0–100:
    // Če je premalo podatkov (<7 dni), rec je null (prikaže se "premalo podatkov")
    let rec = null;
    if (!premaloPodatkov) {
      const deli = [];
      if (hrv != null && hrvOsn) deli.push([0.5, clamp(50 + (hrv / hrvOsn - 1) * 150, 0, 100)]);
      if (rhr != null && rhrOsn) deli.push([0.25, clamp(50 - (rhr / rhrOsn - 1) * 300, 0, 100)]);
      if (sp != null) deli.push([0.25, clamp((sp / spalniCiljMin) * 100, 0, 100)]);
      if (deli.length) {
        const w = deli.reduce((a, [x]) => a + x, 0);
        rec = Math.round(deli.reduce((a, [x, v]) => a + x * v, 0) / w);
      }
    }

    const bud = num(z.budnoMin), lah = num(z.spanjeLahkoMin), glo = num(z.spanjeGlobokoMin), rem = num(z.spanjeRemMin);
    const vsota = [bud, lah, glo, rem].reduce((a, b) => a + (b || 0), 0);

    return {
      datum: z.datum,
      hrv, rhr, sp,
      hrvOsn, rhrOsn, spOsn,
      rec,
      premaloPodatkov,
      dniOsnove,
      recStatus: premaloPodatkov ? 'premalo_podatkov' : 'ok',
      recText: premaloPodatkov ? 'premalo podatkov' : (rec != null ? `${rec}%` : '–'),
      hrvSd, rhrSd, hrvLo, hrvHi, rhrLo, rhrHi,
      opozorila,
      spalniCiljMin, spalniDolgMin,
      hrvRel: !premaloPodatkov && hrv != null && hrvOsn ? Math.round((hrv / hrvOsn - 1) * 100) : null,
      faze: vsota > 0 ? { bud, lah, glo, rem, vsota } : null,
      spanjeOd: z.spanjeOd, spanjeDo: z.spanjeDo,
      koraki: num((urejeni.find((d) => d.datum === todayStr) || {}).koraki),
      azm: num((urejeni.find((d) => d.datum === todayStr) || {}).azm),
      korakiVceraj: num(z.koraki), azmVceraj: num(z.azm),
      vsiDnevi: urejeni,
    };
  }

  const api = { GROUP, CAP, LANDMARKS, COLORS, muscleNamesSl, effort, muscleRecovery, bodyMapColors, volumeLandmarks, statusForWeeklySets, calculateDailyRecovery, dailyRecovery: calculateDailyRecovery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RecoveryEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
