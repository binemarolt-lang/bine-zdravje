/**
 * Bine Zdravje — Skin & Hair UI Module (skinhair-ui.js)
 * 
 * Interaktivni vmesnik za spremljanje kože, aken, las in vizualnega napredka.
 * Popolna integracija s SkinHairEngine in SkinStorage.
 * 
 * Vsebuje:
 * - Dvojni estetski obroči (Skin Score & Hair Index)
 * - Interaktivni Before/After Split Slider z zaveso (clip-path)
 * - Cross-Dissolve prosojni primerjalnik
 * - Interaktivni conski GAGS kalkulator aken (obraz + trup)
 * - Norwood lestvica & sledilnik lasišča s shedding oceno
 * - Cirkadiana AM/PM rutina z zaznavo kemijskih konfliktov
 * - 24-urna varnostna zapora mikroneedlinga pred minoksidilom
 * - Ghost Overlay kamera s pomožnimi anatomskimi mrežami
 * - Izvoz v Obsidian Vault (Zdravje/koza/ in Zdravje/lasje/)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkinHairUI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ========== KLJUČI IN STANJE ==========
  const LS_STATE_KEY = 'bine_zdravje_skin_hair_meta_v1';

  // Privzeto stanje
  const DEFAULT_STATE = {
    activeSubTab: 'pregled', // 'pregled' | 'primerjalnik' | 'akne' | 'lasje' | 'rutina'
    
    // Akne & GAGS
    acneZones: {
      forehead: 0,
      right_cheek: 0,
      left_cheek: 0,
      nose: 0,
      chin: 0,
      chest_back: 0
    },

    // Lasje & Norwood
    hair: {
      norwoodStage: '2',
      hairlineRecessionMm: 2,
      vertexCoveragePct: 92,
      sheddingScore: 2
    },

    // Rutina sestavin
    skincare: {
      amActives: ['azelaic_acid', 'ceramides', 'spf_50'],
      pmActives: ['tretinoin', 'ceramides'],
      amCompleted: false,
      pmCompleted: false,
      lastUpdated: null
    },

    // Protokol za lase
    hairProtocol: {
      minoxidilApplied: false,
      finasterideTaken: false,
      ketoconazoleWash: false,
      lastMicroneedleDate: null,
      streakDays: 14
    },

    // Primerjalnik fotografij
    comparison: {
      activeCategory: 'vse',
      photoA: null, // bazna fotografija
      photoB: null, // primerjalna fotografija
      splitPositionPct: 50,
      opacityBlendPct: 50,
      mode: 'split', // 'split' | 'blend'
      selectedInterval: null // npr. 1, 3, 6 (mesecev)
    },

    // Seznam lokalnih fotografij (metapodatki + thumbnail)
    photos: []
  };

  let state = loadState();
  let selectedNewPhotoCat = 'obraz';

  function loadState() {
    try {
      const saved = localStorage.getItem(LS_STATE_KEY);
      if (saved) {
        return Object.assign({}, DEFAULT_STATE, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('[SkinHairUI] Napaka pri branju localStorage:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState() {
    try {
      const stateToSave = JSON.parse(JSON.stringify(state));
      if (Array.isArray(stateToSave.photos)) {
        stateToSave.photos = stateToSave.photos.map(p => {
          if (p.storage === 'indexedDB' || (p.url && p.url.startsWith('blob:'))) {
            return {
              id: p.id,
              date: p.date,
              timestamp: p.timestamp,
              category: p.category,
              storage: 'indexedDB'
            };
          }
          if (p.url && !p.url.startsWith('data:')) {
            return p;
          }
          if (p.url && p.url.startsWith('data:') && p.url.length > 50000) {
            return {
              id: p.id,
              date: p.date,
              timestamp: p.timestamp,
              category: p.category,
              storage: 'data_omitted'
            };
          }
          return p;
        });
      }
      localStorage.setItem(LS_STATE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.warn('[SkinHairUI] Napaka pri shranjevanju v localStorage:', e);
    }
  }

  // ========== TREZOR FOTOGRAFIJ (PIN, opcijsko) ==========
  // Stanje trezorja je le v RAM-u / IndexedDB (SkinStorage). PIN se NIKOLI ne shranjuje v state, localStorage ali log.
  let vaultStatus = { configured: null, unlocked: false }; // configured: null = še ni znano
  let vaultMessage = '';
  let vaultListenersAttached = false;

  const VAULT_INPUT_STYLE = 'flex: 1; min-width: 120px; min-height: 44px; font-size: 16px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border, #3a3a3c); background: var(--surface-2); color: var(--text-1);';
  const VAULT_BTN_STYLE = 'min-height: 44px; min-width: 110px; font-size: 0.85rem; font-weight: 600;';

  async function refreshVaultStatus() {
    if (typeof window === 'undefined' || !window.SkinStorage) {
      vaultStatus = { configured: false, unlocked: false };
      return;
    }
    try {
      vaultStatus = {
        configured: Boolean(await window.SkinStorage.isPinConfigured()),
        unlocked: Boolean(window.SkinStorage.isUnlocked())
      };
    } catch (e) {
      console.warn('[SkinHairUI] Stanja trezorja ni mogoče prebrati:', e);
      vaultStatus = { configured: null, unlocked: false };
    }
  }

  function readPinInput(id) {
    const el = document.getElementById(id);
    const value = el ? el.value : '';
    if (el) el.value = '';
    return value;
  }

  function isValidPin(pin) {
    return /^[0-9]{4,12}$/.test(pin);
  }

  async function safeGetPhoto(id) {
    try {
      return await window.SkinStorage.getPhoto(id);
    } catch (e) {
      return null; // npr. šifrirana fotografija, ko je sef zaklenjen
    }
  }

  // Ponovno zgradi seznam fotografij iz skinHairDB. Šifrirane fotografije so vidne le, ko je sef odklenjen.
  async function rehydratePhotosFromStorage() {
    if (typeof window === 'undefined' || !window.SkinStorage) return;
    const SS = window.SkinStorage;
    try {
      const listed = await SS.listPhotos();
      const dbPhotos = Array.isArray(listed) ? listed : [];
      const unlocked = Boolean(SS.isUnlocked());
      const rebuilt = [];

      for (const dbp of dbPhotos) {
        if (dbp.isEncrypted && !unlocked) continue; // zaklenjeno: ne prikažemo
        const rec = await safeGetPhoto(dbp.id);
        if (!rec || !rec.photoUrl) continue;
        rebuilt.push({
          id: dbp.id,
          date: dbp.date,
          timestamp: dbp.timestamp,
          category: dbp.category || 'obraz',
          url: rec.photoUrl,
          thumbnail: rec.thumbnailUrl || rec.photoUrl,
          storage: 'indexedDB'
        });
      }

      // Sprosti stare object URL-je fotografij iz baze in ohrani ostale vnose (npr. lokalni FileReader fallback)
      const others = [];
      for (const p of (state.photos || [])) {
        if (p.storage === 'indexedDB') {
          if (p.url && p.url.startsWith('blob:')) SS.revokeSecureUrl(p.url);
          if (p.thumbnail && p.thumbnail.startsWith('blob:') && p.thumbnail !== p.url) SS.revokeSecureUrl(p.thumbnail);
        } else {
          others.push(p);
        }
      }

      state.photos = rebuilt.concat(others);
    } catch (e) {
      console.warn('[SkinHairUI] Rehidracija fotografij iz skinHairDB:', e);
    }
  }

  function attachVaultListeners() {
    if (vaultListenersAttached || typeof window === 'undefined') return;
    vaultListenersAttached = true;
    // Samodejni zaklep (neaktivnost) mora skriti šifrirane fotografije tudi, če uporabnik ni kliknil "Zakleni"
    window.addEventListener('skin-vault:locked', async () => {
      await refreshVaultStatus();
      await rehydratePhotosFromStorage();
      render();
    });
  }

  function renderVaultCard() {
    const s = vaultStatus;
    let label = 'Nalagam…';
    let color = 'var(--text-3)';
    if (s.configured === false) {
      label = 'Izključeno (privzeto)';
    } else if (s.configured === true && s.unlocked) {
      label = 'Odklenjeno';
      color = '#34d399';
    } else if (s.configured === true) {
      label = 'Zaklenjeno';
      color = '#fbbf24';
    }

    let controls = '';
    if (s.configured === false) {
      controls = `
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
          <input id="shVaultPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="12" placeholder="Nov PIN (4–12 številk)" style="${VAULT_INPUT_STYLE}">
          <input id="shVaultPin2" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="12" placeholder="Potrdi PIN" style="${VAULT_INPUT_STYLE}">
        </div>
        <button type="button" class="btn primary" style="${VAULT_BTN_STYLE} width: 100%;" onclick="SkinHairUI.vaultEnable()">Vklopi PIN</button>`;
    } else if (s.configured === true) {
      controls = s.unlocked
        ? `<button type="button" class="btn secondary" style="${VAULT_BTN_STYLE} width: 100%;" onclick="SkinHairUI.vaultLock()">Zakleni</button>`
        : `<div style="display: flex; gap: 8px; flex-wrap: wrap;">
             <input id="shVaultPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" maxlength="12" placeholder="PIN" style="${VAULT_INPUT_STYLE}">
             <button type="button" class="btn primary" style="${VAULT_BTN_STYLE}" onclick="SkinHairUI.vaultUnlock()">Odkleni</button>
           </div>`;
      controls += `
        <details style="margin-top: 10px;">
          <summary style="min-height: 44px; display: flex; align-items: center; font-size: 0.8rem; color: var(--text-2); cursor: pointer;">Izklopi zaščito…</summary>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
            <input id="shVaultPinOff" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" maxlength="12" placeholder="PIN za izklop" style="${VAULT_INPUT_STYLE}">
            <button type="button" class="btn secondary" style="${VAULT_BTN_STYLE}" onclick="SkinHairUI.vaultDisable()">Izklopi zaščito</button>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-3); margin-top: 4px;">Izklop je mogoč le, ko v trezorju ni šifriranih fotografij.</div>
        </details>`;
    }

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">🔒 Zaščita fotografij</div>
          <span style="font-size: 0.75rem; font-weight: 600; color: ${color};">${label}</span>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-3); margin: 6px 0 10px;">
          Opcijsko: PIN šifrira NOVE fotografije v brskalniku (AES-256-GCM). Fotografije, shranjene pred vklopom, ostanejo nešifrirane (samodejne pretvorbe ni). Zaklep skrije šifrirane fotografije. Pozabljen PIN pomeni, da šifrirane fotografije ne bodo več dostopne.
        </div>
        ${controls}
        ${vaultMessage ? `<div role="status" style="font-size: 0.78rem; color: var(--text-1); margin-top: 8px;">${vaultMessage}</div>` : ''}
      </div>`;
  }

  async function vaultEnable() {
    const SS = window.SkinStorage;
    const p1 = readPinInput('shVaultPin');
    const p2 = readPinInput('shVaultPin2');
    if (!SS) { vaultMessage = 'Modul trezorja ni na voljo.'; return render(); }
    if (!isValidPin(p1)) { vaultMessage = 'PIN mora imeti 4 do 12 številk.'; return render(); }
    if (p1 !== p2) { vaultMessage = 'PIN-a se ne ujemata.'; return render(); }
    try {
      await SS.setupVaultPin(p1);
      vaultMessage = 'Zaščita vklopljena. Nove fotografije bodo šifrirane; stare ostanejo nešifrirane.';
    } catch (e) {
      vaultMessage = 'Vklop ni uspel: ' + (e && e.message ? e.message : 'neznana napaka');
    }
    await refreshVaultStatus();
    await rehydratePhotosFromStorage();
    render();
  }

  async function vaultUnlock() {
    const SS = window.SkinStorage;
    const pin = readPinInput('shVaultPin');
    if (!SS) return;
    if (!isValidPin(pin)) { vaultMessage = 'PIN mora imeti 4 do 12 številk.'; return render(); }
    try {
      const res = await SS.unlockVault(pin);
      vaultMessage = res.success ? 'Odklenjeno.' : 'Napačen PIN.';
    } catch (e) {
      vaultMessage = 'Odklepanje ni uspelo.';
    }
    await refreshVaultStatus();
    await rehydratePhotosFromStorage();
    render();
  }

  async function vaultLock() {
    if (!window.SkinStorage) return;
    window.SkinStorage.lockVault();
    vaultMessage = 'Zaklenjeno. Šifrirane fotografije so skrite.';
    await refreshVaultStatus();
    await rehydratePhotosFromStorage();
    render();
  }

  async function vaultDisable() {
    const SS = window.SkinStorage;
    const pin = readPinInput('shVaultPinOff');
    if (!SS) return;
    if (!isValidPin(pin)) { vaultMessage = 'Za izklop vnesi PIN (4 do 12 številk).'; return render(); }
    try {
      const res = await SS.disableVaultPin(pin);
      if (res.success) {
        vaultMessage = 'Zaščita izklopljena. Nove fotografije bodo shranjene brez šifriranja.';
      } else if (res.error === 'NAPAČEN_PIN') {
        vaultMessage = 'Napačen PIN.';
      } else if (res.error === 'SIFRIRANE_FOTOGRAFIJE') {
        vaultMessage = `Izklop ni mogoč: v trezorju je še ${res.count} šifriranih fotografij. Najprej jih izbriši.`;
      } else {
        vaultMessage = 'Izklop ni uspel.';
      }
    } catch (e) {
      vaultMessage = 'Izklop ni uspel: ' + (e && e.message ? e.message : 'neznana napaka');
    }
    await refreshVaultStatus();
    await rehydratePhotosFromStorage();
    render();
  }

  // ========== RENDER FUNKCIJE ==========

  async function mount() {
    const container = document.getElementById('view-estetika');
    if (!container) return;
    attachVaultListeners();
    render();
    await refreshVaultStatus();
    await rehydratePhotosFromStorage();
    render();
  }

  function render() {
    const container = document.getElementById('view-estetika');
    if (!container) return;

    // Pridobi izračune iz SkinHairEngine
    const engine = window.SkinHairEngine;
    const gagsResult = engine ? engine.calculateGAGS(state.acneZones) : { score: 0, skinHealthScore: 100, severityLabel: 'Čisto', color: '#34d399' };
    const hairResult = engine ? engine.calculateHairIndex(state.hair) : { hairIndex: 90, statusLabel: 'Stabilno', color: '#34d399' };
    const needleLock = engine ? engine.checkMicroneedleLockout(state.hairProtocol.lastMicroneedleDate) : { isLocked: false };
    
    // Preveri lifestyle korelacije z obstoječim stanjem aplikacije (Whoop / Cikel)
    let triggers = [];
    if (engine) {
      const appState = window.appState || {};
      const estradiol = appState.bloodwork ? appState.bloodwork.e2 : 22;
      triggers = engine.analyzeTriggersAndRisks({
        wheyGramsToday: 40,
        postWorkoutShowerDelayMin: 20,
        estradiolPgMl: estradiol,
        testDoseMg: 20,
        eqDoseMg: 10
      });
    }

    container.innerHTML = `
      <!-- GLAVA IN PODZAVIHČKI -->
      <div class="card" style="margin-bottom: 12px; padding: 12px 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.3rem;">✨</span>
            <div>
              <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-1);">Koža, Akne & Lasje</div>
              <div style="font-size: 0.72rem; color: var(--text-3);">Klinični GAGS, Norwood analiza in Before/After primerjalnik</div>
            </div>
          </div>
          <button class="btn secondary" style="font-size: 0.72rem; padding: 4px 8px;" onclick="SkinHairUI.triggerPhotoUploadModal()">
            📷 Slikaj
          </button>
        </div>

        <!-- Segmentirani nadzornik (Sub-tabs) -->
        <div class="sh-subtabs">
          <button class="sh-tab-btn ${state.activeSubTab === 'pregled' ? 'active' : ''}" onclick="SkinHairUI.switchSubTab('pregled')">📊 Pregled</button>
          <button class="sh-tab-btn ${state.activeSubTab === 'lasje' ? 'active' : ''}" onclick="SkinHairUI.switchSubTab('lasje')">💈 Lasje</button>
          <button class="sh-tab-btn ${state.activeSubTab === 'dnevnik' ? 'active' : ''}" onclick="SkinHairUI.switchSubTab('dnevnik')">📖 Dnevnik Vnosov</button>
          <button class="sh-tab-btn ${state.activeSubTab === 'rutina' ? 'active' : ''}" onclick="SkinHairUI.switchSubTab('rutina')">🧪 Rutina</button>
          <button class="sh-tab-btn ${state.activeSubTab === 'akne' ? 'active' : ''}" onclick="SkinHairUI.switchSubTab('akne')">🔴 Akne (GAGS)</button>
          <button class="sh-tab-btn ${state.activeSubTab === 'primerjalnik' ? 'active' : ''}" onclick="SkinHairUI.switchSubTab('primerjalnik')">🔍 Primerjalnik</button>
        </div>
      </div>

      <!-- VSEBINA AKTIVNEGA PODZAVIHKA -->
      <div id="sh-content-area">
        ${renderSubTabContent(state.activeSubTab, gagsResult, hairResult, needleLock, triggers)}
      </div>

    `;

    ensureCameraModal();

    // Inicializiraj poslušalce za drsnike, če smo na primerjalniku
    if (state.activeSubTab === 'primerjalnik') {
      initSplitSlider();
    }
  }

  // Modal za foto mora živeti na document.body: znotraj #view-estetika/.container
  // ga stacking context (z-index 10 + transform animacije) potisne pod spodnjo navigacijo (z 200).
  function ensureCameraModal() {
    if (typeof document === 'undefined' || !document.body) return;
    let modal = document.getElementById('shCameraModalOverlay');
    if (modal && modal.parentElement === document.body) return;
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'shCameraModalOverlay';
    modal.style.display = 'none';
    modal.style.zIndex = '1200';
    modal.setAttribute('onclick', "if(event.target.id==='shCameraModalOverlay') SkinHairUI.closeCameraModal()");
    modal.innerHTML = `
        <div class="modal" style="max-width: 480px; padding: 0;">
          <div class="modal-header" style="padding: 12px 16px;">
            <div class="modal-sheet-handle"></div>
            <div class="modal-header-row">
              <h3 style="margin: 0; font-size: 0.95rem;">📸 Standardiziran Foto Zajem</h3>
              <button type="button" class="modal-close" style="width: 44px; height: 44px;" onclick="SkinHairUI.closeCameraModal()">✕</button>
            </div>
          </div>
          <div class="modal-body" style="padding: 14px;">
            ${renderCameraModalBody()}
          </div>
        </div>
    `;
    document.body.appendChild(modal);
  }

  function renderSubTabContent(subTab, gags, hair, needleLock, triggers) {
    switch (subTab) {
      case 'pregled':
        return renderPregledView(gags, hair, needleLock, triggers);
      case 'primerjalnik':
        return renderPrimerjalnikView();
      case 'akne':
        return renderAkneView(gags);
      case 'lasje':
        return renderLasjeView(hair, needleLock);
      case 'dnevnik':
        if (window.ProtocolDiaryUI && typeof window.ProtocolDiaryUI.getDiaryViewHtml === 'function') {
          return window.ProtocolDiaryUI.getDiaryViewHtml();
        }
        return '<div style="text-align: center; padding: 30px 10px; color: var(--text-3); font-size: 0.8rem;">📖 Nalagam dnevnik vnosov...</div>';
      case 'rutina':
        return renderRutinaView(needleLock);
      default:
        return renderPregledView(gags, hair, needleLock, triggers);
    }
  }

  // ========== 1. PODZAVIHEK: PREGLED ==========
  function getLastPhotoInfo() {
    const photos = state.photos || [];
    if (!photos || photos.length === 0) return null;
    let latestTs = 0;
    for (const p of photos) {
      let ts = p.timestamp;
      if (!ts && p.date) {
        const parsed = Date.parse(p.date);
        if (!isNaN(parsed)) ts = parsed;
      }
      if (ts && ts > latestTs) {
        latestTs = ts;
      }
    }
    if (!latestTs) return null;
    const diffDays = Math.max(0, Math.floor((Date.now() - latestTs) / (1000 * 60 * 60 * 24)));
    return { latestTs, diffDays };
  }

  function formatPhotoReminderText() {
    const info = getLastPhotoInfo();
    if (!info) {
      return 'Zadnja fotografija: še ni posneta, priporočeno fotografirati v istih pogojih';
    }
    const x = info.diffDays;
    let daysStr;
    if (x === 0) {
      daysStr = 'pred 0 dnevi (danes)';
    } else if (x === 1) {
      daysStr = 'pred 1 dnem';
    } else if (x === 2) {
      daysStr = 'pred 2 dnevoma';
    } else if (x === 3 || x === 4) {
      daysStr = `pred ${x} dnevi`;
    } else {
      daysStr = `pred ${x} dnevi`;
    }
    return `Zadnja fotografija: ${daysStr}, priporočeno fotografirati v istih pogojih`;
  }

  function renderPregledView(gags, hair, needleLock, triggers) {
    const skinScore = gags.skinHealthScore;
    const hairScore = hair.hairIndex;

    return `
      ${renderVaultCard()}

      <!-- OPOMNIK ZA FOTOGRAFIRANJE -->
      <div class="card sh-photo-reminder-banner" style="margin-bottom: 12px; background: var(--surface-2); border-left: 3px solid var(--strain-blue, #38bdf8); padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="font-size: 0.78rem; color: var(--text-1); line-height: 1.4;">
          📸 <span>${formatPhotoReminderText()}</span>
        </div>
        <button type="button" class="btn secondary" style="font-size: 0.72rem; padding: 0 10px; min-height: 44px; flex-shrink: 0;" onclick="SkinHairUI.switchSubTab('primerjalnik')">Primerjalnik</button>
      </div>

      <!-- DVOJNI ESTETSKI OBROČ (Twin Aesthetics Rings) -->
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">✨ Estetski Indeksi v Živo</div>
          <span style="font-size: 0.72rem; color: var(--text-3);">100% lokalno</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
          <!-- Skin Health Ring -->
          <div class="sh-ring-card">
            <div style="font-size: 0.75rem; color: var(--text-2); font-weight: 600; margin-bottom: 6px;">🧴 Zdravje Kože</div>
            <div class="sh-score-circle" style="border-color: ${gags.color};">
              <span class="sh-score-num" style="color: ${gags.color};">${skinScore}</span>
              <span class="sh-score-lbl">/ 100</span>
            </div>
            <div style="font-size: 0.75rem; font-weight: 600; color: ${gags.color}; margin-top: 6px;">${gags.severityLabel}</div>
            <div style="font-size: 0.68rem; color: var(--text-3);">GAGS točke: ${gags.score} / 40</div>
          </div>

          <!-- Hair Index Ring -->
          <div class="sh-ring-card">
            <div style="font-size: 0.75rem; color: var(--text-2); font-weight: 600; margin-bottom: 6px;">💈 Indeks Las</div>
            <div class="sh-score-circle" style="border-color: ${hair.color};">
              <span class="sh-score-num" style="color: ${hair.color};">${hairScore}</span>
              <span class="sh-score-lbl">/ 100</span>
            </div>
            <div style="font-size: 0.75rem; font-weight: 600; color: ${hair.color}; margin-top: 6px;">${hair.stageName}</div>
            <div style="font-size: 0.68rem; color: var(--text-3);">${hair.statusLabel}</div>
          </div>
        </div>
      </div>

      <!-- VARNOSTNA OPOZORILA & ZAPORE -->
      ${needleLock.isLocked ? `
        <div class="card" style="margin-bottom: 12px; border-left: 4px solid #ef4444; background: rgba(239, 68, 68, 0.08);">
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <span style="font-size: 1.3rem;">🛑</span>
            <div>
              <div style="font-weight: 700; font-size: 0.85rem; color: #ef4444;">Varnostna zapora Minoksidila aktivna</div>
              <div style="font-size: 0.75rem; color: var(--text-2); margin-top: 2px;">${needleLock.message}</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- SPROŽILCI IN KORELACIJE (Lifestyle Insights) -->
      ${triggers.length > 0 ? `
        <div class="card" style="margin-bottom: 12px;">
          <div class="card-header">
            <div class="card-title">⚠️ Zaznani Hormonski & Kožni Sprožilci</div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
            ${triggers.map(t => `
              <div style="background: var(--surface-2); border-left: 3px solid ${t.severity === 'critical' ? '#ef4444' : '#fbbf24'}; padding: 8px 10px; border-radius: 6px;">
                <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-1);">${t.title}</div>
                <div style="font-size: 0.73rem; color: var(--text-2); margin-top: 2px;">${t.message}</div>
                <div style="font-size: 0.72rem; color: var(--rec-green); margin-top: 4px; font-weight: 500;">💡 Priporočilo: ${t.action}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- HITRI POVZETEK DNEVNEGA PROTOKOLA -->
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">📅 Današnji Protokol Nege</div>
          <button class="btn secondary" style="font-size: 0.7rem; padding: 2px 8px;" onclick="SkinHairUI.switchSubTab('rutina')">Uredi</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <div style="background: var(--surface-2); padding: 8px; border-radius: 8px;">
            <div style="font-size: 0.7rem; color: var(--text-3);">☀️ Jutro (AM)</div>
            <div style="font-weight: 600; font-size: 0.8rem; color: ${state.skincare.amCompleted ? 'var(--rec-green)' : 'var(--text-1)'};">
              ${state.skincare.amCompleted ? '✓ Opravljeno' : '○ V teku (AzA + SPF)'}
            </div>
          </div>
          <div style="background: var(--surface-2); padding: 8px; border-radius: 8px;">
            <div style="font-size: 0.7rem; color: var(--text-3);">🌙 Večer (PM)</div>
            <div style="font-weight: 600; font-size: 0.8rem; color: ${state.skincare.pmCompleted ? 'var(--rec-green)' : 'var(--text-1)'};">
              ${state.skincare.pmCompleted ? '✓ Opravljeno' : '○ Tretinoin + Cica'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ========== 2. PODZAVIHEK: PRIMERJALNIK FOTOGRAFIJ ==========
  function renderPrimerjalnikView() {
    const activeCat = state.comparison.activeCategory || 'vse';
    const allPhotos = state.photos || [];
    const filteredPhotos = allPhotos.filter(p => activeCat === 'vse' || p.category === activeCat);

    return `
      <!-- OPOMNIK ZA FOTOGRAFIRANJE -->
      <div class="card sh-photo-reminder-banner" style="margin-bottom: 12px; background: var(--surface-2); border-left: 3px solid var(--strain-blue, #38bdf8); padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="font-size: 0.78rem; color: var(--text-1); line-height: 1.4;">
          📸 <span>${formatPhotoReminderText()}</span>
        </div>
        <button type="button" class="btn secondary" style="font-size: 0.72rem; padding: 0 10px; min-height: 44px; flex-shrink: 0;" onclick="SkinHairUI.triggerPhotoUploadModal()">+ Foto</button>
      </div>

      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">🔍 Before / After Primerjalnik</div>
          <div style="display: flex; gap: 6px;">
            <button class="btn ${state.comparison.mode === 'split' ? 'primary' : 'secondary'}" style="font-size: 0.7rem; padding: 3px 8px; min-height: 44px;" onclick="SkinHairUI.setCompareMode('split')">Zavesa</button>
            <button class="btn ${state.comparison.mode === 'blend' ? 'primary' : 'secondary'}" style="font-size: 0.7rem; padding: 3px 8px; min-height: 44px;" onclick="SkinHairUI.setCompareMode('blend')">Bledenje</button>
          </div>
        </div>

        <!-- Filtrirni čipi -->
        <div style="display: flex; gap: 6px; overflow-x: auto; padding: 6px 0 10px 0;">
          ${['vse', 'obraz', 'lasna_linija', 'temen', 'hrbet', 'prsa'].map(cat => `
            <button class="sh-cat-chip ${activeCat === cat ? 'active' : ''}" style="min-height: 44px;" onclick="SkinHairUI.filterCategory('${cat}')">
              ${cat === 'vse' ? 'Vse' : cat === 'obraz' ? 'Obraz' : cat === 'lasna_linija' ? 'Linija' : cat === 'temen' ? 'Temen' : cat === 'hrbet' ? 'Hrbet' : 'Prsa'}
            </button>
          `).join('')}
        </div>

        <!-- Izbira intervala napredka (1/3/6 mesecev) -->
        <div style="margin: 4px 0 12px 0; background: rgba(0,0,0,0.18); padding: 8px 10px; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">📅 Interval napredka:</span>
            ${state.comparison.selectedInterval ? `<span style="font-size: 0.68rem; color: var(--rec-green);">Samodejno izbrani fotografiji (${state.comparison.selectedInterval}M)</span>` : ''}
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn ${state.comparison.selectedInterval === 1 ? 'primary' : 'secondary'}"
                    style="flex: 1; min-height: 44px; font-size: 0.74rem; padding: 0 8px;"
                    onclick="SkinHairUI.selectCompareInterval(1)">
              1 mesec
            </button>
            <button type="button" class="btn ${state.comparison.selectedInterval === 3 ? 'primary' : 'secondary'}"
                    style="flex: 1; min-height: 44px; font-size: 0.74rem; padding: 0 8px;"
                    onclick="SkinHairUI.selectCompareInterval(3)">
              3 mesece
            </button>
            <button type="button" class="btn ${state.comparison.selectedInterval === 6 ? 'primary' : 'secondary'}"
                    style="flex: 1; min-height: 44px; font-size: 0.74rem; padding: 0 8px;"
                    onclick="SkinHairUI.selectCompareInterval(6)">
              6 mesecev
            </button>
          </div>
        </div>

        <!-- PRIMERJALNO PLATNO -->
        <div class="sh-compare-wrapper" id="shCompareWrapper">
          ${renderCompareCanvas()}
        </div>

        <!-- DRASNIK ZA KRMILJENJE -->
        <div style="margin-top: 12px; display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 0.72rem; color: var(--text-3); min-width: 50px;">
            ${state.comparison.mode === 'split' ? 'Prej (0%)' : 'Baza'}
          </span>
          <input type="range" min="0" max="100" value="${state.comparison.mode === 'split' ? state.comparison.splitPositionPct : state.comparison.opacityBlendPct}" 
                 id="shSliderControl" style="flex: 1;" oninput="SkinHairUI.handleSliderInput(this.value)">
          <span style="font-size: 0.72rem; color: var(--text-3); min-width: 50px; text-align: right;">
            ${state.comparison.mode === 'split' ? 'Potem (100%)' : 'Novejše'}
          </span>
        </div>
      </div>

      <!-- ČASOVNICA FOTOGRAFIJ (Photo Timeline) -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📸 Časovnica Fotografij (${filteredPhotos.length})</div>
          <button class="btn secondary" style="font-size: 0.72rem; padding: 4px 8px;" onclick="SkinHairUI.triggerPhotoUploadModal()">+ Dodaj</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin-top: 10px;">
          ${filteredPhotos.length === 0 ? `
            <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-3); font-size: 0.8rem;">
              ${allPhotos.length === 0 ? 'Še ni naloženih fotografij napredka. Tapni »+ Dodaj« za prvo sliko obraza ali lasišča.' : 'Ni fotografij v izbrani kategoriji.'}
            </div>
          ` : filteredPhotos.map((p, idx) => `
            <div class="sh-photo-thumb-card ${p.id === state.comparison.photoA ? 'selected-a' : ''} ${p.id === state.comparison.photoB ? 'selected-b' : ''}" 
                 style="position: relative;"
                 onclick="SkinHairUI.selectPhotoForCompare('${p.id}')">
              <img src="${p.thumbnail || p.url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 6px;" alt="">
              <button type="button" class="sh-photo-del" title="Izbriši" aria-label="Izbriši fotografijo"
                      onclick="event.stopPropagation(); SkinHairUI.deletePhoto('${p.id}')"><span>✕</span></button>
              <div style="font-size: 0.65rem; color: var(--text-2); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${p.date || 'Danes'}
              </div>
              <div style="font-size: 0.6rem; color: var(--rec-green); font-weight: 600;">${p.category || 'obraz'}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderCompareCanvas() {
    const activeCat = state.comparison.activeCategory || 'vse';
    const candidatePhotos = (state.photos || []).filter(p => activeCat === 'vse' || p.category === activeCat);
    const photoA = candidatePhotos.find(p => p.id === state.comparison.photoA) || candidatePhotos[0] || (state.photos && state.photos[0]) || null;
    const photoB = candidatePhotos.find(p => p.id === state.comparison.photoB) || candidatePhotos[1] || photoA;

    if (!photoA) {
      return `
        <div style="width: 100%; height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--surface-2); border-radius: 12px; color: var(--text-3); font-size: 0.8rem;">
          <span>📷 Naloži vsaj 2 fotografiji za zvezno primerjavo</span>
          <button class="btn secondary" style="margin-top: 8px; font-size: 0.75rem;" onclick="SkinHairUI.triggerPhotoUploadModal()">Naloži fotografijo</button>
        </div>
      `;
    }

    const splitPos = state.comparison.splitPositionPct;
    const blendPos = state.comparison.opacityBlendPct;

    if (state.comparison.mode === 'split') {
      return `
        <div class="sh-split-container" id="shSplitContainer">
          <!-- Spodnja slika (B - Novejša / Potem) -->
          <img src="${photoB ? (photoB.url || photoB.thumbnail) : (photoA.url || photoA.thumbnail)}" class="sh-split-img" alt="Potem">
          <span class="sh-split-label right">POTEM</span>

          <!-- Zgornja slika (A - Prej) s clip-path masko -->
          <div class="sh-split-top" id="shSplitTop" style="clip-path: inset(0 ${100 - splitPos}% 0 0);">
            <img src="${photoA.url || photoA.thumbnail}" class="sh-split-img" alt="Prej">
            <span class="sh-split-label left">PREJ</span>
          </div>

          <!-- Ročaj delilnika -->
          <div class="sh-split-divider" id="shSplitDivider" style="left: ${splitPos}%;">
            <div class="sh-divider-handle">⇄</div>
          </div>
        </div>
      `;
    } else {
      // Cross-Dissolve Blend način
      return `
        <div class="sh-blend-container">
          <img src="${photoA.url || photoA.thumbnail}" class="sh-blend-img" style="opacity: 1;" alt="Prej">
          <img src="${photoB ? (photoB.url || photoB.thumbnail) : (photoA.url || photoA.thumbnail)}" class="sh-blend-img" style="opacity: ${blendPos / 100};" alt="Potem">
          <div style="position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.7); padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; color: #fff;">
            Bledenje: ${blendPos}%
          </div>
        </div>
      `;
    }
  }

  // ========== 3. PODZAVIHEK: AKNE & GAGS ==========
  function renderAkneView(gags) {
    const zones = [
      { id: 'forehead', name: 'Čelo', factor: 1, desc: 'Lojnice T-cone' },
      { id: 'right_cheek', name: 'Desno lice', factor: 2, desc: 'Frikcija / blazina' },
      { id: 'left_cheek', name: 'Levo lice', factor: 2, desc: 'Frikcija / telefon' },
      { id: 'nose', name: 'Nos', factor: 1, desc: 'Komedoni' },
      { id: 'chin', name: 'Brada', factor: 1, desc: 'Hormonski vplivi' },
      { id: 'chest_back', name: 'Zgornji hrbet & prsa', factor: 3, desc: 'Androgeni & znoj' }
    ];

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">🔴 Global Acne Grading System (GAGS)</div>
          <span style="font-weight: 700; color: ${gags.color};">${gags.score} / 40 točk (${gags.severityLabel})</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-2); margin-top: 4px;">
          Klinično točkovanje resnosti aken. Izberi najvišjo stopnjo lezije za vsako anatomsko regijo:
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
          ${zones.map(z => {
            const currentGrade = state.acneZones[z.id] || 0;
            return `
              <div style="background: var(--surface-2); padding: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                  <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-1);">
                    ${z.name} <span style="font-size: 0.7rem; color: var(--text-3);">(Ponder x${z.factor})</span>
                  </div>
                  <div style="font-size: 0.68rem; color: var(--text-3);">${z.desc}</div>
                </div>
                <div style="display: flex; gap: 4px;">
                  ${[0, 1, 2, 3, 4].map(grade => `
                    <button class="sh-grade-btn ${currentGrade === grade ? 'active' : ''}" 
                            onclick="SkinHairUI.setAcneZoneGrade('${z.id}', ${grade})">
                      ${grade === 0 ? '0' : grade === 1 ? '1' : grade === 2 ? '2' : grade === 3 ? '3' : '4'}
                    </button>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Legenda stopenj -->
        <div style="margin-top: 12px; background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; font-size: 0.68rem; color: var(--text-3); display: flex; flex-direction: column; gap: 3px;">
          <div><strong>0:</strong> Brez aken</div>
          <div><strong>1:</strong> $\\ge 1$ komedon ali ploska rdečina (PIE)</div>
          <div><strong>2:</strong> $\\ge 1$ vnetna papula (&lt;5mm)</div>
          <div><strong>3:</strong> $\\ge 1$ pustula z gnojnim centrom</div>
          <div><strong>4:</strong> $\\ge 1$ boleč nodul ali cista (&gt;5mm)</div>
        </div>
      </div>
    `;
  }

  // ========== 4. PODZAVIHEK: LASJE & NORWOOD ==========
  function renderLasjeView(hair, needleLock) {
    const norwoodOptions = ['1', '2', '2A', '3', '3A', '3V', '4', '5', '6', '7'];

    return `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">💈 Norwood Lestvica & Lasišče</div>
          <span style="font-weight: 700; color: ${hair.color};">Indeks: ${hair.hairIndex} / 100</span>
        </div>

        <!-- Norwood stopnja -->
        <div style="margin-top: 10px;">
          <label style="font-size: 0.75rem; color: var(--text-2); font-weight: 600; display: block; margin-bottom: 6px;">
            Stopnja Norwood-Hamilton lestvice:
          </label>
          <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;">
            ${norwoodOptions.map(opt => `
              <button class="sh-nw-btn ${state.hair.norwoodStage === opt ? 'active' : ''}" onclick="SkinHairUI.setNorwoodStage('${opt}')">
                NW ${opt}
              </button>
            `).join('')}
          </div>
          <div style="font-size: 0.72rem; color: var(--rec-green); margin-top: 6px; font-weight: 500;">
            ${hair.stageName}: ${hair.stageDesc}
          </div>
        </div>

        <!-- Vnos odmika lasne linije v mm -->
        <div style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-2); margin-bottom: 4px;">
            <span>Odmik zalizkov v sencih (mm):</span>
            <span style="font-weight: 700; color: var(--text-1);">${state.hair.hairlineRecessionMm} mm</span>
          </div>
          <input type="range" min="0" max="25" value="${state.hair.hairlineRecessionMm}" style="width: 100%;" 
                 oninput="SkinHairUI.updateHairParam('hairlineRecessionMm', parseInt(this.value, 10), true)" onchange="SkinHairUI.updateHairParam('hairlineRecessionMm', parseInt(this.value, 10))">
        </div>

        <!-- Pokritost temena v % -->
        <div style="margin-top: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-2); margin-bottom: 4px;">
            <span>Gostota / Pokritost temena (Vertex %):</span>
            <span style="font-weight: 700; color: var(--text-1);">${state.hair.vertexCoveragePct} %</span>
          </div>
          <input type="range" min="30" max="100" value="${state.hair.vertexCoveragePct}" style="width: 100%;" 
                 oninput="SkinHairUI.updateHairParam('vertexCoveragePct', parseInt(this.value, 10), true)" onchange="SkinHairUI.updateHairParam('vertexCoveragePct', parseInt(this.value, 10))">
        </div>

        <!-- Dnevni shedding (0-10) -->
        <div style="margin-top: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-2); margin-bottom: 4px;">
            <span>Dnevno izpadanje / Shedding (0–10):</span>
            <span style="font-weight: 700; color: ${state.hair.sheddingScore > 4 ? '#fbbf24' : 'var(--rec-green)'};">
              ${state.hair.sheddingScore} / 10 (${hair.sheddingStatus})
            </span>
          </div>
          <input type="range" min="0" max="10" value="${state.hair.sheddingScore}" style="width: 100%;" 
                 oninput="SkinHairUI.updateHairParam('sheddingScore', parseInt(this.value, 10), true)" onchange="SkinHairUI.updateHairParam('sheddingScore', parseInt(this.value, 10))">
        </div>
      </div>

      <!-- MIKRONEEDLING SEJA -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🪡 Mikroneedling & Protokol rasti</div>
          <span style="font-size: 0.75rem; color: var(--text-3);">Globina 1.0–1.25 mm</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-2); margin-top: 6px;">
          Mikroneedling aktivira Wnt/β-catenin signalizacijo mešičkov. Obvezen 24h premor pred nanosom minoksidila!
        </div>
        <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.75rem; color: var(--text-3);">
            Zadnja seja: ${state.hairProtocol.lastMicroneedleDate ? new Date(state.hairProtocol.lastMicroneedleDate).toLocaleDateString('sl-SI') : 'Ni vpisano'}
            ${needleLock.isLocked ? ` <strong style="color: #ef4444;">(Zapora: ${needleLock.hoursRemaining}h)</strong>` : ''}
          </span>
          ${needleLock.isLocked ? `
            <button class="btn secondary" style="font-size: 0.75rem; border-color: #ef4444; color: #fca5a5;" onclick="SkinHairUI.resetMicroneedlingLockout()">
              🔓 Ponastavi zaporo
            </button>
          ` : `
            <button class="btn secondary" style="font-size: 0.75rem;" onclick="SkinHairUI.logMicroneedlingFromButton()">
              Zabeleži sejo danes
            </button>
          `}
        </div>
      </div>
    `;
  }

  // ========== 5. PODZAVIHEK: RUTINA & PROTOKOLI ==========
  const AM_AVAILABLE_ACTIVES = [
    { id: 'azelaic_acid', label: 'Azelainska (15–20%)' },
    { id: 'vitamin_c_laa', label: 'Vitamin C (LAA)' },
    { id: 'niacinamide', label: 'Niacinamid' },
    { id: 'ceramides', label: 'Ceramidi' },
    { id: 'spf_50', label: 'SPF 50+' },
    { id: 'salicylic_acid', label: 'Salicilna (BHA)' },
    { id: 'benzoyl_peroxide', label: 'BPO' }
  ];

  const PM_AVAILABLE_ACTIVES = [
    { id: 'tretinoin', label: 'Tretinoin 0.05%' },
    { id: 'adapalene', label: 'Adapalen' },
    { id: 'benzoyl_peroxide', label: 'BPO' },
    { id: 'salicylic_acid', label: 'Salicilna (BHA)' },
    { id: 'glycolic_acid', label: 'Glikolna (AHA)' },
    { id: 'azelaic_acid', label: 'Azelainska' },
    { id: 'niacinamide', label: 'Niacinamid' },
    { id: 'ceramides', label: 'Ceramidi' }
  ];

  function renderRutinaView(needleLock) {
    const engine = window.SkinHairEngine;
    const amActives = state.skincare.amActives || [];
    const pmActives = state.skincare.pmActives || [];
    const amEval = engine ? engine.evaluateSkincareRoutine(amActives, 'am') : { warnings: [], recommendations: [] };
    const pmEval = engine ? engine.evaluateSkincareRoutine(pmActives, 'pm') : { warnings: [], recommendations: [] };

    return `
      <!-- CIRKADIANA SKINCARE RUTINA & KEMIČNI KONFLIKTI -->
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">🧪 Cirkadiana Nega & Kemični Konflikti</div>
          <span style="font-size: 0.72rem; color: var(--text-3);">Matrika interakcij</span>
        </div>

        <!-- AM Rutina -->
        <div style="background: var(--surface-2); padding: 10px; border-radius: 8px; margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-1);">☀️ Jutranja Zaščita (AM)</span>
            <label style="font-size: 0.75rem; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" ${state.skincare.amCompleted ? 'checked' : ''} onchange="SkinHairUI.toggleRoutineCompleted('am', this.checked)">
              <span>Opravljeno</span>
            </label>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-3); margin-top: 4px; margin-bottom: 6px;">
            Aktivne sestavine AM (klikni za vklop/izklop):
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;">
            ${AM_AVAILABLE_ACTIVES.map(act => {
              const active = amActives.includes(act.id);
              return `<button type="button" class="sh-cat-chip ${active ? 'active' : ''}" style="font-size: 0.68rem; padding: 2px 7px;" onclick="SkinHairUI.toggleActiveIngredient('am', '${act.id}')">${act.label}</button>`;
            }).join('')}
          </div>
          ${(amEval.warnings || []).map(w => `
            <div style="background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444; padding: 6px 10px; border-radius: 6px; margin-top: 6px; font-size: 0.72rem; color: #fca5a5;">
              <strong>⚠️ Opozorilo:</strong> ${w.message}
            </div>
          `).join('')}
          ${(amEval.recommendations || []).map(r => `
            <div style="background: rgba(52, 211, 153, 0.1); border-left: 3px solid #34d399; padding: 6px 10px; border-radius: 6px; margin-top: 6px; font-size: 0.72rem; color: #6ee7b7;">
              <strong>💡 Sinergija:</strong> ${r}
            </div>
          `).join('')}
        </div>

        <!-- PM Rutina -->
        <div style="background: var(--surface-2); padding: 10px; border-radius: 8px; margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; font-size: 0.85rem; color: var(--text-1);">🌙 Večerna Obnova (PM)</span>
            <label style="font-size: 0.75rem; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" ${state.skincare.pmCompleted ? 'checked' : ''} onchange="SkinHairUI.toggleRoutineCompleted('pm', this.checked)">
              <span>Opravljeno</span>
            </label>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-3); margin-top: 4px; margin-bottom: 6px;">
            Aktivne sestavine PM (klikni za vklop/izklop):
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;">
            ${PM_AVAILABLE_ACTIVES.map(act => {
              const active = pmActives.includes(act.id);
              return `<button type="button" class="sh-cat-chip ${active ? 'active' : ''}" style="font-size: 0.68rem; padding: 2px 7px;" onclick="SkinHairUI.toggleActiveIngredient('pm', '${act.id}')">${act.label}</button>`;
            }).join('')}
          </div>
          ${(pmEval.warnings || []).map(w => `
            <div style="background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444; padding: 6px 10px; border-radius: 6px; margin-top: 6px; font-size: 0.72rem; color: #fca5a5;">
              <strong>⚠️ Opozorilo:</strong> ${w.message}
            </div>
          `).join('')}
          ${(pmEval.recommendations || []).map(r => `
            <div style="background: rgba(52, 211, 153, 0.1); border-left: 3px solid #34d399; padding: 6px 10px; border-radius: 6px; margin-top: 6px; font-size: 0.72rem; color: #6ee7b7;">
              <strong>💡 Sinergija:</strong> ${r}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- TRIHOLOŠKI PROTOKOL ZA LASE -->
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">💈 Dnevni Protokol za Lase</div>
          <span style="font-size: 0.72rem; color: var(--rec-green); font-weight: 600;">🔥 Streak: ${state.hairProtocol.streakDays} dni</span>
        </div>

        ${needleLock.isLocked ? `
          <div style="background: rgba(239, 68, 68, 0.12); border-left: 4px solid #ef4444; padding: 8px 10px; border-radius: 6px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.78rem; color: #ef4444;">🛑 24-urna varnostna zapora aktivna (${needleLock.hoursRemaining} h do izteka)</div>
              <div style="font-size: 0.7rem; color: var(--text-2); margin-top: 2px;">Minoksidil zaklenjen proti hipotenziji in tahikardiji po iglanju.</div>
            </div>
            <button class="btn secondary" style="font-size: 0.68rem; padding: 3px 8px; border-color: #ef4444; color: #fca5a5;" onclick="SkinHairUI.resetMicroneedlingLockout()">
              🔓 Ponastavi
            </button>
          </div>
        ` : `
          <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center; background: var(--surface-2); padding: 6px 10px; border-radius: 6px;">
            <span style="font-size: 0.72rem; color: var(--text-2);">Seja mikroneedlinga (1x na teden):</span>
            <button class="btn secondary" style="font-size: 0.68rem; padding: 3px 8px;" onclick="SkinHairUI.logMicroneedlingFromButton()">
              🪡 Zabeleži danes
            </button>
          </div>
        `}

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          <label style="background: var(--surface-2); padding: 8px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
            <div>
              <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-1);">
                Minoksidil 5% (1x ali 2x na dan)
                ${needleLock.isLocked ? `<span style="font-size: 0.68rem; color: #ef4444; font-weight: 700; margin-left: 4px;">(🛑 ZAKLENJENO ${needleLock.hoursRemaining}h)</span>` : ''}
              </div>
              <div style="font-size: 0.68rem; color: var(--text-3);">${needleLock.isLocked ? 'Zaklenjeno zaradi mikroneedlinga!' : 'Podaljšanje anagene faze'}</div>
            </div>
            <input type="checkbox" ${state.hairProtocol.minoxidilApplied ? 'checked' : ''} 
                   ${needleLock.isLocked ? 'disabled' : ''} 
                   onchange="SkinHairUI.toggleHairStep('minoxidilApplied', this.checked)">
          </label>

          <label style="background: var(--surface-2); padding: 8px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
            <div>
              <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-1);">Finasterid 1mg / Antiandrogen</div>
              <div style="font-size: 0.68rem; color: var(--text-3);">Zaviranje 5α-reduktaze tipa 2</div>
            </div>
            <input type="checkbox" ${state.hairProtocol.finasterideTaken ? 'checked' : ''} onchange="SkinHairUI.toggleHairStep('finasterideTaken', this.checked)">
          </label>

          <label style="background: var(--surface-2); padding: 8px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
            <div>
              <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-1);">Ketokonazol 2% šampon (2–3x tedensko)</div>
              <div style="font-size: 0.68rem; color: var(--text-3);">5–10 min kontaktni čas proti Malassezii in TGF-β1</div>
            </div>
            <input type="checkbox" ${state.hairProtocol.ketoconazoleWash ? 'checked' : ''} onchange="SkinHairUI.toggleHairStep('ketoconazoleWash', this.checked)">
          </label>
        </div>
      </div>

      <!-- IZVOZ V OBSIDIAN VAULT -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📝 Sinhronizacija z Obsidianom</div>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-2); margin-top: 4px;">
          Izvozi dnevni zapis nege in stanja v mapo <code>Zdravje/koza/</code> ali <code>Zdravje/lasje/</code>:
        </div>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn secondary" style="flex: 1; font-size: 0.75rem;" onclick="SkinHairUI.exportToObsidian('koza')">
            📋 Kopiraj Koža Markdown
          </button>
          <button class="btn secondary" style="flex: 1; font-size: 0.75rem;" onclick="SkinHairUI.exportToObsidian('lasje')">
            📋 Kopiraj Lasje Markdown
          </button>
        </div>
      </div>
    `;
  }

  // ========== MODAL ZA GHOST OVERLAY KAMERO ==========
  function renderCameraModalBody() {
    return `
      <div style="text-align: center;">
        <div style="background: #000; border-radius: 12px; position: relative; width: 100%; height: 280px; overflow: hidden; display: flex; align-items: center; justify-content: center;" id="shCameraViewport">
          <video id="shLiveVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover; display: none;"></video>
          
          <!-- Ghost Overlay slika -->
          <img id="shGhostOverlayImg" src="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.45; pointer-events: none; display: none;" alt="">

          <!-- Anatomski žični vodič (SVG Crosshairs) -->
          <svg style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;" viewBox="0 0 100 100">
            <!-- Vodoravna linija oči -->
            <line x1="20" y1="42" x2="80" y2="42" stroke="rgba(52, 211, 153, 0.45)" stroke-width="0.8" stroke-dasharray="2,2" />
            <!-- Navpična simetrala nosu -->
            <line x1="50" y1="15" x2="50" y2="85" stroke="rgba(52, 211, 153, 0.45)" stroke-width="0.8" stroke-dasharray="2,2" />
            <!-- Obris lasne linije / čela -->
            <path d="M 28 28 Q 50 18 72 28" fill="none" stroke="rgba(96, 165, 250, 0.5)" stroke-width="0.8" stroke-dasharray="2,2" />
          </svg>

          <!-- Fallback gumb za prenos -->
          <div id="shCameraFallback" style="padding: 16px;">
            <p style="font-size: 0.8rem; color: var(--text-3); margin-bottom: 8px;">Kamera v brskalniku ali izbira iz galerije:</p>
            <input type="file" id="shNativeFileInput" accept="image/*" style="display: none;" onchange="SkinHairUI.handleNativePhotoUpload(this)">
            <button type="button" class="btn primary" onclick="document.getElementById('shNativeFileInput').click()">
              📷 Posnemi / Izberi sliko
            </button>
          </div>
        </div>

        <!-- Prosojnost Ghost prekrivanja -->
        <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.72rem; color: var(--text-3);">Ghost:</span>
          <input type="range" min="0" max="100" value="45" id="shGhostSlider" style="flex: 1;" oninput="SkinHairUI.updateGhostOpacity(this.value)">
          <span style="font-size: 0.72rem; color: var(--text-3);" id="shGhostVal">45%</span>
        </div>

        <!-- Kategorija slike -->
        <div style="margin-top: 10px; display: flex; gap: 6px; justify-content: center;">
          ${['obraz', 'lasna_linija', 'temen', 'hrbet', 'prsa'].map(c => `
            <button type="button" class="sh-cat-chip sh-newcat ${c === selectedNewPhotoCat ? 'active' : ''}" style="font-size: 0.68rem;" onclick="SkinHairUI.setNewPhotoCategory('${c}', this)">
              ${c === 'obraz' ? 'Obraz' : c === 'lasna_linija' ? 'Linija' : c === 'temen' ? 'Temen' : c === 'hrbet' ? 'Hrbet' : 'Prsa'}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ========== DEJANJA IN INTERAKCIJA ==========

  function switchSubTab(subTab) {
    state.activeSubTab = subTab;
    saveState();
    render();
    setTimeout(() => {
      const activeBtn = document.querySelector('.sh-tab-btn.active');
      if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 40);
  }

  function setAcneZoneGrade(zoneId, grade) {
    state.acneZones[zoneId] = grade;
    saveState();
    render();
  }

  function setNorwoodStage(stage) {
    state.hair.norwoodStage = stage;
    saveState();
    render();
  }

  function updateHairParam(param, val, live) {
    state.hair[param] = val;
    saveState();
    // med vlečenjem drsnika (live) ne rišemo znova, sicer se dotik prekine; render ob spustu (onchange)
    if (!live) render();
  }

  function toggleRoutineCompleted(slot, completed) {
    if (slot === 'am') state.skincare.amCompleted = completed;
    if (slot === 'pm') state.skincare.pmCompleted = completed;
    saveState();
    render();
  }

  function toggleHairStep(step, completed) {
    state.hairProtocol[step] = completed;
    saveState();
    render();
    if (completed && window.ProtocolDiary) {
      if (step === 'minoxidilApplied') window.ProtocolDiary.logPreset('minoxidil_topical');
      else if (step === 'finasterideTaken') window.ProtocolDiary.logPreset('finasteride_1mg');
      else if (step === 'ketoconazoleWash') window.ProtocolDiary.logPreset('ketoconazole_shampoo');
    }
  }

  function toggleActiveIngredient(slot, ingredientId) {
    const listKey = slot === 'am' ? 'amActives' : 'pmActives';
    if (!state.skincare[listKey]) state.skincare[listKey] = [];
    const idx = state.skincare[listKey].indexOf(ingredientId);
    if (idx >= 0) {
      state.skincare[listKey].splice(idx, 1);
    } else {
      state.skincare[listKey].push(ingredientId);
    }
    saveState();
    render();
  }

  function resetMicroneedlingLockout() {
    state.hairProtocol.lastMicroneedleDate = null;
    saveState();
    render();
  }

  async function deletePhoto(photoId) {
    if (typeof window !== 'undefined' && window.confirm && !window.confirm('Želiš izbrisati to fotografijo iz trezorja?')) {
      return;
    }
    try {
      if (window.SkinStorage && typeof window.SkinStorage.deletePhoto === 'function') {
        await window.SkinStorage.deletePhoto(photoId);
      }
    } catch (e) {
      console.warn('[SkinHairUI] Napaka pri brisanju fotografije:', e);
    }
    state.photos = (state.photos || []).filter(p => p.id !== photoId);
    if (state.comparison.photoA === photoId) {
      state.comparison.photoA = state.photos[0] ? state.photos[0].id : null;
    }
    if (state.comparison.photoB === photoId) {
      state.comparison.photoB = state.photos[1] ? state.photos[1].id : state.comparison.photoA;
    }
    saveState();
    render();
  }

  // Zabeleži sejo mikroneedlinga: samo stanje + opozorilo. NE kliče ProtocolDiary.logPreset,
  // ker ta kliče to funkcijo nazaj (prej neskončna rekurzija -> "Maximum call stack size exceeded").
  function logMicroneedlingSession() {
    state.hairProtocol.lastMicroneedleDate = new Date().toISOString();
    state.hairProtocol.minoxidilApplied = false; // Varnostni reset minoksidila
    saveState();
    render();
    if (typeof alert === 'function') {
      alert('✓ Mikroneedling seja zabeležena! Vklopljena 24-urna varnostna zapora minoksidila.');
    }
  }

  // Vstop iz gumbov v UI: dnevnik ustvari vnos in nazaj pokliče logMicroneedlingSession (stanje).
  function logMicroneedlingFromButton() {
    if (window.ProtocolDiary && typeof window.ProtocolDiary.logPreset === 'function') {
      const entry = window.ProtocolDiary.logPreset('microneedling_scalp');
      if (entry) return;
    }
    logMicroneedlingSession();
  }

  function setCompareMode(mode) {
    state.comparison.mode = mode;
    saveState();
    render();
  }

  function filterCategory(cat) {
    state.comparison.activeCategory = cat;
    saveState();
    render();
  }

  function handleSliderInput(val) {
    val = parseInt(val, 10);
    if (state.comparison.mode === 'split') {
      state.comparison.splitPositionPct = val;
      const top = document.getElementById('shSplitTop');
      const div = document.getElementById('shSplitDivider');
      if (top) top.style.clipPath = `inset(0 ${100 - val}% 0 0)`;
      if (div) div.style.left = `${val}%`;
    } else {
      state.comparison.opacityBlendPct = val;
      // brez render(): ponovno risanje med vlečenjem uniči drsnik in prekine dotik na iPhonu
      const imgs = document.querySelectorAll('#shCompareWrapper .sh-blend-img');
      if (imgs[1]) imgs[1].style.opacity = val / 100;
      const lbl = document.querySelector('#shCompareWrapper .sh-blend-container > div');
      if (lbl) lbl.textContent = `Bledenje: ${val}%`;
    }
    saveState();
  }

  function selectPhotoForCompare(photoId) {
    if (!state.comparison.photoA) {
      state.comparison.photoA = photoId;
    } else if (!state.comparison.photoB || state.comparison.photoB === state.comparison.photoA) {
      state.comparison.photoB = photoId;
    } else {
      state.comparison.photoA = state.comparison.photoB;
      state.comparison.photoB = photoId;
    }
    saveState();
    render();
  }

  function triggerPhotoUploadModal() {
    const modal = document.getElementById('shCameraModalOverlay');
    if (modal) modal.style.display = 'flex';
  }

  function closeCameraModal() {
    const modal = document.getElementById('shCameraModalOverlay');
    if (modal) modal.style.display = 'none';
  }

  function updateGhostOpacity(val) {
    const img = document.getElementById('shGhostOverlayImg');
    const lbl = document.getElementById('shGhostVal');
    if (img) img.style.opacity = val / 100;
    if (lbl) lbl.textContent = val + '%';
  }

  function setNewPhotoCategory(cat, btn) {
    selectedNewPhotoCat = cat;
    // samo čipi v modalu (prej je odstranilo 'active' tudi s filtrov Primerjalnika in sestavin rutine)
    document.querySelectorAll('#shCameraModalOverlay .sh-newcat').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  async function handleNativePhotoUpload(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    try {
      if (window.SkinStorage && typeof window.SkinStorage.savePhoto === 'function') {
        const savedMeta = await window.SkinStorage.savePhoto(file, { category: selectedNewPhotoCat });
        const retrieved = await window.SkinStorage.getPhoto(savedMeta.id);

        const newPhoto = {
          id: savedMeta.id,
          date: savedMeta.date || new Date().toISOString().split('T')[0],
          timestamp: savedMeta.timestamp || Date.now(),
          category: selectedNewPhotoCat,
          url: retrieved ? retrieved.photoUrl : null,
          thumbnail: retrieved ? (retrieved.thumbnailUrl || retrieved.photoUrl) : null,
          storage: 'indexedDB'
        };

        state.photos.unshift(newPhoto);
        if (!state.comparison.photoA) state.comparison.photoA = newPhoto.id;
        else state.comparison.photoB = newPhoto.id;

        saveState();
        closeCameraModal();
        render();
        return;
      }
    } catch (err) {
      const msg = String(err && err.message ? err.message : '');
      if (msg.startsWith('SEF_ZAKLENJEN') || (window.SkinStorage && vaultStatus.configured !== false)) {
        // Trezor je vklopljen: fotografije ne smemo shraniti nešifrirano
        vaultMessage = msg.startsWith('SEF_ZAKLENJEN') ? 'Trezor je zaklenjen. Odkleni ga in poskusi znova.' : 'Fotografije ni bilo mogoče šifrirano shraniti.';
        input.value = '';
        closeCameraModal();
        render();
        return;
      }
      console.warn('[SkinHairUI] Shranjevanje v SkinStorage ni uspelo, fallback na FileReader:', err);
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      
      const newPhoto = {
        id: 'photo_' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now(),
        category: selectedNewPhotoCat,
        url: dataUrl,
        thumbnail: dataUrl,
        storage: 'local'
      };

      state.photos.unshift(newPhoto);
      if (!state.comparison.photoA) state.comparison.photoA = newPhoto.id;
      else state.comparison.photoB = newPhoto.id;

      saveState();
      closeCameraModal();
      render();
    };
    reader.readAsDataURL(file);
  }

  function initSplitSlider() {
    setTimeout(() => {
      const container = document.getElementById('shSplitContainer');
      const divider = document.getElementById('shSplitDivider');
      const topImg = document.getElementById('shSplitTop');
      if (!container || !divider || !topImg) return;

      let isDragging = false;

      function onMove(clientX) {
        const rect = container.getBoundingClientRect();
        if (!rect.width) return;
        let pos = ((clientX - rect.left) / rect.width) * 100;
        pos = Math.max(0, Math.min(100, pos));
        topImg.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
        divider.style.left = `${pos}%`;
        state.comparison.splitPositionPct = Math.round(pos);
        const slider = document.getElementById('shSliderControl');
        if (slider) slider.value = Math.round(pos);
      }

      function onPointerDown(e) {
        isDragging = true;
        try {
          if (divider.setPointerCapture) divider.setPointerCapture(e.pointerId);
          else if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
        } catch (_) {}
        onMove(e.clientX);
      }

      function onPointerMove(e) {
        if (!isDragging) return;
        onMove(e.clientX);
      }

      function onPointerUp(e) {
        if (isDragging) {
          isDragging = false;
          saveState();
        }
      }

      divider.addEventListener('pointerdown', onPointerDown);
      divider.addEventListener('pointermove', onPointerMove);
      divider.addEventListener('pointerup', onPointerUp);
      divider.addEventListener('pointercancel', onPointerUp);

      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerUp);
    }, 50);
  }

  function exportToObsidian(type) {
    const today = new Date().toISOString().split('T')[0];
    let md = '';

    if (type === 'koza') {
      const gags = window.SkinHairEngine ? window.SkinHairEngine.calculateGAGS(state.acneZones) : { score: 0, severityLabel: 'Čisto' };
      md = `---
datum: ${today}
tip: koza
gags_tocke: ${gags.score}
resnost: ${gags.severityLabel}
am_rutina: ${state.skincare.amCompleted ? 'opravljeno' : 'ne'}
pm_rutina: ${state.skincare.pmCompleted ? 'opravljeno' : 'ne'}
---

# Koža in Akne ${today}

- **GAGS Ocena:** ${gags.score} / 40 (${gags.severityLabel})
- **Čelo:** ${state.acneZones.forehead}
- **Lica:** D=${state.acneZones.right_cheek}, L=${state.acneZones.left_cheek}
- **Zgornji hrbet & prsa:** ${state.acneZones.chest_back}
- **AM Nega:** Azelainska kislina + SPF 50+ (${state.skincare.amCompleted ? '✓' : '✗'})
- **PM Nega:** Tretinoin + Ceramidi (${state.skincare.pmCompleted ? '✓' : '✗'})
`;
    } else {
      const hair = window.SkinHairEngine ? window.SkinHairEngine.calculateHairIndex(state.hair) : { hairIndex: 90 };
      md = `---
datum: ${today}
tip: lasje
norwood: ${state.hair.norwoodStage}
hair_index: ${hair.hairIndex}
shedding_score: ${state.hair.sheddingScore}
minoksidil: ${state.hairProtocol.minoxidilApplied ? 'da' : 'ne'}
finasterid: ${state.hairProtocol.finasterideTaken ? 'da' : 'ne'}
---

# Lasje in Protokol ${today}

- **Norwood Lestvica:** ${state.hair.norwoodStage} (Indeks: ${hair.hairIndex}/100)
- **Odmik zalizkov:** ${state.hair.hairlineRecessionMm} mm
- **Pokritost temena:** ${state.hair.vertexCoveragePct} %
- **Dnevno izpadanje:** ${state.hair.sheddingScore} / 10
- **Streak:** ${state.hairProtocol.streakDays} dni
`;
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(md).then(() => {
        alert(`✓ Markdown za ${type === 'koza' ? 'kožo' : 'lase'} kopiran v odložišče!`);
      }).catch(() => {
        prompt('Kopiraj Markdown:', md);
      });
    } else {
      prompt('Kopiraj Markdown:', md);
    }
  }

  // ========== SAMODEJNI ZAGON ==========
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      // Pripravi začetne poskusne fotografije, če je tabela prazna
      if (!state.photos || state.photos.length === 0) {
        state.photos = [
          {
            id: 'ph_demo_1',
            date: 'Dan 0 (Baseline)',
            timestamp: Date.now() - 30 * 86400000,
            category: 'obraz',
            url: './assets/anime/happy.gif',
            thumbnail: './assets/anime/happy.gif'
          },
          {
            id: 'ph_demo_2',
            date: 'Dan 30 (Danes)',
            timestamp: Date.now(),
            category: 'obraz',
            url: './assets/anime/celebrate.gif',
            thumbnail: './assets/anime/celebrate.gif'
          }
        ];
        state.comparison.photoA = 'ph_demo_1';
        state.comparison.photoB = 'ph_demo_2';
        saveState();
      }
    });
  }

  return {
    mount: mount,
    render: render,
    switchSubTab: switchSubTab,
    setAcneZoneGrade: setAcneZoneGrade,
    setNorwoodStage: setNorwoodStage,
    updateHairParam: updateHairParam,
    toggleRoutineCompleted: toggleRoutineCompleted,
    toggleHairStep: toggleHairStep,
    toggleActiveIngredient: toggleActiveIngredient,
    logMicroneedlingSession: logMicroneedlingSession,
    logMicroneedlingFromButton: logMicroneedlingFromButton,
    resetMicroneedlingLockout: resetMicroneedlingLockout,
    setCompareMode: setCompareMode,
    filterCategory: filterCategory,
    handleSliderInput: handleSliderInput,
    selectPhotoForCompare: selectPhotoForCompare,
    deletePhoto: deletePhoto,
    triggerPhotoUploadModal: triggerPhotoUploadModal,
    closeCameraModal: closeCameraModal,
    updateGhostOpacity: updateGhostOpacity,
    setNewPhotoCategory: setNewPhotoCategory,
    handleNativePhotoUpload: handleNativePhotoUpload,
    rehydratePhotosFromStorage: rehydratePhotosFromStorage,
    vaultEnable: vaultEnable,
    vaultUnlock: vaultUnlock,
    vaultLock: vaultLock,
    vaultDisable: vaultDisable,
    exportToObsidian: exportToObsidian
  };
}));
