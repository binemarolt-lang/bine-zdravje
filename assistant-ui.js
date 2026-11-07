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

  function buildContext() {
    return {
      datum: localDate(),
      zavihek: safe(function () { return document.body.dataset.view || 'danes'; }, 'danes'),
      zadnji_treningi: safe(function () {
        return (root.WorkoutUI.getWorkouts() || []).slice(0, 5).map(compactWorkout);
      }, []),
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
          zadnja_zapisana: last ? { datum: last.date, kg: last.weightKg } : null
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
    switch (a && a.type) {
      case 'log_workout':
        d.title = 'Trening: ' + (str(a.name, 80) || 'Trening');
        (a.exercises || []).forEach(function (ex) {
          var sets = (ex.sets || []).map(function (s) {
            return (s.w != null ? s.w + ' kg × ' : '') + s.reps + (s.rir != null ? ' (RIR ' + s.rir + ')' : '');
          });
          d.lines.push(ex.name + ': ' + sets.join(', '));
        });
        break;
      case 'log_food':
        d.title = 'Obrok: ' + (a.meal_name || '');
        d.lines.push(a.kcal + ' kcal · B ' + (a.protein || 0) + ' g · OH ' + (a.carbs || 0) + ' g · M ' + (a.fat || 0) + ' g');
        break;
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
    if (!capability(a).ok) d.warn = UNS;
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
      date: localDate(),
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
    root.addPresetFood({
      name: meal,
      serving: '1 porcija',
      calories: kcal,
      protein: num(a.protein) || 0,
      carbs: num(a.carbs) || 0,
      fat: num(a.fat) || 0
    });
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
    var slot = a.slot && Object.prototype.hasOwnProperty.call(slots, a.slot) ? a.slot : 'CUSTOM';
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
