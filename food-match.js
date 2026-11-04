/**
 * Bine Zdravje — FoodMatch: lokalno iskanje po USDA bazi (food-db.json) + preračun hranil.
 * Deluje v brskalniku (window.FoodMatch) in v Node (module.exports) za teste.
 *
 * Tok: AI (ali uporabnik) da opis živila + grame -> search() najde USDA zapis ->
 * nutrientsFor(food, grams) vrne kcal, makre in mikre v enotah ATHLETE_MALE_DRI.
 */
(function (root) {
  'use strict';

  const STOP = new Set(['and', 'or', 'with', 'without', 'of', 'the', 'a', 'in', 'to', 'for', 'from', 'style', 'type', 'made', 'ns', 'as', 'all', 'includes', 'z', 's', 'in', 'na', 'iz', 'com', 'de', 'do', 'da', 'e']);
  // Besede, ki v USDA opisu pomenijo "manj tipičen" zapis -> rahla kazen, če jih poizvedba nima.
  const ODD = ['babyfood', 'infant', 'formula', 'dehydrated', 'freeze-dried', 'dry mix', 'powder', 'frozen', 'canned', 'school lunch', 'industrial', 'commercial', 'restaurant', 'imitation', 'low sodium', 'reduced', 'fast foods', 'raw', 'unprepared', 'separable fat', 'skin only', 'giblets', 'liver', 'mechanically', 'with salt', 'pickled', 'concentrate', 'syrup'];

  let DB = null;      // {keys, foods: [[name, cat, vals, portions]]}
  let INDEX = null;   // [{i, name, lname, tokens:Set}]
  let ALIASES = {};   // lokalno ime -> angleška poizvedba
  let IDF = {};

  function normalize(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function stem(t) {
    // zelo preprost angleški stemmer (množina)
    if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 4 && t.endsWith('oes')) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('es') && /(ch|sh|x|s)es$/.test(t)) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
  }

  function tokens(s) {
    return normalize(s).split(/[\s-]+/).filter(t => t && !STOP.has(t)).map(stem);
  }

  function load(db, aliases) {
    DB = db;
    ALIASES = {};
    for (const [k, v] of Object.entries(aliases || {})) ALIASES[normalize(k)] = v;
    INDEX = db.foods.map((f, i) => {
      const toks = tokens(f[0]);
      // Prvi segment (pred vejico) je glavno živilo -> poudarek
      const head = new Set(tokens(f[0].split(',')[0]));
      return { i, name: f[0], lname: f[0].toLowerCase(), tokens: new Set(toks), head, len: toks.length };
    });
    const df = {};
    for (const e of INDEX) for (const t of e.tokens) df[t] = (df[t] || 0) + 1;
    const N = INDEX.length;
    IDF = {};
    for (const [t, c] of Object.entries(df)) IDF[t] = Math.log(1 + N / c);
    return INDEX.length;
  }

  function isLoaded() { return !!INDEX; }

  /** Prevede lokalno (SLO/PT) ime v angleško USDA poizvedbo prek slovarja. */
  function translate(q) {
    const n = normalize(q);
    if (ALIASES[n]) return ALIASES[n];
    // najdaljše ujemanje fraze znotraj niza
    let best = null;
    for (const k of Object.keys(ALIASES)) {
      if (k.length >= 3 && (n === k || n.startsWith(k + ' ') || n.endsWith(' ' + k) || n.includes(' ' + k + ' '))) {
        if (!best || k.length > best.length) best = k;
      }
    }
    if (best) {
      const rest = n.replace(best, ' ').trim();
      return (ALIASES[best] + ' ' + rest).trim();
    }
    // prefiks (sklanjatve: piščančje, piščanca -> piščan...)
    const first = n.split(' ')[0];
    if (first.length >= 5) {
      const p = first.slice(0, Math.max(4, first.length - 2));
      const k = Object.keys(ALIASES).find(a => a.startsWith(p));
      if (k) return ALIASES[k] + ' ' + n.split(' ').slice(1).join(' ');
    }
    return q;
  }

  function scoreEntry(e, qt, qnorm) {
    let s = 0, matched = 0, headHit = 0;
    for (const t of qt) {
      const w = IDF[t] || 1;
      if (e.tokens.has(t)) { s += w; matched++; if (e.head.has(t)) headHit++; }
      else {
        // delno ujemanje (prefiks >= 4)
        if (t.length >= 4) {
          for (const et of e.tokens) { if (et.startsWith(t) || t.startsWith(et) && et.length >= 4) { s += w * 0.5; matched += 0.5; break; } }
        }
      }
    }
    if (!matched) return 0;
    const cover = matched / qt.length;
    s *= (0.4 + 0.6 * cover);
    if (headHit) s *= 1.35;
    // glavne besede zapisa, ki jih poizvedba nima (npr. "sweet" pri "potato") -> kazen
    let foreign = 0;
    for (const h of e.head) if (!qt.includes(h)) foreign++;
    if (foreign) s *= Math.pow(0.72, Math.min(foreign, 3));
    e._cover = cover;
    // krajši opisi so splošnejši -> rahla prednost
    s *= 1 / (1 + Math.max(0, e.len - qt.length) * 0.035);
    for (const o of ODD) if (e.lname.includes(o) && !qnorm.includes(o)) s *= 0.8;
    return s;
  }

  /** Vrne top-N kandidatov: [{index, name, score}] */
  function search(query, limit = 8) {
    if (!INDEX) return [];
    const translated = translate(query);
    const qnorm = normalize(translated);
    const qt = [...new Set(tokens(translated))];
    if (!qt.length) return [];
    const res = [];
    for (const e of INDEX) {
      const sc = scoreEntry(e, qt, qnorm);
      if (sc > 0) res.push({ index: e.i, name: e.name, score: sc, cover: e._cover });
    }
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, limit).map(r => ({ ...r, score: Math.round(r.score * 100) / 100, cover: Math.round(r.cover * 100) / 100, query: translated }));
  }

  function per100(index) {
    const f = DB.foods[index];
    const o = {};
    DB.keys.forEach((k, j) => { if (f[2][j] !== null && f[2][j] !== undefined) o[k] = f[2][j]; });
    return o;
  }

  function portions(index) { return (DB.foods[index][3] || []).map(([label, g]) => ({ label, grams: g })); }

  const MACRO_KEYS = new Set(['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar']);

  /** Hranila za dano količino. Vrne {calories, protein, carbs, fat, fiber, sugar, micros:{...}} */
  function nutrientsFor(index, grams) {
    const p = per100(index);
    const f = (Number(grams) || 0) / 100;
    const r1 = v => Math.round(v * 10) / 10;
    const out = { calories: Math.round((p.calories || 0) * f), protein: r1((p.protein || 0) * f), carbs: r1((p.carbs || 0) * f), fat: r1((p.fat || 0) * f), fiber: r1((p.fiber || 0) * f), sugar: r1((p.sugar || 0) * f), micros: {} };
    for (const [k, v] of Object.entries(p)) {
      if (MACRO_KEYS.has(k)) continue;
      const val = v * f;
      out.micros[k] = Math.abs(val) >= 10 ? Math.round(val) : Math.round(val * 1000) / 1000;
    }
    out.micros.protein = out.protein;
    return out;
  }

  /** Iz ocene AI (na 100 g) naredi "virtualno" živilo, ko v bazi ni dobrega zadetka. */
  function nutrientsFromEstimate(est, grams) {
    const f = (Number(grams) || 0) / 100;
    const r1 = v => Math.round((Number(v) || 0) * f * 10) / 10;
    return { calories: Math.round((Number(est.kcal) || 0) * f), protein: r1(est.protein), carbs: r1(est.carbs), fat: r1(est.fat), fiber: r1(est.fiber), sugar: 0, micros: { protein: r1(est.protein) } };
  }

  /**
   * Izbere najboljši zapis za postavko AI. Če ima AI oceno kcal/100 g, med top kandidati
   * prednost tistemu, ki je energijsko blizu (prepreči npr. "rice, raw" namesto kuhanega).
   */
  function bestMatch(item) {
    const queries = [item.usda_query, item.name_en, item.name].filter(Boolean);
    let cands = [];
    for (const q of queries) {
      const c = search(q, 10).filter(x => x.cover >= 0.6);
      if (c.length) { cands = c; break; }
    }
    if (!cands.length) return null;
    const est = item.per100g && Number(item.per100g.kcal);
    if (est > 0) {
      const top = cands[0].score;
      let best = null, bestVal = -Infinity;
      for (const c of cands) {
        if (c.score < top * 0.6) continue;
        const kc = per100(c.index).calories || 0;
        const ratio = kc > 0 ? Math.min(kc, est) / Math.max(kc, est) : 0;
        const val = c.score / top + ratio * 0.9;
        if (val > bestVal) { bestVal = val; best = { ...c, kcalRatio: Math.round(ratio * 100) / 100 }; }
      }
      return { best, candidates: cands };
    }
    return { best: cands[0], candidates: cands };
  }

  const api = { load, isLoaded, search, translate, per100, portions, nutrientsFor, nutrientsFromEstimate, bestMatch, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FoodMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
