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

  const DEFAULT_TOKEN = 'wyINc3OiLTEl3TJfidr7PrO8ekgvHKVi';
  const LS_TOKEN = 'bine_zdravje_fv_token';
  const LS_ENDPOINT = 'bine_zdravje_fv_endpoint';
  const FALLBACK_ENDPOINTS = [
    'https://kingdom-optimum-cheapest-gates.trycloudflare.com',
    'http://100.101.68.31:8091',
    'http://127.0.0.1:8091'
  ];

  // Samodejno nastavi privzeti žeton, če localStorage še nima shranjenega žetona
  function getEffectiveToken() {
    try {
      let t = localStorage.getItem(LS_TOKEN);
      if (!t || !t.trim()) {
        t = DEFAULT_TOKEN;
        localStorage.setItem(LS_TOKEN, DEFAULT_TOKEN);
      }
      return t;
    } catch (e) {
      return DEFAULT_TOKEN;
    }
  }

  // ---------- Povezava (žeton iz QR kode: ...#fv=<token>) ----------
  (function capturePairing() {
    try {
      if (!localStorage.getItem(LS_TOKEN)) {
        localStorage.setItem(LS_TOKEN, DEFAULT_TOKEN);
      }
      const m = location.hash.match(/[#&]fv=([A-Za-z0-9_-]{16,})/);
      if (m) {
        localStorage.setItem(LS_TOKEN, m[1]);
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(() => toast('✅ Foto prepoznava povezana s strežnikom.'), 800);
      }
      const e = location.hash.match(/[#&]fvurl=([^&]+)/);
      if (e) localStorage.setItem(LS_ENDPOINT, decodeURIComponent(e[1]));
    } catch (err) {}
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
      if (r.ok) {
        const j = await r.json();
        if (j.url) list.push(j.url);
      }
    } catch (e) { /* ni objavljen */ }
    for (const f of FALLBACK_ENDPOINTS) {
      if (!(location.protocol === 'https:' && f.startsWith('http:'))) {
        list.push(f);
      }
    }
    return [...new Set(list.map(u => u.replace(/\/$/, '')))];
  }

  // ---------- Zdravstveno stanje (Health Check) & Badge ----------
  let activeEndpoint = null;
  let lastHealthStatus = null; // { ok: boolean, endpoint: string, ms: number }

  function updateStatusBadges(state, ep, ms) {
    const badges = document.querySelectorAll('.fv-status-badge');
    badges.forEach(b => {
      b.classList.remove('optimal', 'suboptimal', 'critical');
      if (state === 'connected') {
        b.classList.add('optimal');
        b.innerHTML = '🟢 AI Povezan';
        b.title = `AI strežnik je aktiven (${ep || ''}${ms ? ` · ${ms} ms` : ''}). Klikni za ponovni preizkus.`;
      } else if (state === 'checking') {
        b.innerHTML = '🟡 AI Preverjam...';
        b.title = 'Preverjam povezavo z AI strežnikom...';
      } else {
        b.classList.add('suboptimal');
        b.innerHTML = '🟡 AI Brez povezave';
        b.title = 'AI strežnik ni dosegljiv. Aktiven je hitri ročni vnos kalorij. Klikni za test.';
      }
    });
  }

  async function checkHealth(interactive = false) {
    if (interactive && typeof showMascotNotification === 'function') {
      showMascotNotification('🔍 Preverjam povezavo z AI strežnikom...');
    }
    updateStatusBadges('checking');

    const eps = await endpointCandidates();
    const token = getEffectiveToken();
    let workingEndpoint = null;
    let latencyMs = 0;

    for (const ep of eps) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 4000);
        const t0 = performance.now();
        const r = await fetch(ep + '/api/health', {
          signal: ctrl.signal,
          headers: { 'X-Zdravje-Token': token },
          cache: 'no-store'
        });
        clearTimeout(to);
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          if (j.ok) {
            workingEndpoint = ep;
            latencyMs = Math.round(performance.now() - t0);
            break;
          }
        }
      } catch (e) {
        // poskusi naslednjega
      }
    }

    if (workingEndpoint) {
      activeEndpoint = workingEndpoint;
      lastHealthStatus = { ok: true, endpoint: workingEndpoint, ms: latencyMs };
      updateStatusBadges('connected', workingEndpoint, latencyMs);
      if (interactive) {
        toast(`🟢 AI Povezan (${latencyMs} ms · ${workingEndpoint.replace(/^https?:\/\//, '').slice(0, 26)}…)`);
      }
      return true;
    } else {
      activeEndpoint = null;
      lastHealthStatus = { ok: false, endpoint: null, ms: 0 };
      updateStatusBadges('offline');
      if (interactive) {
        toast('⚠️ AI Brez povezave — aktiven je hitri ocenjevalnik kalorij.');
      }
      return false;
    }
  }

  async function analyzePhoto(dataUrl, note) {
    const token = getEffectiveToken();
    const eps = await endpointCandidates();
    if (activeEndpoint && eps.includes(activeEndpoint)) {
      eps.splice(eps.indexOf(activeEndpoint), 1);
      eps.unshift(activeEndpoint);
    }

    let lastErr = null;
    for (const ep of eps) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 25000);
        const r = await fetch(ep + '/api/food-photo', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'X-Zdravje-Token': token },
          body: JSON.stringify({ image: dataUrl, note: note || '' })
        });
        clearTimeout(to);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastErr = new Error(j.error || ('HTTP ' + r.status));
          if (r.status === 401) break;
          continue;
        }
        activeEndpoint = ep;
        updateStatusBadges('connected', ep, j.ms);
        return j;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Strežnik se ni odzval pravočasno (25 s).') : e;
      }
    }
    updateStatusBadges('offline');
    throw lastErr || new Error('Strežnik za prepoznavo ni dosegljiv.');
  }

  // ---------- Stanje pregleda ----------
  let review = null; // {photo, items:[{name, grams, match:{index,name}|null, candidates, est, nutr}], mealName}
  const quickState = { kcal: 450, p: 28, c: 51, f: 15, photo: null, mealName: '' };

  function computeItem(it) {
    // Potrjene vrednosti (embalaža ali OFF) imajo prednost pred USDA ujemanjem.
    if (it.verified && it.est) it.nutr = FoodMatch.nutrientsFromEstimate(it.est, it.grams);
    else if (it.match && it.match.index != null) it.nutr = FoodMatch.nutrientsFor(it.match.index, it.grams);
    else if (it.est) it.nutr = FoodMatch.nutrientsFromEstimate(it.est, it.grams);
    else it.nutr = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} };
  }

  // Oznaka vira pri vsaki postavki. 'ocena' ostane jasno označena kot ocena.
  function sourceBadge(it) {
    if (it.source === 'label') return '<span class="fv-src" style="color:var(--rec-green)">✓ Z embalaže</span>';
    if (it.source === 'off_barcode' || it.source === 'off_search') return '<span class="fv-src" style="color:var(--rec-green)">✓ Open Food Facts</span>';
    if (it.source === 'usda') return '<span class="fv-src" style="color:var(--strain-blue)">USDA baza</span>';
    return '<span class="fv-src" style="color:var(--rec-yellow)">ocena (ni potrjeno)</span>';
  }

  // ---------- Črtna koda (EAN) ----------
  function eanValid(s) {
    if (!/^\d{8}$|^\d{13}$/.test(s)) return false;
    const body = s.slice(0, -1).split('').map(Number);
    let sum = 0;
    body.forEach((d, i) => { sum += d * ((body.length - i) % 2 === 1 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === Number(s.slice(-1));
  }

  async function lookupOFF(ean) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + ean + '.json?fields=product_name,brands,nutriments', { signal: ctrl.signal });
      if (!r.ok) return null;
      const p = (await r.json()).product;
      const n = p && p.nutriments;
      if (!n || !(Number(n['energy-kcal_100g']) > 0)) return null;
      return { name: p.product_name || '', brands: p.brands || '', per100g: {
        kcal: Number(n['energy-kcal_100g']) || 0, protein: Number(n.proteins_100g) || 0,
        carbs: Number(n.carbohydrates_100g) || 0, fat: Number(n.fat_100g) || 0, fiber: Number(n.fiber_100g) || 0 } };
    } catch (e) { return null; } finally { clearTimeout(to); }
  }

  // Skener: BarcodeDetector če je na voljo (kamera), sicer ročni vnos EAN.
  async function scanBarcodeCamera() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) return null;
    const video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:10001;background:#000';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream; document.body.appendChild(video); await video.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
    try {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const codes = await det.detect(video);
        const v = codes.map(c => c.rawValue).find(eanValid);
        if (v) return v;
        await new Promise(r => setTimeout(r, 250));
      }
      return null;
    } finally { stream.getTracks().forEach(t => t.stop()); video.remove(); }
  }

  async function scanBarcode(i) {
    const it = review && review.items[i]; if (!it) return;
    let ean = null;
    try { ean = await scanBarcodeCamera(); } catch (e) { ean = null; }
    if (!ean) {
      const typed = window.prompt('Vnesi EAN (8 ali 13 številk, pod črtno kodo):', it.barcode || '');
      ean = typed ? typed.replace(/\D/g, '') : null;
    }
    if (!ean) return;
    if (!eanValid(ean)) { toast('⚠️ EAN ni veljaven (kontrolna številka).'); return; }
    toast('🔍 Iščem v Open Food Facts…');
    const off = await lookupOFF(ean);
    if (!off) { toast('Izdelka ni v Open Food Facts – ostane ocena.'); return; }
    Object.assign(it, { barcode: ean, verified: true, source: 'off_barcode', est: off.per100g, offName: off.name });
    if (!it.name || it.name === it.aiName) it.name = off.name || it.name;
    computeItem(it); renderReview();
    toast('✅ Vrednosti iz Open Food Facts (' + ean + ')');
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
    const verified = !!ai.verified;
    const it = {
      name: ai.name, grams: ai.grams || 100, confidence: ai.confidence,
      est: ai.per100g, aiEst: ai.ai_per100g || ai.per100g,
      estFromAI: !verified, match: null, candidates: [],
      source: ai.source || 'ai', verified, offName: ai.off_name || '',
      packaged: !!ai.packaged, brand: ai.brand || '', barcode: ai.barcode || null
    };
    const res = FoodMatch.bestMatch({ usda_query: ai.usda_query, name_en: ai.name_en, name: ai.name, per100g: ai.per100g });
    if (res && res.best) {
      it.candidates = res.candidates.slice(0, 8);
      // Potrjenih vrednosti (embalaža / OFF) USDA ne prepiše.
      if (!verified) {
        // Če baza da energijsko povsem drugačno živilo kot AI ocena, raje zaupaj AI oceni.
        const kc = FoodMatch.per100(res.best.index).calories || 0;
        const est = Number(ai.per100g && ai.per100g.kcal) || 0;
        const ratio = est > 0 && kc > 0 ? Math.min(kc, est) / Math.max(kc, est) : 1;
        if (ratio >= 0.7) it.match = { index: res.best.index, name: res.best.name };
      }
    }
    computeItem(it);
    return it;
  }

  function totals() {
    const t = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} };
    for (const it of (review?.items || [])) {
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
      .fv-quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:4px 0}
      .fv-quick-btn{padding:10px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;border-radius:10px;cursor:pointer;background:var(--surface-2);border:1px solid var(--edge-2);transition:all 0.15s ease}
      .fv-quick-btn:hover{background:var(--surface-3)}
      .fv-quick-btn.active{border-color:var(--rec-green);background:rgba(0,230,118,0.12)}
      .fv-quick-btn.active strong{color:var(--rec-green)}
      .fv-badge-clickable{cursor:pointer;transition:transform 0.15s ease}
      .fv-badge-clickable:active{transform:scale(0.95)}
    `;
    document.head.appendChild(css);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div class="modal-overlay" id="fvModalOverlay" onclick="if(event.target.id==='fvModalOverlay') FoodVision.close()">
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <div class="modal-sheet-handle"></div>
          <div class="modal-header-row">
            <div style="display:flex;align-items:center;gap:8px;">
              <h3 id="fvTitle" style="margin:0;">📸 Prepoznava obroka</h3>
              <button type="button" class="status-pill optimal fv-status-badge fv-badge-clickable" id="fvModalStatusBadge" onclick="FoodVision.checkHealth(true)" style="padding:2px 8px;font-size:0.7rem;font-weight:700;" title="Klikni za test AI povezave">🟢 AI Povezan</button>
            </div>
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
    document.getElementById('fvTitle').textContent = '📸 Prepoznava obroka';
    document.getElementById('fvBody').innerHTML = `
      ${photo ? `<img class="fv-photo" src="${photo}">` : ''}
      <div class="fv-spinner"></div>
      <div style="text-align:center;color:var(--text-2);font-size:.85rem;">${esc(msg)}</div>`;
  }

  // ---------- Hitri ocenjevalnik kalorij (Fallback ob napaki omrežja ali offline) ----------
  function syncQuickMacros(kcal) {
    quickState.p = Math.round(kcal * 0.25 / 4);
    quickState.c = Math.round(kcal * 0.45 / 4);
    quickState.f = Math.round(kcal * 0.30 / 9);
  }

  function renderQuickEstimatorBody(err) {
    injectModal();
    const b = document.getElementById('fvBody');
    if (!b) return;
    const photo = quickState.photo;
    const k = quickState.kcal;
    const errText = err ? (err.message || String(err)) : null;

    b.innerHTML = `
      ${photo ? `<img class="fv-photo" src="${photo}">` : ''}
      <div style="background:rgba(255,214,0,0.1);border:1px solid rgba(255,214,0,0.3);border-radius:10px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:0.75rem;color:var(--rec-yellow);line-height:1.3;">
          ${errText ? `⚠️ Strežnik ni dosegljiv (${esc(errText)}).` : '⚠️ Brez povezave s strežnikom.'} Vnesite hitro oceno:
        </span>
        <button type="button" class="btn secondary" style="padding:4px 8px;font-size:0.7rem;white-space:nowrap;" onclick="FoodVision.retry()">🔄 Ponovi AI</button>
      </div>

      <div class="fv-row">
        <input id="fvQuickMealName" class="fv-name" value="${esc(quickState.mealName)}" oninput="FoodVision.onQuickMealName(this.value)" placeholder="Ime obroka (npr. Kosilo)">
      </div>

      <div style="font-size:0.72rem;color:var(--text-3);font-weight:700;text-transform:uppercase;margin-top:2px;">
        Pametni predlogi kalorij (1-klik):
      </div>
      <div class="fv-quick-grid">
        <button type="button" class="fv-quick-btn ${k === 250 ? 'active' : ''}" onclick="FoodVision.setQuickKcal(250)">
          <strong style="font-size:1.1rem;color:#fff;">250</strong>
          <span style="font-size:0.62rem;color:var(--text-3);">Prigrizek</span>
        </button>
        <button type="button" class="fv-quick-btn ${k === 450 ? 'active' : ''}" onclick="FoodVision.setQuickKcal(450)">
          <strong style="font-size:1.1rem;color:#fff;">450</strong>
          <span style="font-size:0.62rem;color:var(--text-3);">Lahek</span>
        </button>
        <button type="button" class="fv-quick-btn ${k === 700 ? 'active' : ''}" onclick="FoodVision.setQuickKcal(700)">
          <strong style="font-size:1.1rem;color:#fff;">700</strong>
          <span style="font-size:0.62rem;color:var(--text-3);">Glavni</span>
        </button>
        <button type="button" class="fv-quick-btn ${k === 1000 ? 'active' : ''}" onclick="FoodVision.setQuickKcal(1000)">
          <strong style="font-size:1.1rem;color:#fff;">1000</strong>
          <span style="font-size:0.62rem;color:var(--text-3);">Krepak</span>
        </button>
      </div>

      <div style="background:var(--surface-2);border:1px solid var(--edge-1);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-size:0.75rem;color:var(--text-2);font-weight:700;">Kalorije:</span>
          <div style="display:flex;align-items:center;gap:4px;">
            <input id="fvQuickKcalInput" type="number" inputmode="numeric" value="${k}" oninput="FoodVision.onQuickKcalInput(this.value)" style="width:84px;text-align:center;font-size:1.15rem;font-weight:800;padding:6px 4px;background:var(--surface-3);border:1px solid var(--edge-2);border-radius:8px;color:#fff;">
            <span style="font-size:0.75rem;color:var(--text-3);font-weight:700;">kcal</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;">
          <div style="background:var(--surface-3);border-radius:8px;padding:6px 4px;">
            <span style="font-size:0.62rem;color:var(--text-3);text-transform:uppercase;">Beljakovine</span>
            <div style="display:flex;align-items:center;justify-content:center;gap:2px;">
              <input id="fvQuickProtein" type="number" inputmode="decimal" value="${quickState.p}" oninput="FoodVision.onQuickMacroChange()" style="width:48px;text-align:center;font-weight:700;color:var(--rec-green);background:transparent;border:none;font-size:0.95rem;">
              <span style="font-size:0.7rem;color:var(--text-3);">g</span>
            </div>
          </div>
          <div style="background:var(--surface-3);border-radius:8px;padding:6px 4px;">
            <span style="font-size:0.62rem;color:var(--text-3);text-transform:uppercase;">OH</span>
            <div style="display:flex;align-items:center;justify-content:center;gap:2px;">
              <input id="fvQuickCarbs" type="number" inputmode="decimal" value="${quickState.c}" oninput="FoodVision.onQuickMacroChange()" style="width:48px;text-align:center;font-weight:700;color:var(--strain-blue);background:transparent;border:none;font-size:0.95rem;">
              <span style="font-size:0.7rem;color:var(--text-3);">g</span>
            </div>
          </div>
          <div style="background:var(--surface-3);border-radius:8px;padding:6px 4px;">
            <span style="font-size:0.62rem;color:var(--text-3);text-transform:uppercase;">Maščobe</span>
            <div style="display:flex;align-items:center;justify-content:center;gap:2px;">
              <input id="fvQuickFat" type="number" inputmode="decimal" value="${quickState.f}" oninput="FoodVision.onQuickMacroChange()" style="width:48px;text-align:center;font-weight:700;color:var(--rec-yellow);background:transparent;border:none;font-size:0.95rem;">
              <span style="font-size:0.7rem;color:var(--text-3);">g</span>
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="btn" id="fvQuickSaveBtn" style="padding:13px;font-weight:800;font-size:0.95rem;background:linear-gradient(135deg,#00E676 0%,#00B0FF 100%);color:#08090A;box-shadow:0 4px 16px rgba(0,230,118,0.3);margin-top:2px;" onclick="FoodVision.saveQuickMeal()">
        ✓ Shrani obrok (${k} kcal)
      </button>

      <button type="button" class="btn secondary" style="padding:8px;font-size:0.8rem;" onclick="FoodVision.manual()">
        ✍️ Podrobno iskanje po USDA bazi (8.000 živil)
      </button>
    `;
  }

  function openQuickEstimator(photo, err) {
    open();
    const suggested = typeof getSuggestedMealName === 'function' ? getSuggestedMealName() : 'Obrok';
    quickState.photo = photo || lastPhoto || null;
    quickState.mealName = suggested;
    quickState.kcal = quickState.kcal || 450;
    syncQuickMacros(quickState.kcal);

    document.getElementById('fvTitle').textContent = '⚡ Hitra ocena kalorij';
    renderQuickEstimatorBody(err);
  }

  function setQuickKcal(val) {
    val = Math.round(Number(val) || 0);
    quickState.kcal = val;
    syncQuickMacros(val);
    renderQuickEstimatorBody(null);
  }

  function onQuickKcalInput(val) {
    const k = Math.max(0, Math.round(Number(val) || 0));
    quickState.kcal = k;
    syncQuickMacros(k);
    const pInp = document.getElementById('fvQuickProtein');
    const cInp = document.getElementById('fvQuickCarbs');
    const fInp = document.getElementById('fvQuickFat');
    if (pInp) pInp.value = quickState.p;
    if (cInp) cInp.value = quickState.c;
    if (fInp) fInp.value = quickState.f;
    const saveBtn = document.getElementById('fvQuickSaveBtn');
    if (saveBtn) saveBtn.textContent = `✓ Shrani obrok (${k} kcal)`;
    document.querySelectorAll('.fv-quick-btn').forEach(btn => {
      const match = btn.querySelector('strong')?.textContent === String(k);
      btn.classList.toggle('active', match);
    });
  }

  function onQuickMacroChange() {
    const p = Math.max(0, Number(document.getElementById('fvQuickProtein')?.value) || 0);
    const c = Math.max(0, Number(document.getElementById('fvQuickCarbs')?.value) || 0);
    const f = Math.max(0, Number(document.getElementById('fvQuickFat')?.value) || 0);
    quickState.p = p;
    quickState.c = c;
    quickState.f = f;
    const k = Math.round((p * 4) + (c * 4) + (f * 9));
    quickState.kcal = k;
    const kcalInp = document.getElementById('fvQuickKcalInput');
    if (kcalInp) kcalInp.value = k;
    const saveBtn = document.getElementById('fvQuickSaveBtn');
    if (saveBtn) saveBtn.textContent = `✓ Shrani obrok (${k} kcal)`;
  }

  function onQuickMealName(v) {
    quickState.mealName = v;
  }

  function saveQuickMeal() {
    const mealName = (document.getElementById('fvQuickMealName')?.value || quickState.mealName || '').trim() ||
      (typeof getSuggestedMealName === 'function' ? getSuggestedMealName() : 'Obrok');
    const k = Math.round(Number(quickState.kcal) || 450);
    const p = r1(quickState.p);
    const c = r1(quickState.c);
    const f = r1(quickState.f);

    const entry = {
      id: 'm_' + Date.now(),
      date: (window.prehranaState && prehranaState.selectedDate) || (typeof PrehranaDays !== 'undefined' ? PrehranaDays.isoOf() : new Date().toISOString().slice(0, 10)),
      name: mealName,
      serving: `${k} kcal (hitra ocena)`,
      calories: k,
      protein: p,
      carbs: c,
      fat: f,
      fiber: 0,
      micros: {},
      items: [{
        name: mealName,
        grams: 100,
        usda: null,
        calories: k,
        protein: p,
        carbs: c,
        fat: f
      }],
      source: 'MANUAL_QUICK',
      time: new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' }),
      photo: quickState.photo || null
    };

    if (window.prehranaState && Array.isArray(prehranaState.meals)) {
      prehranaState.meals.push(entry);
      try {
        if (typeof savePrehranaState === 'function') savePrehranaState();
      } catch (e) {
        entry.photo = null;
        if (typeof savePrehranaState === 'function') savePrehranaState();
      }
      if (typeof renderPrehranaView === 'function') renderPrehranaView();
    }

    close();
    toast(`✅ ${entry.name}: ${entry.calories} kcal · B ${Math.round(entry.protein)} g`);
  }

  function microLine(m) {
    const show = [['iron', 'Fe', 'mg'], ['zinc', 'Zn', 'mg'], ['magnesium', 'Mg', 'mg'], ['calcium', 'Ca', 'mg'], ['potassium', 'K', 'mg'], ['sodium', 'Na', 'mg'], ['vitaminB12', 'B12', 'µg'], ['vitaminD', 'D', 'µg'], ['vitaminC', 'C', 'mg'], ['selenium', 'Se', 'µg'], ['omega3DHA', 'DHA', 'g'], ['leucine', 'Leu', 'g']];
    return show.filter(([k]) => m[k] != null && m[k] > 0).map(([k, l, u]) => `${l} ${r1(m[k])}${u}`).join(' · ');
  }

  function renderReview() {
    const b = document.getElementById('fvBody');
    document.getElementById('fvTitle').textContent = '📸 Prepoznava obroka';
    const t = totals();
    const items = review.items.map((it, i) => {
      const n = it.nutr || {};
      const opts = (it.candidates || []).map(c => `<option value="${c.index}" ${it.match && it.match.index === c.index ? 'selected' : ''}>${esc(c.name.slice(0, 70))}</option>`).join('');
      const conf = it.confidence != null ? `<span class="fv-conf" style="color:${it.confidence >= 0.75 ? 'var(--rec-green)' : it.confidence >= 0.5 ? 'var(--rec-yellow)' : 'var(--rec-red)'}">${Math.round(it.confidence * 100)} %</span>` : '';
      const scanBtn = it.packaged ? `<button type="button" class="fv-scan" onclick="FoodVision.scanBarcode(${i})" style="background:none;border:1px solid var(--edge-2);border-radius:6px;color:var(--text-2);font-size:.66rem;padding:2px 6px;cursor:pointer">📷 Skeniraj črtno kodo</button>` : '';
      const srcLine = `<div class="fv-src-line" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${sourceBadge(it)}${scanBtn}</div>`;
      return `
      <div class="fv-item" data-i="${i}">
        <div class="fv-row">
          <input class="fv-name" value="${esc(it.name)}" oninput="FoodVision.onName(${i}, this.value)" placeholder="Živilo (npr. puran)">
          <input class="fv-grams" type="number" inputmode="decimal" value="${it.grams}" oninput="FoodVision.onGrams(${i}, this.value)"><span style="font-size:.7rem;color:var(--text-3)">g</span>
          <button class="fv-del" onclick="FoodVision.remove(${i})" title="Odstrani">✕</button>
        </div>
        ${srcLine}
        <div class="fv-match">${conf}
          ${it.verified ? `<span style="color:var(--text-3)">${it.source === 'label' ? 'Hranila s tabele na embalaži' : 'Hranila iz Open Food Facts'}${it.barcode ? ' · EAN ' + esc(it.barcode) : ''}</span>` : it.match ? `<span>USDA:</span><select onchange="FoodVision.pick(${i}, this.value)">${opts}</select>` : `<span style="color:var(--rec-yellow)">Ni zadetka v bazi — uporabljena ocena AI. Popravi ime.</span>`}
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

  function refreshItem(i) {
    if (!review) return;
    const it = review.items[i];
    if (!it) return;
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
    timers[i] = setTimeout(() => { if (!review || review.items[i] !== it) return; it.estFromAI = false; rematch(it, v); refreshItem(i); }, 300);
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
  function onMealName(v) { if (review) review.mealName = v; }

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
    if (window.prehranaState && Array.isArray(prehranaState.meals)) {
      prehranaState.meals.push(entry);
      try { if (typeof savePrehranaState === 'function') savePrehranaState(); } catch (e) {
        entry.photo = null; if (typeof savePrehranaState === 'function') savePrehranaState();
      }
      if (typeof renderPrehranaView === 'function') renderPrehranaView();
    }
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
      console.warn('[FoodVision] AI analiza ni uspela, odpiram hitri vnos:', e);
      openQuickEstimator(photo, e);
    }
  }

  async function manual() {
    try { await ensureDb(); } catch (e) { return openQuickEstimator(lastPhoto, e); }
    review = { photo: lastPhoto, mealName: typeof getSuggestedMealName === 'function' ? getSuggestedMealName() : '', items: [] };
    open(); renderReview(); add();
  }

  function handleFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    renderLoading(null, 'Stiskam sliko…');
    if (typeof compressAndResizeImage === 'function') {
      compressAndResizeImage(file, { maxDim: 1024, initialQuality: 0.8, maxSizeKB: 220 })
        .then(res => run(res.dataUrl))
        .catch(err => openQuickEstimator(null, err));
    } else {
      const reader = new FileReader();
      reader.onload = e => run(e.target.result);
      reader.onerror = err => openQuickEstimator(null, err);
      reader.readAsDataURL(file);
    }
  }

  window.FoodVision = {
    run,
    retry: () => lastPhoto ? run(lastPhoto) : (typeof triggerDirectFoodPhotoUpload === 'function' ? triggerDirectFoodPhotoUpload() : null),
    manual,
    quick: openQuickEstimator,
    setQuickKcal,
    onQuickKcalInput,
    onQuickMacroChange,
    onQuickMealName,
    saveQuickMeal,
    checkHealth,
    scanBarcode,
    close,
    onName,
    onGrams,
    pick,
    remove,
    add,
    onMealName,
    save,
    handleFile,
    ensureDb,
    analyzePhoto,
    _state: () => review,
    _quickState: () => quickState,
    _lastHealth: () => lastHealthStatus
  };

  // Prevzemi obstoječe foto gumbe (FAB, "Foto Obrok").
  window.handleDirectFoodPhotoUpload = handleFile;
  ensureDb().catch(() => {}); // predhodno naloži bazo v ozadju

  // Avtomatski preizkus zdravja ob zagonu (brez motenja uporabnika)
  setTimeout(() => {
    checkHealth(false).catch(() => {});
  }, 350);
})();
