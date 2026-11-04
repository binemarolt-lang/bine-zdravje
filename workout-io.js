/**
 * Bine Zdravje — WorkoutIO: Hevy CSV import, Strong CSV import, CSV export, Obsidian markdown export.
 * Podatkovni model skladno s trening-roj/POGODBA.md.
 */
(function (root) {
  'use strict';

  const LB_TO_KG = 0.45359237;

  const roundWeight = w => (w == null || isNaN(w)) ? null : Math.round(Number(w) * 100) / 100;

  // Month lookup for multi-language date exports (EN, FR, ES, PT, DE, IT)
  const MON = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    janv: 1, fevr: 2, mars: 3, avri: 4, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9, octo: 10, nove: 11, dece: 12,
    ene: 1, fev: 2, abr: 4, ago: 8, set: 9, out: 10, dic: 12,
    mrz: 3, mei: 5, okt: 10, dez: 12, maart: 3, mrt: 3,
    gen: 1, mag: 5, giu: 6, lug: 7, ott: 10,
  };

  function monthOf(w) {
    if (!w) return null;
    const k = String(w).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    return MON[k] || MON[k.slice(0, 4)] || MON[k.slice(0, 3)] || null;
  }

  const p2 = n => String(n).padStart(2, '0');

  function calendarDay(y, mo, d, h, mi, sc) {
    y = +y; mo = +mo; d = +d;
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const hasTime = h !== undefined;
    h = hasTime ? +h : 12;
    mi = mi !== undefined ? +mi : 0;
    sc = sc !== undefined ? +sc : 0;
    if (h > 23 || mi > 59 || sc > 59) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, sc));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return {
      date: `${y}-${p2(mo)}-${p2(d)}`,
      timestamp: dt.getTime(),
      hasTime
    };
  }

  function parseDateTime(s) {
    if (!s) return null;
    const v = String(s).trim();
    if (!v) return null;

    // 1) ISO / YYYY-MM-DD [HH:mm[:ss]] (with - or / or .)
    let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      return calendarDay(m[1], m[2], m[3], m[4], m[5], m[6]);
    }

    // 2) DD Mon YYYY[, HH:mm[:ss]] (e.g. "3 févr. 2026, 18:00", "22 Dec 2025 08:00")
    m = v.match(/^(\d{1,2})\s+(\p{L}{3,})\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/u);
    if (m) {
      const mo = monthOf(m[2]);
      if (mo) return calendarDay(m[3], mo, m[1], m[4], m[5], m[6]);
    }

    // 3) Mon DD, YYYY[, HH:mm[:ss]] (e.g. "Dec 22, 2025, 08:00")
    m = v.match(/^(\p{L}{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/u);
    if (m) {
      const mo = monthOf(m[1]);
      if (mo) return calendarDay(m[3], mo, m[2], m[4], m[5], m[6]);
    }

    // 4) DD/MM/YYYY or MM/DD/YYYY
    m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const [, a, b, y, h, mi, sc] = m;
      const d = +a > 12 ? a : +b > 12 ? b : a;
      const mo = d === a ? b : a;
      return calendarDay(y, mo, d, h, mi, sc);
    }

    // 5) Fallback standard Date
    const parsed = Date.parse(v);
    if (!isNaN(parsed)) {
      const dt = new Date(parsed);
      return {
        date: `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`,
        timestamp: dt.getTime(),
        hasTime: true
      };
    }
    return null;
  }

  function parseDurationMs(v) {
    if (!v) return 0;
    const s = String(v).trim();
    if (!s) return 0;
    const mh = s.match(/(\d+)\s*h/i);
    const mm = s.match(/(\d+)\s*m/i);
    const ms = s.match(/(\d+)\s*s/i);
    if (mh || mm || ms) {
      const h = mh ? parseInt(mh[1], 10) : 0;
      const m = mm ? parseInt(mm[1], 10) : 0;
      const sec = ms ? parseInt(ms[1], 10) : 0;
      return (h * 3600 + m * 60 + sec) * 1000;
    }
    if (s.includes(':')) {
      const parts = s.split(':').map(p => parseInt(p, 10) || 0);
      let sec = 0;
      if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
      return sec * 1000;
    }
    const numSec = parseFloat(s);
    if (!isNaN(numSec) && numSec > 0) {
      return Math.round(numSec * 1000);
    }
    return 0;
  }

  function toSlug(name) {
    return String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed';
  }

  function hashString(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'w_' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function formatTimestamp(ts) {
    if (!ts || isNaN(ts)) return '';
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  }

  function escapeCsv(val, alwaysQuote) {
    if (val == null || val === '') return '';
    const s = String(val);
    if (alwaysQuote || /["\r\n,]/.test(s) || /^\s|\s$/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * RFC 4180 CSV parser supporting:
   * - Quoted fields
   * - Embedded commas and quotes ("")
   * - Embedded newlines inside quotes
   * - Auto-detection of separator (, or ;)
   * - Stripping of UTF-8 BOM
   */
  function parseCSV(text) {
    if (!text) return [];
    const s = String(text).replace(/^\uFEFF/, '');
    if (!s.trim()) return [];

    let firstNl = s.search(/[\r\n]/);
    const head = (firstNl < 0 ? s : s.slice(0, firstNl)).replace(/"[^"]*"/g, '');
    const countSemi = (head.match(/;/g) || []).length;
    const countComma = (head.match(/,/g) || []).length;
    const countTab = (head.match(/\t/g) || []).length;
    let sep = ',';
    if (countSemi > countComma && countSemi >= countTab) sep = ';';
    else if (countTab > countComma && countTab > countSemi) sep = '\t';

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const len = s.length;

    for (let i = 0; i < len; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < len && s[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === sep) {
          row.push(field);
          field = '';
        } else if (c === '\n' || c === '\r') {
          if (c === '\r' && i + 1 < len && s[i + 1] === '\n') {
            i++;
          }
          row.push(field);
          field = '';
          if (row.some(x => x.trim() !== '')) rows.push(row);
          row = [];
        } else {
          field += c;
        }
      }
    }
    row.push(field);
    if (row.some(x => x.trim() !== '')) rows.push(row);
    return rows;
  }

  const normHeader = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const COL_ALIASES = {
    title: ['title', 'workoutname', 'workout', 'workouttitle'],
    startTime: ['starttime', 'startdate', 'date', 'workoutdate'],
    endTime: ['endtime', 'enddate'],
    duration: ['duration', 'time', 'length'],
    durationSeconds: ['durationseconds'],
    seconds: ['seconds', 'sec'],
    workoutNotes: ['workoutnotes', 'workoutnote', 'description'],
    exerciseNotes: ['exercisenotes', 'exercisenote'],
    notes: ['notes', 'note', 'comment', 'comments'],
    exercise: ['exercisetitle', 'exercisename', 'exercise'],
    supersetId: ['supersetid', 'superset'],
    setIndex: ['setindex', 'setorder', 'set'],
    setType: ['settype', 'type', 'kind'],
    weightKg: ['weightkg'],
    weightLb: ['weightlbs', 'weightlb'],
    weight: ['weight'],
    weightUnit: ['weightunit', 'unit'],
    reps: ['reps', 'repetitions'],
    distanceKm: ['distancekm'],
    distance: ['distance'],
    distanceUnit: ['distanceunit'],
    rpe: ['rpe', 'rperating'],
    rir: ['rir', 'repsinreserve'],
  };

  function mapColumns(headerRow) {
    const cols = {};
    const normCols = headerRow.map(normHeader);

    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      cols[key] = -1;
      for (let i = 0; i < normCols.length; i++) {
        if (aliases.includes(normCols[i])) {
          cols[key] = i;
          break;
        }
      }
    }
    return cols;
  }

  function resolveExercise(name, matcher) {
    const cleanName = String(name || '').trim();
    if (matcher) {
      let match = null;
      if (typeof matcher.best === 'function') {
        match = matcher.best(cleanName);
      } else if (typeof matcher === 'function') {
        match = matcher(cleanName);
      }
      if (match && match.id) {
        return {
          exId: match.id,
          name: match.sl || match.name || cleanName
        };
      }
    }
    return {
      exId: 'custom:' + toSlug(cleanName),
      name: cleanName
    };
  }

  function importParsedRows(rows, matcher, opts) {
    opts = opts || {};
    if (!rows || rows.length < 2) return [];

    const cols = mapColumns(rows[0]);
    if (cols.startTime === -1 || cols.exercise === -1) return [];

    const workoutMap = new Map();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const dateVal = row[cols.startTime];
      const dateInfo = parseDateTime(dateVal);
      if (!dateInfo) continue;

      const title = cols.title !== -1 && row[cols.title] ? String(row[cols.title]).trim() : '';
      const sessionKey = dateInfo.hasTime
        ? `${dateInfo.date}|${dateInfo.timestamp}|${title}`
        : `${dateInfo.date}|${title}`;

      let workout = workoutMap.get(sessionKey);
      if (!workout) {
        workout = {
          id: hashString(sessionKey),
          date: dateInfo.date,
          start: dateInfo.timestamp,
          end: null,
          name: title || 'Trening',
          notes: undefined,
          bodyweight: null,
          exercises: [],
          source: 'import'
        };
        workoutMap.set(sessionKey, workout);
      }

      // Check workout end time or duration
      if (workout.end == null) {
        if (cols.endTime !== -1 && row[cols.endTime]) {
          const endInfo = parseDateTime(row[cols.endTime]);
          if (endInfo && endInfo.timestamp) workout.end = endInfo.timestamp;
        } else if (cols.duration !== -1 && row[cols.duration]) {
          const durMs = parseDurationMs(row[cols.duration]);
          if (durMs > 0) workout.end = workout.start + durMs;
        }
      }

      // Check workout notes / description
      if (!workout.notes) {
        let wNote = '';
        if (cols.workoutNotes !== -1 && row[cols.workoutNotes]) {
          wNote = String(row[cols.workoutNotes]).trim();
        }
        if (wNote) {
          workout.notes = wNote.replace(/\\r\\n|\\n/g, '\n');
        }
      }

      // Exercise name
      const exNameRaw = cols.exercise !== -1 && row[cols.exercise] ? String(row[cols.exercise]).trim() : '';
      if (!exNameRaw) continue;

      // Weight and unit
      let w = null;
      let isLb = false;
      if (cols.weightKg !== -1 && row[cols.weightKg] !== '' && row[cols.weightKg] !== undefined) {
        w = parseFloat(row[cols.weightKg]);
      } else if (cols.weightLb !== -1 && row[cols.weightLb] !== '' && row[cols.weightLb] !== undefined) {
        w = parseFloat(row[cols.weightLb]);
        isLb = true;
      } else if (cols.weight !== -1 && row[cols.weight] !== '' && row[cols.weight] !== undefined) {
        w = parseFloat(row[cols.weight]);
        if (cols.weightUnit !== -1 && row[cols.weightUnit]) {
          const u = String(row[cols.weightUnit]).toLowerCase().trim();
          if (u.startsWith('lb')) isLb = true;
        } else if (opts.unit === 'lb') {
          isLb = true;
        }
      }

      if (w !== null && !isNaN(w)) {
        if (isLb) w = roundWeight(w * LB_TO_KG);
        else w = roundWeight(w);
        if (w === 0) w = null;
      } else {
        w = null;
      }

      // Seconds (set duration / timed hold)
      let sec = null;
      if (cols.durationSeconds !== -1 && row[cols.durationSeconds] !== '' && row[cols.durationSeconds] !== undefined) {
        const parsedSec = parseInt(row[cols.durationSeconds], 10);
        if (!isNaN(parsedSec) && parsedSec > 0) sec = parsedSec;
      } else if (cols.seconds !== -1 && row[cols.seconds] !== '' && row[cols.seconds] !== undefined) {
        const parsedSec = parseInt(row[cols.seconds], 10);
        if (!isNaN(parsedSec) && parsedSec > 0) sec = parsedSec;
      }

      // Reps
      let reps = null;
      if (cols.reps !== -1 && row[cols.reps] !== '' && row[cols.reps] !== undefined) {
        const parsedReps = parseInt(row[cols.reps], 10);
        if (!isNaN(parsedReps)) {
          reps = parsedReps > 0 ? parsedReps : (sec != null && sec > 0 ? null : parsedReps);
        }
      }

      // Set type
      let setType = 'normal';
      let typeVal = '';
      if (cols.setType !== -1 && row[cols.setType]) {
        typeVal = String(row[cols.setType]).trim();
      } else if (cols.setIndex !== -1 && row[cols.setIndex]) {
        const si = String(row[cols.setIndex]).trim();
        if (/^[WDF]$/i.test(si)) typeVal = si;
      }

      if (/warm/i.test(typeVal) || /^w$/i.test(typeVal)) {
        setType = 'warmup';
      } else if (/drop/i.test(typeVal) || /^d$/i.test(typeVal)) {
        setType = 'drop';
      } else if (/fail/i.test(typeVal) || /^f$/i.test(typeVal)) {
        setType = 'failure';
      }

      // RPE and RIR
      let rpe = null;
      let rir = null;
      if (cols.rpe !== -1 && row[cols.rpe] !== '' && row[cols.rpe] !== undefined) {
        const parsedRpe = parseFloat(row[cols.rpe]);
        if (!isNaN(parsedRpe) && parsedRpe >= 0 && parsedRpe <= 10) {
          rpe = parsedRpe;
          rir = Math.max(0, Math.round((10 - rpe) * 10) / 10);
        }
      }
      if (cols.rir !== -1 && row[cols.rir] !== '' && row[cols.rir] !== undefined) {
        const parsedRir = parseFloat(row[cols.rir]);
        if (!isNaN(parsedRir) && parsedRir >= 0) {
          rir = parsedRir;
          if (rpe === null && rir <= 10) {
            rpe = Math.max(0, Math.round((10 - rir) * 10) / 10);
          }
        }
      }

      // Superset ID
      const supersetId = (cols.supersetId !== -1 && row[cols.supersetId] !== '' && row[cols.supersetId] !== undefined)
        ? String(row[cols.supersetId]).trim()
        : null;

      // Exercise resolution
      const { exId, name: resolvedName } = resolveExercise(exNameRaw, matcher);

      // Exercise notes
      const exNote = (cols.exerciseNotes !== -1 && row[cols.exerciseNotes])
        ? String(row[cols.exerciseNotes]).trim()
        : (cols.notes !== -1 && cols.workoutNotes !== cols.notes && row[cols.notes])
          ? String(row[cols.notes]).trim()
          : '';

      let ex = workout.exercises.find(e => e.exId === exId && (e.supersetId || null) === (supersetId || null));
      if (!ex) {
        ex = {
          exId,
          name: resolvedName,
          sets: [],
          ...(exNote ? { note: exNote } : {}),
          ...(supersetId ? { supersetId } : {})
        };
        workout.exercises.push(ex);
      } else if (exNote && !ex.note) {
        ex.note = exNote;
      }

      const wSet = {
        w,
        reps,
        ...(sec != null ? { sec } : {}),
        ...(rir != null ? { rir } : {}),
        ...(rpe != null ? { rpe } : {}),
        type: setType,
        done: true
      };
      ex.sets.push(wSet);
    }

    const workouts = Array.from(workoutMap.values());
    workouts.sort((a, b) => (a.start || 0) - (b.start || 0) || a.date.localeCompare(b.date));
    return workouts;
  }

  function importHevyCsv(text, matcher, opts) {
    const rows = parseCSV(text);
    return importParsedRows(rows, matcher, opts);
  }

  function importStrongCsv(text, matcher, opts) {
    const rows = parseCSV(text);
    return importParsedRows(rows, matcher, opts);
  }

  function importCsv(text, matcher, opts) {
    const rows = parseCSV(text);
    return importParsedRows(rows, matcher, opts);
  }

  /**
   * Export workouts into Hevy-compatible CSV.
   * Header: title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe
   */
  function exportCsv(workouts) {
    const list = Array.isArray(workouts) ? workouts : (workouts ? [workouts] : []);
    const header = [
      'title', 'start_time', 'end_time', 'description', 'exercise_title',
      'superset_id', 'exercise_notes', 'set_index', 'set_type',
      'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe'
    ];

    const lines = [header.map(h => `"${h}"`).join(',')];

    for (const w of list) {
      const title = w.name || 'Trening';
      const startTime = formatTimestamp(w.start);
      const endTime = w.end ? formatTimestamp(w.end) : '';
      const desc = w.notes || '';

      for (const ex of w.exercises || []) {
        const exTitle = ex.name || ex.exId;
        const supersetId = ex.supersetId != null ? ex.supersetId : '';
        const exNote = ex.note || '';

        const sets = ex.sets || [];
        for (let i = 0; i < sets.length; i++) {
          const s = sets[i];
          let setType = 'normal';
          if (s.type === 'warmup') setType = 'warmup';
          else if (s.type === 'drop') setType = 'drop_set';
          else if (s.type === 'failure') setType = 'failure';

          const weightKg = s.w != null ? s.w : '';
          const reps = s.reps != null ? s.reps : '';
          const distanceKm = s.distanceKm != null ? s.distanceKm : '';
          const durationSeconds = s.sec != null ? s.sec : '';
          const rpe = s.rpe != null ? s.rpe : (s.rir != null ? Math.max(0, 10 - s.rir) : '');

          const row = [
            escapeCsv(title, true),
            escapeCsv(startTime, true),
            escapeCsv(endTime, true),
            escapeCsv(desc, true),
            escapeCsv(exTitle, true),
            escapeCsv(supersetId, false),
            escapeCsv(exNote, true),
            i,
            escapeCsv(setType, true),
            escapeCsv(weightKg, false),
            escapeCsv(reps, false),
            escapeCsv(distanceKm, false),
            escapeCsv(durationSeconds, false),
            escapeCsv(rpe, false)
          ];
          lines.push(row.join(','));
        }
      }
    }

    return lines.join('\r\n') + '\r\n';
  }

  function isIdentical(a, b) {
    return (a.w ?? null) === (b.w ?? null) &&
           (a.reps ?? null) === (b.reps ?? null) &&
           (a.sec ?? null) === (b.sec ?? null) &&
           (a.rir ?? null) === (b.rir ?? null) &&
           (a.rpe ?? null) === (b.rpe ?? null);
  }

  /**
   * Format workout to Bine's Obsidian markdown log:
   * # Trening YYYY-MM-DD — <name>
   * - <sl or name> — 3 × 8 @ 80 kg (RIR 2)
   * - <sl or name> — serije: 80×8, 85×6
   *
   * Volumen: 1840 kg
   * Trajanje: 60 min
   */
  function toObsidianMarkdown(workout, db) {
    if (!workout) return '';
    const date = workout.date || (workout.start ? new Date(workout.start).toISOString().slice(0, 10) : '');
    const headerTitle = workout.name ? `# Trening ${date} — ${workout.name}` : `# Trening ${date}`;

    const lines = [headerTitle, ''];

    const exList = Array.isArray(db) ? db : ((db && db.exercises) ? db.exercises : []);
    const exMap = new Map();
    for (const e of exList) {
      if (e && e.id) exMap.set(e.id, e);
    }

    for (const ex of workout.exercises || []) {
      const def = exMap.get(ex.exId);
      const displayName = def?.sl || def?.name || ex.name || ex.exId;

      const validSets = (ex.sets || []).filter(s => s.done !== false);
      const workSets = validSets.filter(s => s.type !== 'warmup');
      const sets = workSets.length > 0 ? workSets : validSets;

      if (!sets.length) continue;

      let setDesc = '';
      if (sets.length > 0 && sets.every(s => isIdentical(s, sets[0]))) {
        // All sets identical
        const first = sets[0];
        const count = sets.length;
        let effortStr = '';
        if (first.rir != null) effortStr = ` (RIR ${first.rir})`;
        else if (first.rpe != null) effortStr = ` (RPE ${first.rpe})`;

        if (first.w != null && first.w > 0 && first.reps != null) {
          setDesc = `${count} × ${first.reps} @ ${first.w} kg${effortStr}`;
        } else if (first.reps != null && (first.w == null || first.w === 0)) {
          setDesc = `${count} × ${first.reps}${effortStr}`;
        } else if (first.sec != null && (!first.reps || first.reps === 0)) {
          setDesc = `${count} × ${first.sec}s${effortStr}`;
        } else {
          setDesc = `${count} × ${first.reps || 0}${effortStr}`;
        }
      } else {
        // Differing sets: serije: 80×8, 85×6
        const items = sets.map(s => {
          if (s.w != null && s.w > 0 && s.reps != null) {
            return `${s.w}×${s.reps}`;
          }
          if (s.sec != null && (!s.reps || s.reps === 0)) {
            return `${s.sec}s`;
          }
          if (s.reps != null) {
            return `${s.w != null ? s.w + '×' : ''}${s.reps}`;
          }
          return `${s.w ?? 0}×${s.reps ?? 0}`;
        });
        setDesc = `serije: ${items.join(', ')}`;
      }

      lines.push(`- ${displayName} — ${setDesc}`);
    }

    // Volume and duration
    let volumeKg = 0;
    for (const ex of workout.exercises || []) {
      for (const s of ex.sets || []) {
        if (s.done !== false && s.type !== 'warmup' && s.w && s.reps) {
          if (s.w > 0) volumeKg += s.w * s.reps;
        }
      }
    }
    volumeKg = Math.round(volumeKg);

    let durationMin = null;
    if (workout.end && workout.start && workout.end > workout.start) {
      durationMin = Math.round((workout.end - workout.start) / 60000);
    }

    lines.push('');
    lines.push(`Volumen: ${volumeKg} kg`);
    if (durationMin !== null && durationMin > 0) {
      lines.push(`Trajanje: ${durationMin} min`);
    }

    if (workout.notes) {
      lines.push('');
      lines.push(`Opombe: ${workout.notes}`);
    }

    return lines.join('\n');
  }

  const api = {
    parseCSV,
    importHevyCsv,
    importStrongCsv,
    importCsv,
    exportCsv,
    toObsidianMarkdown,
    roundWeight,
    LB_TO_KG,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.WorkoutIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
