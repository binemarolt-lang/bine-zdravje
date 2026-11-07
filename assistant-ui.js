/*
 * AI pomočnik: plavajoč gumb 🤖 + klepet (bottom sheet).
 * Pošilja kontekst na POST {endpoint}/api/assistant (glava X-Zdravje-Token).
 * Predlagane akcije se izvedejo SAMO po kliku na "Potrdi".
 *
 * Uporablja obstoječe javne vstope:
 *   WorkoutUI.getWorkouts / renderDashboard / renderBodyMapColors / getSettings
 *   addPresetFood (window), BpVision.save / getLog, saveDanesVnos + #vnosTeza,
 *   ProtocolDiary.addEntry / getTodayEntries / TIMING_SLOTS, saveBloodworkVnos + inpBio*,
 *   switchNav (window).
 */
(function (root) {
  'use strict';

  var DEFAULT_TOKEN = 'wyINc3OiLTEl3TJfidr7PrO8ekgvHKVi'; // isti kot food-vision-ui.js
  var LS_TOKEN = 'bine_zdravje_fv_token';
  var LS_ENDPOINT = 'bine_zdravje_fv_endpoint';
  var LS_WORKOUTS = 'bine_zdravje_workouts_v1';
  var LS_BP_LOG = 'bine_zdravje_tlak_log';
  var ENDPOINT_FILE = './food-vision-endpoint.json';
  var FALLBACK_ENDPOINTS = ['http://100.101.68.31:8091', 'http://127.0.0.1:8091'];
  var HISTORY_MAX = 10;
  var REQUEST_TIMEOUT_MS = 120000;
  var UNS = 'Ni podprto v aplikaciji';
  var FRIENDLY_ERROR = 'Pomočnik trenutno ni dosegljiv. Poskusi znova čez nekaj trenutkov.';
  var TOKEN_ERROR = 'Povezava s pomočnikom ni overjena. Poveži aplikacijo s QR kodo in poskusi znova.';
  var TAB_LABELS = {
    danes: 'Danes', cikel: 'Cikel', prehrana: 'Prehrana', bloodwork: 'Izvidi',
    trening: 'Trening', estetika: 'Estetika', vault: 'Vault'
  };
  var BLOODWORK_FIELDS = {
    hct: 'inpBioHct', hematokrit: 'inpBioHct',
    e2: 'inpBioE2', estradiol: 'inpBioE2',
    totalt: 'inpBioTotalT', testosteron: 'inpBioTotalT', testosterontotal: 'inpBioTotalT', skupnitestosteron: 'inpBioTotalT',
    shbg: 'inpBioSHBG',
    apob: 'inpBioApoB',
    ggt: 'inpBioGGT',
    kreatinin: 'inpBioKreatinin', creat: 'inpBioKreatinin', creatinine: 'inpBioKreatinin',
    ast: 'inpBioAST',
    alt: 'inpBioALT'
  };

  var fabEl = null, overlay = null, logEl = null, inputEl = null, sendBtn = null;
  var messages = []; // samo uspešni pogovori: {role, content}
  var busy = false;
  var greeted = false;
  var syncQueued = false;
  var attachBtn = null;
  var DATE_WARN = 'Datum ni podprt, vnese se danes';
  var DATED_TYPES = { log_food: true, log_weight: true, log_blood_pressure: true };
  var SRC_NAMES = { label: 'etiketa', off_barcode: 'OpenFoodFacts', off_search: 'OpenFoodFacts', ai: 'ocena AI' };

  // ---------- pomožne ----------
  function $(id) { return document.getElementById(id); }
  function safe(fn, fb) { try { var v = fn(); return v === undefined ? fb : v; } catch (e) { return fb; } }
  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var x = Number(v);
    return isFinite(x) ? x : null;
  }
  function str(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function normKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function bloodField(k) {
    var nk = normKey(k);
    return Object.prototype.hasOwnProperty.call(BLOODWORK_FIELDS, nk) ? BLOODWORK_FIELDS[nk] : null;
  }
  function localDate(d) {
    d = d || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function isoDaysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return localDate(d); }
  // Datum iz akcije: samo yyyy-mm-dd, ne prihodnji, ne starejši od 60 dni; sicer null.
  function validDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return (v <= localDate() && v >= isoDaysAgo(60)) ? v : null;
  }
  function foodMacrosUnknown(a) { return ['protein', 'carbs', 'fat'].some(function (k) { return num(a[k]) === null; }); }
  function uniq(x, i, arr) { return arr.indexOf(x) === i; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function ok(msg) { return { ok: true, msg: msg }; }
  function fail(msg) { return { ok: false, msg: msg }; }

  // ---------- kontekst ----------
  function compactWorkout(w) {
    return {
      datum: w.date || null,
      ime: w.name || 'Trening',
      vaje: (w.exercises || []).map(function (ex) {
        return {
          ime: ex.name,
          serije: (ex.sets || []).map(function (s) {
            return { kg: s.w, reps: s.reps, rir: s.rir == null ? null : s.rir };
          })
        };
      })
    };
  }

  // Zadnji PR po vaji: nov rekord 1RM (Epley/WorkoutUI.estimate1RM) glede na prejšnje sete iste vaje.
  function prsByExercise(workouts) {
    var chron = workouts.slice().sort(function (a, b) {
      var x = a.date || '', y = b.date || ''; return x < y ? -1 : x > y ? 1 : 0;
    });
    var best = {}, prs = {};
    chron.forEach(function (w) {
      (w.exercises || []).forEach(function (ex) {
        var name = str(ex && ex.name, 60);
        if (!name) return;
        (ex.sets || []).forEach(function (s) {
          if (!s || s.done === false) return;
          var reps = num(s.reps), kg = num(s.w);
          if (reps === null || reps < 1 || kg === null || kg <= 0) return;
          var e = num(safe(function () { return root.WorkoutUI.estimate1RM(kg, reps, num(s.rir) || 0); }, null));
          if (e === null) return;
          if (best[name] !== undefined && e > best[name] + 1e-9) {
            prs[name] = { vaja: name, datum: w.date || null, kg: kg, reps: reps, e1rm: Math.round(e * 10) / 10 };
          }
          if (best[name] === undefined || e > best[name]) best[name] = e;
        });
      });
    });
    return Object.keys(prs).map(function (k) { return prs[k]; })
      .sort(function (a, b) { return a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0; })
      .slice(0, 5);
  }

  // Tedenski povzetek (zadnjih 7 dni, vključno z danes). Serij po mišici ni v shrambi brez exercise-db, zato ni.
  function weekSummary(workouts) {
    var cutoff = isoDaysAgo(6), today = localDate();
    var ws = workouts.filter(function (w) { return w.date >= cutoff && w.date <= today; });
    var sets = 0, vol = 0;
    ws.forEach(function (w) {
      (w.exercises || []).forEach(function (ex) {
        (ex.sets || []).forEach(function (s) {
          if (!s || s.done === false || s.type === 'warmup') return;
          sets++;
          var r = num(s.reps), kg = num(s.w);
          if (r !== null && kg !== null) vol += r * kg;
        });
      });
    });
    var hist = ((root.prehranaState && root.prehranaState.weightHistory) || [])
      .filter(function (h) { return h && h.date >= cutoff && h.date <= today; });
    var kc = hist.map(function (h) { return num(h.caloriesIn); }).filter(function (x) { return x !== null && x > 0; });
    return {
      obdobje: cutoff + ' do ' + today,
      treningi: ws.length,
      serije: sets,
      volumen_kg: Math.round(vol),
      kcal_povprecje_dni_z_tezo: kc.length ? Math.round(kc.reduce(function (a, b) { return a + b; }, 0) / kc.length) : null,
      kcal_dni_v_vzorcu: kc.length,
      beljakovine_povprecje: null // ni shranjeno po dnevih (samo današnji obroki)
    };
  }

  function weight14() {
    var cutoff = isoDaysAgo(13);
    return ((root.prehranaState && root.prehranaState.weightHistory) || [])
      .filter(function (h) { return h && h.date >= cutoff; })
      .slice(-14)
      .map(function (h) { return { datum: h.date, kg: num(h.weightKg) }; });
  }

  function buildContext() {
    var workouts = safe(function () { return root.WorkoutUI.getWorkouts() || []; }, []);
    return {
      datum: localDate(),
      zavihek: safe(function () { return document.body.dataset.view || 'danes'; }, 'danes'),
      zadnji_treningi: workouts.slice(0, 5).map(compactWorkout),
      tedenski_povzetek: safe(function () { return weekSummary(workouts); }, null),
      zadnji_pr: safe(function () { return prsByExercise(workouts); }, []),
      hrana_danes: safe(function () {
        return ((root.prehranaState && root.prehranaState.meals) || []).map(function (m) {
          return { ime: m.name, kcal: m.calories, beljakovine: m.protein, ogljikovi: m.carbs, mascobe: m.fat, cas: m.time };
        });
      }, []),
      zadnji_tlak: safe(function () {
        var log = root.BpVision.getLog();
        return log.length ? log[log.length - 1] : null;
      }, null),
      teza: safe(function () {
        var ps = root.prehranaState || {};
        var h = ps.weightHistory || [];
        var last = h.length ? h[h.length - 1] : null;
        return {
          trenutna_kg: ps.weightKg == null ? null : ps.weightKg,
          zadnja_zapisana: last ? { datum: last.date, kg: last.weightKg } : null,
          zadnjih_14_dni: weight14()
        };
      }, null),
      protokol_danes: safe(function () {
        return root.ProtocolDiary.getTodayEntries().map(function (e) {
          return { snov: e.substance, odmerek: e.dose, enota: e.unit, termin: e.slot, cas: e.time };
        });
      }, [])
    };
  }

  // ---------- endpoint in klic ----------
  async function endpointCandidates() {
    var list = [];
    var manual = safe(function () { return localStorage.getItem(LS_ENDPOINT); }, null);
    if (manual) list.push(manual);
    try {
      var r = await fetch(ENDPOINT_FILE + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        var j = await r.json();
        if (j && j.url) list.push(j.url);
      }
    } catch (e) { /* ignoriramo, uporabimo rezerve */ }
    FALLBACK_ENDPOINTS.forEach(function (f) { list.push(f); });
    var clean = list
      .map(function (u) { return String(u).replace(/\/$/, ''); })
      .filter(function (u) { return !(location.protocol === 'https:' && u.indexOf('http:') === 0); });
    return clean.filter(function (u, i) { return clean.indexOf(u) === i; });
  }

  function getToken() {
    var t = safe(function () { return localStorage.getItem(LS_TOKEN); }, null);
    return t && t.trim() ? t.trim() : DEFAULT_TOKEN;
  }

  async function callAssistant(message, history, context) {
    var token = getToken();
    var eps = await endpointCandidates();
    var lastErr = null;
    for (var i = 0; i < eps.length; i++) {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
      try {
        var r = await fetch(eps[i] + '/api/assistant', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'X-Zdravje-Token': token },
          body: JSON.stringify({ message: message, history: history, context: context })
        });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) {
          lastErr = new Error(j.error || ('HTTP ' + r.status));
          lastErr.status = r.status;
          if (r.status === 401) break; // napačen žeton: drugi naslovi ne bodo pomagali
          continue;
        }
        return j;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(to);
      }
    }
    throw lastErr || new Error('Ni endpointa');
  }

  // ---------- zmogljivost in opis akcij ----------
  function capability(a) {
    if (!a || typeof a !== 'object') return { ok: false };
    switch (a.type) {
      case 'log_workout':
        return { ok: !!(root.WorkoutUI && typeof root.WorkoutUI.getWorkouts === 'function') };
      case 'log_food':
        return { ok: typeof root.addPresetFood === 'function' };
      case 'log_blood_pressure':
        return { ok: !!(root.BpVision && typeof root.BpVision.save === 'function') };
      case 'log_weight':
        return { ok: !!$('vnosTeza') && typeof root.saveDanesVnos === 'function' };
      case 'log_protocol':
        return { ok: !!(root.ProtocolDiary && typeof root.ProtocolDiary.addEntry === 'function') };
      case 'update_bloodwork': {
        var markers = a.markers && typeof a.markers === 'object' ? a.markers : {};
        var anyField = Object.keys(markers).some(function (k) { var f = bloodField(k); return f && $(f); });
        return { ok: typeof root.saveBloodworkVnos === 'function' && anyField };
      }
      case 'switch_tab':
        return { ok: typeof root.switchNav === 'function' && Object.prototype.hasOwnProperty.call(TAB_LABELS, a.tab) };
      default:
        return { ok: false };
    }
  }

  function describeAction(a) {
    var d = { title: 'Predlog', lines: [], warn: null };
    var today = localDate();
    var warns = [];
    switch (a && a.type) {
      case 'log_workout':
        d.title = 'Trening: ' + (str(a.name, 80) || 'Trening');
        if (a.date && a.date !== today) d.lines.push('Datum: ' + a.date);
        (a.exercises || []).forEach(function (ex) {
          var sets = (ex.sets || []).map(function (s) {
            return (s.w != null ? s.w + ' kg × ' : '') + s.reps + (s.rir != null ? ' (RIR ' + s.rir + ')' : '');
          });
          d.lines.push(ex.name + ': ' + sets.join(', '));
        });
        break;
      case 'log_food': {
        var unknown = foodMacrosUnknown(a);
        d.title = (unknown ? 'Obrok (ocena): ' : 'Obrok: ') + (a.meal_name || '');
        d.lines.push(a.kcal + ' kcal · ' + (unknown
          ? 'makri: ocena, niso znani (ne zapišejo se kot 0)'
          : 'B ' + (a.protein || 0) + ' g · OH ' + (a.carbs || 0) + ' g · M ' + (a.fat || 0) + ' g'));
        if (a._source) d.lines.push(a._source);
        break;
      }
      case 'log_blood_pressure':
        d.title = 'Krvni tlak';
        d.lines.push(a.sys + '/' + a.dia + ' mmHg' + (a.pulse != null ? ' · pulz ' + a.pulse : ''));
        break;
      case 'log_weight':
        d.title = 'Teža';
        d.lines.push(a.kg + ' kg');
        break;
      case 'log_protocol':
        d.title = 'Protokol';
        d.lines.push(a.substance + ' — ' + a.dose + ' ' + (a.unit || '') + (a.slot ? ' · ' + a.slot : ''));
        break;
      case 'update_bloodwork': {
        d.title = 'Izvidi';
        var markers = a.markers && typeof a.markers === 'object' ? a.markers : {};
        var skipped = [];
        Object.keys(markers).slice(0, 50).forEach(function (k) {
          if (bloodField(k)) d.lines.push(k + ': ' + markers[k]);
          else skipped.push(k);
        });
        if (skipped.length) d.warn = UNS + ': ' + skipped.join(', ');
        break;
      }
      case 'switch_tab':
        d.title = 'Zavihek: ' + (TAB_LABELS[a.tab] || a.tab);
        break;
      default:
        d.title = 'Neznan predlog';
    }
    if (a && a.date && a.date !== today && DATED_TYPES[a.type]) warns.push(DATE_WARN);
    if (d.warn) warns.unshift(d.warn);
    if (!capability(a).ok) warns.push(UNS);
    d.warn = warns.length ? warns.join(' · ') : null;
    return d;
  }

  // ---------- izvedba (samo po potrditvi) ----------
  function applyWorkout(a) {
    var exercises = (a.exercises || []).slice(0, 20).map(function (ex) {
      var name = str(ex && ex.name, 60);
      var sets = ((ex && ex.sets) || []).slice(0, 12).map(function (s) {
        var reps = num(s && s.reps), w = num(s && s.w);
        if (reps === null || reps < 1) return null;
        var set = { w: w === null ? 0 : w, reps: Math.round(reps), type: 'normal', done: true };
        var rir = num(s && s.rir);
        if (rir !== null) set.rir = rir;
        return set;
      }).filter(Boolean);
      return name && sets.length ? { exId: 'custom:' + slug(name), name: name, sets: sets, note: '', supersetId: null } : null;
    }).filter(Boolean);
    if (!exercises.length) return fail('Trening nima veljavnih vaj.');

    var now = Date.now();
    var workout = {
      id: 'w_' + now,
      date: validDate(a.date) || localDate(),
      start: now,
      end: now,
      name: str(a.name, 80) || 'Trening',
      notes: '',
      bodyweight: safe(function () { return root.WorkoutUI.getSettings().bodyweight; }, 80),
      exercises: exercises,
      source: 'assistant'
    };
    var list = root.WorkoutUI.getWorkouts();
    if (!Array.isArray(list)) list = [];
    list.unshift(workout);
    localStorage.setItem(LS_WORKOUTS, JSON.stringify(list));
    safe(function () { root.WorkoutUI.renderDashboard(); });
    safe(function () { root.WorkoutUI.renderBodyMapColors(); });
    return ok('Trening dodan v dnevnik.');
  }

  function applyFood(a) {
    var meal = str(a.meal_name, 80);
    var kcal = num(a.kcal);
    if (!meal || kcal === null) return fail('Manjkajo podatki o obroku.');
    var unknown = foodMacrosUnknown(a);
    root.addPresetFood({
      name: unknown ? meal + ' (ocena)' : meal,
      serving: '1 porcija',
      calories: kcal,
      protein: num(a.protein) || 0,
      carbs: num(a.carbs) || 0,
      fat: num(a.fat) || 0
    });
    if (unknown) {
      // addPresetFood zapiše 0 kjer ni vrednosti; neznane makre popravimo na null (v pomnilniku in shrambi).
      safe(function () {
        var list = root.prehranaState.meals;
        var last = list[list.length - 1];
        ['protein', 'carbs', 'fat'].forEach(function (k) { if (num(a[k]) === null) last[k] = null; });
        localStorage.setItem('bine_zdravje_meals_v2', JSON.stringify(list));
        if (typeof root.renderPrehranaView === 'function') root.renderPrehranaView();
      });
      return ok('Obrok dodan v Prehrano (makri niso znani, ocena).');
    }
    return ok('Obrok dodan v Prehrano.');
  }

  function applyBp(a) {
    var sys = num(a.sys), dia = num(a.dia), pulse = num(a.pulse);
    if (sys === null || dia === null) return fail('Manjkata vrednosti tlaka.');
    sys = Math.round(sys); dia = Math.round(dia);
    var pulseR = pulse === null ? null : Math.round(pulse);
    root.BpVision.save(sys, dia, pulseR);
    // Opomba gre kot dodatno polje `note` v zadnji zapis dnevnika (obstoječi bralniki ga ignorirajo).
    var note = str(a.note, 160);
    if (note) {
      safe(function () {
        var log = root.BpVision.getLog();
        var last = log[log.length - 1];
        if (last && last.sys === sys && last.dia === dia) {
          last.note = note;
          localStorage.setItem(LS_BP_LOG, JSON.stringify(log));
        }
      });
    }
    return ok('Tlak shranjen: ' + sys + '/' + dia + '.');
  }

  // Zgodovina teže (prehranaState.weightHistory): en zapis na dan, današnji se prepiše.
  function recordWeightHistory(kg) {
    var ps = root.prehranaState;
    if (!ps) return;
    if (!Array.isArray(ps.weightHistory)) ps.weightHistory = [];
    var today = localDate();
    var kcalToday = (ps.meals || []).reduce(function (s, m) { return s + (Number(m.calories) || 0); }, 0);
    var idx = -1;
    ps.weightHistory.forEach(function (h, i) { if (h && h.date === today) idx = i; });
    if (idx >= 0) {
      ps.weightHistory[idx].weightKg = kg;
    } else {
      ps.weightHistory.push({ date: today, weightKg: kg, caloriesIn: kcalToday });
      ps.weightHistory.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
    }
    if (typeof root.savePrehranaState === 'function') root.savePrehranaState();
    if (typeof root.renderTdeeHistoryTable === 'function') root.renderTdeeHistoryTable();
    if (typeof root.renderPrehranaView === 'function') root.renderPrehranaView();
  }

  function applyWeight(a) {
    var kg = num(a.kg);
    if (kg === null || kg < 20 || kg > 300) return fail('Neveljavna teža.');
    var input = $('vnosTeza');
    input.value = String(Math.round(kg * 10) / 10);
    root.saveDanesVnos(); // obstoječi mehanizem Danes → teža
    safe(function () { recordWeightHistory(Math.round(kg * 10) / 10); });
    return ok('Teža shranjena: ' + input.value + ' kg.');
  }

  function applyProtocol(a) {
    var PD = root.ProtocolDiary;
    var substance = str(a.substance, 60);
    var dose = num(a.dose);
    if (!substance || dose === null) return fail('Manjkajo podatki o protokolu.');
    var slots = PD.TIMING_SLOTS || {};
    var slotKey = typeof a.slot === 'string' ? a.slot.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
    var slot = Object.prototype.hasOwnProperty.call(slots, slotKey) ? slotKey : 'CUSTOM';
    var unit = str(a.unit, 20) || 'mg';
    PD.addEntry({ substance: substance, dose: String(dose), unit: unit, slot: slot, notes: '' });
    safe(function () { root.ProtocolDiaryUI.renderTodayWidget(); });
    return ok('Protokol zabeležen: ' + substance + ' ' + dose + ' ' + unit + '.');
  }

  function applyBloodwork(a) {
    var markers = a.markers && typeof a.markers === 'object' ? a.markers : {};
    var applied = [], skipped = [];
    Object.keys(markers).slice(0, 50).forEach(function (k) {
      var id = bloodField(k);
      var input = id ? $(id) : null;
      var v = markers[k];
      if (!input || typeof v !== 'number' || !isFinite(v)) { skipped.push(k); return; }
      input.value = v;
      applied.push(k);
    });
    if (!applied.length) return fail(UNS + ': ' + skipped.join(', '));
    root.saveBloodworkVnos(); // obstoječi mehanizem izvidov
    return ok('Izvidi posodobljeni: ' + applied.join(', ') +
      (skipped.length ? ' (' + UNS.toLowerCase() + ': ' + skipped.join(', ') + ')' : ''));
  }

  function applyTab(a) {
    closeSheet();
    root.switchNav(a.tab);
    return ok('Odprt zavihek: ' + TAB_LABELS[a.tab] + '.');
  }

  function applyAction(a) {
    if (!capability(a).ok) return fail(UNS);
    try {
      switch (a.type) {
        case 'log_workout': return applyWorkout(a);
        case 'log_food': return applyFood(a);
        case 'log_blood_pressure': return applyBp(a);
        case 'log_weight': return applyWeight(a);
        case 'log_protocol': return applyProtocol(a);
        case 'update_bloodwork': return applyBloodwork(a);
        case 'switch_tab': return applyTab(a);
        default: return fail(UNS);
      }
    } catch (e) {
      console.error('[AssistantUI] izvedba akcije ni uspela', e);
      return fail('Ni uspelo shraniti. Poskusi znova.');
    }
  }

  // ---------- UI ----------
  function scrollToBottom() {
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function appendBubble(role, text, opts) {
    var b = el('div', 'as-msg ' + role + (opts && opts.error ? ' error' : '') + (opts && opts.typing ? ' as-typing' : ''), text);
    logEl.appendChild(b);
    scrollToBottom();
    return b;
  }

  function setStatus(node, text, isError) {
    node.textContent = text;
    node.classList.toggle('is-error', !!isError);
    node.hidden = false;
  }

  function appendActionCard(a) {
    var d = describeAction(a);
    var cap = capability(a);
    var card = el('div', 'as-card');
    card.appendChild(el('div', 'as-card-title', d.title));
    d.lines.forEach(function (ln) { card.appendChild(el('div', 'as-card-body', ln)); });
    if (d.warn) card.appendChild(el('div', 'as-card-warn', d.warn));

    var status = el('div', 'as-card-status');
    status.hidden = true;
    card.appendChild(status);

    var row = el('div', 'as-card-actions');
    var noBtn = el('button', 'as-btn as-btn-no', 'Zavrni');
    var okBtn = el('button', 'as-btn as-btn-ok', 'Potrdi');
    noBtn.type = 'button';
    okBtn.type = 'button';
    okBtn.disabled = !cap.ok;

    okBtn.addEventListener('click', function () {
      okBtn.disabled = true;
      noBtn.disabled = true;
      var res = applyAction(a);
      if (res.ok) {
        card.classList.add('is-done');
        row.remove();
        setStatus(status, '✓ ' + res.msg, false);
      } else {
        okBtn.disabled = false;
        noBtn.disabled = false;
        setStatus(status, res.msg, true);
      }
    });
    noBtn.addEventListener('click', function () {
      card.classList.add('is-rejected');
      row.remove();
      setStatus(status, 'Zavrnjeno.', false);
    });

    row.appendChild(noBtn);
    row.appendChild(okBtn);
    card.appendChild(row);
    logEl.appendChild(card);
    scrollToBottom();
  }

  function openSheet() {
    if (!overlay) return;
    if (!greeted) {
      greeted = true;
      appendBubble('assistant', 'Zdravo! Lahko pogledam tvoje podatke ali predlagam vnos (trening, obrok, tlak, teža, protokol, izvid). Ničesar ne shranim brez tvoje potrditve.');
    }
    overlay.classList.add('open');
    scrollToBottom();
    setTimeout(function () { if (inputEl) inputEl.focus({ preventScroll: true }); }, 250);
  }

  function closeSheet() {
    if (!overlay) return;
    overlay.classList.remove('open');
    if (inputEl) inputEl.blur();
  }

  function autosize() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  async function send() {
    if (busy || !inputEl) return;
    var text = inputEl.value.trim();
    if (!text) return;
    busy = true;
    sendBtn.disabled = true;

    var history = messages.slice(-HISTORY_MAX).map(function (m) { return { role: m.role, content: m.content }; });
    inputEl.value = '';
    autosize();
    appendBubble('user', text);
    var typing = appendBubble('assistant', 'Razmišljam…', { typing: true });

    try {
      var data = await callAssistant(text, history, buildContext());
      typing.remove();
      var reply = String((data && data.reply) || '').trim() || '…';
      appendBubble('assistant', reply);
      messages.push({ role: 'user', content: text });
      messages.push({ role: 'assistant', content: reply });
      var actions = data && Array.isArray(data.actions) ? data.actions : [];
      actions.forEach(appendActionCard);
    } catch (e) {
      typing.remove();
      console.warn('[AssistantUI]', e);
      var unauth = e && e.status === 401;
      appendBubble('assistant', unauth ? TOKEN_ERROR : FRIENDLY_ERROR, { error: true });
    } finally {
      busy = false;
      sendBtn.disabled = false;
      scrollToBottom();
    }
  }

  // ---------- POST z istim žetonom in endpointi (generično) ----------
  async function postApi(path, body, timeoutMs) {
    var token = getToken();
    var eps = await endpointCandidates();
    var lastErr = null;
    for (var i = 0; i < eps.length; i++) {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, timeoutMs);
      try {
        var r = await fetch(eps[i] + path, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'X-Zdravje-Token': token },
          body: JSON.stringify(body)
        });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) {
          lastErr = new Error(j.error || ('HTTP ' + r.status));
          lastErr.status = r.status;
          if (r.status === 401) break;
          continue;
        }
        return j;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Strežnik se ni odzval pravočasno.') : e;
      } finally {
        clearTimeout(to);
      }
    }
    throw lastErr || new Error('Ni endpointa');
  }

  // Fotografija -> največ 1280 px, JPEG (manjši prenos; server sprejme do 6 MB).
  function resizeImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var s = Math.min(1, maxSide / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s));
          c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (e) { reject(e); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Slike ni mogoče odpreti.')); };
      img.src = url;
    });
  }

  // Odgovor /api/food-photo -> akcija log_food (predlog; shrani se šele po Potrdi).
  function photoToAction(j) {
    var items = Array.isArray(j && j.items) ? j.items : [];
    if (!items.length) return { empty: 'Na sliki ne vidim hrane.' };
    var tot = { kcal: 0, protein: 0, carbs: 0, fat: 0 }, srcs = [], names = [];
    items.forEach(function (it) {
      var p = (it && it.per100g) || {}, f = (num(it && it.grams) || 0) / 100;
      tot.kcal += (num(p.kcal) || 0) * f;
      tot.protein += (num(p.protein) || 0) * f;
      tot.carbs += (num(p.carbs) || 0) * f;
      tot.fat += (num(p.fat) || 0) * f;
      srcs.push((it && it.source) || 'ai');
      names.push(str(it && it.name, 40));
    });
    if (tot.kcal <= 0) return { empty: 'Iz fotografije nisem dobil zanesljivih vrednosti. Vnesi obrok ročno.' };
    var labels = srcs.filter(uniq).map(function (k) { return SRC_NAMES[k] || 'ocena'; }).filter(uniq);
    var estimate = srcs.indexOf('ai') >= 0;
    var r1 = function (x) { return Math.round(x * 10) / 10; };
    return {
      type: 'log_food',
      meal_name: str(j.meal_name, 80) || names.filter(Boolean).join(', ').slice(0, 80) || 'Obrok s fotografije',
      kcal: Math.round(tot.kcal),
      protein: r1(tot.protein),
      carbs: r1(tot.carbs),
      fat: r1(tot.fat),
      _source: 'Vir: fotografija · ' + labels.join(' + ') + (estimate ? ' (del vrednosti je ocena)' : '')
    };
  }

  async function sendPhoto(file) {
    if (busy) return;
    if (!file || !/^image\//.test(file.type || '')) {
      appendBubble('assistant', 'To ni slika.', { error: true });
      return;
    }
    busy = true; sendBtn.disabled = true; attachBtn.disabled = true;
    appendBubble('user', '📷 Fotografija hrane');
    var typing = appendBubble('assistant', 'Prepoznavam hrano…', { typing: true });
    try {
      var dataUrl = await resizeImage(file, 1280, 0.85);
      var j = await postApi('/api/food-photo', { image: dataUrl, note: '' }, 25000);
      typing.remove();
      var act = photoToAction(j);
      if (act.empty) { appendBubble('assistant', act.empty); }
      else {
        appendBubble('assistant', 'Predlog iz fotografije. Preveri količine in potrdi ali zavrni.');
        appendActionCard(act);
      }
    } catch (e) {
      typing.remove();
      var msg = e && e.status === 401 ? TOKEN_ERROR : (e && e.status ? e.message : FRIENDLY_ERROR);
      appendBubble('assistant', msg, { error: true });
    } finally {
      busy = false; sendBtn.disabled = false; attachBtn.disabled = false;
      scrollToBottom();
    }
  }

  // Gumb je skrit, ko je odprt kateri koli modal ali celozaslonski trening.
  function syncFab() {
    syncQueued = false;
    if (!fabEl) return;
    var sheet = $('wuiActiveSheet');
    var sheetOpen = !!sheet && getComputedStyle(sheet).display !== 'none';
    var hide = document.body.classList.contains('modal-open') || sheetOpen ||
      (overlay && overlay.classList.contains('open'));
    if (fabEl.classList.contains('is-hidden') !== hide) fabEl.classList.toggle('is-hidden', hide);
  }
  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncFab);
  }

  function injectStyles() {
    if ($('assistantStyles')) return;
    var css = [
      '.assistant-fab { position: fixed; right: 16px; bottom: calc(128px + env(safe-area-inset-bottom, 12px));',
      '  z-index: 180; width: 48px; height: 48px; min-width: 44px; min-height: 44px; border-radius: 999px;',
      '  border: 1px solid var(--edge-2, rgba(255,255,255,0.10)); background: var(--surface-2, #14171A);',
      '  color: var(--text-1, #F4F5F6); font-size: 1.35rem; line-height: 1; display: flex; align-items: center;',
      '  justify-content: center; cursor: pointer; padding: 0; touch-action: manipulation;',
      '  -webkit-tap-highlight-color: transparent;',
      '  box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 14px var(--rec-green-glow, rgba(0,230,118,0.22)); }',
      '.assistant-fab.is-hidden { display: none; }',
      '#assistantSheet.assistant-overlay { z-index: 10010; align-items: flex-end; }',
      '.assistant-sheet { height: 100dvh; max-height: 100dvh !important; border-radius: 24px 24px 0 0;',
      '  display: flex; flex-direction: column; overflow: hidden; padding: 0; min-width: 0; }',
      '.as-header { display: flex; align-items: center; justify-content: space-between; gap: 8px;',
      '  padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 10px; border-bottom: 1px solid var(--edge-1, rgba(255,255,255,0.06)); }',
      '.as-title { font-weight: 800; font-size: 1rem; color: var(--text-1, #F4F5F6); }',
      '.as-close { min-width: 44px; min-height: 44px; border: none; background: transparent; color: var(--text-2, #A1A7B0);',
      '  font-size: 1.2rem; cursor: pointer; border-radius: 12px; }',
      '.as-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;',
      '  overscroll-behavior: contain; touch-action: pan-y; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }',
      '.as-msg { max-width: 85%; padding: 9px 12px; border-radius: 14px; font-size: 0.92rem; line-height: 1.4;',
      '  white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-1, #F4F5F6); }',
      '.as-msg.user { align-self: flex-end; background: rgba(0,230,118,0.14); border: 1px solid rgba(0,230,118,0.3); }',
      '.as-msg.assistant { align-self: flex-start; background: var(--surface-2, #14171A); border: 1px solid var(--edge-2, rgba(255,255,255,0.10)); }',
      '.as-msg.error { color: #FFB4A0; border-color: rgba(255,61,0,0.4); }',
      '.as-typing { color: var(--text-2, #A1A7B0); font-style: italic; }',
      '.as-card { align-self: stretch; min-width: 0; background: var(--surface-2, #14171A); border: 1px solid var(--edge-2, rgba(255,255,255,0.10));',
      '  border-radius: 14px; padding: 10px 12px; overflow-wrap: anywhere; }',
      '.as-card.is-done { border-color: rgba(0,230,118,0.45); }',
      '.as-card.is-rejected { opacity: 0.55; }',
      '.as-card-title { font-weight: 700; font-size: 0.88rem; color: var(--text-1, #F4F5F6); margin-bottom: 4px; }',
      '.as-card-body { font-size: 0.82rem; color: var(--text-2, #A1A7B0); white-space: pre-wrap; overflow-wrap: anywhere; }',
      '.as-card-warn { font-size: 0.78rem; color: #FFB4A0; margin-top: 4px; }',
      '.as-card-status { font-size: 0.82rem; color: var(--rec-green, #00E676); margin-top: 6px; }',
      '.as-card-status.is-error { color: #FFB4A0; }',
      '.as-card-actions { display: flex; gap: 8px; margin-top: 10px; }',
      '.as-btn { flex: 1; min-height: 44px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; cursor: pointer; font-family: inherit; }',
      '.as-btn:disabled { opacity: 0.45; cursor: default; }',
      '.as-btn-ok { border: none; background: var(--rec-green, #00E676); color: #08090A; }',
      '.as-btn-no { border: 1px solid var(--edge-2, rgba(255,255,255,0.10)); background: transparent; color: var(--text-2, #A1A7B0); }',
      '.as-form { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));',
      '  border-top: 1px solid var(--edge-1, rgba(255,255,255,0.06)); background: var(--surface-1, #0E1012); }',
      '.as-input { flex: 1; min-width: 0; min-height: 44px; max-height: 120px; resize: none; box-sizing: border-box;',
      '  font-size: 16px; font-family: inherit; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--edge-2, rgba(255,255,255,0.10));',
      '  background: var(--surface-2, #14171A); color: var(--text-1, #F4F5F6); }',
      '.as-send { min-width: 72px; min-height: 44px; border-radius: 12px; border: none; background: var(--rec-green, #00E676);',
      '  color: #08090A; font-weight: 800; font-size: 0.92rem; cursor: pointer; font-family: inherit; }',
      '.as-send:disabled { opacity: 0.5; cursor: default; }',
      '.as-icon { flex: 0 0 auto; min-width: 44px; min-height: 44px; border-radius: 12px; padding: 0; cursor: pointer;',
      '  border: 1px solid var(--edge-2, rgba(255,255,255,0.10)); background: var(--surface-2, #14171A); color: var(--text-1, #F4F5F6);',
      '  font-size: 1.1rem; touch-action: manipulation; }',
      '.as-icon:disabled { opacity: 0.45; cursor: default; }',
      '.as-icon.is-on { border-color: var(--rec-green, #00E676); box-shadow: 0 0 10px var(--rec-green-glow, rgba(0,230,118,0.22)); }',
      '.as-card-src { font-size: 0.78rem; color: var(--text-2, #A1A7B0); margin-top: 4px; overflow-wrap: anywhere; }',
      '@media (min-width: 641px) {',
      '  #assistantSheet.assistant-overlay { align-items: center; padding: 24px 16px; }',
      '  .assistant-sheet { height: 85dvh !important; max-height: 85dvh !important; max-width: 500px !important;',
      '    border-radius: 20px; border-bottom: 1px solid var(--edge-2, rgba(255,255,255,0.10)); margin: auto; }',
      '}'
    ].join('\n');
    var st = el('style');
    st.id = 'assistantStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function mount() {
    if ($('assistantSheet')) return;
    injectStyles();

    fabEl = el('button', 'assistant-fab', '🤖');
    fabEl.type = 'button';
    fabEl.id = 'assistantFab';
    fabEl.setAttribute('aria-label', 'Odpri AI pomočnika');
    fabEl.title = 'AI pomočnik';
    document.body.appendChild(fabEl);

    overlay = el('div', 'modal-overlay assistant-overlay');
    overlay.id = 'assistantSheet';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'AI pomočnik');

    var sheet = el('div', 'modal assistant-sheet');
    var header = el('div', 'as-header');
    header.appendChild(el('div', 'as-title', '🤖 AI pomočnik'));
    var closeBtn = el('button', 'as-close', '✕');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Zapri');
    header.appendChild(closeBtn);

    logEl = el('div', 'as-log');
    logEl.setAttribute('aria-live', 'polite');

    var form = el('form', 'as-form');
    inputEl = el('textarea', 'as-input');
    inputEl.rows = 1;
    inputEl.placeholder = 'Napiši sporočilo…';
    inputEl.setAttribute('enterkeyhint', 'send');
    sendBtn = el('button', 'as-send', 'Pošlji');
    sendBtn.type = 'submit';
    attachBtn = el('button', 'as-icon as-attach', '📷');
    attachBtn.type = 'button';
    attachBtn.setAttribute('aria-label', 'Priloži fotografijo hrane');
    attachBtn.title = 'Fotografija hrane';
    var fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.id = 'assistantPhotoInput';
    fileInput.style.display = 'none';
    attachBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) sendPhoto(f);
    });
    form.appendChild(attachBtn);
    form.appendChild(fileInput);

    // Govorni vnos: samo če brskalnik podpira Web Speech API (sicer gumba ni).
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      var micBtn = el('button', 'as-icon as-mic', '🎤');
      micBtn.type = 'button';
      micBtn.setAttribute('aria-label', 'Govorni vnos');
      micBtn.setAttribute('aria-pressed', 'false');
      var rec = null, listening = false;
      var stopListening = function () {
        listening = false;
        micBtn.classList.remove('is-on');
        micBtn.setAttribute('aria-pressed', 'false');
      };
      micBtn.addEventListener('click', function () {
        if (listening) { try { rec && rec.stop(); } catch (e) { stopListening(); } return; }
        try { rec = new SR(); } catch (e) { return; }
        rec.lang = 'sl-SI';
        rec.interimResults = false;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        rec.onresult = function (ev) {
          var t = ev.results && ev.results[0] && ev.results[0][0] ? String(ev.results[0][0].transcript || '').trim() : '';
          if (t) {
            inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + t;
            autosize();
          }
        };
        rec.onend = stopListening;
        rec.onerror = stopListening;
        listening = true;
        micBtn.classList.add('is-on');
        micBtn.setAttribute('aria-pressed', 'true');
        try { rec.start(); } catch (e) { stopListening(); }
      });
      form.appendChild(micBtn);
    }

    form.appendChild(inputEl);
    form.appendChild(sendBtn);

    sheet.appendChild(header);
    sheet.appendChild(logEl);
    sheet.appendChild(form);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    fabEl.addEventListener('click', openSheet);
    closeBtn.addEventListener('click', closeSheet);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSheet(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    inputEl.addEventListener('input', autosize);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeSheet();
    });

    // Skrivanje gumba: ob odprtju modalov (body.modal-open) ali celozaslonskega treninga.
    var mo = new MutationObserver(queueSync);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true, childList: true });
    syncFab();
  }

  root.AssistantUI = {
    open: openSheet,
    close: closeSheet,
    applyAction: applyAction,   // izpostavljeno za preverjanje; UI kliče samo po potrditvi
    buildContext: buildContext
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window);
