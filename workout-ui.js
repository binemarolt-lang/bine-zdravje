/**
 * Bine Zdravje — WorkoutUI (Hevy-class vmesnik za beleženje treninga)
 *
 * Mobilno usmerjen, vanilla JS, brez zunanjih odvisnosti, UMD modul.
 * Samodejno se vpne v zavihek #view-trening v PWA.
 *
 * Podatkovni model (POGODBA.md):
 * - localStorage 'bine_zdravje_workouts_v1' = Array<Workout>
 * - localStorage 'bine_zdravje_active_workout_v1' = Workout (aktivni osnutek)
 * - localStorage 'bine_zdravje_train_settings_v1' = Nastavitve
 */
(function (root) {
  'use strict';

  // ========== KLJUČI IN KONSTANTE ==========
  const LS_WORKOUTS = 'bine_zdravje_workouts_v1';
  const LS_ACTIVE = 'bine_zdravje_active_workout_v1';
  const LS_SETTINGS = 'bine_zdravje_train_settings_v1';
  const LS_TOKEN = 'bine_zdravje_fv_token';
  const LS_ENDPOINT = 'bine_zdravje_fv_endpoint';
  const FALLBACK_ENDPOINTS = ['http://100.101.68.31:8091'];

  const DEFAULT_SETTINGS = {
    bodyweight: 80,
    unit: 'kg',
    barKg: 20,
    plates: [25, 20, 15, 10, 5, 2.5, 1.25],
    restDefaultSec: 120,
    oneRmFormula: 'weighted'
  };

  const MUSCLE_NAMES_SL = {
    'chest': 'Prsa',
    'upper-back': 'Zgornji hrbet',
    'lower-back': 'Spodnji hrbet',
    'quadriceps': 'Kvadrici',
    'hamstring': 'Zadnja loža',
    'gluteal': 'Gluteus',
    'front-deltoids': 'Sprednje rame',
    'back-deltoids': 'Zadnje rame',
    'biceps': 'Biceps',
    'triceps': 'Triceps',
    'abs': 'Trebuh / Jedro',
    'obliques': 'Stranski trebuh',
    'calves': 'Meča',
    'forearm': 'Podlahti',
    'trapezius': 'Trapez',
    'adductor': 'Primikalke (aduktorji)',
    'abductors': 'Odmikalke (abduktorji)',
    'neck': 'Vrat'
  };

  // Vgrajene predloge (če app/workout-templates.json še ni na voljo)
  const DEFAULT_TEMPLATES = [
    {
      id: 'tpl_push',
      name: 'Push (Potisk zgoraj)',
      exercises: [
        { exId: '0025', name: 'Potisk s prsi z drogom (Bench press)', targetSets: 4 },
        { exId: '0047', name: 'Potisk nad glavo z drogom (OHP)', targetSets: 3 },
        { exId: '0314', name: 'Poševni potisk z ročkami', targetSets: 3 },
        { exId: '0334', name: 'Stranski odmik z ročkami', targetSets: 4 },
        { exId: '0241', name: 'Iztegovanje komolcev na škripcu', targetSets: 3 }
      ]
    },
    {
      id: 'tpl_pull',
      name: 'Pull (Vlek zgoraj)',
      exercises: [
        { exId: '0652', name: 'Zgibi (Pull-up)', targetSets: 4 },
        { exId: '0027', name: 'Veslanje v predklonu z drogom', targetSets: 4 },
        { exId: '0150', name: 'Poteg na prsi na škripcu (Lat pulldown)', targetSets: 3 },
        { exId: '0294', name: 'Pregib komolcev z ročkami (Biceps)', targetSets: 3 },
        { exId: '0188', name: 'Obrazni poteg na škripcu (Face pull)', targetSets: 3 }
      ]
    },
    {
      id: 'tpl_legs',
      name: 'Legs (Noge & Spodnji del)',
      exercises: [
        { exId: '0043', name: 'Počep z drogom (Squat)', targetSets: 4 },
        { exId: '0038', name: 'Romunski mrtvi dvig (RDL)', targetSets: 4 },
        { exId: '0741', name: 'Nožni potisk (Leg press)', targetSets: 3 },
        { exId: '0585', name: 'Upogib kolen na napravi (Leg curl)', targetSets: 3 },
        { exId: '0812', name: 'Dvig na prste stoje (Calf raise)', targetSets: 4 }
      ]
    },
    {
      id: 'tpl_upper',
      name: 'Upper Body (Zgornji del celotno)',
      exercises: [
        { exId: '0025', name: 'Potisk s prsi z drogom', targetSets: 4 },
        { exId: '0027', name: 'Veslanje z drogom', targetSets: 4 },
        { exId: '0047', name: 'Potisk nad glavo z drogom', targetSets: 3 },
        { exId: '0652', name: 'Zgibi', targetSets: 3 },
        { exId: '0294', name: 'Pregib z ročkami', targetSets: 3 }
      ]
    },
    {
      id: 'tpl_lower',
      name: 'Lower Body (Spodnji del celotno)',
      exercises: [
        { exId: '0043', name: 'Počep z drogom', targetSets: 4 },
        { exId: '0032', name: 'Klasični mrtvi dvig (Deadlift)', targetSets: 3 },
        { exId: '0741', name: 'Nožni potisk', targetSets: 3 },
        { exId: '0585', name: 'Upogib kolen', targetSets: 3 },
        { exId: '0001', name: 'Trebuh na napravi ali deska', targetSets: 3 }
      ]
    }
  ];

  // Vgrajeni katalog pogostih vaj za hiter fallback
  const BUILTIN_EXERCISES = [
    { id: '0025', name: 'barbell bench press', sl: 'Potisk s prsi z drogom', bp: 'chest', pri: ['chest'], sec: ['triceps', 'front-deltoids'], pop: 100 },
    { id: '0043', name: 'barbell squat', sl: 'Počep z drogom', bp: 'upper legs', pri: ['quadriceps', 'gluteal'], sec: ['lower-back'], pop: 100 },
    { id: '0032', name: 'barbell deadlift', sl: 'Mrtvi dvig z drogom', bp: 'back', pri: ['hamstring', 'gluteal', 'lower-back'], sec: ['upper-back', 'trapezius', 'forearm'], pop: 98 },
    { id: '0047', name: 'overhead press', sl: 'Potisk nad glavo z drogom (OHP)', bp: 'shoulders', pri: ['front-deltoids'], sec: ['triceps', 'trapezius'], pop: 90 },
    { id: '0652', name: 'pull-up', sl: 'Zgibi (Pull-up)', bp: 'back', pri: ['upper-back'], sec: ['biceps', 'forearm'], pop: 92 },
    { id: '0027', name: 'barbell row', sl: 'Veslanje v predklonu z drogom', bp: 'back', pri: ['upper-back'], sec: ['biceps', 'lower-back'], pop: 88 },
    { id: '0038', name: 'romanian deadlift', sl: 'Romunski mrtvi dvig (RDL)', bp: 'upper legs', pri: ['hamstring', 'gluteal'], sec: ['lower-back'], pop: 88 },
    { id: '0314', name: 'incline dumbbell press', sl: 'Poševni potisk z ročkami', bp: 'chest', pri: ['chest'], sec: ['front-deltoids', 'triceps'], pop: 85 },
    { id: '0150', name: 'lat pulldown', sl: 'Poteg na prsi na škripcu', bp: 'back', pri: ['upper-back'], sec: ['biceps'], pop: 85 },
    { id: '0294', name: 'dumbbell bicep curl', sl: 'Pregib komolcev z ročkami', bp: 'upper arms', pri: ['biceps'], sec: ['forearm'], pop: 82 },
    { id: '0241', name: 'triceps pushdown', sl: 'Iztegovanje komolcev na škripcu', bp: 'upper arms', pri: ['triceps'], sec: [], pop: 82 },
    { id: '0334', name: 'dumbbell lateral raise', sl: 'Stranski odmik z ročkami', bp: 'shoulders', pri: ['back-deltoids', 'front-deltoids'], sec: ['trapezius'], pop: 84 },
    { id: '0741', name: 'leg press', sl: 'Nožni potisk (Leg press)', bp: 'upper legs', pri: ['quadriceps', 'gluteal'], sec: [], pop: 80 },
    { id: '0585', name: 'leg curl', sl: 'Upogib kolen na napravi', bp: 'upper legs', pri: ['hamstring'], sec: ['calves'], pop: 78 },
    { id: '0586', name: 'leg extension', sl: 'Izteg kolen na napravi', bp: 'upper legs', pri: ['quadriceps'], sec: [], pop: 78 },
    { id: '0812', name: 'standing calf raise', sl: 'Dvig na prste stoje (Meča)', bp: 'lower legs', pri: ['calves'], sec: [], pop: 75 },
    { id: '0188', name: 'face pull', sl: 'Obrazni poteg na škripcu', bp: 'shoulders', pri: ['back-deltoids', 'trapezius'], sec: [], pop: 80 },
    { id: '0211', name: 'dips', sl: 'Skleki na bradlji (Dips)', bp: 'chest', pri: ['chest', 'triceps'], sec: ['front-deltoids'], pop: 80 },
    { id: '0599', name: 'push-up', sl: 'Sklece', bp: 'chest', pri: ['chest'], sec: ['triceps', 'front-deltoids', 'abs'], pop: 75 },
    { id: '0101', name: 'hanging leg raise', sl: 'Dvig nog v visu (Trebuh)', bp: 'waist', pri: ['abs'], sec: ['forearm'], pop: 70 }
  ];

  // In-memory shramba za okolja brez localStorage (Node testi)
  const memStore = {};

  function getStorage(key, fallback = null) {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : fallback;
      }
    } catch (e) {
      console.warn('[WorkoutUI] Storage read error:', e);
    }
    return memStore[key] !== undefined ? memStore[key] : fallback;
  }

  function setStorage(key, value) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (e) {
      console.warn('[WorkoutUI] Storage write error:', e);
    }
    memStore[key] = JSON.parse(JSON.stringify(value));
  }

  function removeStorage(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch (e) {}
    delete memStore[key];
  }

  // Toast / Obvestilo
  function toast(msg) {
    if (typeof root.showMascotNotification === 'function') {
      root.showMascotNotification(msg);
    } else if (typeof window !== 'undefined' && window.showMascotNotification) {
      window.showMascotNotification(msg);
    } else {
      console.log('[WorkoutUI]', msg);
    }
  }

  const serijSklon = n => { const m = n % 100; return m === 1 ? 'serija' : m === 2 ? 'seriji' : (m === 3 || m === 4) ? 'serije' : 'serij'; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ========== ČISTE DOMENSKE FUNKCIJE (PURE HELPERS) ==========

  function getEngine() {
    if (typeof window !== 'undefined' && window.WorkoutEngine) return window.WorkoutEngine;
    if (typeof require !== 'undefined') {
      try { return require('./workout-engine.js'); } catch (e) {}
    }
    return null;
  }

  function getRecoveryEngine() {
    if (typeof window !== 'undefined' && window.RecoveryEngine) return window.RecoveryEngine;
    if (typeof require !== 'undefined') {
      try { return require('./recovery-engine.js'); } catch (e) {}
    }
    return null;
  }

  /**
   * Formatira sekunde v HH:MM:SS ali MM:SS ali človeku prijazen opis
   */
  function formatDuration(seconds, opts = {}) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if (opts.human) {
      if (h > 0) return `${h} h ${m} min`;
      if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
      return `${s} s`;
    }

    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    if (h > 0) {
      return `${h}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }

  /**
   * Izpolni prazna polja v seriji iz prejšnjih vrednosti in jo označi kot opravljeno
   */
  function fillFromPrevious(set, prevSet) {
    const s = Object.assign({ type: 'normal', done: false, w: null, reps: null, rir: null }, set || {});
    if (prevSet) {
      if (s.w === null || s.w === undefined || s.w === '') {
        if (prevSet.w !== null && prevSet.w !== undefined && prevSet.w !== '') {
          s.w = Number(prevSet.w);
        }
      }
      if (s.reps === null || s.reps === undefined || s.reps === '') {
        if (prevSet.reps !== null && prevSet.reps !== undefined && prevSet.reps !== '') {
          s.reps = Number(prevSet.reps);
        }
      }
      if (s.rir === null || s.rir === undefined || s.rir === '') {
        if (prevSet.rir !== null && prevSet.rir !== undefined && prevSet.rir !== '') {
          s.rir = Number(prevSet.rir);
        }
      }
    }
    s.done = true;
    s.ts = Date.now();
    return s;
  }

  /**
   * Združi razčlenjene vaje (iz AI ali predlog) v trenutni trening
   */
  function mergeParsed(currentWorkout, parsed) {
    const workout = Object.assign({}, currentWorkout);
    if (!workout.exercises) workout.exercises = [];
    const newExs = Array.isArray(parsed) ? parsed : (parsed && parsed.exercises ? parsed.exercises : []);

    for (const ex of newExs) {
      if (!ex || !ex.name) continue;
      const targetName = String(ex.name).trim().toLowerCase();
      const existing = workout.exercises.find(e => (
        (ex.exId && e.exId === ex.exId) ||
        (e.name && e.name.trim().toLowerCase() === targetName)
      ));

      const rawSets = Array.isArray(ex.sets) && ex.sets.length > 0 ? ex.sets : [{ w: null, reps: null, type: 'normal', done: false }];
      const normalizedSets = rawSets.map(s => ({
        w: s.w !== undefined && s.w !== null && s.w !== '' ? Number(s.w) : null,
        reps: s.reps !== undefined && s.reps !== null && s.reps !== '' ? Number(s.reps) : null,
        rir: s.rir !== undefined && s.rir !== null && s.rir !== '' ? Number(s.rir) : null,
        rpe: s.rpe !== undefined && s.rpe !== null && s.rpe !== '' ? Number(s.rpe) : null,
        type: s.type || 'normal',
        done: !!s.done,
        ts: s.ts || undefined
      }));

      if (existing) {
        existing.sets.push(...normalizedSets);
        if (ex.note && !existing.note) existing.note = ex.note;
      } else {
        workout.exercises.push({
          exId: ex.exId || ('custom:' + targetName.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')),
          name: ex.name,
          sets: normalizedSets,
          note: ex.note || '',
          supersetId: ex.supersetId || null,
          restSec: ex.restSec || undefined
        });
      }
    }
    return workout;
  }

  /**
   * Izračuna kolute na stran droga
   */
  function calculatePlates(targetKg, barKg = 20, platesList = null) {
    const eng = getEngine();
    if (eng && typeof eng.plates === 'function') {
      try {
        return eng.plates(targetKg, { barKg, plates: platesList });
      } catch (e) {}
    }
    const bar = Number(barKg) || 20;
    const target = Number(targetKg) || 0;
    const available = (platesList || [25, 20, 15, 10, 5, 2.5, 1.25]).slice().sort((a, b) => b - a);

    if (target < bar) {
      return { perSide: [], achieved: bar };
    }
    let remPerSide = (target - bar) / 2;
    const perSide = [];
    for (const p of available) {
      while (remPerSide >= p - 1e-4) {
        perSide.push(p);
        remPerSide -= p;
      }
    }
    const achieved = bar + 2 * perSide.reduce((sum, p) => sum + p, 0);
    return { perSide, achieved };
  }

  /**
   * Ustvari ogrevalne serije za podano delovno težo
   */
  function generateWarmups(workKg, settingsOrBar = 20) {
    const eng = getEngine();
    if (eng && typeof eng.warmups === 'function') {
      try {
        return eng.warmups(workKg, settingsOrBar);
      } catch (e) {}
    }
    const bar = typeof settingsOrBar === 'number' ? settingsOrBar : ((settingsOrBar && settingsOrBar.barKg) || 20);
    const target = Number(workKg) || 0;
    if (target <= bar) return [];

    const sets = [];
    sets.push({ w: bar, reps: 10, type: 'warmup', done: false });
    const p50 = Math.round((bar + (target - bar) * 0.4) / 2.5) * 2.5;
    const p70 = Math.round((bar + (target - bar) * 0.65) / 2.5) * 2.5;
    const p85 = Math.round((bar + (target - bar) * 0.85) / 2.5) * 2.5;

    if (p50 > bar && p50 < target) sets.push({ w: p50, reps: 6, type: 'warmup', done: false });
    if (p70 > p50 && p70 < target) sets.push({ w: p70, reps: 4, type: 'warmup', done: false });
    if (p85 > p70 && p85 < target) sets.push({ w: p85, reps: 2, type: 'warmup', done: false });

    return sets;
  }

  /**
   * Izračuna ocenjeni 1RM (e1RM)
   */
  function estimate1RM(w, reps, rir = 0, formula = 'weighted') {
    const eng = getEngine();
    if (eng && typeof eng.e1rm === 'function') {
      try {
        return eng.e1rm(w, reps, rir, formula);
      } catch (e) {}
    }
    const weight = Number(w) || 0;
    const repCount = Number(reps) || 0;
    const rirVal = Number(rir) || 0;
    if (weight <= 0 || repCount <= 0 || repCount > 15) return null;

    const effReps = repCount + rirVal;
    if (effReps === 1) return weight;

    const epley = weight * (1 + effReps / 30);
    const brzycki = weight * (36 / (37 - effReps));

    if (formula === 'epley') return Math.round(epley * 10) / 10;
    if (formula === 'brzycki') return Math.round(brzycki * 10) / 10;
    return Math.round(((epley + brzycki) / 2) * 10) / 10;
  }

  /**
   * Izračuna skupni volumen opravljenih serij (brez ogrevalnih)
   */
  function calculateVolume(workoutOrExercises) {
    const exs = Array.isArray(workoutOrExercises) ? workoutOrExercises : ((workoutOrExercises && workoutOrExercises.exercises) || []);
    let vol = 0;
    for (const ex of exs) {
      for (const s of (ex.sets || [])) {
        if (s.done && s.type !== 'warmup' && Number(s.w) > 0 && Number(s.reps) > 0) {
          vol += Number(s.w) * Number(s.reps);
        }
      }
    }
    return Math.round(vol);
  }

  /**
   * Vrne serije zadnjega treninga za dano vajo (za stolpec PREJŠNJIČ)
   */
  function previousSets(exId, history = []) {
    const eng = getEngine();
    if (eng && typeof eng.previousSets === 'function') {
      try {
        return eng.previousSets(exId, history);
      } catch (e) {}
    }
    if (!history || !history.length) return [];
    for (const w of history) {
      const match = (w.exercises || []).find(e => e.exId === exId || (e.name && e.name.toLowerCase() === String(exId).toLowerCase()));
      if (match && match.sets && match.sets.length) {
        return match.sets;
      }
    }
    return [];
  }

  /**
   * Zazna osebne rekorde (PR-je) glede na zgodovino
   */
  function detectPRs(workout, history = [], db = null) {
    const eng = getEngine();
    if (eng && typeof eng.detectPRs === 'function') {
      try {
        return eng.detectPRs(workout, history, db);
      } catch (e) {}
    }
    const prs = [];
    const prevWorkouts = (history || []).filter(w => w.id !== workout.id && (w.start || 0) <= (workout.start || Date.now()));
    if (!prevWorkouts.length) return [];

    for (const ex of (workout.exercises || [])) {
      let prevMaxW = 0;
      let prevMaxE1 = 0;
      const prevRepsAtW = {};

      for (const pw of prevWorkouts) {
        const pe = (pw.exercises || []).find(e => e.exId === ex.exId || (e.name && e.name.toLowerCase() === ex.name.toLowerCase()));
        if (!pe) continue;
        for (const s of (pe.sets || [])) {
          if (!s.done || s.type === 'warmup') continue;
          const w = Number(s.w) || 0;
          const r = Number(s.reps) || 0;
          if (w > prevMaxW) prevMaxW = w;
          const e1 = estimate1RM(w, r, s.rir || 0);
          if (e1 && e1 > prevMaxE1) prevMaxE1 = e1;
          if (w > 0) prevRepsAtW[w] = Math.max(prevRepsAtW[w] || 0, r);
        }
      }

      for (const s of (ex.sets || [])) {
        if (!s.done || s.type === 'warmup') continue;
        const w = Number(s.w) || 0;
        const r = Number(s.reps) || 0;
        if (prevMaxW > 0 && w > prevMaxW) {
          prs.push({ exId: ex.exId, name: ex.name, kind: 'weight', value: w, prev: prevMaxW });
          prevMaxW = w;
        }
        const e1 = estimate1RM(w, r, s.rir || 0);
        if (e1 && prevMaxE1 > 0 && e1 > prevMaxE1) {
          prs.push({ exId: ex.exId, name: ex.name, kind: 'e1rm', value: e1, prev: prevMaxE1 });
          prevMaxE1 = e1;
        }
        if (w > 0 && prevRepsAtW[w] !== undefined && r > prevRepsAtW[w]) {
          prs.push({ exId: ex.exId, name: ex.name, kind: 'reps@weight', weight: w, value: r, prev: prevRepsAtW[w] });
          prevRepsAtW[w] = r;
        }
      }
    }
    return prs;
  }

  /**
   * Pretvori trening v format Markdown za Obsidian
   */
  function toObsidianMarkdown(workout, db = null) {
    if (typeof window !== 'undefined' && window.WorkoutIO && typeof window.WorkoutIO.toObsidianMarkdown === 'function') {
      try {
        return window.WorkoutIO.toObsidianMarkdown(workout, db);
      } catch (e) {}
    }
    const durMin = workout.start && workout.end ? Math.round((workout.end - workout.start) / 60000) : 0;
    const vol = calculateVolume(workout);
    let md = `---\ntags:\n  - trening\n  - fitness\ndate: ${workout.date}\ntrajanje_min: ${durMin}\nvolumen_kg: ${vol}\n---\n\n`;
    md += `# Trening: ${workout.name} (${workout.date})\n\n`;
    md += `- **Čas:** ${durMin} min\n- **Skupni volumen:** ${vol.toLocaleString('sl-SI')} kg\n`;
    if (workout.notes) md += `- **Opombe:** ${workout.notes}\n`;
    md += `\n## Vaje\n\n`;

    for (const ex of (workout.exercises || [])) {
      md += `### ${ex.name}\n`;
      if (ex.note) md += `*Opomba: ${ex.note}*\n`;
      const sets = (ex.sets || []).map((s, idx) => {
        const typeTag = s.type === 'warmup' ? ' (Ogrevanje)' : s.type === 'drop' ? ' (Drop set)' : s.type === 'failure' ? ' (Do odpovedi)' : '';
        const rirTag = s.rir != null ? ` [RIR ${s.rir}]` : '';
        const wStr = s.w != null ? `${s.w} kg` : 'lastna teža';
        return `  ${idx + 1}. ${wStr} × ${s.reps || 0}${rirTag}${typeTag}`;
      }).join('\n');
      md += sets ? sets + '\n\n' : '  (brez serij)\n\n';
    }
    return md;
  }

  /**
   * Zasilni lokalni razčlenjevalnik prostega besedila (če WorkoutParser ali LLM nista na voljo)
   */
  function fallbackParseText(text) {
    if (typeof window !== 'undefined' && window.WorkoutParser && typeof window.WorkoutParser.parse === 'function') {
      try {
        return window.WorkoutParser.parse(text, window.ExerciseMatch);
      } catch (e) {}
    }
    const lines = String(text || '').split(/\r?\n|;/).map(l => l.trim()).filter(Boolean);
    const exercises = [];
    const exerciseRegex = /^([a-zA-ZčžšČŽŠ\s]+?)(?:[:\-]|\s+)(\d+.*)$/i;

    for (const line of lines) {
      const match = line.match(exerciseRegex);
      if (!match) continue;
      const rawName = match[1].trim();
      const rest = match[2].trim();

      // Poskusi prepoznati 3x8 80kg ali 80kg 8,8,8
      const sets = [];
      const m1 = rest.match(/(\d+)\s*[xX*]\s*(\d+)(?:\s*@?\s*(\d+(?:\.\d+)?)\s*(?:kg)?)?/i);
      const m2 = rest.match(/(\d+(?:\.\d+)?)\s*kg\s+([\d\s,]+)/i);

      if (m1) {
        const count = parseInt(m1[1], 10);
        const reps = parseInt(m1[2], 10);
        const w = m1[3] ? parseFloat(m1[3]) : null;
        for (let i = 0; i < count; i++) sets.push({ w, reps, type: 'normal', done: false });
      } else if (m2) {
        const w = parseFloat(m2[1]);
        const repsList = m2[2].split(/[\s,]+/).map(r => parseInt(r, 10)).filter(r => !isNaN(r));
        for (const reps of repsList) sets.push({ w, reps, type: 'normal', done: false });
      } else {
        sets.push({ w: null, reps: null, type: 'normal', done: false });
      }

      exercises.push({
        name: rawName,
        exId: 'custom:' + rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sets
      });
    }
    return { exercises };
  }

  // ========== STANJE UI IN UPRAVLJANJE ==========
  let activeWorkout = null;
  let activeTimerInterval = null;
  let restTimerState = {
    targetEnd: 0,
    totalSec: 0,
    interval: null,
    exerciseName: ''
  };
  let speechRec = null;
  let isListening = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecordingAudio = false;
  let cachedDb = null;
  let lastPickerCallback = null;
  let tempPhotoDataUrl = null;

  function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, getStorage(LS_SETTINGS, {}));
  }

  function saveSettings(s) {
    setStorage(LS_SETTINGS, s);
  }

  function getWorkouts() {
    return getStorage(LS_WORKOUTS, []);
  }

  function saveWorkouts(list) {
    setStorage(LS_WORKOUTS, list);
  }

  function loadActiveDraft() {
    return getStorage(LS_ACTIVE, null);
  }

  function saveActiveDraft(w) {
    if (!w) {
      removeStorage(LS_ACTIVE);
    } else {
      setStorage(LS_ACTIVE, w);
    }
  }

  // ========== ZVOČNI IN VIBRACIJSKI SIGNALI ==========
  function playBeepSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1046, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('[WorkoutUI] Audio error:', e);
    }
  }

  function triggerVibration() {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 300]);
      }
    } catch (e) {}
  }

  function triggerNotification(title, body) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: './assets/anime/thumbsup.gif'
        });
      }
    } catch (e) {}
  }

  // ========== POČITEK (REST TIMER) ==========
  function startRestTimer(seconds, exerciseName = '') {
    const s = Number(seconds) > 0 ? Number(seconds) : getSettings().restDefaultSec;
    restTimerState.totalSec = s;
    restTimerState.targetEnd = Date.now() + s * 1000;
    restTimerState.exerciseName = exerciseName;

    if (restTimerState.interval) clearInterval(restTimerState.interval);
    restTimerState.interval = setInterval(tickRestTimer, 500);
    renderRestPill();

    // Zahtevaj dovoljenje za notifikacije ob prvi uporabi
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function adjustRestTimer(deltaSec) {
    if (!restTimerState.targetEnd) return;
    restTimerState.targetEnd += deltaSec * 1000;
    tickRestTimer();
  }

  function skipRestTimer() {
    if (restTimerState.interval) clearInterval(restTimerState.interval);
    restTimerState.targetEnd = 0;
    restTimerState.interval = null;
    hideRestPill();
  }

  function tickRestTimer() {
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((restTimerState.targetEnd - now) / 1000));
    updateRestPillText(remaining);

    if (remaining <= 0) {
      clearInterval(restTimerState.interval);
      restTimerState.interval = null;
      playBeepSound();
      triggerVibration();
      triggerNotification('⏱️ Počitek je končan!', 'Čas za naslednjo serijo! 💪');
      toast('⏱️ Počitek je končan! Čas za naslednjo serijo! 💪');
      setTimeout(hideRestPill, 4000);
    }
  }

  function renderRestPill() {
    if (typeof document === 'undefined') return;
    let pill = document.getElementById('wuiRestPill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'wuiRestPill';
      pill.className = 'wui-rest-pill';
      pill.innerHTML = `
        <div class="wui-rest-info" onclick="WorkoutUI.openActiveModal()">
          <span class="wui-rest-icon">⏱️</span>
          <span id="wuiRestTimerText">00:00</span>
        </div>
        <div class="wui-rest-controls">
          <button type="button" class="wui-rest-btn" onclick="WorkoutUI.adjustRest(-15)">-15</button>
          <button type="button" class="wui-rest-btn" onclick="WorkoutUI.adjustRest(+15)">+15</button>
          <button type="button" class="wui-rest-btn wui-rest-skip" onclick="WorkoutUI.skipRest()">✕</button>
        </div>
      `;
      document.body.appendChild(pill);
    }
    pill.classList.add('visible');
    tickRestTimer();
  }

  function updateRestPillText(rem) {
    if (typeof document === 'undefined') return;
    const textEl = document.getElementById('wuiRestTimerText');
    if (textEl) textEl.textContent = formatDuration(rem);
  }

  function hideRestPill() {
    if (typeof document === 'undefined') return;
    const pill = document.getElementById('wuiRestPill');
    if (pill) pill.classList.remove('visible');
  }

  // ========== PREPOZNAVA IN AI VNOS ==========
  async function endpointCandidates() {
    const list = [];
    const manual = localStorage.getItem(LS_ENDPOINT);
    if (manual) list.push(manual);
    try {
      const r = await fetch('./food-vision-endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j.url) list.push(j.url);
      }
    } catch (e) {}
    for (const f of FALLBACK_ENDPOINTS) {
      if (!(location.protocol === 'https:' && f.startsWith('http:'))) list.push(f);
    }
    return [...new Set(list.map(u => u.replace(/\/$/, '')))];
  }

  async function parseWorkoutWithAi({ text, image, audio }) {
    const token = localStorage.getItem(LS_TOKEN) || '';
    const eps = await endpointCandidates();
    let lastErr = null;

    for (const ep of eps) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 60000);
        const r = await fetch(ep + '/api/workout-parse', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Zdravje-Token': token
          },
          body: JSON.stringify({ text, image, audio })
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
        lastErr = e.name === 'AbortError' ? new Error('Strežnik se ni odzval v 60 s.') : e;
      }
    }

    // Če omrežje ne uspe, uporabi lokalni offline parser
    if (text) {
      console.warn('[WorkoutUI] Strežnik nedosegljiv, uporabljam lokalni parser:', lastErr);
      return fallbackParseText(text);
    }
    throw lastErr || new Error('Strežnik za AI prepoznavo ni dosegljiv.');
  }

  // ========== CSS SLOGI ==========
  function injectStyles() {
    if (document.getElementById('wuiStyles')) return;
    const style = document.createElement('style');
    style.id = 'wuiStyles';
    style.textContent = `
      /* Glavni kontejner v zavihku Trening */
      .wui-container { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }

      /* Akcijske kartice */
      .wui-card-highlight { background: linear-gradient(135deg, rgba(48,209,88,0.12) 0%, rgba(0,176,255,0.08) 100%); border: 1px solid var(--rec-green); }
      .wui-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
      .wui-btn-tile { background: var(--surface-2); border: 1px solid var(--edge-1); border-radius: 12px; padding: 12px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; text-align: center; min-height: 74px; transition: background 0.15s, border-color 0.15s; }
      .wui-btn-tile:hover, .wui-btn-tile:active { background: var(--surface-3); border-color: var(--edge-2); }
      .wui-btn-tile .tile-icon { font-size: 1.4rem; }
      .wui-btn-tile .tile-label { font-size: 0.76rem; font-weight: 700; color: #fff; line-height: 1.2; }

      /* Aktivni trening bar */
      .wui-active-banner { background: linear-gradient(135deg, #122818 0%, #10212E 100%); border: 1px solid var(--rec-green); border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .wui-active-pulse { width: 10px; height: 10px; border-radius: 50%; background: var(--rec-green); box-shadow: 0 0 10px var(--rec-green); animation: wuiPulse 1.5s infinite; }
      @keyframes wuiPulse { 0% { transform: scale(0.9); opacity: 0.8; } 50% { transform: scale(1.3); opacity: 1; } 100% { transform: scale(0.9); opacity: 0.8; } }

      /* Polnozaslonski sheet za aktivni trening */
      .wui-sheet-fullscreen { position: fixed; inset: 0; z-index: 9999; background: var(--surface-1, #08090A); display: flex; flex-direction: column; overflow: hidden; }
      .wui-sheet-header { background: var(--surface-2); border-bottom: 1px solid var(--edge-1); padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
      .wui-sheet-title-input { background: transparent; border: none; font-size: 1.15rem; font-weight: 800; color: #fff; flex: 1; min-width: 0; padding: 4px 0; outline: none; min-height: 44px; }
      /* (1) Modali morajo biti nad aktivnim sheetom (9999) */
      #wuiModalsContainer .modal-overlay { z-index: 10005; }
      .wui-timer-badge { background: var(--surface-3); border: 1px solid var(--edge-2); border-radius: 8px; padding: 4px 10px; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; font-weight: 700; color: var(--rec-green); }
      .wui-sheet-body { flex: 1; overflow-y: auto; padding: 14px 14px calc(110px + env(safe-area-inset-bottom, 24px)) 14px; display: flex; flex-direction: column; gap: 14px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y; }
      .wui-sheet-footer { background: var(--surface-2); border-top: 1px solid var(--edge-1); padding: 12px 16px; display: flex; gap: 10px; }

      /* Vaja v treningu */
      .wui-exercise-card { background: var(--surface-2); border: 1px solid var(--edge-1); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .wui-exercise-card.superset-active { border-left: 4px solid var(--strain-blue); }
      .wui-exercise-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .wui-exercise-name { font-size: 1rem; font-weight: 800; color: #fff; flex: 1; }
      .wui-menu-btn { background: var(--surface-3); border: 1px solid var(--edge-2); border-radius: 8px; color: var(--text-2); padding: 6px 10px; font-size: 0.85rem; cursor: pointer; min-height: 44px; min-width: 44px; }

      /* Tabela serij */
      .wui-set-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0 6px; }
      .wui-set-table th { font-size: 0.62rem; color: var(--text-3); text-transform: uppercase; font-weight: 700; padding: 4px 0; text-align: center; overflow: hidden; white-space: nowrap; }
      .wui-set-table td { padding: 3px 2px; text-align: center; overflow: hidden; }
      .wui-set-row.done { opacity: 0.6; }
      .wui-set-row.done .wui-check-btn { background: var(--rec-green); border-color: var(--rec-green); color: #08090A; }

      /* Gumbi za serijo (N / W / D / F) */
      .wui-type-btn { width: 36px; height: 44px; border-radius: 8px; border: 1px solid var(--edge-2); background: var(--surface-3); color: #fff; font-size: 0.82rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
      .wui-type-btn.type-warmup { background: rgba(255, 159, 10, 0.2); border-color: var(--rec-yellow); color: var(--rec-yellow); }
      .wui-type-btn.type-drop { background: rgba(0, 176, 255, 0.2); border-color: var(--strain-blue); color: var(--strain-blue); }
      .wui-type-btn.type-failure { background: rgba(255, 61, 0, 0.2); border-color: var(--rec-red); color: var(--rec-red); }

      /* Vnosna polja za KG, PON, RIR (16px font - no iOS auto-zoom!) */
      .wui-input { width: 100%; max-width: 68px; background: var(--surface-3); border: 1px solid var(--edge-2); border-radius: 8px; color: #fff; font-size: 16px !important; text-align: center; padding: 8px 4px; outline: none; box-sizing: border-box; min-height: 44px; }
      .wui-input:focus { border-color: var(--rec-green); }
      .wui-input::placeholder { color: var(--text-3); opacity: 0.6; }

      /* Kljukica serije */
      .wui-check-btn { width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--edge-2); background: var(--surface-3); color: var(--text-2); font-size: 1.15rem; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; }

      /* Izbris serije */
      .wui-del-btn { background: none; border: none; color: var(--text-3); font-size: 1.1rem; padding: 8px 0; cursor: pointer; min-height: 44px; width: 100%; min-width: 36px; display: flex; align-items: center; justify-content: center; }

      /* Lebdeči počitek (Rest Pill) */
      .wui-rest-pill { position: fixed; bottom: 84px; right: 16px; z-index: 10000; background: rgba(18, 22, 26, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--rec-green); box-shadow: 0 8px 24px rgba(0,0,0,0.6); border-radius: 30px; padding: 8px 14px; display: none; align-items: center; gap: 12px; }
      .wui-rest-pill.visible { display: flex; animation: wuiSlideUp 0.25s ease-out; }
      @keyframes wuiSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .wui-rest-info { display: flex; align-items: center; gap: 6px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 800; color: #fff; }
      .wui-rest-controls { display: flex; gap: 4px; }
      .wui-rest-btn { background: var(--surface-3); border: 1px solid var(--edge-2); border-radius: 16px; color: #fff; font-size: 0.72rem; font-weight: 700; padding: 6px 10px; cursor: pointer; min-height: 44px; min-width: 44px; }
      .wui-rest-skip { background: rgba(255, 61, 0, 0.2); border-color: var(--rec-red); color: var(--rec-red); }

      /* Čipi mišic v izbirniku */
      .wui-chip-bar { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch; }
      .wui-chip { background: var(--surface-2); border: 1px solid var(--edge-1); border-radius: 20px; color: var(--text-2); font-size: 0.76rem; font-weight: 600; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
      .wui-chip.active { background: var(--rec-green); border-color: var(--rec-green); color: #08090A; font-weight: 800; }

      /* Graf e1RM */
      .wui-chart-box { width: 100%; height: 160px; background: var(--surface-2); border: 1px solid var(--edge-1); border-radius: 12px; padding: 10px; display: flex; align-items: center; justify-content: center; }

      /* Zgodovina kartice */
      .wui-hist-card { background: var(--surface-2); border: 1px solid var(--edge-1); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: border-color 0.15s; }
      .wui-hist-card:hover { border-color: var(--edge-2); }
      .wui-hist-row { display: flex; justify-content: space-between; align-items: center; }
      /* Tap targeti >=44px za gumbe na dashboardu */
      #workoutUiContainer button { min-height: 44px; }
      #workoutUiContainer .status-pill { min-width: 44px; display: inline-flex; align-items: center; justify-content: center; }
    `;
    document.head.appendChild(style);
  }

  // ========== MODALNA OKNA ==========
  function injectModals() {
    if (document.getElementById('wuiModalsContainer')) return;
    const wrap = document.createElement('div');
    wrap.id = 'wuiModalsContainer';
    wrap.innerHTML = `
      <!-- 1. Izbirnik vaj -->
      <div class="modal-overlay" id="wuiPickerModal" onclick="if(event.target.id==='wuiPickerModal') WorkoutUI.closePicker()">
        <div class="modal" style="max-width: 500px; height: 85vh; display: flex; flex-direction: column;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>🔍 Izberi vajo</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closePicker()">✕</button>
            </div>
          </div>
          <div style="padding: 10px 14px 6px;">
            <input type="text" id="wuiPickerSearch" class="wui-input" style="max-width: none; text-align: left; font-size: 16px !important;" placeholder="Išči vajo (npr. bench, počep, lat)..." oninput="WorkoutUI.onPickerSearch(this.value)">
            <div class="wui-chip-bar" id="wuiPickerChips" style="margin-top: 8px;"></div>
          </div>
          <div class="modal-body" id="wuiPickerList" style="flex: 1; overflow-y: auto; padding: 10px 14px;"></div>
          <div style="padding: 10px 14px; border-top: 1px solid var(--edge-1);">
            <button class="btn secondary" style="width: 100%;" onclick="WorkoutUI.showCustomExercisePrompt()">+ Ustvari vajo po meri</button>
          </div>
        </div>
      </div>

      <!-- 2. AI Vnos -->
      <div class="modal-overlay" id="wuiAiModal" onclick="if(event.target.id==='wuiAiModal') WorkoutUI.closeAiModal()">
        <div class="modal" style="max-width: 500px;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>✨ Pametni AI vnos treninga</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeAiModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="font-size: 0.8rem; color: var(--text-2);">
              Izgovori, napiši ali slikaj zapiske/tablo v fitnesu. Aplikacija samodejno prepozna vaje, serije in težo.
            </div>
            <div style="position: relative;">
              <textarea id="wuiAiText" class="wui-input" style="width: 100%; max-width: none; min-height: 100px; text-align: left; padding: 10px; font-size: 16px !important;" placeholder="Npr.: bench 3x8 80kg, nato počep 100kg 5 5 4 @8, zgibi 3x10"></textarea>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" id="wuiMicBtn" class="btn secondary" style="flex: 1; min-height: 44px;" onclick="WorkoutUI.toggleSpeechRecognition()">
                <span id="wuiMicIcon">🎙️</span> <span id="wuiMicLabel">Govorni vnos (SLO)</span>
              </button>
              <label class="btn secondary" style="flex: 1; min-height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; margin: 0;">
                📷 Slikaj / Naloži
                <input type="file" accept="image/*" capture="environment" style="display: none;" onchange="WorkoutUI.onPhotoSelected(this)">
              </label>
            </div>
            <div id="wuiPhotoPreviewBox" style="display: none; position: relative;">
              <img id="wuiPhotoPreviewImg" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 8px; border: 1px solid var(--edge-2);" />
              <button type="button" onclick="WorkoutUI.clearPhoto()" style="position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.7); border: none; color: #fff; border-radius: 50%; width: 26px; height: 26px; cursor: pointer;">✕</button>
            </div>
            <div id="wuiAiParsedResult" style="display: none; background: var(--surface-3); border: 1px solid var(--edge-2); border-radius: 10px; padding: 10px; font-size: 0.82rem;"></div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn secondary" style="flex: 1;" onclick="WorkoutUI.closeAiModal()">Prekliči</button>
              <button type="button" id="wuiAiSubmitBtn" class="btn" style="flex: 1; background: linear-gradient(135deg,#00E676 0%,#00B0FF 100%); color: #08090A; font-weight: 800;" onclick="WorkoutUI.executeAiParse()">✨ Razčleni z AI</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Zaključek in Povzetek (Summary) -->
      <div class="modal-overlay" id="wuiSummaryModal" onclick="if(event.target.id==='wuiSummaryModal') WorkoutUI.closeSummaryModal()">
        <div class="modal" style="max-width: 500px;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>🏆 Povzetek treninga</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeSummaryModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" id="wuiSummaryBody" style="display: flex; flex-direction: column; gap: 14px;"></div>
        </div>
      </div>

      <!-- 4. Podrobnosti zaključenega treninga (Detail) -->
      <div class="modal-overlay" id="wuiDetailModal" onclick="if(event.target.id==='wuiDetailModal') WorkoutUI.closeDetailModal()">
        <div class="modal" style="max-width: 500px; max-height: 85vh; display: flex; flex-direction: column;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3 id="wuiDetailTitle">📋 Podrobnosti treninga</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeDetailModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" id="wuiDetailBody" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;"></div>
          <div class="modal-footer" id="wuiDetailFooter" style="padding: 10px 14px; border-top: 1px solid var(--edge-1); display: flex; gap: 8px;"></div>
        </div>
      </div>

      <!-- 5. Statistika vaje in e1RM graf -->
      <div class="modal-overlay" id="wuiStatsModal" onclick="if(event.target.id==='wuiStatsModal') WorkoutUI.closeStatsModal()">
        <div class="modal" style="max-width: 500px;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3 id="wuiStatsTitle">📊 Statistika vaje</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeStatsModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" id="wuiStatsBody" style="display: flex; flex-direction: column; gap: 12px;"></div>
        </div>
      </div>

      <!-- 6. Kalkulator kolutov -->
      <div class="modal-overlay" id="wuiPlatesModal" onclick="if(event.target.id==='wuiPlatesModal') WorkoutUI.closePlatesModal()">
        <div class="modal" style="max-width: 440px;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>⚖️ Kalkulator kolutov</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closePlatesModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; gap: 10px; align-items: center;">
              <div style="flex: 1;">
                <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Ciljna teža (kg):</label>
                <input type="number" step="any" inputmode="decimal" id="wuiPlatesTargetInput" class="wui-input" style="max-width: none; font-size: 18px !important; font-weight: 800;" value="100" oninput="WorkoutUI.recalcPlates()">
              </div>
              <div style="width: 110px;">
                <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Drog (kg):</label>
                <input type="number" step="any" inputmode="decimal" id="wuiPlatesBarInput" class="wui-input" style="max-width: none;" value="20" oninput="WorkoutUI.recalcPlates()">
              </div>
            </div>
            <div id="wuiPlatesVisual" style="background: var(--surface-3); border-radius: 12px; padding: 16px; text-align: center; border: 1px solid var(--edge-2);"></div>
            <button class="btn secondary" onclick="WorkoutUI.closePlatesModal()">Zapri</button>
          </div>
        </div>
      </div>

      <!-- 7. Ogrevalne serije (Warmup generator) -->
      <div class="modal-overlay" id="wuiWarmupModal" onclick="if(event.target.id==='wuiWarmupModal') WorkoutUI.closeWarmupModal()">
        <div class="modal" style="max-width: 440px;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>🔥 Ogrevalne serije</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeWarmupModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; gap: 10px; align-items: center;">
              <div style="flex: 1;">
                <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Delovna teža (kg):</label>
                <input type="number" step="any" inputmode="decimal" id="wuiWarmupTargetInput" class="wui-input" style="max-width: none; font-size: 18px !important; font-weight: 800;" value="100" oninput="WorkoutUI.recalcWarmups()">
              </div>
            </div>
            <div id="wuiWarmupList" style="display: flex; flex-direction: column; gap: 6px;"></div>
            <div style="display: flex; gap: 8px;">
              <button class="btn secondary" style="flex: 1;" onclick="WorkoutUI.closeWarmupModal()">Prekliči</button>
              <button id="wuiWarmupInsertBtn" class="btn" style="flex: 1; background: var(--rec-yellow); color: #08090A; font-weight: 800;" onclick="WorkoutUI.insertWarmupsToActive()">+ Vstavi v vajo</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 8. Nastavitve treninga -->
      <div class="modal-overlay" id="wuiSettingsModal" onclick="if(event.target.id==='wuiSettingsModal') WorkoutUI.closeSettingsModal()">
        <div class="modal" style="max-width: 460px;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>⚙️ Nastavitve treninga</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeSettingsModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px;">
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Telesna teža (kg):</label>
              <input type="number" step="0.1" inputmode="decimal" id="wuiSettingBw" class="wui-input" style="max-width: none;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Teža olimpijskega droga (kg):</label>
              <input type="number" step="0.5" inputmode="decimal" id="wuiSettingBar" class="wui-input" style="max-width: none;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Razpoložljivi koluti (ločeni z vejico):</label>
              <input type="text" id="wuiSettingPlates" class="wui-input" style="max-width: none; text-align: left;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Privzeti čas počitka (sekunde):</label>
              <input type="number" step="5" inputmode="numeric" id="wuiSettingRest" class="wui-input" style="max-width: none;">
            </div>
            <div style="display: flex; gap: 8px; margin-top: 6px;">
              <button class="btn secondary" style="flex: 1;" onclick="WorkoutUI.closeSettingsModal()">Prekliči</button>
              <button class="btn" style="flex: 1; background: var(--rec-green); color: #08090A; font-weight: 800;" onclick="WorkoutUI.saveSettingsForm()">Shrani nastavitve</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 9. Izbira predloge -->
      <div class="modal-overlay" id="wuiTemplateModal" onclick="if(event.target.id==='wuiTemplateModal') WorkoutUI.closeTemplateModal()">
        <div class="modal" style="max-width: 480px; max-height: 80vh; display: flex; flex-direction: column;">
          <div class="modal-header">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3>📋 Izberi predlogo treninga</h3>
              <button type="button" class="modal-close" onclick="WorkoutUI.closeTemplateModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" id="wuiTemplateList" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  // ========== VPENJANJE V STRAN (MOUNT) ==========
  function mount() {
    if (typeof document === 'undefined') return;
    const viewTrening = document.getElementById('view-trening');
    if (!viewTrening) return;

    injectStyles();
    injectModals();

    let cont = document.getElementById('workoutUiContainer');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'workoutUiContainer';
      cont.className = 'wui-container';
      // Vpni pred obstoječi card z Body Mapom
      viewTrening.insertBefore(cont, viewTrening.firstElementChild);
    }

    // Preveri, ali že obstaja aktiven trening v draftu
    if (!activeWorkout) {
      const draft = loadActiveDraft();
      if (draft && draft.exercises) {
        activeWorkout = draft;
      }
    }

    // Samodejno uvozi Google Health vadbe, če je zgodovina še prazna
    if (getWorkouts().length === 0) {
      importGoogleHealthWorkouts(false).catch(() => {});
    }

    renderDashboard();
    renderBodyMapColors();
    ensureExerciseDb().then(() => {
      renderBodyMapColors();
    }).catch(() => {});
  }

  let historyExpanded = false;

  async function importGoogleHealthWorkouts(notify = true) {
    try {
      const res = await fetch('./google-health-workouts.json?v=' + Date.now());
      if (!res.ok) throw new Error('Datoteka ni dosegljiva (' + res.status + ')');
      const incoming = await res.json();
      if (!Array.isArray(incoming) || !incoming.length) return 0;

      const current = getWorkouts();
      const existingIds = new Set(current.map(w => w.id));
      let added = 0;

      for (const w of incoming) {
        if (!existingIds.has(w.id)) {
          current.push(w);
          existingIds.add(w.id);
          added++;
        }
      }

      if (added > 0) {
        current.sort((a, b) => (b.start || new Date(b.date).getTime()) - (a.start || new Date(a.date).getTime()));
        saveWorkouts(current);
        renderDashboard();
        renderBodyMapColors();
        if (notify && typeof root.showMascotNotification === 'function') {
          root.showMascotNotification(`📥 Uspešno uvoženih ${added} treningov iz Google Health!`);
        }
      } else if (notify && typeof root.showMascotNotification === 'function') {
        root.showMascotNotification('Vsi treningi iz Google Health so že uvoženi.');
      }
      return added;
    } catch (e) {
      console.warn('[WorkoutUI] Napaka pri uvozu Google Health treningov:', e);
      if (notify && typeof root.showMascotNotification === 'function') {
        root.showMascotNotification('Uvoz iz Google Health ni uspel: ' + e.message);
      }
      return 0;
    }
  }

  function toggleHistoryExpanded() {
    historyExpanded = !historyExpanded;
    renderDashboard();
  }

  // ========== IZRIS GLAVNEGA ZAVIHKA (DASHBOARD) ==========
  function renderDashboard() {
    if (typeof document === 'undefined') return;
    const cont = document.getElementById('workoutUiContainer');
    if (!cont) return;

    const history = getWorkouts();
    const hasActive = !!activeWorkout;
    const lastWorkout = history.length > 0 ? history[0] : null;

    let html = '';

    // Pasica za aktiven trening, če poteka
    if (hasActive) {
      const elapsed = Math.floor((Date.now() - (activeWorkout.start || Date.now())) / 1000);
      html += `
        <div class="wui-active-banner">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="wui-active-pulse"></div>
            <div>
              <div style="font-size: 0.72rem; color: var(--rec-green); font-weight: 800; text-transform: uppercase;">Trening v teku</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">${esc(activeWorkout.name || 'Trening')}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="wui-timer-badge" id="wuiBannerTimer">${formatDuration(elapsed)}</span>
            <button class="btn" style="padding: 8px 12px; font-weight: 800; background: var(--rec-green); color: #08090A;" onclick="WorkoutUI.openActiveModal()">Nadaljuj</button>
          </div>
        </div>
      `;
    }

    // Glavna kartica: Začni trening
    html += `
      <div class="card ${hasActive ? '' : 'wui-card-highlight'}">
        <div class="card-header">
          <div class="card-title">⚡ Začni trening</div>
          <div style="display: flex; gap: 6px;">
            <button class="status-pill" onclick="WorkoutUI.openSettingsModal()" title="Nastavitve">⚙️</button>
            <button class="status-pill" onclick="WorkoutUI.openAiModal()" title="Pametni AI vnos" style="color: var(--strain-blue);">✨ AI vnos</button>
          </div>
        </div>
        <div class="wui-grid-3">
          <div class="wui-btn-tile" onclick="WorkoutUI.startNewWorkout('empty')">
            <span class="tile-icon">➕</span>
            <span class="tile-label">Prazen trening</span>
          </div>
          <div class="wui-btn-tile" onclick="WorkoutUI.openTemplateModal()">
            <span class="tile-icon">📋</span>
            <span class="tile-label">Iz predloge</span>
          </div>
          <div class="wui-btn-tile" onclick="WorkoutUI.startNewWorkout('repeat_last')" ${lastWorkout ? '' : 'style="opacity:0.5;pointer-events:none;"'}>
            <span class="tile-icon">🔁</span>
            <span class="tile-label">Ponovi zadnjega</span>
          </div>
        </div>
      </div>
    `;

    // Zgodovina treningov
    html += `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📅 Zgodovina treningov</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn secondary" style="padding: 4px 8px; font-size: 0.68rem; border-radius: 6px; cursor: pointer;" onclick="WorkoutUI.importGoogleHealthWorkouts(true)" title="Uvozi prejšnje vadbe iz Google Health">📥 Google Health</button>
            <span style="font-size: 0.75rem; color: var(--text-3); font-family: 'JetBrains Mono', monospace;">${history.length}</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;" id="wuiHistoryList">
    `;

    if (!history.length) {
      html += `
        <div style="text-align: center; color: var(--text-3); font-size: 0.8rem; padding: 18px;">
          Še ni zabeleženih treningov. Začni prvega zgoraj!
          <div style="margin-top: 10px;">
            <button type="button" class="btn secondary" style="font-size: 0.78rem; padding: 6px 14px; border-radius: 8px; cursor: pointer;" onclick="WorkoutUI.importGoogleHealthWorkouts(true)">📥 Uvozi 21 treningov iz Google Health (Fitbit)</button>
          </div>
        </div>
      `;
    } else {
      const showList = historyExpanded ? history : history.slice(0, 5);
      for (const w of showList) {
        const dur = w.start && w.end ? Math.round((w.end - w.start) / 60000) : 0;
        const vol = calculateVolume(w);
        const exSummary = (w.exercises || []).map(e => e.name).slice(0, 3).join(', ') + ((w.exercises || []).length > 3 ? '...' : '');
        html += `
          <div class="wui-hist-card" onclick="WorkoutUI.openDetailModal('${w.id}')">
            <div class="wui-hist-row">
              <strong style="color: #fff; font-size: 0.92rem;">${esc(w.name || 'Trening')}</strong>
              <span style="font-size: 0.72rem; color: var(--text-3); font-family: 'JetBrains Mono', monospace;">${w.date}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-2); display: flex; gap: 12px;">
              <span>⏱️ ${dur} min</span>
              ${vol > 0 ? `<span>🏋️ ${vol.toLocaleString('sl-SI')} kg</span>` : ''}
              <span>🔢 ${((n) => n + ' ' + serijSklon(n))((w.exercises || []).reduce((acc, e) => acc + (e.sets || []).filter(s => s.done).length, 0))}</span>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${esc(exSummary)}
            </div>
          </div>
        `;
      }
      if (history.length > 5) {
        html += `
          <button type="button" class="btn secondary" style="width: 100%; padding: 8px; font-size: 0.75rem; border-radius: 8px; margin-top: 4px; cursor: pointer;" onclick="WorkoutUI.toggleHistoryExpanded()">
            ${historyExpanded ? '▲ Prikaži manj' : '▼ Prikaži vseh ' + history.length + ' treningov'}
          </button>
        `;
      }
    }

    html += `
        </div>
      </div>
    `;

    cont.innerHTML = html;
  }

  // ========== AKTIVNI TRENING (FULL-SCREEN SHEET) ==========
  function openActiveModal() {
    if (typeof document === 'undefined') return;
    if (!activeWorkout) return;
    let sheet = document.getElementById('wuiActiveSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'wuiActiveSheet';
      sheet.className = 'wui-sheet-fullscreen';
      document.body.appendChild(sheet);
    }
    sheet.style.display = 'flex';
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    if (activeTimerInterval) clearInterval(activeTimerInterval);
    activeTimerInterval = setInterval(updateActiveTimerUi, 1000);

    renderActiveWorkoutBody();
  }

  function closeActiveModal() {
    if (typeof document === 'undefined') return;
    const sheet = document.getElementById('wuiActiveSheet');
    if (sheet) sheet.style.display = 'none';
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
    if (activeTimerInterval) {
      clearInterval(activeTimerInterval);
      activeTimerInterval = null;
    }
    renderDashboard();
  }

  function updateActiveTimerUi() {
    if (typeof document === 'undefined') return;
    if (!activeWorkout) return;
    const elapsed = Math.floor((Date.now() - (activeWorkout.start || Date.now())) / 1000);
    const durStr = formatDuration(elapsed);
    const badge = document.getElementById('wuiActiveTimerBadge');
    if (badge) badge.textContent = durStr;
    const bannerBadge = document.getElementById('wuiBannerTimer');
    if (bannerBadge) bannerBadge.textContent = durStr;
  }

  function renderActiveWorkoutBody() {
    if (typeof document === 'undefined') return;
    const sheet = document.getElementById('wuiActiveSheet');
    if (!sheet || !activeWorkout) return;

    const history = getWorkouts();
    const elapsed = Math.floor((Date.now() - (activeWorkout.start || Date.now())) / 1000);

    let html = `
      <div class="wui-sheet-header">
        <button class="wui-menu-btn" onclick="WorkoutUI.closeActiveModal()" title="Pomanjšaj">✕</button>
        <input class="wui-sheet-title-input" value="${esc(activeWorkout.name || 'Trening')}" oninput="WorkoutUI.onActiveWorkoutNameChange(this.value)" placeholder="Ime treninga">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="wui-timer-badge" id="wuiActiveTimerBadge">${formatDuration(elapsed)}</span>
          <button class="btn" style="background: linear-gradient(135deg,#00E676 0%,#00B0FF 100%); color:#08090A; font-weight:800; padding:8px 14px; min-height:44px;" onclick="WorkoutUI.openSummaryModal()">✓ Zaključi</button>
        </div>
      </div>
      <div class="wui-sheet-body" id="wuiSheetExercisesList">
    `;

    if (!activeWorkout.exercises.length) {
      html += `
        <div style="text-align: center; color: var(--text-3); font-size: 0.85rem; padding: 40px 20px;">
          Trening je še prazen. Dodaj vaje s spodnjim gumbom ali uporabi pametni AI vnos!
        </div>
      `;
    } else {
      activeWorkout.exercises.forEach((ex, exIdx) => {
        const prev = previousSets(ex.exId, history);
        const supersetActive = !!ex.supersetId;

        html += `
          <div class="wui-exercise-card ${supersetActive ? 'superset-active' : ''}" data-ex-idx="${exIdx}">
            <div class="wui-exercise-head">
              <div style="flex: 1;">
                <div class="wui-exercise-name">${esc(ex.name)}</div>
                ${supersetActive ? `<span class="status-pill" style="color:var(--strain-blue); margin-top:2px; font-size:0.65rem;">🔗 Superset ${esc(ex.supersetId)}</span>` : ''}
              </div>
              <div style="display: flex; gap: 4px;">
                <button type="button" class="wui-menu-btn" onclick="WorkoutUI.openStatsModal('${ex.exId}', '${esc(ex.name)}')" title="Statistika">📊</button>
                <button type="button" class="wui-menu-btn" onclick="WorkoutUI.openPlatesModalForExercise(${exIdx})" title="Koluti">⚖️</button>
                <button type="button" class="wui-menu-btn" onclick="WorkoutUI.openWarmupModalForExercise(${exIdx})" title="Ogrevanje">🔥</button>
                <button type="button" class="wui-menu-btn" onclick="WorkoutUI.toggleExerciseMenu(${exIdx})" title="Več možnosti">•••</button>
              </div>
            </div>

            <!-- Meni za dodatne možnosti vaje -->
            <div id="wuiExMenu_${exIdx}" style="display: none; background: var(--surface-3); border: 1px solid var(--edge-2); border-radius: 10px; padding: 8px; flex-direction: column; gap: 6px;">
              <button class="btn secondary" style="font-size: 0.76rem; padding: 6px; min-height: 44px;" onclick="WorkoutUI.toggleSupersetLink(${exIdx})">🔗 ${supersetActive ? 'Odstrani iz superseta' : 'Poveži v superset'}</button>
              <button class="btn secondary" style="font-size: 0.76rem; padding: 6px; min-height: 44px;" onclick="WorkoutUI.moveExercise(${exIdx}, -1)" ${exIdx === 0 ? 'disabled' : ''}>⬆️ Premakni navzgor</button>
              <button class="btn secondary" style="font-size: 0.76rem; padding: 6px; min-height: 44px;" onclick="WorkoutUI.moveExercise(${exIdx}, 1)" ${exIdx === activeWorkout.exercises.length - 1 ? 'disabled' : ''}>⬇️ Premakni navzdol</button>
              <button class="btn secondary" style="font-size: 0.76rem; padding: 6px; min-height: 44px; color: var(--rec-red);" onclick="WorkoutUI.removeExercise(${exIdx})">🗑️ Odstrani vajo</button>
            </div>

            <!-- Opomba vaje -->
            <div>
              <input type="text" class="wui-input" style="width: 100%; max-width: none; text-align: left; font-size: 0.78rem !important; padding: 6px 8px; min-height: 32px;" value="${esc(ex.note || '')}" placeholder="Opomba k vaji (npr. pavza 1s na dnu)..." oninput="WorkoutUI.onExerciseNoteChange(${exIdx}, this.value)">
            </div>

            <!-- Tabela serij -->
            <table class="wui-set-table">
              <thead>
                <tr>
                  <th style="width: 40px;">SET</th>
                  <th style="width: 52px;">PREJ.</th>
                  <th>KG</th>
                  <th>PON</th>
                  <th style="width: 38px;">RIR</th>
                  <th style="width: 44px;">✓</th>
                  <th style="width: 40px;"></th>
                </tr>
              </thead>
              <tbody>
        `;

        (ex.sets || []).forEach((s, sIdx) => {
          const prevSet = prev && prev[sIdx] ? prev[sIdx] : null;
          const prevStr = prevSet && (prevSet.w !== null || prevSet.reps !== null)
            ? `${prevSet.w != null ? prevSet.w + 'k' : ''}×${prevSet.reps || ''}`
            : '—';

          const placeholderW = prevSet && prevSet.w != null ? prevSet.w : '';
          const placeholderReps = prevSet && prevSet.reps != null ? prevSet.reps : '';
          const placeholderRir = prevSet && prevSet.rir != null ? prevSet.rir : '2';

          const typeLabel = s.type === 'warmup' ? 'W' : s.type === 'drop' ? 'D' : s.type === 'failure' ? 'F' : (sIdx + 1);
          const typeClass = s.type === 'warmup' ? 'type-warmup' : s.type === 'drop' ? 'type-drop' : s.type === 'failure' ? 'type-failure' : '';

          html += `
            <tr class="wui-set-row ${s.done ? 'done' : ''}" data-s-idx="${sIdx}">
              <td>
                <button type="button" class="wui-type-btn ${typeClass}" onclick="WorkoutUI.cycleSetType(${exIdx}, ${sIdx})" title="Tapni za spremembo tipa (W/D/F/N)">${typeLabel}</button>
              </td>
              <td style="font-size: 0.72rem; color: var(--text-3); font-family: 'JetBrains Mono', monospace;">
                ${prevStr}
              </td>
              <td>
                <input type="number" step="any" inputmode="decimal" class="wui-input" value="${s.w !== null && s.w !== undefined ? s.w : ''}" placeholder="${placeholderW}" oninput="WorkoutUI.onSetWeightChange(${exIdx}, ${sIdx}, this.value)">
              </td>
              <td>
                <input type="number" step="1" inputmode="numeric" class="wui-input" value="${s.reps !== null && s.reps !== undefined ? s.reps : ''}" placeholder="${placeholderReps}" oninput="WorkoutUI.onSetRepsChange(${exIdx}, ${sIdx}, this.value)">
              </td>
              <td>
                <input type="number" step="1" inputmode="numeric" class="wui-input" style="max-width: 38px; padding: 8px 0;" value="${s.rir !== null && s.rir !== undefined ? s.rir : ''}" placeholder="${placeholderRir}" oninput="WorkoutUI.onSetRirChange(${exIdx}, ${sIdx}, this.value)">
              </td>
              <td>
                <button type="button" class="wui-check-btn" onclick="WorkoutUI.toggleSetDone(${exIdx}, ${sIdx})" title="Označi kot opravljeno">✓</button>
              </td>
              <td>
                <button type="button" class="wui-del-btn" onclick="WorkoutUI.removeSet(${exIdx}, ${sIdx})" title="Odstrani serijo">✕</button>
              </td>
            </tr>
          `;
        });

        html += `
              </tbody>
            </table>
            <button class="btn secondary" style="width: 100%; min-height: 40px; padding: 6px;" onclick="WorkoutUI.addSet(${exIdx})">+ Dodaj serijo</button>
          </div>
        `;
      });
    }

    html += `
      </div>
      <div class="wui-sheet-footer">
        <button class="btn secondary" style="flex: 1; min-height: 44px;" onclick="WorkoutUI.openPicker(WorkoutUI.addExerciseToActive)">+ Dodaj vajo</button>
        <button class="btn secondary" style="min-height: 44px; color: var(--strain-blue);" onclick="WorkoutUI.openAiModal()">✨ AI vnos</button>
        <button class="btn secondary" style="min-height: 44px; color: var(--rec-red);" onclick="WorkoutUI.discardActiveWorkout()">🗑️ Zavrzi</button>
      </div>
    `;

    sheet.innerHTML = html;
  }

  // ========== DOGODKI V AKTIVNEM TRENINGU ==========
  function startNewWorkout(type = 'empty', prefilled = null) {
    if (activeWorkout) {
      if (!confirm('Že imate aktiven trening v teku. Ga želite nadaljevati (V redu) ali zavreči in začeti znova (Prekliči)?')) {
        discardActiveWorkout(true);
      } else {
        openActiveModal();
        return;
      }
    }

    const settings = getSettings();
    const history = getWorkouts();
    let name = 'Trening';
    let exercises = [];

    if (type === 'repeat_last' && history.length > 0) {
      const last = history[0];
      name = last.name || 'Trening';
      exercises = (last.exercises || []).map(e => ({
        exId: e.exId,
        name: e.name,
        sets: (e.sets || []).map(s => ({
          w: s.w,
          reps: s.reps,
          rir: s.rir,
          type: s.type || 'normal',
          done: false
        })),
        note: e.note || '',
        supersetId: e.supersetId || null
      }));
    } else if (type === 'template' && prefilled) {
      name = prefilled.name || 'Trening';
      exercises = (prefilled.exercises || []).map(e => ({
        exId: e.exId || 'custom:' + e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: e.name,
        sets: Array.from({ length: e.targetSets || 3 }, () => ({
          w: null,
          reps: null,
          rir: null,
          type: 'normal',
          done: false
        })),
        note: '',
        supersetId: null
      }));
    }

    activeWorkout = {
      id: 'w_' + Date.now(),
      date: new Date().toISOString().slice(0, 10),
      start: Date.now(),
      end: null,
      name,
      notes: '',
      bodyweight: settings.bodyweight,
      exercises,
      source: 'manual'
    };

    saveActiveDraft(activeWorkout);
    renderDashboard();
    openActiveModal();
  }

  function discardActiveWorkout(skipConfirm = false) {
    if (!skipConfirm && !confirm('Ali res želite zavreči trenutni aktivni trening?')) return;
    activeWorkout = null;
    saveActiveDraft(null);
    closeActiveModal();
    skipRestTimer();
    renderDashboard();
    toast('Trening zavržen.');
  }

  function onActiveWorkoutNameChange(val) {
    if (!activeWorkout) return;
    activeWorkout.name = val;
    saveActiveDraft(activeWorkout);
  }

  function onExerciseNoteChange(exIdx, val) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    activeWorkout.exercises[exIdx].note = val;
    saveActiveDraft(activeWorkout);
  }

  function cycleSetType(exIdx, sIdx) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const s = activeWorkout.exercises[exIdx].sets[sIdx];
    if (!s) return;
    const order = ['normal', 'warmup', 'drop', 'failure'];
    const curIdx = order.indexOf(s.type || 'normal');
    s.type = order[(curIdx + 1) % order.length];
    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function onSetWeightChange(exIdx, sIdx, val) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const s = activeWorkout.exercises[exIdx].sets[sIdx];
    if (!s) return;
    s.w = val !== '' ? parseFloat(val) : null;
    saveActiveDraft(activeWorkout);
  }

  function onSetRepsChange(exIdx, sIdx, val) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const s = activeWorkout.exercises[exIdx].sets[sIdx];
    if (!s) return;
    s.reps = val !== '' ? parseInt(val, 10) : null;
    saveActiveDraft(activeWorkout);
  }

  function onSetRirChange(exIdx, sIdx, val) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const s = activeWorkout.exercises[exIdx].sets[sIdx];
    if (!s) return;
    s.rir = val !== '' ? parseInt(val, 10) : null;
    saveActiveDraft(activeWorkout);
  }

  function toggleSetDone(exIdx, sIdx) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const ex = activeWorkout.exercises[exIdx];
    const s = ex.sets[sIdx];
    if (!s) return;

    if (!s.done) {
      // Če so polja prazna, avtomatsko skopiraj iz prejšnjih vrednosti
      const history = getWorkouts();
      const prev = previousSets(ex.exId, history);
      const prevSet = prev && prev[sIdx] ? prev[sIdx] : null;
      const filled = fillFromPrevious(s, prevSet);
      Object.assign(s, filled);
      s.done = true;
      if (!s.ts) s.ts = Date.now();

      // Sproži avtomatski odštevalnik počitka
      const restSec = ex.restSec || getSettings().restDefaultSec;
      startRestTimer(restSec, ex.name);
    } else {
      s.done = false;
    }

    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function addSet(exIdx) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const ex = activeWorkout.exercises[exIdx];
    const lastSet = ex.sets.length > 0 ? ex.sets[ex.sets.length - 1] : null;
    ex.sets.push({
      w: lastSet ? lastSet.w : null,
      reps: lastSet ? lastSet.reps : null,
      rir: lastSet ? lastSet.rir : null,
      type: 'normal',
      done: false
    });
    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function removeSet(exIdx, sIdx) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    activeWorkout.exercises[exIdx].sets.splice(sIdx, 1);
    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function removeExercise(exIdx) {
    if (!activeWorkout) return;
    activeWorkout.exercises.splice(exIdx, 1);
    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function moveExercise(exIdx, delta) {
    if (!activeWorkout) return;
    const targetIdx = exIdx + delta;
    if (targetIdx < 0 || targetIdx >= activeWorkout.exercises.length) return;
    const temp = activeWorkout.exercises[exIdx];
    activeWorkout.exercises[exIdx] = activeWorkout.exercises[targetIdx];
    activeWorkout.exercises[targetIdx] = temp;
    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function toggleSupersetLink(exIdx) {
    if (!activeWorkout || !activeWorkout.exercises[exIdx]) return;
    const ex = activeWorkout.exercises[exIdx];
    if (ex.supersetId) {
      ex.supersetId = null;
    } else {
      ex.supersetId = 'A';
    }
    saveActiveDraft(activeWorkout);
    renderActiveWorkoutBody();
  }

  function toggleExerciseMenu(exIdx) {
    const el = document.getElementById('wuiExMenu_' + exIdx);
    if (!el) return;
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
  }

  function addExerciseToActive(ex) {
    if (!activeWorkout) startNewWorkout('empty');
    activeWorkout.exercises.push({
      exId: ex.id || ('custom:' + ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      name: ex.sl || ex.name,
      sets: [
        { w: null, reps: null, rir: null, type: 'normal', done: false },
        { w: null, reps: null, rir: null, type: 'normal', done: false },
        { w: null, reps: null, rir: null, type: 'normal', done: false }
      ],
      note: '',
      supersetId: null
    });
    saveActiveDraft(activeWorkout);
    closePicker();
    renderActiveWorkoutBody();
  }

  // ========== IZBIRNIK VAJ (EXERCISE PICKER) ==========
  let dbPromise = null;
  function ensureExerciseDb() {
    if (cachedDb && (!root.ExerciseMatch && !window?.ExerciseMatch || (root.ExerciseMatch || window?.ExerciseMatch).isLoaded())) return Promise.resolve(cachedDb);
    if (!dbPromise) {
      dbPromise = fetch('./exercise-db.json')
        .then(r => {
          if (!r.ok) throw new Error('exercise-db.json ' + r.status);
          return r.json();
        })
        .then(data => {
          if (data) {
            cachedDb = data;
            const matchMod = (typeof window !== 'undefined' && window.ExerciseMatch) || root.ExerciseMatch || null;
            if (matchMod && typeof matchMod.load === 'function' && !matchMod.isLoaded()) {
              matchMod.load(data);
            }
          }
          return cachedDb;
        })
        .catch(err => {
          console.warn('[WorkoutUI] Napaka pri nalaganju baze vaj:', err);
          dbPromise = null;
          return null;
        });
    }
    return dbPromise;
  }

  let selectedMuscleFilter = 'vse';

  function openPicker(onPickCallback) {
    lastPickerCallback = onPickCallback;
    const modal = document.getElementById('wuiPickerModal');
    if (!modal) return;
    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    renderPickerChips();
    renderPickerList('');
    ensureExerciseDb().then(() => {
      renderPickerList(document.getElementById('wuiPickerSearch')?.value || '');
    }).catch(() => {});

    const searchInput = document.getElementById('wuiPickerSearch');
    if (searchInput) {
      searchInput.value = '';
      setTimeout(() => searchInput.focus(), 150);
    }
  }

  function closePicker() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('wuiPickerModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  function renderPickerChips() {
    const box = document.getElementById('wuiPickerChips');
    if (!box) return;
    const chips = [
      { id: 'vse', name: 'Vse' },
      { id: 'chest', name: 'Prsa' },
      { id: 'upper-back', name: 'Hrbet' },
      { id: 'quadriceps', name: 'Kvadrici' },
      { id: 'hamstring', name: 'Zadnja loža' },
      { id: 'front-deltoids', name: 'Ramena' },
      { id: 'biceps', name: 'Biceps' },
      { id: 'triceps', name: 'Triceps' },
      { id: 'abs', name: 'Trebuh' },
      { id: 'calves', name: 'Meča' }
    ];

    box.innerHTML = chips.map(c => `
      <div class="wui-chip ${selectedMuscleFilter === c.id ? 'active' : ''}" onclick="WorkoutUI.onPickerChip('${c.id}')">${c.name}</div>
    `).join('');
  }

  function onPickerChip(muscleId) {
    selectedMuscleFilter = muscleId;
    renderPickerChips();
    const query = document.getElementById('wuiPickerSearch')?.value || '';
    renderPickerList(query);
  }

  function onPickerSearch(val) {
    renderPickerList(val);
  }

  function renderPickerList(query = '') {
    const listEl = document.getElementById('wuiPickerList');
    if (!listEl) return;

    let pool = BUILTIN_EXERCISES;
    if (cachedDb && cachedDb.exercises) {
      pool = cachedDb.exercises;
    }

    const q = query.trim().toLowerCase();
    let results = [];

    if (typeof window !== 'undefined' && window.ExerciseMatch && typeof window.ExerciseMatch.search === 'function') {
      try {
        const matchRes = window.ExerciseMatch.search(q, 40);
        if (matchRes && matchRes.length) {
          results = matchRes.map(m => pool.find(e => e.id === m.id) || m);
        }
      } catch (e) {}
    }

    if (results.length > 0 && selectedMuscleFilter !== 'vse') {
      results = results.filter(ex => {
        return (ex.pri && ex.pri.includes(selectedMuscleFilter)) ||
          (ex.bp && ex.bp.toLowerCase().includes(selectedMuscleFilter));
      });
    }

    if (!results.length) {
      results = pool.filter(ex => {
        const matchesMuscle = selectedMuscleFilter === 'vse' ||
          (ex.pri && ex.pri.includes(selectedMuscleFilter)) ||
          (ex.bp && ex.bp.toLowerCase().includes(selectedMuscleFilter));

        if (!matchesMuscle) return false;
        if (!q) return true;

        const nameEn = (ex.name || '').toLowerCase();
        const nameSl = (ex.sl || '').toLowerCase();
        const aliases = (ex.aliases || []).join(' ').toLowerCase();
        return nameEn.includes(q) || nameSl.includes(q) || aliases.includes(q);
      });
    }

    // Dodaj pogoste / nedavne iz zgodovine na vrh
    const history = getWorkouts();
    const freq = {};
    for (const w of history) {
      for (const e of (w.exercises || [])) {
        freq[e.exId] = (freq[e.exId] || 0) + 1;
      }
    }
    results.sort((a, b) => ((freq[b.id] || 0) + (b.pop || 0)) - ((freq[a.id] || 0) + (a.pop || 0)));

    if (!results.length) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--text-3); font-size: 0.8rem; padding: 20px;">Ni zadetkov za "${esc(q)}". Ustvari vajo po meri spodaj!</div>`;
      return;
    }

    listEl.innerHTML = results.slice(0, 40).map(ex => {
      const displayName = ex.sl || ex.name;
      const subName = ex.sl && ex.sl !== ex.name ? ex.name : '';
      const muscleTag = (ex.pri && ex.pri[0] && MUSCLE_NAMES_SL[ex.pri[0]]) || ex.bp || 'Vaja';

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 8px; border-bottom: 1px solid var(--edge-1); gap: 10px;">
          <div style="flex: 1; cursor: pointer;" onclick="WorkoutUI.onExercisePicked('${ex.id}')">
            <div style="font-weight: 700; color: #fff; font-size: 0.92rem;">${esc(displayName)}</div>
            <div style="font-size: 0.72rem; color: var(--text-3);">
              ${subName ? `<span>${esc(subName)} · </span>` : ''}
              <span style="color: var(--rec-green);">${esc(muscleTag)}</span>
            </div>
          </div>
          <button class="btn secondary" style="min-height: 38px; padding: 6px 12px; font-weight: 700;" onclick="WorkoutUI.onExercisePicked('${ex.id}')">+ Dodaj</button>
        </div>
      `;
    }).join('');
  }

  function onExercisePicked(exId) {
    let pool = BUILTIN_EXERCISES;
    if (cachedDb && cachedDb.exercises) pool = cachedDb.exercises;
    let ex = pool.find(e => e.id === exId);
    if (!ex && typeof window !== 'undefined' && window.ExerciseMatch && typeof window.ExerciseMatch.get === 'function') {
      ex = window.ExerciseMatch.get(exId);
    }
    if (!ex) ex = { id: exId, name: exId, sl: exId };
    if (typeof lastPickerCallback === 'function') {
      lastPickerCallback(ex);
    }
  }

  function showCustomExercisePrompt() {
    const name = prompt('Vnesite ime vaje po meri:');
    if (!name || !name.trim()) return;
    const customEx = {
      id: 'custom:' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: name.trim(),
      sl: name.trim(),
      bp: 'custom',
      pri: ['chest']
    };
    if (typeof lastPickerCallback === 'function') {
      lastPickerCallback(customEx);
    }
  }

  // ========== AI VNOS MODAL ==========
  function openAiModal() {
    const modal = document.getElementById('wuiAiModal');
    if (!modal) return;
    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();
  }

  function closeAiModal() {
    const modal = document.getElementById('wuiAiModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
    stopSpeechRecognition();
  }

  function toggleSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micIcon = document.getElementById('wuiMicIcon');
    const micLabel = document.getElementById('wuiMicLabel');

    if (isListening) {
      stopSpeechRecognition();
      return;
    }

    if (SpeechRec) {
      speechRec = new SpeechRec();
      speechRec.lang = 'sl-SI';
      speechRec.continuous = true;
      speechRec.interimResults = true;

      speechRec.onresult = (evt) => {
        let transcript = '';
        for (let i = evt.resultIndex; i < evt.results.length; ++i) {
          transcript += evt.results[i][0].transcript;
        }
        const textEl = document.getElementById('wuiAiText');
        if (textEl && transcript) {
          textEl.value = (textEl.value ? textEl.value + ' ' : '') + transcript;
        }
      };

      speechRec.onerror = (err) => {
        console.warn('[WorkoutUI] Speech error:', err);
        stopSpeechRecognition();
      };

      speechRec.onend = () => {
        stopSpeechRecognition();
      };

      speechRec.start();
      isListening = true;
      if (micIcon) micIcon.textContent = '🔴';
      if (micLabel) micLabel.textContent = 'Poslušam...';
    } else {
      // Fallback: MediaRecorder snemanje zvoka
      startMediaAudioRecording();
    }
  }

  function stopSpeechRecognition() {
    if (speechRec) {
      try { speechRec.stop(); } catch (e) {}
      speechRec = null;
    }
    isListening = false;
    const micIcon = document.getElementById('wuiMicIcon');
    const micLabel = document.getElementById('wuiMicLabel');
    if (micIcon) micIcon.textContent = '🎙️';
    if (micLabel) micLabel.textContent = 'Govorni vnos (SLO)';
  }

  async function startMediaAudioRecording() {
    try {
      if (isRecordingAudio) {
        if (mediaRecorder) mediaRecorder.stop();
        isRecordingAudio = false;
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        toast('Posnetek zvoka shranjen za analizo.');
      };
      mediaRecorder.start();
      isRecordingAudio = true;
      toast('Snemam zvok... Pritisnite znova za konec.');
    } catch (e) {
      toast('Mikrofon ni na voljo ali pa dostop ni bil dovoljen.');
    }
  }

  function onPhotoSelected(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      tempPhotoDataUrl = e.target.result;
      const previewBox = document.getElementById('wuiPhotoPreviewBox');
      const previewImg = document.getElementById('wuiPhotoPreviewImg');
      if (previewBox && previewImg) {
        previewImg.src = tempPhotoDataUrl;
        previewBox.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    tempPhotoDataUrl = null;
    const previewBox = document.getElementById('wuiPhotoPreviewBox');
    if (previewBox) previewBox.style.display = 'none';
  }

  async function executeAiParse() {
    const textEl = document.getElementById('wuiAiText');
    const submitBtn = document.getElementById('wuiAiSubmitBtn');
    const text = textEl ? textEl.value.trim() : '';
    const image = tempPhotoDataUrl || undefined;

    if (!text && !image && !audioChunks.length) {
      toast('Prosimo, vnesite besedilo, posnemite govor ali priložite sliko.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Razčlenjujem...';
    }

    try {
      const res = await parseWorkoutWithAi({ text, image });
      const parsedExercises = res.exercises || [];

      if (!parsedExercises.length) {
        toast('AI ni prepoznal nobenih vaj. Poskusite z bolj specifičnim zapisom.');
        return;
      }

      // Če ni aktivnega treninga, ga ustvari
      if (!activeWorkout) {
        startNewWorkout('empty');
      }

      activeWorkout = mergeParsed(activeWorkout, parsedExercises);
      saveActiveDraft(activeWorkout);
      closeAiModal();
      renderActiveWorkoutBody();
      toast(`✅ Uspešno dodano ${parsedExercises.length} vaj v trening!`);
    } catch (err) {
      console.error('[WorkoutUI] AI parse failed:', err);
      toast('Napaka pri AI prepoznavi: ' + (err.message || err));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '✨ Razčleni z AI';
      }
    }
  }

  // ========== ZAKLJUČEK IN POVZETEK (SUMMARY) ==========
  function openSummaryModal() {
    if (!activeWorkout) return;
    const modal = document.getElementById('wuiSummaryModal');
    const body = document.getElementById('wuiSummaryBody');
    if (!modal || !body) return;

    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    const elapsed = Math.floor((Date.now() - (activeWorkout.start || Date.now())) / 1000);
    const durMin = Math.round(elapsed / 60);
    const vol = calculateVolume(activeWorkout);
    const totalSets = (activeWorkout.exercises || []).reduce((acc, ex) => acc + (ex.sets || []).filter(s => s.done).length, 0);

    const history = getWorkouts();
    const prs = detectPRs(activeWorkout, history, cachedDb);

    // Izračun serij po mišičnih skupinah
    const muscleMap = {};
    for (const ex of activeWorkout.exercises) {
      const pool = cachedDb && cachedDb.exercises ? cachedDb.exercises : BUILTIN_EXERCISES;
      const match = pool.find(e => e.id === ex.exId);
      const pri = (match && match.pri) || ['other'];
      const completedCount = (ex.sets || []).filter(s => s.done && s.type !== 'warmup').length;
      for (const m of pri) {
        muscleMap[m] = (muscleMap[m] || 0) + completedCount;
      }
    }

    let html = `
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center;">
        <div style="background: var(--surface-2); border-radius: 10px; padding: 10px 4px; border: 1px solid var(--edge-1);">
          <div style="font-size: 1.15rem; font-weight: 800; color: #fff;">${durMin} min</div>
          <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Trajanje</div>
        </div>
        <div style="background: var(--surface-2); border-radius: 10px; padding: 10px 4px; border: 1px solid var(--edge-1);">
          <div style="font-size: 1.15rem; font-weight: 800; color: var(--rec-green);">${vol.toLocaleString('sl-SI')} kg</div>
          <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Volumen</div>
        </div>
        <div style="background: var(--surface-2); border-radius: 10px; padding: 10px 4px; border: 1px solid var(--edge-1);">
          <div style="font-size: 1.15rem; font-weight: 800; color: var(--strain-blue);">${totalSets}</div>
          <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Serij</div>
        </div>
      </div>
    `;

    // Prikaz PR-jev
    if (prs.length > 0) {
      html += `
        <div style="background: rgba(255, 159, 10, 0.15); border: 1px solid var(--rec-yellow); border-radius: 12px; padding: 10px;">
          <div style="font-size: 0.82rem; font-weight: 800; color: var(--rec-yellow); display: flex; align-items: center; gap: 6px;">
            <span>🏆</span> <span>Novi osebni rekordi (${prs.length}):</span>
          </div>
          <ul style="margin: 6px 0 0 16px; padding: 0; font-size: 0.78rem; color: #fff;">
            ${prs.map(p => {
              const kindLabel = p.kind === 'weight' ? `Teža: ${p.value} kg (prej ${p.prev} kg)` :
                p.kind === 'e1rm' ? `e1RM: ${p.value} kg (prej ${p.prev} kg)` :
                p.kind === 'volume' ? `Volumen vaje: ${p.value} kg (prej ${p.prev} kg)` :
                p.kind === 'reps@weight' ? `Ponovitve: ${p.value} @ ${p.weight} kg (prej ${p.prev})` :
                `${p.kind}: ${p.value}`;
              return `<li><b>${esc(p.name)}</b>: ${kindLabel}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    // Mišična porazdelitev
    html += `
      <div>
        <div style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">Obremenjene mišične skupine:</div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${Object.entries(muscleMap).map(([m, c]) => `
            <span class="status-pill" style="color: var(--rec-green);">${MUSCLE_NAMES_SL[m] || m}: <b>${c}</b> ${serijSklon(c)}</span>
          `).join('')}
        </div>
      </div>
    `;

    // Opombe treninga
    html += `
      <div>
        <label style="font-size: 0.72rem; color: var(--text-3); text-transform: uppercase;">Opombe o treningu:</label>
        <textarea id="wuiSummaryNotes" class="wui-input" style="width: 100%; max-width: none; min-height: 60px; text-align: left; padding: 8px; font-size: 16px !important;" placeholder="Kako se je zdelo? Počutje, energija, spanec...">${esc(activeWorkout.notes || '')}</textarea>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <button class="btn secondary" style="flex: 1;" onclick="WorkoutUI.closeSummaryModal()">Nazaj</button>
        <button class="btn" style="flex: 1; background: linear-gradient(135deg,#00E676 0%,#00B0FF 100%); color:#08090A; font-weight:800;" onclick="WorkoutUI.saveAndFinishWorkout()">💾 Shrani trening</button>
      </div>
    `;

    body.innerHTML = html;
  }

  function closeSummaryModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('wuiSummaryModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  function saveAndFinishWorkout() {
    if (!activeWorkout) return;
    const notesEl = typeof document !== 'undefined' ? document.getElementById('wuiSummaryNotes') : null;
    if (notesEl) activeWorkout.notes = notesEl.value.trim();

    activeWorkout.end = Date.now();
    const history = getWorkouts();
    history.unshift(activeWorkout);
    saveWorkouts(history);

    // Počisti aktivni trening
    activeWorkout = null;
    saveActiveDraft(null);
    skipRestTimer();

    closeSummaryModal();
    closeActiveModal();
    renderDashboard();
    renderBodyMapColors();

    toast('🎉 Trening uspešno zabeležen in shranjen v dnevnik! Odlično opravljeno! 🏆');
  }

  // ========== PODROBNOSTI ZAKLJUČENEGA TRENINGA (DETAIL) ==========
  function openDetailModal(workoutId) {
    const history = getWorkouts();
    const w = history.find(x => x.id === workoutId);
    if (!w) return;

    const modal = document.getElementById('wuiDetailModal');
    const body = document.getElementById('wuiDetailBody');
    const footer = document.getElementById('wuiDetailFooter');
    const title = document.getElementById('wuiDetailTitle');
    if (!modal || !body || !footer) return;

    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    if (title) title.textContent = `${w.name} (${w.date})`;
    const durMin = w.start && w.end ? Math.round((w.end - w.start) / 60000) : 0;
    const vol = calculateVolume(w);

    let html = `
      <div style="display: flex; gap: 12px; font-size: 0.8rem; color: var(--text-2); background: var(--surface-3); border-radius: 8px; padding: 8px 12px;">
        <span>⏱️ ${durMin} min</span>
        <span>🏋️ ${vol.toLocaleString('sl-SI')} kg</span>
        <span>🔢 ${((n) => n + ' ' + serijSklon(n))((w.exercises || []).reduce((acc, e) => acc + (e.sets || []).filter(s => s.done).length, 0))}</span>
      </div>
    `;

    if (w.notes) {
      html += `<div style="font-size: 0.8rem; color: var(--text-2); background: var(--surface-2); border-left: 3px solid var(--rec-green); padding: 6px 10px;">${esc(w.notes)}</div>`;
    }

    for (const ex of (w.exercises || [])) {
      html += `
        <div style="background: var(--surface-2); border-radius: 10px; padding: 10px; border: 1px solid var(--edge-1);">
          <div style="font-weight: 800; color: #fff; font-size: 0.95rem; margin-bottom: 6px;">${esc(ex.name)}</div>
          ${ex.note ? `<div style="font-size: 0.72rem; color: var(--text-3); margin-bottom: 6px;">${esc(ex.note)}</div>` : ''}
          <div style="display: flex; flex-direction: column; gap: 4px;">
      `;
      (ex.sets || []).forEach((s, idx) => {
        const typeStr = s.type === 'warmup' ? ' (W)' : s.type === 'drop' ? ' (Drop)' : s.type === 'failure' ? ' (Odpoved)' : '';
        const rirStr = s.rir != null ? ` · RIR ${s.rir}` : '';
        const wStr = s.w != null ? `${s.w} kg` : 'lastna teža';
        html += `
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; padding: 3px 6px; background: var(--surface-3); border-radius: 6px;">
            <span>Serija ${idx + 1}${typeStr}: <b>${wStr}</b> × <b>${s.reps || 0}</b>${rirStr}</span>
            <span style="color: var(--rec-green);">${s.done ? '✓' : '—'}</span>
          </div>
        `;
      });
      html += `
          </div>
        </div>
      `;
    }

    body.innerHTML = html;

    footer.innerHTML = `
      <button class="btn secondary" style="flex: 1;" onclick="WorkoutUI.repeatWorkoutFromDetail('${w.id}')">🔁 Ponovi ta trening</button>
      <button class="btn secondary" style="flex: 1;" onclick="WorkoutUI.copyWorkoutAsMarkdown('${w.id}')">📋 Kopiraj Markdown</button>
      <button class="btn secondary" style="color: var(--rec-red);" onclick="WorkoutUI.deleteWorkout('${w.id}')">🗑️</button>
    `;
  }

  function closeDetailModal() {
    const modal = document.getElementById('wuiDetailModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  function repeatWorkoutFromDetail(workoutId) {
    const history = getWorkouts();
    const w = history.find(x => x.id === workoutId);
    if (!w) return;
    closeDetailModal();
    startNewWorkout('repeat_last', w);
  }

  function copyWorkoutAsMarkdown(workoutId) {
    const history = getWorkouts();
    const w = history.find(x => x.id === workoutId);
    if (!w) return;
    const md = toObsidianMarkdown(w, cachedDb);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(() => {
        toast('📋 Markdown uspešno kopiran v odložišče (Obsidian format)!');
      }).catch(() => {
        prompt('Kopirajte besedilo:', md);
      });
    } else {
      prompt('Kopirajte besedilo:', md);
    }
  }

  function deleteWorkout(workoutId) {
    if (!confirm('Ali res želite izbrisati ta trening iz zgodovine?')) return;
    const history = getWorkouts().filter(w => w.id !== workoutId);
    saveWorkouts(history);
    closeDetailModal();
    renderDashboard();
    renderBodyMapColors();
    toast('Trening izbrisan.');
  }

  // ========== STATISTIKA VAJE IN e1RM GRAF ==========
  function openStatsModal(exId, exName) {
    const modal = document.getElementById('wuiStatsModal');
    const body = document.getElementById('wuiStatsBody');
    const title = document.getElementById('wuiStatsTitle');
    if (!modal || !body) return;

    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();
    if (title) title.textContent = `📊 ${exName || 'Statistika vaje'}`;

    const history = getWorkouts();
    const points = [];
    let bestWeight = 0;
    let bestReps = 0;
    let bestE1 = 0;

    // Preišči zgodovino (od najstarejšega do najnovejšega)
    const reversed = history.slice().reverse();
    for (const w of reversed) {
      const match = (w.exercises || []).find(e => e.exId === exId || (e.name && e.name.toLowerCase() === (exName || '').toLowerCase()));
      if (!match) continue;

      let workoutBestE1 = 0;
      for (const s of (match.sets || [])) {
        if (!s.done || s.type === 'warmup') continue;
        const weight = Number(s.w) || 0;
        const reps = Number(s.reps) || 0;
        if (weight > bestWeight) bestWeight = weight;
        if (reps > bestReps) bestReps = reps;
        const e1 = estimate1RM(weight, reps, s.rir || 0);
        if (e1 && e1 > workoutBestE1) workoutBestE1 = e1;
        if (e1 && e1 > bestE1) bestE1 = e1;
      }
      if (workoutBestE1 > 0) {
        points.push({ date: w.date, e1rm: workoutBestE1 });
      }
    }

    // Izris SVG grafa
    let svgHtml = '<div style="color:var(--text-3); font-size:0.8rem; text-align:center;">Še ni dovolj podatkov za graf.</div>';
    if (points.length >= 2) {
      const w = 320, h = 140, pad = 24;
      const minE = Math.min(...points.map(p => p.e1rm)) * 0.95;
      const maxE = Math.max(...points.map(p => p.e1rm)) * 1.05;
      const rangeE = maxE - minE || 1;

      const coords = points.map((p, idx) => {
        const x = pad + (idx / (points.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((p.e1rm - minE) / rangeE) * (h - 2 * pad);
        return { x, y, val: p.e1rm, date: p.date };
      });

      const pathD = coords.map((c, i) => (i === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`)).join(' ');

      svgHtml = `
        <svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: 100%;">
          <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--edge-2)" stroke-width="1" />
          <path d="${pathD}" fill="none" stroke="var(--rec-green)" stroke-width="2.5" />
          ${coords.map(c => `
            <circle cx="${c.x}" cy="${c.y}" r="4" fill="var(--rec-green)" stroke="#08090A" stroke-width="1.5" />
            <text x="${c.x}" y="${c.y - 8}" fill="#fff" font-size="9" text-anchor="middle" font-family="'JetBrains Mono', monospace">${c.val}</text>
          `).join('')}
        </svg>
      `;
    }

    body.innerHTML = `
      <div class="wui-chart-box">${svgHtml}</div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; margin-top: 6px;">
        <div style="background: var(--surface-3); padding: 8px 4px; border-radius: 8px;">
          <div style="font-size: 1.05rem; font-weight: 800; color: #fff;">${bestWeight} kg</div>
          <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Maks. teža</div>
        </div>
        <div style="background: var(--surface-3); padding: 8px 4px; border-radius: 8px;">
          <div style="font-size: 1.05rem; font-weight: 800; color: var(--rec-green);">${bestE1} kg</div>
          <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Najvišji e1RM</div>
        </div>
        <div style="background: var(--surface-3); padding: 8px 4px; border-radius: 8px;">
          <div style="font-size: 1.05rem; font-weight: 800; color: var(--strain-blue);">${points.length}</div>
          <div style="font-size: 0.65rem; color: var(--text-3); text-transform: uppercase;">Treningov</div>
        </div>
      </div>
      <button class="btn secondary" style="margin-top: 8px;" onclick="WorkoutUI.closeStatsModal()">Zapri</button>
    `;
  }

  function closeStatsModal() {
    const modal = document.getElementById('wuiStatsModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  // ========== KALKULATOR KOLUTOV (PLATE CALCULATOR) ==========
  let currentPlateTargetExerciseIdx = null;

  function openPlatesModalForExercise(exIdx) {
    currentPlateTargetExerciseIdx = exIdx;
    const modal = document.getElementById('wuiPlatesModal');
    if (!modal) return;
    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    let targetW = 100;
    if (activeWorkout && activeWorkout.exercises[exIdx]) {
      const ex = activeWorkout.exercises[exIdx];
      const s = ex.sets.find(st => Number(st.w) > 0);
      if (s) targetW = Number(s.w);
    }
    const targetInput = document.getElementById('wuiPlatesTargetInput');
    const barInput = document.getElementById('wuiPlatesBarInput');
    if (targetInput) targetInput.value = targetW;
    if (barInput) barInput.value = getSettings().barKg;
    recalcPlates();
  }

  function closePlatesModal() {
    const modal = document.getElementById('wuiPlatesModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  function recalcPlates() {
    const target = parseFloat(document.getElementById('wuiPlatesTargetInput')?.value) || 0;
    const bar = parseFloat(document.getElementById('wuiPlatesBarInput')?.value) || 20;
    const res = calculatePlates(target, bar, getSettings().plates);
    const box = document.getElementById('wuiPlatesVisual');
    if (!box) return;

    if (!res.perSide.length) {
      box.innerHTML = `<div style="color: var(--text-3); font-size: 0.85rem;">Samo prazen drog (${bar} kg).</div>`;
      return;
    }

    const plateColors = {
      25: '#FF3D00',
      20: '#00B0FF',
      15: '#FF9F0A',
      10: '#30D158',
      5: '#EEEEEE',
      2.5: '#212121',
      1.25: '#9E9E9E'
    };

    const platesHtml = res.perSide.map(p => `
      <span style="display:inline-block; padding: 4px 8px; border-radius: 6px; background: ${plateColors[p] || '#555'}; color: ${p === 5 ? '#000' : '#fff'}; font-weight: 800; font-size: 0.8rem; margin: 2px;">
        ${p} kg
      </span>
    `).join(' ');

    box.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--text-2); margin-bottom: 8px;">Na VSAKO stran droga naloži:</div>
      <div>${platesHtml}</div>
      <div style="font-size: 0.76rem; color: var(--text-3); margin-top: 10px;">
        Dosežena teža: <b>${res.achieved} kg</b> (${res.perSide.reduce((a, b) => a + b, 0) * 2} kg uteži + ${bar} kg drog)
      </div>
    `;
  }

  // ========== OGREVALNE SERIJE (WARMUP GENERATOR) ==========
  let currentWarmupTargetExerciseIdx = null;

  function openWarmupModalForExercise(exIdx) {
    currentWarmupTargetExerciseIdx = exIdx;
    const modal = document.getElementById('wuiWarmupModal');
    if (!modal) return;
    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    let targetW = 100;
    if (activeWorkout && activeWorkout.exercises[exIdx]) {
      const ex = activeWorkout.exercises[exIdx];
      const s = ex.sets.find(st => Number(st.w) > 0);
      if (s) targetW = Number(s.w);
    }
    const input = document.getElementById('wuiWarmupTargetInput');
    if (input) input.value = targetW;
    recalcWarmups();
  }

  function closeWarmupModal() {
    const modal = document.getElementById('wuiWarmupModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  function recalcWarmups() {
    const target = parseFloat(document.getElementById('wuiWarmupTargetInput')?.value) || 0;
    const sets = generateWarmups(target, getSettings().barKg);
    const box = document.getElementById('wuiWarmupList');
    if (!box) return;

    if (!sets.length) {
      box.innerHTML = `<div style="color: var(--text-3); font-size: 0.8rem; text-align: center;">Za to težo ogrevalne serije niso potrebne (teža je manjša od droga).</div>`;
      return;
    }

    box.innerHTML = sets.map((s, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-3); padding: 8px 12px; border-radius: 8px; font-size: 0.82rem;">
        <span>Ogrevanje ${idx + 1}: <b>${s.w} kg</b> × <b>${s.reps}</b> pon</span>
        <span class="status-pill" style="color: var(--rec-yellow);">Ogrevanje</span>
      </div>
    `).join('');
  }

  function insertWarmupsToActive() {
    if (currentWarmupTargetExerciseIdx === null || !activeWorkout) return;
    const ex = activeWorkout.exercises[currentWarmupTargetExerciseIdx];
    if (!ex) return;
    const target = parseFloat(document.getElementById('wuiWarmupTargetInput')?.value) || 0;
    const warmups = generateWarmups(target, getSettings().barKg);
    if (warmups.length) {
      ex.sets.unshift(...warmups);
      saveActiveDraft(activeWorkout);
      renderActiveWorkoutBody();
      toast(`Dodano ${warmups.length} ogrevalnih serij v vajo!`);
    }
    closeWarmupModal();
  }

  // ========== NASTAVITVE (SETTINGS) ==========
  function openSettingsModal() {
    const modal = document.getElementById('wuiSettingsModal');
    if (!modal) return;
    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    const s = getSettings();
    document.getElementById('wuiSettingBw').value = s.bodyweight;
    document.getElementById('wuiSettingBar').value = s.barKg;
    document.getElementById('wuiSettingPlates').value = (s.plates || []).join(', ');
    document.getElementById('wuiSettingRest').value = s.restDefaultSec;
  }

  function closeSettingsModal() {
    const modal = document.getElementById('wuiSettingsModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  function saveSettingsForm() {
    const bw = parseFloat(document.getElementById('wuiSettingBw')?.value) || 80;
    const bar = parseFloat(document.getElementById('wuiSettingBar')?.value) || 20;
    const platesStr = document.getElementById('wuiSettingPlates')?.value || '';
    const plates = platesStr.split(/[\s,]+/).map(p => parseFloat(p)).filter(p => !isNaN(p) && p > 0);
    const rest = parseInt(document.getElementById('wuiSettingRest')?.value, 10) || 120;

    const s = getSettings();
    s.bodyweight = bw;
    s.barKg = bar;
    s.plates = plates.length ? plates : [25, 20, 15, 10, 5, 2.5, 1.25];
    s.restDefaultSec = rest;
    saveSettings(s);
    closeSettingsModal();
    toast('✅ Nastavitve treninga shranjene.');
  }

  // ========== PREDLOGE (TEMPLATES) ==========
  let loadedTemplates = DEFAULT_TEMPLATES;

  function openTemplateModal() {
    const modal = document.getElementById('wuiTemplateModal');
    const list = document.getElementById('wuiTemplateList');
    if (!modal || !list) return;
    modal.classList.add('open');
    if (typeof root.lockBodyScroll === 'function') root.lockBodyScroll();

    fetch('./workout-templates.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        let tpls = DEFAULT_TEMPLATES.slice();
        if (Array.isArray(data)) {
          const programDays = [];
          for (const prog of data) {
            const progName = prog.name_sl || prog.name_en || 'Program';
            for (const day of (prog.days || [])) {
              programDays.push({
                id: `${prog.id || 'p'}_${day.name}`,
                name: `${day.name} (${progName})`,
                exercises: (day.exercises || []).map(e => ({
                  exId: e.exId,
                  name: e.name,
                  targetSets: e.sets || 3,
                  restSec: e.restSec,
                  rir: e.rir
                }))
              });
            }
          }
          if (programDays.length) tpls = tpls.concat(programDays);
        } else if (data && Array.isArray(data.templates)) {
          tpls = data.templates;
        }
        loadedTemplates = tpls;
        renderTemplatesList(loadedTemplates);
      })
      .catch(() => {
        loadedTemplates = DEFAULT_TEMPLATES;
        renderTemplatesList(loadedTemplates);
      });
  }

  function renderTemplatesList(templates) {
    const list = document.getElementById('wuiTemplateList');
    if (!list) return;
    list.innerHTML = templates.map((t, idx) => `
      <div class="wui-hist-card" onclick="WorkoutUI.pickTemplate(${idx})">
        <div style="font-weight: 800; color: #fff; font-size: 0.95rem;">${esc(t.name)}</div>
        <div style="font-size: 0.72rem; color: var(--text-3); margin-top: 4px;">
          ${(t.exercises || []).map(e => e.name).join(' · ')}
        </div>
      </div>
    `).join('');
  }

  function pickTemplate(tplIdx) {
    const tpl = (loadedTemplates && loadedTemplates[tplIdx]) || DEFAULT_TEMPLATES[tplIdx];
    if (tpl) {
      closeTemplateModal();
      startNewWorkout('template', tpl);
    }
  }

  function closeTemplateModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('wuiTemplateModal');
    if (modal) modal.classList.remove('open');
    if (typeof root.unlockBodyScroll === 'function') root.unlockBodyScroll();
  }

  // ========== BODY MAP REGENERACIJA (HOOK) ==========
  function renderBodyMapColors() {
    if (typeof document === 'undefined') return;
    const svg = document.getElementById('bodyMapSvg');
    if (!svg) return;

    const history = getWorkouts();
    let colors = {};

    if (typeof window !== 'undefined' && window.RecoveryEngine && typeof window.RecoveryEngine.muscleRecovery === 'function' && typeof window.RecoveryEngine.bodyMapColors === 'function') {
      try {
        const rec = window.RecoveryEngine.muscleRecovery(history, cachedDb || { exercises: BUILTIN_EXERCISES }, Date.now());
        colors = window.RecoveryEngine.bodyMapColors(rec);
      } catch (e) {}
    }

    if (!Object.keys(colors).length) {
      // Zasilni izračun glede na zadnji trening
      const now = Date.now();
      const lastTrained = {};
      for (const w of history) {
        const diffHours = (now - (w.start || w.end || now)) / 3600000;
        for (const ex of (w.exercises || [])) {
          const pool = cachedDb && cachedDb.exercises ? cachedDb.exercises : BUILTIN_EXERCISES;
          const match = pool.find(e => e.id === ex.exId);
          for (const m of ((match && match.pri) || [])) {
            if (lastTrained[m] === undefined || diffHours < lastTrained[m]) {
              lastTrained[m] = diffHours;
            }
          }
        }
      }

      for (const m of Object.keys(MUSCLE_NAMES_SL)) {
        const h = lastTrained[m];
        if (h === undefined || h >= 168) {
          colors[m] = '#2A313A'; // Počiva (7+ dni)
        } else if (h < 24) {
          colors[m] = '#FF3D00'; // Utrujeno (<24h)
        } else if (h < 72) {
          colors[m] = '#FF9F0A'; // Obremenjeno (<72h)
        } else {
          colors[m] = '#30D158'; // Sveže (3-7 dni)
        }
      }
    }

    // Pobarvaj poligone v SVG
    const polys = svg.querySelectorAll('polygon');
    polys.forEach(p => {
      const onclickAttr = p.getAttribute('onclick') || '';
      const match = onclickAttr.match(/selectMuscleGroup\('([^']+)'\)/);
      if (match && match[1]) {
        const m = match[1];
        if (colors[m]) {
          p.setAttribute('fill', colors[m]);
        }
      }
    });
  }

  // ========== JAVNI API ==========
  const WorkoutUI = {
    // Pure Helpers (za Node teste)
    formatDuration,
    fillFromPrevious,
    mergeParsed,
    calculatePlates,
    generateWarmups,
    estimate1RM,
    calculateVolume,
    detectPRs,
    previousSets,
    toObsidianMarkdown,
    fallbackParseText,

    // UI & Življenjski cikel
    mount,
    renderDashboard,
    renderBodyMapColors,
    startNewWorkout,
    discardActiveWorkout,
    openActiveModal,
    closeActiveModal,
    saveAndFinishWorkout,
    getWorkouts,
    getActiveWorkout: () => activeWorkout,
    getSettings,
    getDb: () => cachedDb,
    setExerciseDb: db => { cachedDb = db; },
    ensureExerciseDb,

    // Izbirnik vaj
    openPicker,
    closePicker,
    onPickerSearch,
    onPickerChip,
    onExercisePicked,
    showCustomExercisePrompt,

    // Počitek (Rest timer)
    startRestTimer,
    adjustRest: adjustRestTimer,
    skipRest: skipRestTimer,

    // AI Vnos
    openAiModal,
    closeAiModal,
    toggleSpeechRecognition,
    onPhotoSelected,
    clearPhoto,
    executeAiParse,

    // Dogodki serij
    cycleSetType,
    toggleSetDone,
    addSet,
    removeSet,
    removeExercise,
    moveExercise,
    toggleSupersetLink,
    toggleExerciseMenu,
    onSetWeightChange,
    onSetRepsChange,
    onSetRirChange,
    onActiveWorkoutNameChange,
    onExerciseNoteChange,
    addExerciseToActive,

    // Modali
    openSummaryModal,
    closeSummaryModal,
    openDetailModal,
    closeDetailModal,
    repeatWorkoutFromDetail,
    copyWorkoutAsMarkdown,
    deleteWorkout,
    openStatsModal,
    closeStatsModal,
    openPlatesModalForExercise,
    closePlatesModal,
    recalcPlates,
    openWarmupModalForExercise,
    closeWarmupModal,
    recalcWarmups,
    insertWarmupsToActive,
    openSettingsModal,
    closeSettingsModal,
    saveSettingsForm,
    openTemplateModal,
    closeTemplateModal,
    pickTemplate,
    importGoogleHealthWorkouts,
    toggleHistoryExpanded
  };

  // UMD izvoz
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkoutUI;
  }
  if (typeof window !== 'undefined') {
    window.WorkoutUI = WorkoutUI;
    // Samodejni mount ob zagonu v brskalniku
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => WorkoutUI.mount());
    } else {
      setTimeout(() => WorkoutUI.mount(), 0);
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
