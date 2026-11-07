/**
 * Protocol & Supplement Diary UI (Binetov Dnevnik Vnosov & Protokolov)
 * Celovit UI modul za beleženje vseh vnosov anabolikov, suplementov, nootropikov in las.
 * Vključuje 1-klik hitre vnose, filtre, zgodovino, modal za vnos po meri in globalno levo/desno drsanje.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['ProtocolDiary'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./protocol-diary.js'));
  } else {
    root.ProtocolDiaryUI = factory(root.ProtocolDiary);
  }
}(typeof self !== 'undefined' ? self : this, function(Diary) {
  'use strict';

  if (!Diary && typeof window !== 'undefined' && window.ProtocolDiary) {
    Diary = window.ProtocolDiary;
  }

  let currentCategoryFilter = 'all';
  let currentPeriodFilter = 'all'; // '7' | '30' | 'all'

  function showToast(text, isHappy = true) {
    const toast = document.getElementById('mascotToast');
    const toastText = document.getElementById('mascotToastText');
    const toastImg = document.getElementById('mascotToastImg');
    if (toast && toastText && toastImg) {
      toastText.textContent = text;
      toastImg.src = isHappy ? './assets/anime/wink.gif' : './assets/anime/laugh.gif';
      toast.style.display = 'flex';
      clearTimeout(window._toastTimeout);
      window._toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
      }, 3500);
    }
  }

  /**
   * Generiranje HTML kode polnega pogleda dnevnika
   */
  function getDiaryViewHtml() {
    if (!Diary) return '<div style="padding: 20px; text-align: center; color: var(--text-3);">Dnevnik ni naložen.</div>';

    const stats = Diary.getStats();
    const todayEntries = Diary.getTodayEntries();
    const allDates = Diary.getDatesWithEntries();

    // Filtriraj datume glede na izbrano obdobje (7 / 30 / vse) in kategorijo
    const now = new Date();
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const filteredDates = allDates.filter(d => {
      // 1. Filter po obdobju
      if (currentPeriodFilter !== 'all') {
        const daysLimit = parseInt(currentPeriodFilter, 10);
        if (!isNaN(daysLimit)) {
          const parts = d.split('-');
          if (parts.length === 3) {
            const dMid = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime();
            const diffDays = Math.round((todayMid - dMid) / (1000 * 60 * 60 * 24));
            if (diffDays > daysLimit) return false;
          }
        }
      }

      // 2. Filter po kategoriji
      const dayEntries = Diary.getEntriesForDate(d);
      if (currentCategoryFilter === 'all') return dayEntries.length > 0;
      return dayEntries.some(e => e.category === currentCategoryFilter);
    });

    return `
      <!-- KARTICA 1: NADZORNA PLOŠČA & STATISTIKA -->
      <div class="card" style="margin-bottom: 12px; position: relative;">
        <div class="card-header">
          <div class="card-title">📖 Dnevnik Vnosov & Protokolov</div>
          <span class="status-pill" style="color: var(--rec-green); border-color: rgba(0,230,118,0.3);">
            🔥 Streak: ${stats.currentStreakDays} dni
          </span>
        </div>

        <div class="bento-grid" style="margin-top: 10px;">
          <div class="bento-cell">
            <span class="bento-label">Vnosov danes</span>
            <span class="bento-val" style="color: var(--rec-green);">${todayEntries.length}</span>
            <span class="bento-sub">${todayEntries.length === 0 ? 'Še ni vnosov za danes' : 'Zabeleženi protokoli'}</span>
          </div>
          <div class="bento-cell">
            <span class="bento-label">Skupaj vnosov</span>
            <span class="bento-val" style="color: var(--strain-blue);">${stats.totalEntries}</span>
            <span class="bento-sub">Dni beleženja: ${stats.daysLogged}</span>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
          <button type="button" class="btn" style="flex: 2; min-width: 130px; padding: 10px; min-height: 44px; font-weight: 700; font-size: 0.8rem;" onclick="ProtocolDiaryUI.openNewEntryModal()">
            + ✍️ Vnos po meri
          </button>
          <button type="button" class="btn secondary" style="flex: 1; min-width: 85px; padding: 10px; min-height: 44px; font-weight: 600; font-size: 0.76rem;" onclick="ProtocolDiaryUI.exportToObsidian()" title="Kopiraj Markdown tabelo za Obsidian">
            📋 Markdown
          </button>
          <button type="button" class="btn secondary" style="flex: 1; min-width: 85px; padding: 10px; min-height: 44px; font-weight: 600; font-size: 0.76rem;" onclick="ProtocolDiaryUI.exportToCSV()" title="Kopiraj CSV tabelo">
            📊 CSV
          </button>
        </div>
      </div>

      <!-- KARTICA 2: HITRI 1-KLIK VNOSI (PRESET CHIPS) -->
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">⚡ Hitri 1-Klik Vnos (Binetov Sklad)</div>
          <span style="font-size: 0.72rem; color: var(--text-3);">Tapni za takojšen vpis</span>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">
          ${Diary.PRESET_INTAKES.map(p => {
            const lastEntry = (typeof Diary.getLastEntryForSubstance === 'function')
              ? (Diary.getLastEntryForSubstance(p.name) || Diary.getLastEntryForSubstance(p.shortName))
              : null;
            const lastAgo = (lastEntry && typeof Diary.formatDaysAgoEntry === 'function')
              ? Diary.formatDaysAgoEntry(lastEntry)
              : null;
            return `
            <button type="button" class="btn secondary" 
                    style="padding: 6px 12px; min-height: 44px; font-size: 0.76rem; border-radius: 10px; display: inline-flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; border-color: rgba(255,255,255,0.12);"
                    onclick="ProtocolDiaryUI.quickLog('${p.id}')">
              <div style="display: flex; align-items: center; gap: 5px;">
                <span>${p.icon}</span>
                <strong>${p.shortName}</strong>
                <span style="color: var(--text-3); font-size: 0.7rem;">(${p.dose} ${p.unit})</span>
              </div>
              <div style="font-size: 0.64rem; color: ${lastAgo ? 'var(--strain-blue, #38bdf8)' : 'var(--text-3)'};">
                ${lastAgo ? `zadnji vnos: ${lastAgo}` : 'zadnji vnos: še ni zabeležen'}
              </div>
            </button>
          `;
          }).join('')}
        </div>
      </div>

      <!-- KARTICA 3: ZGODOVINA IN ČASOVNICA VNOSOV -->
      <div class="card">
        <div class="card-header" style="flex-direction: column; align-items: stretch; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="card-title">🕒 Zgodovina & Časovnica Vnosov</div>
          </div>

          <!-- Filter po obdobju (7 / 30 / Vse) -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(0,0,0,0.18); padding: 6px 10px; border-radius: 8px;">
            <span style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Obdobje:</span>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="sh-tab-btn ${currentPeriodFilter === '7' ? 'active' : ''}" 
                      style="font-size: 0.72rem; padding: 0 10px; min-height: 44px; min-width: 44px;" onclick="ProtocolDiaryUI.setPeriodFilter('7')">7 dni</button>
              <button type="button" class="sh-tab-btn ${currentPeriodFilter === '30' ? 'active' : ''}" 
                      style="font-size: 0.72rem; padding: 0 10px; min-height: 44px; min-width: 44px;" onclick="ProtocolDiaryUI.setPeriodFilter('30')">30 dni</button>
              <button type="button" class="sh-tab-btn ${currentPeriodFilter === 'all' ? 'active' : ''}" 
                      style="font-size: 0.72rem; padding: 0 10px; min-height: 44px; min-width: 44px;" onclick="ProtocolDiaryUI.setPeriodFilter('all')">Vse</button>
            </div>
          </div>
          
          <!-- Filtri kategorij -->
          <div style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px;">
            <button type="button" class="sh-tab-btn ${currentCategoryFilter === 'all' ? 'active' : ''}" 
                    style="font-size: 0.72rem; padding: 0 12px; min-height: 44px; flex-shrink: 0;" onclick="ProtocolDiaryUI.setFilter('all')">Vse</button>
            <button type="button" class="sh-tab-btn ${currentCategoryFilter === 'anabolik' ? 'active' : ''}" 
                    style="font-size: 0.72rem; padding: 0 12px; min-height: 44px; flex-shrink: 0; white-space: nowrap; color: #f87171;" onclick="ProtocolDiaryUI.setFilter('anabolik')">💉 Anaboliki</button>
            <button type="button" class="sh-tab-btn ${currentCategoryFilter === 'lasje' ? 'active' : ''}" 
                    style="font-size: 0.72rem; padding: 0 12px; min-height: 44px; flex-shrink: 0; white-space: nowrap; color: #c084fc;" onclick="ProtocolDiaryUI.setFilter('lasje')">💈 Lasje</button>
            <button type="button" class="sh-tab-btn ${currentCategoryFilter === 'suplement' ? 'active' : ''}" 
                    style="font-size: 0.72rem; padding: 0 12px; min-height: 44px; flex-shrink: 0; white-space: nowrap; color: #34d399;" onclick="ProtocolDiaryUI.setFilter('suplement')">💊 Suplementi</button>
          </div>
        </div>

        <div id="pdiaryTimelineContainer" style="margin-top: 12px; display: flex; flex-direction: column; gap: 14px;">
          ${filteredDates.length === 0 ? `
            <div style="text-align: center; padding: 24px 10px; color: var(--text-3); font-size: 0.8rem;">
              <span>📭 Ni najdenih vnosov za izbran filter.</span><br>
              <span style="font-size: 0.72rem;">Uporabi zgornje gumbe za hiter vnos dopolnil ali anabolikov!</span>
            </div>
          ` : filteredDates.map(dateStr => renderDayCard(dateStr)).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Izris polnega pogleda dnevnika v poljuben vsebnik
   */
  function renderDiaryView(containerId = 'sh-content-area') {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container || !Diary) return;
    container.innerHTML = getDiaryViewHtml();
  }

  /**
   * Izris kartice za posamezen dan
   */
  function renderDayCard(dateStr) {
    let dayEntries = Diary.getEntriesForDate(dateStr);
    if (currentCategoryFilter !== 'all') {
      dayEntries = dayEntries.filter(e => e.category === currentCategoryFilter);
    }
    if (dayEntries.length === 0) return '';

    const displayTitle = Diary.formatDisplayDate(dateStr);
    const isToday = displayTitle === 'Danes';

    return `
      <div style="background: var(--surface-2); border: 1px solid var(--edge-1); border-radius: 12px; padding: 12px; ${isToday ? 'border-left: 3px solid var(--rec-green);' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 700; font-size: 0.88rem; color: ${isToday ? 'var(--rec-green)' : 'var(--text-1)'};">
            📅 ${displayTitle} <span style="font-size: 0.72rem; color: var(--text-3); font-weight: normal;">(${dateStr})</span>
          </span>
          <span style="font-size: 0.7rem; color: var(--text-3); background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 6px;">
            ${dayEntries.length} ${dayEntries.length === 1 ? 'vnos' : dayEntries.length === 2 ? 'vnosa' : 'vnosov'}
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${dayEntries.map(e => {
            const cat = Diary.CATEGORIES[e.category] || { label: e.category, color: '#38bdf8', icon: '💊' };
            const slot = Diary.TIMING_SLOTS[e.slot] || { label: e.slot, icon: '⏱️' };
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.22); padding: 8px 10px; border-radius: 8px; border-left: 2px solid ${cat.color};">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                  <span style="font-size: 0.72rem; color: var(--text-3); font-variant-numeric: tabular-nums; width: 38px;">
                    ${escapeHtml(e.time)}
                  </span>
                  <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                      <span style="font-weight: 700; font-size: 0.82rem; color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${escapeHtml(e.substance)}
                      </span>
                      <span style="font-size: 0.74rem; font-weight: 700; color: ${cat.color};">
                        ${escapeHtml(e.dose)} ${escapeHtml(e.unit)}
                      </span>
                    </div>
                    <div style="font-size: 0.68rem; color: var(--text-3); margin-top: 1px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                      <span>${slot.icon} ${slot.label}</span>
                      ${e.notes ? `<span>• <em>${escapeHtml(e.notes)}</em></span>` : ''}
                    </div>
                  </div>
                </div>

                <button type="button" style="background: none; border: none; color: var(--text-3); cursor: pointer; padding: 0; min-width: 44px; min-height: 44px; flex-shrink: 0; font-size: 0.9rem; border-radius: 4px; touch-action: manipulation;" aria-label="Izbriši vnos"
                        title="Izbriši vnos" onclick="ProtocolDiaryUI.deleteEntry('${e.id}')">
                  ✕
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Izris kompaktnega povzetka za zavihek Danes
   */
  function renderTodayWidget(targetElementId = 'danesDiaryWidget') {
    const el = document.getElementById(targetElementId);
    if (!el || !Diary) return;

    const todayEntries = Diary.getTodayEntries();
    const stats = Diary.getStats();

    el.innerHTML = `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header">
          <div class="card-title">💊 Dnevni Protokoli & Suplementi</div>
          <span class="status-pill" style="color: var(--rec-green);">
            ${todayEntries.length} vnosov danes
          </span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; margin-bottom: 10px;">
          <span style="font-size: 0.75rem; color: var(--text-2);">
            Zabeleži vnos ali preveri zgodovino
          </span>
          <button type="button" class="btn secondary" style="font-size: 0.7rem; padding: 0 10px; min-height: 44px;" onclick="switchNav('estetika'); if(window.SkinHairUI) SkinHairUI.switchSubTab('dnevnik');">
            📖 Celoten dnevnik →
          </button>
        </div>

        <!-- Hitri gumbi za danes -->
        <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 8px;">
          <button type="button" class="btn secondary" style="padding: 0 10px; min-height: 44px; flex-shrink: 0; font-size: 0.72rem; white-space: nowrap;" onclick="ProtocolDiaryUI.quickLog('test_eq_daily')">
            💉 Test+EQ
          </button>
          <button type="button" class="btn secondary" style="padding: 0 10px; min-height: 44px; flex-shrink: 0; font-size: 0.72rem; white-space: nowrap;" onclick="ProtocolDiaryUI.quickLog('finasteride_1mg')">
            💈 Finasterid 1mg
          </button>
          <button type="button" class="btn secondary" style="padding: 0 10px; min-height: 44px; flex-shrink: 0; font-size: 0.72rem; white-space: nowrap;" onclick="ProtocolDiaryUI.quickLog('minoxidil_topical')">
            💈 Minoksidil 5%
          </button>
          <button type="button" class="btn secondary" style="padding: 0 10px; min-height: 44px; flex-shrink: 0; font-size: 0.72rem; white-space: nowrap;" onclick="ProtocolDiaryUI.quickLog('omega3_dha_epa')">
            🐟 Omega-3
          </button>
          <button type="button" class="btn secondary" style="padding: 0 10px; min-height: 44px; flex-shrink: 0; font-size: 0.72rem; white-space: nowrap;" onclick="ProtocolDiaryUI.quickLog('vitamin_d3_k2')">
            ☀️ Vit D3+K2
          </button>
        </div>

        ${todayEntries.length > 0 ? `
          <div style="font-size: 0.72rem; color: var(--text-3); display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--edge-1); padding-top: 6px;">
            ${todayEntries.slice(0, 4).map(e => `
              <div style="display: flex; justify-content: space-between;">
                <span>${escapeHtml(e.substance)} (${escapeHtml(e.dose)} ${escapeHtml(e.unit)})</span>
                <span style="color: var(--text-3); font-variant-numeric: tabular-nums;">${escapeHtml(e.time)}</span>
              </div>
            `).join('')}
            ${todayEntries.length > 4 ? `<span style="color: var(--rec-green); font-size: 0.68rem;">+ še ${todayEntries.length - 4} vnosov</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Hitri vnos iz predloge z obvestilom in prikazom zadnjega vnosa
   */
  function quickLog(presetId) {
    if (!Diary) return;
    const preset = Diary.PRESET_INTAKES.find(p => p.id === presetId);
    const prevEntry = preset && typeof Diary.getLastEntryForSubstance === 'function'
      ? (Diary.getLastEntryForSubstance(preset.name) || Diary.getLastEntryForSubstance(preset.shortName))
      : null;
    const prevAgo = prevEntry && typeof Diary.formatDaysAgoEntry === 'function'
      ? Diary.formatDaysAgoEntry(prevEntry)
      : null;

    const entry = Diary.logPreset(presetId);
    if (entry) {
      const lastText = prevAgo ? ` • zadnji vnos: ${prevAgo}` : '';
      showToast(`✓ Zabeleženo: ${entry.substance} (${entry.dose} ${entry.unit})${lastText}`, true);
      refreshActiveViews();
    }
  }

  /**
   * Brisanje vnosa z osvežitvijo
   */
  function deleteEntry(entryId) {
    if (!Diary) return;
    if (confirm('Želiš izbrisati ta vnos iz dnevnika?')) {
      Diary.deleteEntry(entryId);
      showToast('Vnos izbrisan', false);
      refreshActiveViews();
    }
  }

  function setFilter(cat) {
    currentCategoryFilter = cat;
    renderDiaryView();
  }

  function setPeriodFilter(period) {
    currentPeriodFilter = period;
    renderDiaryView();
  }

  function getPeriodFilter() {
    return currentPeriodFilter;
  }

  function updateLastEntryHint(substanceName) {
    const hintEl = document.getElementById('pdiaryLastEntryHint');
    if (!hintEl || !Diary) return;
    const name = (substanceName || '').trim();
    if (!name) {
      hintEl.textContent = 'zadnji vnos: vnesi substanco za vpogled';
      hintEl.style.color = 'var(--text-3)';
      return;
    }
    const last = typeof Diary.getLastEntryForSubstance === 'function' ? Diary.getLastEntryForSubstance(name) : null;
    if (last) {
      const ago = (typeof Diary.formatDaysAgoEntry === 'function') ? Diary.formatDaysAgoEntry(last) : null;
      const doseStr = last.dose ? ` (${last.dose} ${last.unit})` : '';
      hintEl.textContent = `zadnji vnos: ${ago || 'pred kratkim'}${doseStr}`;
      hintEl.style.color = 'var(--strain-blue, #38bdf8)';
    } else {
      hintEl.textContent = 'zadnji vnos: še ni zabeležen v dnevniku';
      hintEl.style.color = 'var(--text-3)';
    }
  }

  function refreshActiveViews() {
    renderDiaryView();
    renderTodayWidget();
    if (typeof window !== 'undefined' && window.SkinHairUI && typeof window.SkinHairUI.render === 'function') {
      // če smo na podzavihku dnevnik, renderDiaryView že osveži
    }
  }

  /**
   * Modal za vnos po meri
   */
  function openNewEntryModal() {
    let overlay = document.getElementById('pdiaryModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pdiaryModalOverlay';
      overlay.className = 'modal-overlay';
      overlay.onclick = (e) => {
        if (e.target.id === 'pdiaryModalOverlay') closeNewEntryModal();
      };
      document.body.appendChild(overlay);
    }

    const today = Diary.getLocalDateString();
    const nowTime = Diary.getLocalTimeString();

    overlay.innerHTML = `
      <div class="modal" style="max-width: 460px;">
        <div class="modal-header">
          <div class="modal-sheet-handle"></div>
          <div class="modal-header-row">
            <h3 style="margin: 0; font-size: 0.95rem;">✍️ Zabeleži Vnos v Dnevnik</h3>
            <button type="button" class="modal-close" style="width: 44px; height: 44px;" aria-label="Zapri" onclick="ProtocolDiaryUI.closeNewEntryModal()">✕</button>
          </div>
        </div>
        <div class="modal-body" style="padding: 14px; display: flex; flex-direction: column; gap: 10px;">
          <div>
            <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Substanca / Dopolnilo</label>
            <input type="text" id="pdiaryInpSubstance" placeholder="npr. Testosteron, Finasterid, Omega-3..." 
                   list="pdiarySubstancesList" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff; font-weight: 600;"
                   oninput="ProtocolDiaryUI.updateLastEntryHint(this.value)" onchange="ProtocolDiaryUI.updateLastEntryHint(this.value)">
            <div id="pdiaryLastEntryHint" style="font-size: 0.74rem; color: var(--text-3); margin-top: 4px; min-height: 18px; font-weight: 500;">
              zadnji vnos: vnesi substanco za vpogled
            </div>
            <datalist id="pdiarySubstancesList">
              ${Diary.PRESET_INTAKES.map(p => `<option value="${p.name}">`).join('')}
              <option value="Raloksifen">
              <option value="Boldenon (EQ)">
              <option value="Testosteron cipionat">
              <option value="Finasterid">
              <option value="Minoksidil 5%">
              <option value="Omega-3 (DHA/EPA)">
              <option value="Vitamin D3 + K2">
              <option value="Magnezijev bisglicinat">
              <option value="Cink pikolinat">
              <option value="Kreatin monohidrat">
              <option value="L-Teanin">
              <option value="Kofein">
            </datalist>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Odmerek</label>
              <input type="text" id="pdiaryInpDose" placeholder="npr. 30 ali 1" value="" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff; font-weight: 700;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Enota</label>
              <select id="pdiaryInpUnit" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
                <option value="mg">mg</option>
                <option value="enot (U-100)">enot (U-100)</option>
                <option value="mL">mL</option>
                <option value="g">g</option>
                <option value="IU">IU</option>
                <option value="kapsula">kapsula</option>
                <option value="nanos">nanos</option>
                <option value="pranje">pranje</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Kategorija</label>
              <select id="pdiaryInpCat" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
                <option value="anabolik">💉 Anaboliki & Zaščita</option>
                <option value="lasje">💈 Lasje & Skalp</option>
                <option value="suplement" selected>💊 Suplementi & Zdravje</option>
                <option value="nootropik">🧠 Nootropiki</option>
              </select>
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Cirkadiana reža</label>
              <select id="pdiaryInpSlot" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
                ${Object.entries(Diary.TIMING_SLOTS).map(([k, v]) => `
                  <option value="${k}">${v.icon} ${v.label}</option>
                `).join('')}
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Datum</label>
              <input type="date" id="pdiaryInpDate" value="${today}" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Ura</label>
              <input type="time" id="pdiaryInpTime" value="${nowTime}" style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
            </div>
          </div>

          <div>
            <label style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">Opomba (neobvezno)</label>
            <input type="text" id="pdiaryInpNotes" placeholder="npr. vbod v ramo, z obrokom..." style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
          </div>

          <button type="button" class="btn" style="width: 100%; padding: 11px; min-height: 48px; font-weight: 700; margin-top: 6px;" onclick="ProtocolDiaryUI.saveNewEntryFromModal()">
            💾 Shrani v Dnevnik
          </button>
        </div>
      </div>
    `;

    overlay.style.display = '';
    overlay.classList.add('open');
    if (typeof lockBodyScroll === 'function') lockBodyScroll();
    else {
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    }
  }

  function closeNewEntryModal() {
    const overlay = document.getElementById('pdiaryModalOverlay');
    if (overlay) { overlay.classList.remove('open'); overlay.style.display = ''; }
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll();
    else {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }
  }

  function saveNewEntryFromModal() {
    const substance = (document.getElementById('pdiaryInpSubstance')?.value || '').trim();
    if (!substance) {
      alert('Vnesi ime substance ali dopolnila!');
      return;
    }

    const dose = (document.getElementById('pdiaryInpDose')?.value || '').trim();
    const unit = document.getElementById('pdiaryInpUnit')?.value || 'mg';
    const category = document.getElementById('pdiaryInpCat')?.value || 'suplement';
    const slot = document.getElementById('pdiaryInpSlot')?.value || 'CUSTOM';
    const date = document.getElementById('pdiaryInpDate')?.value || Diary.getLocalDateString();
    const time = document.getElementById('pdiaryInpTime')?.value || Diary.getLocalTimeString();
    const notes = (document.getElementById('pdiaryInpNotes')?.value || '').trim();

    Diary.addEntry({ substance, dose, unit, category, slot, date, time, notes });
    closeNewEntryModal();
    showToast(`✓ Zabeleženo: ${substance} ${dose ? `(${dose} ${unit})` : ''}`, true);
    refreshActiveViews();
  }

  /**
   * Izvoz v Obsidian
   */
  function copyTextFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
      document.body.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function exportToObsidian() {
    if (!Diary) return;
    const md = Diary.exportToObsidianMarkdown();
    const done = () => showToast('✓ Markdown kopiran v odložišče! (Prilepi v Obsidian)', true);
    const fail = () => { if (copyTextFallback(md)) done(); else prompt('Kopiraj Markdown za Obsidian:', md); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(done).catch(fail);
    } else {
      fail();
    }
  }

  // =========================================================================
  // GLOBALNO DRSTANJE LEVO / DESNO (SWIPE GESTURE NAVIGATION)
  // =========================================================================
  const TAB_ORDER = ['danes', 'cikel', 'prehrana', 'bloodwork', 'trening', 'estetika', 'vault'];

  function initSwipeNavigation() {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isTracking = false;

    // Elementi, kjer drsanje levo/desno ne sme preklapljati glavnih zavihkov
    function shouldIgnoreSwipe(target) {
      if (!target) return false;
      return !!target.closest(
        'input[type="range"], input, textarea, select, table, .sh-split-container, .modal-overlay, .modal, #assistantSheet, .assistant-sheet, .wui-sheet-fullscreen, .wui-container, .beast-overlay, [contenteditable], #cpChart, #cikelSvgChart, .sh-subtabs, #catFilterButtons, #presetFoodsChips, canvas, button'
      );
    }

    function isFullscreenSheetOpen() {
      const sheet = document.getElementById('wuiActiveSheet');
      return !!sheet && getComputedStyle(sheet).display === 'flex';
    }

    document.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      if (document.body.classList.contains('modal-open')) return;
      if (isFullscreenSheetOpen()) return;
      if (shouldIgnoreSwipe(e.target)) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      isTracking = true;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!isTracking || !e.changedTouches || e.changedTouches.length === 0) return;
      isTracking = false;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const duration = Date.now() - startTime;

      // Zahtevaj naraven vodoravni poteg (vsaj 45px, bolj vodoraven kot navpičen, < 650ms)
      if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > 1.35 * Math.abs(deltaY) && duration < 650) {
        handleGlobalSwipe(deltaX < 0 ? 'next' : 'prev');
      }
    }, { passive: true });
  }

  function handleGlobalSwipe(direction) {
    const currentView = document.body.dataset.view || 'danes';
    const currentIndex = TAB_ORDER.indexOf(currentView);
    if (currentIndex === -1) return;

    let targetIndex;
    if (direction === 'next') {
      targetIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else {
      targetIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    }

    const targetTab = TAB_ORDER[targetIndex];
    if (typeof window.switchNav === 'function') {
      window.switchNav(targetTab);
      // Nežen vizualni indikator
      showToast(`Prikaz: ${targetTab.toUpperCase()}`, true);
    }
  }

  // Samodejna inicializacija
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initSwipeNavigation();
      });
    } else {
      initSwipeNavigation();
    }
  }

  return {
    getDiaryViewHtml,
    renderDiaryView,
    renderTodayWidget,
    quickLog,
    deleteEntry,
    setFilter,
    openNewEntryModal,
    closeNewEntryModal,
    saveNewEntryFromModal,
    exportToObsidian,
    initSwipeNavigation,
    handleGlobalSwipe,
    refreshActiveViews
  };
}));
