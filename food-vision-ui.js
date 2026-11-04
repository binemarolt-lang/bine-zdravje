/**
 * Bine Zdravje — Foto prepoznava hrane (Cal AI / MacroFactor slog).
 *
 * Tok: 📷 -> stiskanje -> POST /api/food-photo (VPS, Gemini vision) -> postavke {ime, grami}
 *      -> FoodMatch (lokalna USDA baza, 8000 živil, ~40 hranil) -> pregled in urejanje -> shrani obrok.
 * Urejanje: spremeniš ime ("puran" namesto "piščanec") ali grame -> hranila se preračunajo sama.
 *
 * Odvisnosti iz index.html: compressAndResizeImage, prehranaState, savePrehranaState,
 * renderPrehranaView, lockBodyScroll, unlockBodyScroll, showMascotNotification, getSuggestedMealName.
 */
(function () {
  'use strict';

  const LS_TOKEN = 'bine_zdravje_fv_token';
  const LS_ENDPOINT = 'bine_zdravje_fv_endpoint';
  const FALLBACK_ENDPOINTS = ['http://100.101.68.31:8091'];

  // ---------- Povezava (žeton iz QR kode: ...#fv=<token>) ----------
  (function capturePairing() {
    const m = location.hash.match(/[#&]fv=([A-Za-z0-9_-]{16,})/);
    if (m) {
      localStorage.setItem(LS_TOKEN, m[1]);
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => toast('✅ Foto prepoznava povezana s strežnikom.'), 800);
    }
    const e = location.hash.match(/[#&]fvurl=([^&]+)/);
    if (e) localStorage.setItem(LS_ENDPOINT, decodeURIComponent(e[1]));
  })();

  function toast(msg) {
    if (typeof showMascotNotification === 'function') showMascotNotification(msg);
    else console.log('[FV]', msg);
  }

  // ---------- Baza hranil (lazy) ----------
  let dbPromise = null;
  function ensureDb() {
    if (window.FoodMatch && FoodMatch.isLoaded()) return Promise.resolve();
    if (!dbPromise) {
      dbPromise = Promise.all([
        fetch('./food-db.json').then(r => { if (!r.ok) throw new Error('food-db.json ' + r.status); return r.json(); }),
        fetch('./food-aliases.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))
      ]).then(([db, aliases]) => { FoodMatch.load(db, aliases); })
        .catch(e => { dbPromise = null; throw e; });
    }
    return dbPromise;
  }

  // ---------- Strežnik ----------
  async function endpointCandidates() {
    const list = [];
    const manual = localStorage.getItem(LS_ENDPOINT);
    if (manual) list.push(manual);
    try {
      const r = await fetch('./food-vision-endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.url) list.push(j.url); }
    } catch (e) { /* ni objavljen */ }
    for (const f of FALLBACK_ENDPOINTS) if (!(location.protocol === 'https:' && f.startsWith('http:'))) list.push(f);
    return [...new Set(list.map(u => u.replace(/\/$/, '')))];
  }

  async function analyzePhoto(dataUrl, note) {
    const token = localStorage.getItem(LS_TOKEN) || '';
    if (!token) throw Object.assign(new Error('Aplikacija še ni povezana s strežnikom za prepoznavo. Odpri povezavo iz QR kode (enkrat).'), { code: 'NOTOKEN' });
    const eps = await endpointCandidates();
    let lastErr = null;
    for (const ep of eps) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 70000);
        const r = await fetch(ep + '/api/food-photo', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'X-Zdravje-Token': token },
          body: JSON.stringify({ image: dataUrl, note: note || '' })
        });
        clearTimeout(to);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { lastErr = new Error(j.error || ('HTTP ' + r.status)); if (r.status === 401) break; continue; }
        return j;
      } catch (e) { lastErr = e.name === 'AbortError' ? new Error('Strežnik se ni odzval v 70 s.') : e; }
    }
    throw lastErr || new Error('Strežnik za prepoznavo ni dosegljiv.');
  }

  // ---------- Stanje pregleda ----------
  let review = null; // {photo, items:[{name, grams, match:{index,name}|null, candidates, est, nutr}], mealName}

  function computeItem(it) {
    if (it.match && it.match.index != null) it.nutr = FoodMatch.nutrientsFor(it.match.index, it.grams);
    else if (it.est) it.nutr = FoodMatch.nutrientsFromEstimate(it.est, it.grams);
    else it.nutr = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} };
  }

  function rematch(it, query) {
    const res = FoodMatch.bestMatch({ usda_query: query, name: query, per100g: it.estFromAI ? it.est : null });
    if (res && res.best) {
      it.match = { index: res.best.index, name: res.best.name };
      it.candidates = res.candidates.slice(0, 8);
    } else {
      it.match = null;
      it.candidates = [];
    }
    computeItem(it);
  }

  function itemFromAI(ai) {
    const it = { name: ai.name, grams: ai.grams || 100, confidence: ai.confidence, est: ai.per100g, estFromAI: true, match: null, candidates: [] };
    const res = FoodMatch.bestMatch({ usda_query: ai.usda_query, name_en: ai.name_en, name: ai.name, per100g: ai.per100g });
    if (res && res.best) {
      // Če baza da energijsko povsem drugačno živilo kot AI ocena, raje zaupaj AI oceni.
      const kc = FoodMatch.per100(res.best.index).calories || 0;
      const est = Number(ai.per100g && ai.per100g.kcal) || 0;
      const ratio = est > 0 && kc > 0 ? Math.min(kc, est) / Math.max(kc, est) : 1;
      it.candidates = res.candidates.slice(0, 8);
      if (ratio >= 0.7) it.match = { index: res.best.index, name: res.best.name };
    }
    computeItem(it);
    return it;
  }

  function totals() {
    const t = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} };
    for (const it of review.items) {
      const n = it.nutr; if (!n) continue;
      t.calories += n.calories; t.protein += n.protein; t.carbs += n.carbs; t.fat += n.fat; t.fiber += n.fiber || 0;
      for (const [k, v] of Object.entries(n.micros || {})) t.micros[k] = (t.micros[k] || 0) + (Number(v) || 0);
    }
    return t;
  }

  // ---------- UI ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = v => Math.round((Number(v) || 0) * 10) / 10;

  function injectModal() {
    if (document.getElementById('fvModalOverlay')) return;
    const css = document.createElement('style');
    css.textContent = `
      .fv-item{background:var(--surface-2);border:1px solid var(--edge-1);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px}
      .fv-row{display:flex;gap:6px;align-items:center}
      .fv-row input{background:var(--surface-3);border:1px solid var(--edge-2);border-radius:8px;color:#fff;padding:8px 10px;font-size:16px;min-width:0}
      .fv-name{flex:1;font-weight:700}
      .fv-grams{width:76px;text-align:center}
      .fv-del{background:none;border:none;color:var(--text-3);font-size:1.1rem;padding:4px 6px;cursor:pointer}
      .fv-match{font-size:.68rem;color:var(--text-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .fv-match select{background:var(--surface-3);color:var(--text-2);border:1px solid var(--edge-2);border-radius:6px;font-size:.7rem;max-width:100%;padding:3px}
      .fv-macros{font-size:.74rem;color:var(--text-2);display:flex;gap:10px;flex-wrap:wrap}
      .fv-macros b{color:#fff}
      .fv-total{position:sticky;bottom:0;background:rgba(14,16,18,.97);border-top:1px solid var(--edge-2);padding:10px 0 4px;display:flex;flex-direction:column;gap:8px}
      .fv-total-nums{display:grid;grid-template-columns:repeat(4,1fr);text-align:center;gap:4px}
      .fv-total-nums div{background:var(--surface-2);border-radius:10px;padding:6px 2px}
      .fv-total-nums strong{display:block;font-size:1.05rem;color:#fff}
      .fv-total-nums span{font-size:.62rem;color:var(--text-3);text-transform:uppercase}
      .fv-spinner{width:34px;height:34px;border:3px solid var(--edge-2);border-top-color:var(--rec-green);border-radius:50%;animation:fvspin .8s linear infinite;margin:10px auto}
      @keyframes fvspin{to{transform:rotate(360deg)}}
      .fv-photo{width:100%;max-height:180px;object-fit:cover;border-radius:12px;border:1px solid var(--edge-2)}
      .fv-conf{font-size:.6rem;padding:1px 6px;border-radius:6px;border:1px solid var(--edge-2)}
      .fv-micros{font-size:.68rem;color:var(--text-3);line-height:1.5}
    `;
    document.head.appendChild(css);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div class="modal-overlay" id="fvModalOverlay" onclick="if(event.target.id==='fvModalOverlay') FoodVision.close()">
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <div class="modal-sheet-handle"></div>
          <div class="modal-header-row">
            <h3 id="fvTitle">📸 Prepoznava obroka</h3>
            <button type="button" class="modal-close" onclick="FoodVision.close()">✕</button>
          </div>
        </div>
        <div class="modal-body" id="fvBody" style="display:flex;flex-direction:column;gap:10px;"></div>
      </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  function open() {
    injectModal();
    document.getElementById('fvModalOverlay').classList.add('open');
    if (typeof lockBodyScroll === 'function') lockBodyScroll();
  }
  function close() {
    document.getElementById('fvModalOverlay')?.classList.remove('open');
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll();
  }

  function renderLoading(photo, msg) {
    open();
    document.getElementById('fvBody').innerHTML = `
      ${photo ? `<img class="fv-photo" src="${photo}">` : ''}
      <div class="fv-spinner"></div>
      <div style="text-align:center;color:var(--text-2);font-size:.85rem;">${esc(msg)}</div>`;
  }

  function renderError(photo, err) {
    open();
    const noToken = err && err.code === 'NOTOKEN';
    document.getElementById('fvBody').innerHTML = `
      ${photo ? `<img class="fv-photo" src="${photo}">` : ''}
      <div style="color:var(--rec-red);font-size:.85rem;text-align:center;padding:8px;">⚠️ ${esc(err.message || err)}</div>
      ${noToken ? '' : `<button class="btn" onclick="FoodVision.retry()">🔄 Poskusi znova</button>`}
      <button class="btn secondary" onclick="FoodVision.manual()">✍️ Vnesi ročno (iskanje po bazi)</button>`;
  }

  function microLine(m) {
    const show = [['iron', 'Fe', 'mg'], ['zinc', 'Zn', 'mg'], ['magnesium', 'Mg', 'mg'], ['calcium', 'Ca', 'mg'], ['potassium', 'K', 'mg'], ['sodium', 'Na', 'mg'], ['vitaminB12', 'B12', 'µg'], ['vitaminD', 'D', 'µg'], ['vitaminC', 'C', 'mg'], ['selenium', 'Se', 'µg'], ['omega3DHA', 'DHA', 'g'], ['leucine', 'Leu', 'g']];
    return show.filter(([k]) => m[k] != null && m[k] > 0).map(([k, l, u]) => `${l} ${r1(m[k])}${u}`).join(' · ');
  }

  function renderReview() {
    const b = document.getElementById('fvBody');
    const t = totals();
    const items = review.items.map((it, i) => {
      const n = it.nutr || {};
      const opts = (it.candidates || []).map(c => `<option value="${c.index}" ${it.match && it.match.index === c.index ? 'selected' : ''}>${esc(c.name.slice(0, 70))}</option>`).join('');
      const conf = it.confidence != null ? `<span class="fv-conf" style="color:${it.confidence >= 0.75 ? 'var(--rec-green)' : it.confidence >= 0.5 ? 'var(--rec-yellow)' : 'var(--rec-red)'}">${Math.round(it.confidence * 100)} %</span>` : '';
      return `
      <div class="fv-item" data-i="${i}">
        <div class="fv-row">
          <input class="fv-name" value="${esc(it.name)}" oninput="FoodVision.onName(${i}, this.value)" placeholder="Živilo (npr. puran)">
          <input class="fv-grams" type="number" inputmode="decimal" value="${it.grams}" oninput="FoodVision.onGrams(${i}, this.value)"><span style="font-size:.7rem;color:var(--text-3)">g</span>
          <button class="fv-del" onclick="FoodVision.remove(${i})" title="Odstrani">✕</button>
        </div>
        <div class="fv-match">${conf}
          ${it.match ? `<span>USDA:</span><select onchange="FoodVision.pick(${i}, this.value)">${opts}</select>` : `<span style="color:var(--rec-yellow)">Ni zadetka v bazi — uporabljena ocena AI. Popravi ime.</span>`}
        </div>
        <div class="fv-macros"><span><b>${n.calories || 0}</b> kcal</span><span style="color:var(--rec-green)">B ${r1(n.protein)} g</span><span style="color:var(--strain-blue)">OH ${r1(n.carbs)} g</span><span style="color:var(--rec-yellow)">M ${r1(n.fat)} g</span></div>
        <div class="fv-micros">${microLine(n.micros || {})}</div>
      </div>`;
    }).join('');

    b.innerHTML = `
      ${review.photo ? `<img class="fv-photo" src="${review.photo}">` : ''}
      <div class="fv-row"><input id="fvMealName" class="fv-name" value="${esc(review.mealName)}" oninput="FoodVision.onMealName(this.value)" placeholder="Ime obroka"></div>
      <div style="font-size:.68rem;color:var(--text-3);">Preveri postavke. Spremeni ime ali grame in hranila se preračunajo sama.${review.model ? ` · ${esc(review.model)}, ${(review.ms / 1000).toFixed(1)} s` : ''}</div>
      ${items || '<div style="text-align:center;color:var(--text-3);font-size:.8rem;">Na sliki ni prepoznane hrane. Dodaj postavko ročno.</div>'}
      <button class="btn secondary" onclick="FoodVision.add()">+ Dodaj postavko</button>
      <div class="fv-total">
        <div class="fv-total-nums">
          <div><strong>${Math.round(t.calories)}</strong><span>kcal</span></div>
          <div><strong style="color:var(--rec-green)">${Math.round(t.protein)}</strong><span>beljak. g</span></div>
          <div><strong style="color:var(--strain-blue)">${Math.round(t.carbs)}</strong><span>OH g</span></div>
          <div><strong style="color:var(--rec-yellow)">${Math.round(t.fat)}</strong><span>maščobe g</span></div>
        </div>
        <button class="btn" style="padding:12px;font-weight:800;background:linear-gradient(135deg,#00E676 0%,#00B0FF 100%);color:#08090A;" onclick="FoodVision.save()" ${review.items.length ? '' : 'disabled'}>✓ Shrani obrok</button>
      </div>`;
  }

  // Posodobi samo številke ene postavke (brez ponovnega izrisa, da tipkovnica ostane odprta)
  function refreshItem(i) {
    const it = review.items[i];
    const el = document.querySelector(`.fv-item[data-i="${i}"]`);
    if (!el) return renderReview();
    const n = it.nutr || {};
    el.querySelector('.fv-macros').innerHTML = `<span><b>${n.calories || 0}</b> kcal</span><span style="color:var(--rec-green)">B ${r1(n.protein)} g</span><span style="color:var(--strain-blue)">OH ${r1(n.carbs)} g</span><span style="color:var(--rec-yellow)">M ${r1(n.fat)} g</span>`;
    el.querySelector('.fv-micros').innerHTML = microLine(n.micros || {});
    const opts = (it.candidates || []).map(c => `<option value="${c.index}" ${it.match && it.match.index === c.index ? 'selected' : ''}>${esc(c.name.slice(0, 70))}</option>`).join('');
    el.querySelector('.fv-match').innerHTML = it.match ? `<span>USDA:</span><select onchange="FoodVision.pick(${i}, this.value)">${opts}</select>` : `<span style="color:var(--rec-yellow)">Ni zadetka v bazi — napiši drugače (npr. "turkey", "puran").</span>`;
    const t = totals();
    const nums = document.querySelectorAll('.fv-total-nums strong');
    if (nums.length === 4) { nums[0].textContent = Math.round(t.calories); nums[1].textContent = Math.round(t.protein); nums[2].textContent = Math.round(t.carbs); nums[3].textContent = Math.round(t.fat); }
  }

  const timers = {};
  function onName(i, v) {
    const it = review.items[i]; it.name = v;
    clearTimeout(timers[i]);
    timers[i] = setTimeout(() => { it.estFromAI = false; rematch(it, v); refreshItem(i); }, 300);
  }
  function onGrams(i, v) { const it = review.items[i]; it.grams = Math.max(0, Number(v) || 0); computeItem(it); refreshItem(i); }
  function pick(i, idx) {
    const it = review.items[i]; const c = (it.candidates || []).find(x => String(x.index) === String(idx));
    if (c) { it.match = { index: c.index, name: c.name }; computeItem(it); refreshItem(i); }
  }
  function remove(i) { review.items.splice(i, 1); renderReview(); }
  function add() {
    review.items.push({ name: '', grams: 100, match: null, candidates: [], est: null, nutr: null });
    computeItem(review.items[review.items.length - 1]);
    renderReview();
    const all = document.querySelectorAll('.fv-name'); all[all.length - 1]?.focus();
  }
  function onMealName(v) { review.mealName = v; }

  function save() {
    const t = totals();
    const micros = {};
    for (const [k, v] of Object.entries(t.micros)) micros[k] = Math.round(v * 1000) / 1000;
    const entry = {
      id: 'm_' + Date.now(),
      name: (review.mealName || '').trim() || (typeof getSuggestedMealName === 'function' ? getSuggestedMealName() : 'Obrok'),
      serving: review.items.map(it => `${it.name} ${Math.round(it.grams)} g`).join(', '),
      calories: Math.round(t.calories), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat), fiber: r1(t.fiber),
      micros,
      items: review.items.map(it => ({ name: it.name, grams: it.grams, usda: it.match ? it.match.name : null, calories: it.nutr.calories, protein: it.nutr.protein, carbs: it.nutr.carbs, fat: it.nutr.fat })),
      source: 'AI_VISION',
      time: new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' }),
      photo: review.photo || null
    };
    prehranaState.meals.push(entry);
    try { savePrehranaState(); } catch (e) {
      // localStorage poln (fotografije) -> shrani brez slike
      entry.photo = null; savePrehranaState();
    }
    renderPrehranaView();
    close();
    toast(`✅ ${entry.name}: ${entry.calories} kcal · B ${Math.round(entry.protein)} g`);
    review = null;
  }

  let lastPhoto = null;
  async function run(photo) {
    lastPhoto = photo;
    renderLoading(photo, 'Prepoznavam hrano in ocenjujem porcije…');
    try {
      const [ai] = await Promise.all([analyzePhoto(photo), ensureDb()]);
      review = { photo, mealName: ai.meal_name || (typeof getSuggestedMealName === 'function' ? getSuggestedMealName() : ''), model: ai.model, ms: ai.ms, items: (ai.items || []).map(itemFromAI) };
      renderReview();
    } catch (e) {
      console.error('[FoodVision]', e);
      renderError(photo, e);
    }
  }

  async function manual() {
    try { await ensureDb(); } catch (e) { return renderError(lastPhoto, e); }
    review = { photo: lastPhoto, mealName: typeof getSuggestedMealName === 'function' ? getSuggestedMealName() : '', items: [] };
    open(); renderReview(); add();
  }

  function handleFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    renderLoading(null, 'Stiskam sliko…');
    compressAndResizeImage(file, { maxDim: 1024, initialQuality: 0.8, maxSizeKB: 220 })
      .then(res => run(res.dataUrl))
      .catch(err => renderError(null, err));
  }

  window.FoodVision = { run, retry: () => lastPhoto && run(lastPhoto), manual, close, onName, onGrams, pick, remove, add, onMealName, save, handleFile, ensureDb, analyzePhoto, _state: () => review };

  // Prevzemi obstoječe foto gumbe (FAB, "Foto Obrok").
  window.handleDirectFoodPhotoUpload = handleFile;
  ensureDb().catch(() => {}); // predhodno naloži bazo v ozadju
})();
