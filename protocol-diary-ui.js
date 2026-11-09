/**
 * Protocol & Supplement Diary UI (Binetov Dnevnik Vnosov & Protokolov)
 * Celovit UI modul za beleženje vseh vnosov anabolikov, suplementov, nootropikov in las.
 * Vključuje 1-klik hitre vnose, jutro/večer sezname s kljukicami, urejanje protokola,
 * podporo za intervale (npr. dutasterid vsak 2. dan) ter ohranjanje položaja drsenja.
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

  // =========================================================================
  // OHRANJANJE POLOŽAJA DRSENJA (Scroll preservation - brez skakanja na vrh)
  // =========================================================================
  function withPreservedScroll(fn) {
    if (typeof window === 'undefined') {
      fn();
      return;
    }

    const scrollY = window.pageYOffset || (document.documentElement ? document.documentElement.scrollTop : 0) || (document.body ? document.body.scrollTop : 0);
    const scrollX = window.pageXOffset || (document.documentElement ? document.documentElement.scrollLeft : 0) || (document.body ? document.body.scrollLeft : 0);

    const containerSnapshots = [];
    try {
      const candidates = document.querySelectorAll('.container, .view, #view-danes, #view-estetika, #sh-content-area, .sh-split-container, body, html');
      candidates.forEach(el => {
        if (el && (el.scrollTop > 0 || el.scrollLeft > 0)) {
          containerSnapshots.push({ el, top: el.scrollTop, left: el.scrollLeft });
        }
      });
    } catch(e) {}

    fn();

    const restore = () => {
      try {
        if (typeof window.scrollTo === 'function') {
          window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
        }
        containerSnapshots.forEach(item => {
          if (item.el) {
            item.el.scrollTop = item.top;
            item.el.scrollLeft = item.left;
          }
        });
      } catch(e) {}
    };

    restore();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(restore);
    }
  }

  // =========================================================================
  // TOAST OBVESTILA IN 5-SEKUNDNI UNDO
  // =========================================================================
  function showToast(text, isHappy = true, duration = 3500) {
    const toast = document.getElementById('mascotToast');
    const toastText = document.getElementById('mascotToastText');
    const toastImg = document.getElementById('mascotToastImg');
    if (toast && toastText && toastImg) {
      toastText.textContent = text;
      toastImg.src = isHappy ? './assets/anime/wink-opt.gif' : './assets/anime/laugh-opt.gif';
      toast.style.display = 'flex';
      clearTimeout(window._toastTimeout);
      window._toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }
  }

  /**
   * Prikaz toast obvestila z gumbom za razveljavitev, ki traja 5 sekund
   */
  function showUndoToast(text, undoCallback, duration = 5000) {
    const toast = document.getElementById('mascotToast');
    const toastText = document.getElementById('mascotToastText');
    const toastImg = document.getElementById('mascotToastImg');

    if (toast && toastText && toastImg) {
      toastImg.src = './assets/anime/wink-opt.gif';
      toastText.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
          <span style="font-size: 0.76rem; line-height: 1.25;">${escapeHtml(text)}</span>
          <button type="button" id="pdiaryUndoActionBtn" style="background: var(--strain-blue, #38bdf8); color: #040914; border: none; border-radius: 6px; padding: 4px 10px; font-weight: 800; font-size: 0.72rem; cursor: pointer; flex-shrink: 0; min-height: 36px; touch-action: manipulation;">
            Razveljavi
          </button>
        </div>
      `;
      toast.style.display = 'flex';

      const btn = document.getElementById('pdiaryUndoActionBtn');
      if (btn) {
        btn.onclick = (e) => {
          e.stopPropagation();
          clearTimeout(window._toastTimeout);
          toast.style.display = 'none';
          if (typeof undoCallback === 'function') {
            undoCallback();
          }
        };
      }

      clearTimeout(window._toastTimeout);
      window._toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
      return;
    }

    // Fallback samostojni floating toast
    let fallback = document.getElementById('pdiaryFloatingToast');
    if (!fallback) {
      fallback = document.createElement('div');
      fallback.id = 'pdiaryFloatingToast';
      fallback.style.cssText = 'position:fixed; bottom:calc(75px + env(safe-area-inset-bottom, 0px)); left:50%; transform:translateX(-50%); z-index:9999; background:rgba(14,16,18,0.96); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1px solid var(--edge-2); box-shadow:0 8px 30px rgba(0,0,0,0.6); border-radius:12px; padding:10px 16px; font-size:0.8rem; color:var(--text-1); display:flex; align-items:center; gap:12px; max-width:90vw;';
      document.body.appendChild(fallback);
    }
    fallback.innerHTML = `
      <span>${escapeHtml(text)}</span>
      <button type="button" id="pdiaryFallbackUndoBtn" style="background:var(--strain-blue, #38bdf8); color:#040914; border:none; border-radius:6px; padding:6px 12px; font-weight:800; font-size:0.75rem; cursor:pointer; min-height:36px;">
        Razveljavi
      </button>
    `;
    fallback.style.display = 'flex';
    const fUndoBtn = document.getElementById('pdiaryFallbackUndoBtn');
    if (fUndoBtn) {
      fUndoBtn.onclick = () => {
        fallback.style.display = 'none';
        if (typeof undoCallback === 'function') undoCallback();
      };
    }
    clearTimeout(window._fallbackToastTimeout);
    window._fallbackToastTimeout = setTimeout(() => {
      fallback.style.display = 'none';
    }, duration);
  }

  // =========================================================================
  // IZRIS POLNEGA POGLEDA DNEVNIKA (Estetika / Dnevnik)
  // =========================================================================
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

    // Prikazujemo samo AKTIVNE presete
    const activePresets = typeof Diary.getActivePresets === 'function'
      ? Diary.getActivePresets()
      : Diary.PRESET_INTAKES.filter(p => p.aktiven !== false);

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
          <button type="button" class="btn secondary" style="flex: 1; min-width: 110px; padding: 10px; min-height: 44px; font-weight: 600; font-size: 0.76rem;" onclick="ProtocolDiaryUI.openRoutineModal()">
            ⚙️ Uredi protokol
          </button>
          <button type="button" class="btn secondary" style="flex: 1; min-width: 85px; padding: 10px; min-height: 44px; font-weight: 600; font-size: 0.76rem;" onclick="ProtocolDiaryUI.exportToObsidian()" title="Kopiraj Markdown tabelo za Obsidian">
            📋 Markdown
          </button>
          <button type="button" class="btn secondary" style="flex: 1; min-width: 85px; padding: 10px; min-height: 44px; font-weight: 600; font-size: 0.76rem;" onclick="ProtocolDiaryUI.exportToCSV()" title="Kopiraj CSV tabelo">
            📊 CSV
          </button>
        </div>
      </div>

      <!-- KARTICA 2: HITRI 1-KLIK VNOSI (SAMO AKTIVNI PRESET CHIPS) -->
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header" style="justify-content: space-between; align-items: center;">
          <div>
            <div class="card-title">⚡ Hitri 1-Klik Vnos (Binetov Sklad)</div>
            <span style="font-size: 0.72rem; color: var(--text-3);">Tapni za takojšen vpis</span>
          </div>
          <button type="button" class="btn secondary" style="padding: 4px 10px; font-size: 0.72rem; min-height: 44px;" onclick="ProtocolDiaryUI.openRoutineModal()">
            ⚙️ Prilagodi
          </button>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">
          ${activePresets.map(p => {
            const lastEntry = (typeof Diary.getLastEntryForSubstance === 'function')
              ? (Diary.getLastEntryForSubstance(p.name) || Diary.getLastEntryForSubstance(p.shortName))
              : null;
            const lastAgo = (lastEntry && typeof Diary.formatDaysAgoEntry === 'function')
              ? Diary.formatDaysAgoEntry(lastEntry)
              : null;
            
            // Interval badge
            let intervalBadge = '';
            if (p.pogostost && p.pogostost.vsakNdni && typeof Diary.getIntervalStatus === 'function') {
              const iv = Diary.getIntervalStatus(p.id);
              if (iv) {
                if (iv.isDue) {
                  intervalBadge = `<span style="font-size: 0.62rem; color: #22d3ee; font-weight: 700;">• danes na vrsti</span>`;
                } else {
                  intervalBadge = `<span style="font-size: 0.62rem; color: #fbbf24; font-weight: 700;">• jutri</span>`;
                }
              }
            }

            return `
            <button type="button" class="btn secondary" 
                    style="padding: 6px 12px; min-height: 44px; font-size: 0.76rem; border-radius: 10px; display: inline-flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; border-color: rgba(255,255,255,0.12); touch-action: manipulation;"
                    onclick="ProtocolDiaryUI.quickLog('${p.id}')">
              <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                <span>${p.icon}</span>
                <strong>${escapeHtml(p.shortName || p.name)}</strong>
                <span style="color: var(--text-3); font-size: 0.7rem;">(${escapeHtml(p.dose)} ${escapeHtml(p.unit)})</span>
                ${intervalBadge}
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
            <button type="button" class="sh-tab-btn ${currentCategoryFilter === 'nootropik' ? 'active' : ''}" 
                    style="font-size: 0.72rem; padding: 0 12px; min-height: 44px; flex-shrink: 0; white-space: nowrap; color: #60a5fa;" onclick="ProtocolDiaryUI.setFilter('nootropik')">🧠 Nootropiki</button>
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

  function renderDiaryView(containerId = 'sh-content-area') {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container || !Diary) return;
    container.innerHTML = getDiaryViewHtml();
  }

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
          }).join('')}\n        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // =========================================================================
  // DANES WIDGET (Jutro / Pred treningom / Zvečer kartični seznami s kljukicami)
  // =========================================================================
  function renderTodayWidget(targetElementId = 'danesDiaryWidget') {
    const el = document.getElementById(targetElementId);
    if (!el || !Diary) return;

    const todayEntries = Diary.getTodayEntries();
    const stats = Diary.getStats();

    // Sklopi
    const morningPresets = typeof Diary.getActivePresets === 'function' ? Diary.getActivePresets('morning') : [];
    const preworkoutPresets = typeof Diary.getActivePresets === 'function' ? Diary.getActivePresets('preworkout') : [];
    const eveningPresets = typeof Diary.getActivePresets === 'function' ? Diary.getActivePresets('evening') : [];

    // Preštej skupno število opravljenih aktivnih nalog danes
    const allActive = typeof Diary.getActivePresets === 'function' ? Diary.getActivePresets() : [];
    let completedActiveCount = 0;
    allActive.forEach(p => {
      if (typeof Diary.getTodayEntryForPreset === 'function' && Diary.getTodayEntryForPreset(p.id)) {
        completedActiveCount++;
      }
    });

    el.innerHTML = `
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-header" style="justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="card-title">💊 Dnevni Protokoli & Suplementi</div>
          </div>
          <span class="status-pill" style="color: var(--rec-green); border-color: rgba(0,230,118,0.3); font-size: 0.72rem;">
            ✓ ${completedActiveCount} / ${allActive.length} danes
          </span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; margin-bottom: 12px; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="btn secondary" style="font-size: 0.74rem; padding: 6px 12px; min-height: 44px; display: inline-flex; align-items: center; gap: 6px;" onclick="ProtocolDiaryUI.openRoutineModal()">
            <span>⚙️</span>
            <span>Uredi moj protokol</span>
          </button>
          <button type="button" class="btn secondary" style="font-size: 0.74rem; padding: 6px 12px; min-height: 44px; display: inline-flex; align-items: center; gap: 6px;" onclick="switchNav('estetika'); if(window.SkinHairUI) SkinHairUI.switchSubTab('dnevnik');">
            <span>📖</span>
            <span>Celoten dnevnik →</span>
          </button>
        </div>

        <!-- 1. SKLOP: ZJUTRAJ -->
        ${renderSklopCard('morning', '🌅 Zjutraj', morningPresets, '✓ Vse zjutraj')}

        <!-- 2. SKLOP: PRED TRENINGOM -->
        ${renderSklopCard('preworkout', '⚡ Pred treningom', preworkoutPresets, '✓ Vse pred treningom')}

        <!-- 3. SKLOP: ZVEČER -->
        ${renderSklopCard('evening', '🌙 Zvečer', eveningPresets, '✓ Vse zvečer')}

        <!-- POVZETEK DANES ZABELEŽENIH VNOSOV -->
        ${todayEntries.length > 0 ? `
          <div style="margin-top: 10px; border-top: 1px solid var(--edge-1); padding-top: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.72rem; color: var(--text-3); font-weight: 700; text-transform: uppercase;">
                🕒 Časovnica danes (${todayEntries.length} vnosov):
              </span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${todayEntries.slice(0, 5).map(e => `
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; background: rgba(0,0,0,0.18); padding: 5px 8px; border-radius: 6px;">
                  <span style="color: var(--text-1);">
                    <strong>${escapeHtml(e.substance)}</strong>
                    <span style="color: var(--text-3);">(${escapeHtml(e.dose)} ${escapeHtml(e.unit)})</span>
                  </span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--rec-green); font-variant-numeric: tabular-nums; font-weight: 600;">${escapeHtml(e.time)}</span>
                    <button type="button" style="background: none; border: none; color: var(--text-3); cursor: pointer; padding: 0 4px; min-width: 32px; min-height: 32px; font-size: 0.8rem;" title="Izbriši vnos" onclick="ProtocolDiaryUI.deleteEntry('${e.id}')">✕</button>
                  </div>
                </div>
              `).join('')}
              ${todayEntries.length > 5 ? `
                <span style="color: var(--rec-green); font-size: 0.68rem; text-align: right; margin-top: 2px;">
                  + še ${todayEntries.length - 5} vnosov
                </span>
              ` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Izris kartice za posamezen sklop (Zjutraj / Pred treningom / Zvečer)
   */
  function renderSklopCard(sklopId, title, presets, batchButtonLabel) {
    if (!presets || presets.length === 0) {
      return '';
    }

    // Preveri, koliko jih je odkljukanih danes
    let loggedCount = 0;
    let dueCount = 0;

    const itemsHtml = presets.map(p => {
      const todayEntry = typeof Diary.getTodayEntryForPreset === 'function' ? Diary.getTodayEntryForPreset(p.id) : null;
      const isLogged = !!todayEntry;
      if (isLogged) loggedCount++;

      // Preveri interval
      let intervalBadge = '';
      let isDue = true;
      if (p.pogostost && p.pogostost.vsakNdni && typeof Diary.getIntervalStatus === 'function') {
        const iv = Diary.getIntervalStatus(p.id);
        if (iv) {
          isDue = iv.isDue;
          if (isLogged) {
            intervalBadge = `<span style="font-size: 0.65rem; background: rgba(0,230,118,0.16); color: var(--rec-green); border: 1px solid rgba(0,230,118,0.3); padding: 1px 6px; border-radius: 6px; font-weight: 700;">✓ danes vzeto</span>`;
          } else if (iv.isDue) {
            intervalBadge = `<span style="font-size: 0.65rem; background: rgba(34,211,238,0.18); color: #22d3ee; border: 1px solid rgba(34,211,238,0.35); padding: 1px 6px; border-radius: 6px; font-weight: 700;">⚡ danes na vrsti</span>`;
          } else {
            intervalBadge = `<span style="font-size: 0.65rem; background: rgba(251,191,36,0.14); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); padding: 1px 6px; border-radius: 6px; font-weight: 700;">⏳ jutri</span>`;
          }
        }
      }

      if (isDue || isLogged) dueCount++;

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.22); border: 1px solid ${isLogged ? 'rgba(0,230,118,0.28)' : 'var(--edge-1)'}; border-radius: 10px; padding: 6px 8px; min-height: 44px; transition: border-color 0.2s; touch-action: manipulation;">
          <!-- Kljukica gumb (min 44x44px za iOS) -->
          <button type="button" 
                  style="width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0;"
                  aria-label="${isLogged ? 'Razveljavi vnos ' + p.name : 'Zabeleži ' + p.name}"
                  onclick="ProtocolDiaryUI.togglePreset('${p.id}')">
            ${isLogged ? `
              <div style="width: 26px; height: 26px; border-radius: 50%; background: var(--rec-green, #00e676); color: #040914; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.85rem; box-shadow: 0 0 10px rgba(0,230,118,0.45);">
                ✓
              </div>
            ` : `
              <div style="width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center;">
              </div>
            `}
          </button>

          <!-- Vsebina snovi (klik prav tako preklopi) -->
          <div style="flex: 1; min-width: 0; padding: 0 6px; cursor: pointer;" onclick="ProtocolDiaryUI.togglePreset('${p.id}')">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-weight: 700; font-size: 0.82rem; color: ${isLogged ? 'var(--rec-green, #00e676)' : 'var(--text-1)'};">
                ${p.icon} ${escapeHtml(p.shortName || p.name)}
              </span>
              <span style="font-size: 0.74rem; font-weight: 600; color: ${isLogged ? 'var(--rec-green, #00e676)' : 'var(--text-2)'};">
                ${escapeHtml(p.dose)} ${escapeHtml(p.unit)}
              </span>
              ${intervalBadge}
            </div>
            <div style="font-size: 0.68rem; color: var(--text-3); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(p.defaultNotes || '')}
            </div>
          </div>

          <!-- Desni indikator časa ali statusa -->
          <div style="flex-shrink: 0; text-align: right; padding-right: 4px;">
            ${isLogged && todayEntry ? `
              <span style="font-size: 0.72rem; color: var(--rec-green, #00e676); font-variant-numeric: tabular-nums; font-weight: 700;">
                ${escapeHtml(todayEntry.time)}
              </span>
            ` : `
              <span style="font-size: 0.68rem; color: var(--text-3); opacity: 0.7;">
                tapni
              </span>
            `}
          </div>
        </div>
      `;
    }).join('');

    const allCompleted = presets.length > 0 && loggedCount >= presets.length;

    return `
      <div style="background: rgba(255,255,255,0.025); border: 1px solid var(--edge-1); border-radius: 12px; padding: 10px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-weight: 800; font-size: 0.86rem; color: var(--text-1);">${title}</span>
            <span style="font-size: 0.72rem; color: ${allCompleted ? 'var(--rec-green)' : 'var(--text-3)'}; background: rgba(255,255,255,0.05); padding: 1px 7px; border-radius: 6px; font-weight: 700;">
              ${loggedCount}/${presets.length}
            </span>
          </div>

          <!-- Gumb Vse naenkrat -->
          <button type="button" class="btn ${allCompleted ? 'secondary' : ''}" 
                  style="font-size: 0.72rem; padding: 4px 12px; min-height: 44px; font-weight: 700; ${allCompleted ? 'opacity: 0.7;' : 'background: var(--rec-green, #00e676); color: #040914;'}"
                  onclick="ProtocolDiaryUI.logAll('${sklopId}')">
            ${allCompleted ? '✓ Vse zabeleženo' : batchButtonLabel}
          </button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // DEJANJA: TOGGLE, BATCH LOG, QUICK LOG, DELETE
  // =========================================================================

  /**
   * Preklopi kljukico posamezne substance danes:
   * 1. klik = vnos
   * 2. klik = razveljavi samo današnji vnos (z 5s undo toastom)
   */
  function togglePreset(presetId) {
    if (!Diary) return;
    const res = typeof Diary.togglePresetForToday === 'function'
      ? Diary.togglePresetForToday(presetId)
      : null;

    if (!res) return;

    if (res.action === 'added') {
      showToast(`✓ Zabeleženo: ${res.entry.substance} (${res.entry.dose} ${res.entry.unit})`, true, 3500);
    } else if (res.action === 'removed') {
      const sub = res.preset.shortName || res.preset.name;
      const dose = `${res.removedEntry.dose} ${res.removedEntry.unit}`;
      showUndoToast(
        `↩️ Razveljavljen današnji vnos: ${sub} (${dose})`,
        () => {
          // Razveljavi razveljavitev: ponovno vpiši
          Diary.logPreset(presetId);
          showToast(`✓ Ponovno zabeleženo: ${sub}`, true, 3500);
          refreshActiveViews();
        },
        5000
      );
    }

    refreshActiveViews();
  }

  /**
   * Gumb »✓ Vse zjutraj« (ali drug sklop) vpiše vse neodkljukane naenkrat
   */
  function logAll(sklop = 'morning') {
    if (!Diary) return;
    const added = typeof Diary.logAllForSklop === 'function'
      ? Diary.logAllForSklop(sklop)
      : [];

    const sklopTitle = sklop === 'morning' ? 'jutranjih' : sklop === 'preworkout' ? 'pred-trening' : 'večernih';

    if (added.length > 0) {
      showToast(`✓ Zabeleženo ${added.length} ${sklopTitle} vnosov naenkrat!`, true, 3500);
    } else {
      showToast(`Vse ${sklopTitle} substance so za danes že zabeležene.`, true, 3000);
    }

    refreshActiveViews();
  }

  /**
   * Hitri vnos iz predloge z obvestilom in prikazom zadnjega vnosa
   */
  function quickLog(presetId) {
    if (!Diary) return;
    const preset = (typeof Diary.getPresetById === 'function')
      ? Diary.getPresetById(presetId)
      : Diary.PRESET_INTAKES.find(p => p.id === presetId);

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
   * Brisanje posameznega vnosa
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
    withPreservedScroll(() => {
      renderDiaryView();
      renderTodayWidget();
    });
  }

  // =========================================================================
  // NASTAVITEV »UREDI MOJ PROTOKOL« (bine_protocol_routine_v1)
  // =========================================================================
  function openRoutineModal() {
    let overlay = document.getElementById('pdiaryRoutineModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pdiaryRoutineModalOverlay';
      overlay.className = 'modal-overlay';
      overlay.onclick = (e) => {
        if (e.target.id === 'pdiaryRoutineModalOverlay') closeRoutineModal();
      };
      document.body.appendChild(overlay);
    }

    const allPresets = typeof Diary.getPresets === 'function'
      ? Diary.getPresets()
      : Diary.PRESET_INTAKES;

    overlay.innerHTML = `
      <div class="modal" style="max-width: 480px; max-height: 85vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div class="modal-sheet-handle"></div>
          <div class="modal-header-row">
            <h3 style="margin: 0; font-size: 0.95rem;">⚙️ Uredi moj protokol</h3>
            <button type="button" class="modal-close" style="width: 44px; height: 44px;" aria-label="Zapri" onclick="ProtocolDiaryUI.closeRoutineModal()">✕</button>
          </div>
          <p style="margin: 4px 0 0 0; font-size: 0.72rem; color: var(--text-3);">
            Vklopi ali izklopi posamezne snovi ter jih razvrsti v sklop Zjutraj, Pred treningom ali Zvečer.
          </p>
        </div>

        <div class="modal-body" style="padding: 12px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px;">
          ${allPresets.map(p => `
            <div class="pdiary-routine-row" data-id="${p.id}" style="background: rgba(0,0,0,0.25); border: 1px solid var(--edge-1); border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; cursor: pointer; min-height: 44px;">
                <input type="checkbox" class="pdiary-routine-active" ${p.aktiven ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--rec-green); flex-shrink: 0;">
                <div style="min-width: 0; flex: 1;">
                  <div style="font-weight: 700; font-size: 0.82rem; color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${p.icon} ${escapeHtml(p.shortName || p.name)}
                  </div>
                  <div style="font-size: 0.68rem; color: var(--text-3);">
                    ${escapeHtml(p.dose)} ${escapeHtml(p.unit)}${p.pogostost && p.pogostost.vsakNdni ? ` • vsak ${p.pogostost.vsakNdni}. dan` : ''}
                  </div>
                </div>
              </label>

              <div style="flex-shrink: 0;">
                <select class="pdiary-routine-sklop" style="padding: 6px 8px; font-size: 16px; background: var(--surface-2); color: var(--text-1); border: 1px solid var(--edge-2); border-radius: 6px; min-height: 44px;">
                  <option value="morning" ${p.sklop === 'morning' ? 'selected' : ''}>🌅 Zjutraj</option>
                  <option value="preworkout" ${p.sklop === 'preworkout' ? 'selected' : ''}>⚡ Pred treningom</option>
                  <option value="evening" ${p.sklop === 'evening' ? 'selected' : ''}>🌙 Zvečer</option>
                </select>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="modal-footer" style="padding: 10px 14px; border-top: 1px solid var(--edge-1); display: flex; gap: 8px;">
          <button type="button" class="btn secondary" style="flex: 1; min-height: 44px; font-size: 0.76rem;" onclick="ProtocolDiaryUI.resetRoutineDefaults()">
            🔄 Ponastavi
          </button>
          <button type="button" class="btn" style="flex: 2; min-height: 44px; font-size: 0.82rem; font-weight: 700;" onclick="ProtocolDiaryUI.saveRoutineFromModal()">
            💾 Shrani protokol
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

  function closeRoutineModal() {
    const overlay = document.getElementById('pdiaryRoutineModalOverlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.style.display = 'none';
    }
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll();
    else {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }
  }

  function saveRoutineFromModal() {
    const rows = document.querySelectorAll('.pdiary-routine-row');
    const presetsConfig = {};

    rows.forEach((row, idx) => {
      const id = row.getAttribute('data-id');
      const activeInp = row.querySelector('.pdiary-routine-active');
      const sklopSelect = row.querySelector('.pdiary-routine-sklop');

      if (id && activeInp && sklopSelect) {
        presetsConfig[id] = {
          aktiven: !!activeInp.checked,
          sklop: sklopSelect.value || 'morning',
          order: idx
        };
      }
    });

    if (typeof Diary.saveRoutine === 'function') {
      Diary.saveRoutine({
        version: 1,
        presets: presetsConfig
      });
    }

    closeRoutineModal();
    showToast('✓ Nastavitve protokola shranjene!', true, 3500);
    refreshActiveViews();
  }

  function resetRoutineDefaults() {
    if (confirm('Ali želiš ponastaviti protokol na Binetove privzete nastavitve?')) {
      if (typeof Diary.resetRoutine === 'function') {
        Diary.resetRoutine();
      }
      closeRoutineModal();
      showToast('Ponastavljeno na privzeti protokol', true, 3500);
      refreshActiveViews();
    }
  }

  // =========================================================================
  // MODAL ZA VNOS PO MERI
  // =========================================================================
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
                <option value="žlička">žlička</option>
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
            <input type="text" id="pdiaryInpNotes" placeholder="npr. vbod v deltoid, z obrokom..." style="width: 100%; padding: 8px; min-height: 44px; font-size: 16px; background: var(--surface-2); border: 1px solid var(--edge-2); border-radius: 6px; color: #fff;">
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
    if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
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

  // =========================================================================
  // IZVOZ V OBSIDIAN & CSV
  // =========================================================================
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

  function exportToCSV() {
    if (!Diary || typeof Diary.exportToCSV !== 'function') return;
    const csv = Diary.exportToCSV();
    const done = () => showToast('✓ CSV kopiran v odložišče!', true);
    const fail = () => { if (copyTextFallback(csv)) done(); else prompt('Kopiraj CSV dnevnika:', csv); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).then(done).catch(fail);
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
    togglePreset,
    logAll,
    quickLog,
    deleteEntry,
    setFilter,
    setPeriodFilter,
    getPeriodFilter,
    updateLastEntryHint,
    openNewEntryModal,
    closeNewEntryModal,
    saveNewEntryFromModal,
    openRoutineModal,
    closeRoutineModal,
    saveRoutineFromModal,
    resetRoutineDefaults,
    exportToObsidian,
    exportToCSV,
    initSwipeNavigation,
    handleGlobalSwipe,
    refreshActiveViews,
    withPreservedScroll
  };
}));
