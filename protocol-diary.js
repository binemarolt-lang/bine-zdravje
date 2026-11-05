/**
 * Protocol & Supplement Diary Engine (Binetov Dnevnik Vnosov)
 * Upravlja zgodovino in beleženje vseh vnosov anabolikov, suplementov, nootropikov in nege las.
 * Podpira 1-klik hitre vnose, filtre, localStorage shranjevanje in izvoz v Obsidian.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProtocolDiary = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const STORAGE_KEY = 'bine_protocol_diary_v1';

  // Privzeti hitri vnosi prilagojeni za Binetov cikel in protokol za lase
  const PRESET_INTAKES = [
    {
      id: 'test_eq_daily',
      name: 'Testosteron + EQ (dnevni odmerek)',
      shortName: 'Test + EQ',
      category: 'anabolik',
      icon: '💉',
      dose: '34T + 11EQ',
      unit: 'enot (U-100)',
      slot: 'MORNING_FASTED',
      color: '#f87171',
      defaultNotes: 'SubQ / Shallow IM vbod'
    },
    {
      id: 'raloxifene_rescue',
      name: 'Raloksifen (zaščita dojk)',
      shortName: 'Raloksifen',
      category: 'anabolik',
      icon: '🛡️',
      dose: '60',
      unit: 'mg',
      slot: 'WITH_BREAKFAST',
      color: '#fb923c',
      defaultNotes: 'SERM ob občutljivosti'
    },
    {
      id: 'finasteride_1mg',
      name: 'Finasterid (DHT zavora)',
      shortName: 'Finasterid',
      category: 'lasje',
      icon: '💈',
      dose: '1',
      unit: 'mg',
      slot: 'BEFORE_BED',
      color: '#c084fc',
      defaultNotes: '5α-reduktaza tip 2'
    },
    {
      id: 'minoxidil_topical',
      name: 'Topikalni Minoksidil 5%',
      shortName: 'Minoksidil 5%',
      category: 'lasje',
      icon: '💈',
      dose: '1',
      unit: 'mL nanos',
      slot: 'WITH_BREAKFAST',
      color: '#a855f7',
      defaultNotes: 'Lasišče (zalizki + vertex)'
    },
    {
      id: 'ketoconazole_shampoo',
      name: 'Ketokonazol 2% šampon',
      shortName: 'Keto šampon',
      category: 'lasje',
      icon: '🧴',
      dose: '1',
      unit: 'pranje',
      slot: 'WITH_BREAKFAST',
      color: '#818cf8',
      defaultNotes: 'Kontaktni čas 7 min'
    },
    {
      id: 'microneedling_scalp',
      name: 'Mikroneedling lasišča (1.0 mm)',
      shortName: 'Mikroneedling',
      category: 'lasje',
      icon: '🪡',
      dose: '1.0',
      unit: 'mm globina',
      slot: 'WITH_DINNER',
      color: '#e879f9',
      defaultNotes: '24h zapora za minoksidil!'
    },
    {
      id: 'omega3_dha_epa',
      name: 'Omega-3 (Zumub / HSN visoka DHA+EPA)',
      shortName: 'Omega-3',
      category: 'suplement',
      icon: '🐟',
      dose: '2000',
      unit: 'mg',
      slot: 'WITH_BREAKFAST',
      color: '#34d399',
      defaultNotes: 'Zdravje srca & lipidi'
    },
    {
      id: 'vitamin_d3_k2',
      name: 'Vitamin D3 (5000 IU) + K2 (100 µg)',
      shortName: 'Vit D3+K2',
      category: 'suplement',
      icon: '☀️',
      dose: '5000',
      unit: 'IU',
      slot: 'WITH_BREAKFAST',
      color: '#facc15',
      defaultNotes: 'Z obrokom z maščobami'
    },
    {
      id: 'creatine_mono',
      name: 'Kreatin monohidrat',
      shortName: 'Kreatin',
      category: 'suplement',
      icon: '⚡',
      dose: '5',
      unit: 'g',
      slot: 'POST_WORKOUT',
      color: '#38bdf8',
      defaultNotes: 'Celična hidracija'
    },
    {
      id: 'magnesium_bisglycinate',
      name: 'Magnezijev bisglicinat',
      shortName: 'Magnezij',
      category: 'suplement',
      icon: '😴',
      dose: '400',
      unit: 'mg elementarni',
      slot: 'BEFORE_BED',
      color: '#60a5fa',
      defaultNotes: 'Regeneracija & spanje'
    },
    {
      id: 'zinc_copper',
      name: 'Cink pikolinat (25mg) + Baker (2mg)',
      shortName: 'Cink + Baker',
      category: 'suplement',
      icon: '🛡️',
      dose: '25',
      unit: 'mg',
      slot: 'WITH_DINNER',
      color: '#2dd4bf',
      defaultNotes: 'Imunski sistem & koža'
    }
  ];

  const TIMING_SLOTS = {
    MORNING_FASTED: { label: 'Zjutraj na tešče', icon: '🌅' },
    WITH_BREAKFAST: { label: 'Z zajtrkom', icon: '🍳' },
    PRE_WORKOUT: { label: 'Pred treningom', icon: '⚡' },
    INTRA_WORKOUT: { label: 'Med treningom', icon: '💧' },
    POST_WORKOUT: { label: 'Po treningu', icon: '🥩' },
    WITH_DINNER: { label: 'Z večerjo', icon: '🥗' },
    BEFORE_BED: { label: 'Pred spanjem', icon: '🌙' },
    CUSTOM: { label: 'Čez dan', icon: '⏱️' }
  };

  const CATEGORIES = {
    anabolik: { label: 'Anaboliki & Zaščita', color: '#f87171', icon: '💉' },
    lasje: { label: 'Lasje & Skalp', color: '#c084fc', icon: '💈' },
    suplement: { label: 'Suplementi & Zdravje', color: '#34d399', icon: '💊' },
    nootropik: { label: 'Nootropiki & Možgani', color: '#60a5fa', icon: '🧠' }
  };

  /**
   * Pomožne funkcije za datum in čas
   */
  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getLocalTimeString(d = new Date()) {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function formatDisplayDate(dateStr) {
    const today = getLocalDateString();
    const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
    if (dateStr === today) return 'Danes';
    if (dateStr === yesterday) return 'Včeraj';
    
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return `${parseInt(parts[2], 10)}. ${getMonthName(parseInt(parts[1], 10))} ${parts[0]}`;
      }
    } catch(e) {}
    return dateStr;
  }

  function getMonthName(m) {
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
    return months[m - 1] || '';
  }

  /**
   * Glavno stanje dnevnika
   */
  let state = {
    entries: [],
    filterCategory: 'all',
    selectedDate: getLocalDateString()
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      }
    } catch (e) {
      console.warn('[ProtocolDiary] Napaka pri branju iz shrambe:', e);
      state.entries = [];
    }
    return state;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        entries: state.entries,
        updatedAt: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('[ProtocolDiary] Napaka pri shranjevanju:', e);
    }
  }

  /**
   * Dodajanje novega vnosa v dnevnik
   */
  function addEntry(data) {
    const now = new Date();
    const entry = {
      id: 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: now.toISOString(),
      date: data.date || getLocalDateString(now),
      time: data.time || getLocalTimeString(now),
      substance: (data.substance || 'Neznano').trim(),
      dose: (data.dose || '').toString().trim(),
      unit: (data.unit || 'mg').trim(),
      category: data.category && CATEGORIES[data.category] ? data.category : 'suplement',
      slot: data.slot && TIMING_SLOTS[data.slot] ? data.slot : 'CUSTOM',
      notes: (data.notes || '').trim()
    };

    state.entries.unshift(entry);
    saveState();
    dispatchDiaryEvent('entryAdded', entry);
    return entry;
  }

  /**
   * Hitri vnos iz vnaprej pripravljene predloge
   */
  function logPreset(presetId, customNotes = '') {
    const preset = PRESET_INTAKES.find(p => p.id === presetId);
    if (!preset) return null;

    // Če gre za mikroneedling, posodobi tudi SkinHairUI stanje, če obstaja
    if (preset.id === 'microneedling_scalp') {
      if (typeof window !== 'undefined' && window.SkinHairUI && typeof window.SkinHairUI.logMicroneedlingSession === 'function') {
        window.SkinHairUI.logMicroneedlingSession();
      }
    }

    // Če gre za dnevni test+eq, preveri ali obstaja cikel-plan
    let doseStr = preset.dose;
    if (preset.id === 'test_eq_daily' && typeof window !== 'undefined' && window.CikelPlan) {
      try {
        const cp = window.CikelPlan;
        const s = cp.load ? cp.load() : null;
        if (s && s.start) {
          const di = Math.floor((new Date() - new Date(s.start)) / 86400000);
          const w = Math.max(0, Math.floor(di / 7));
          const tU = cp.PLAN.testUnits[Math.min(w, cp.PLAN.testUnits.length - 1)];
          const eU = cp.PLAN.eqUnits[Math.min(w, cp.PLAN.eqUnits.length - 1)];
          doseStr = `${tU}T + ${eU}EQ`;
        }
      } catch(e) {}
    }

    return addEntry({
      substance: preset.name,
      dose: doseStr,
      unit: preset.unit,
      category: preset.category,
      slot: preset.slot,
      notes: customNotes ? `${preset.defaultNotes} (${customNotes})` : preset.defaultNotes
    });
  }

  /**
   * Izbris posameznega vnosa
   */
  function deleteEntry(entryId) {
    const idx = state.entries.findIndex(e => e.id === entryId);
    if (idx !== -1) {
      const removed = state.entries.splice(idx, 1)[0];
      saveState();
      dispatchDiaryEvent('entryDeleted', removed);
      return true;
    }
    return false;
  }

  /**
   * Pridobivanje vnosov za določen dan
   */
  function getEntriesForDate(dateStr) {
    return state.entries.filter(e => e.date === dateStr);
  }

  /**
   * Pridobivanje vseh vnosov za danes
   */
  function getTodayEntries() {
    return getEntriesForDate(getLocalDateString());
  }

  /**
   * Pridobivanje vseh unikatnih datumov z vnosi
   */
  function getDatesWithEntries() {
    const dates = new Set();
    state.entries.forEach(e => dates.add(e.date));
    return Array.from(dates).sort().reverse();
  }

  /**
   * Izračun adherence in statistike
   */
  function getStats() {
    const totalEntries = state.entries.length;
    const todayEntries = getTodayEntries().length;
    const uniqueDates = getDatesWithEntries();

    // Izračun zaporednih dni (Streak)
    let streak = 0;
    const today = getLocalDateString();
    let checkDate = new Date();

    // Če danes še ni vnosa, preveri od včeraj
    const hasToday = uniqueDates.includes(today);
    if (!hasToday) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dateStr = getLocalDateString(checkDate);
      if (uniqueDates.includes(dateStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Porazdelitev po kategorijah
    const categoryCounts = { anabolik: 0, lasje: 0, suplement: 0, nootropik: 0 };
    state.entries.forEach(e => {
      if (categoryCounts[e.category] !== undefined) {
        categoryCounts[e.category]++;
      }
    });

    return {
      totalEntries,
      todayEntries,
      daysLogged: uniqueDates.length,
      currentStreakDays: streak,
      categoryCounts
    };
  }

  /**
   * Izvoz v celovit Markdown zapis za Obsidian
   */
  function exportToObsidianMarkdown() {
    const dates = getDatesWithEntries();
    if (dates.length === 0) {
      return '# Dnevnik Protokolov & Suplementov\n\n*Ni zabeleženih vnosov.*';
    }

    let md = `# Dnevnik Protokolov & Suplementov (Bine)\n\n`;
    md += `*Generirano:* ${new Date().toLocaleString('sl-SI')}\n`;
    const stats = getStats();
    md += `*Skupaj vnosov:* ${stats.totalEntries} | *Dni beleženja:* ${stats.daysLogged} | *Streak:* ${stats.currentStreakDays} dni 🔥\n\n---\n\n`;

    dates.forEach(d => {
      const dayEntries = getEntriesForDate(d);
      md += `## 📅 ${formatDisplayDate(d)} (${d})\n\n`;
      md += `| Čas | Kategorija | Substanca / Spojina | Odmerek | Reža | Opomba |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      
      dayEntries.forEach(e => {
        const catLabel = CATEGORIES[e.category]?.label || e.category;
        const slotLabel = TIMING_SLOTS[e.slot]?.label || e.slot;
        md += `| ${e.time} | ${catLabel} | **${e.substance}** | ${e.dose} ${e.unit} | ${slotLabel} | ${e.notes || '-'} |\n`;
      });
      md += '\n';
    });

    return md;
  }

  function dispatchDiaryEvent(type, detail = {}) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('bineProtocolDiaryUpdate', {
          detail: { type, detail, stats: getStats() }
        }));
      } catch(e) {}
    }
  }

  // Samodejni zagon ob nalaganju
  loadState();

  return {
    PRESET_INTAKES,
    TIMING_SLOTS,
    CATEGORIES,
    loadState,
    saveState,
    addEntry,
    logPreset,
    deleteEntry,
    getEntriesForDate,
    getTodayEntries,
    getDatesWithEntries,
    getStats,
    exportToObsidianMarkdown,
    formatDisplayDate,
    getLocalDateString,
    getLocalTimeString
  };
}));
