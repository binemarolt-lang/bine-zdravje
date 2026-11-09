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
    // Binetov dejanski jutranji protokol (9.11.2026, po njegovih besedah)
    {
      id: "ghk_cu_morning",
      name: "GHK-Cu",
      shortName: "GHK-Cu",
      category: "lasje",
      icon: "💉",
      dose: "3",
      unit: "mg",
      slot: "MORNING_FASTED",
      color: "#22d3ee",
      defaultNotes: "s.c. zjutraj"
    },
    {
      id: "caffeine_preworkout",
      name: "Kofein pred treningom",
      shortName: "Kofein",
      category: "nootropik",
      icon: "☕",
      dose: "200",
      unit: "mg",
      slot: "PRE_WORKOUT",
      color: "#a3a3a3",
      defaultNotes: "200 ali 400 mg"
    },
    {
      id: "ezetimibe",
      name: "Ezetimib",
      shortName: "Ezetimib",
      category: "suplement",
      icon: "💊",
      dose: "10",
      unit: "mg",
      slot: "MORNING_FASTED",
      color: "#fbbf24",
      defaultNotes: "Od 7.11.2026"
    },
    {
      id: "evening_powder_mix",
      name: "Mešanica: glicin + NAC + vitamin C + badelj",
      shortName: "Mešanica",
      category: "suplement",
      icon: "🥄",
      dose: "1",
      unit: "žlička",
      slot: "BEFORE_BED",
      color: "#34d399",
      defaultNotes: "Zvečer, ~2,7 g glicin / 0,55 g NAC / ~1 g C / 0,25 g badelj (ocena)"
    },
    {
      id: "klow_evening",
      name: "KLOW (GHK-Cu + BPC-157 + TB-500 + KPV)",
      shortName: "KLOW",
      category: "anabolik",
      icon: "💉",
      dose: "2",
      unit: "mg GHK-Cu",
      slot: "BEFORE_BED",
      color: "#2dd4bf",
      defaultNotes: "s.c. zvečer"
    },
    {
      id: "dutasteride_05",
      name: "Dutasterid 0,5 mg",
      shortName: "Dutasterid",
      category: "lasje",
      icon: "💈",
      dose: "0.5",
      unit: "mg",
      slot: "MORNING_FASTED",
      color: "#c084fc",
      defaultNotes: "Vsak drugi dan (od 27.9.2026)"
    },
    {
      id: "minoxidil_oral_sl",
      name: "Minoksidil oralni (pod jezik)",
      shortName: "Minoksidil SL",
      category: "lasje",
      icon: "💈",
      dose: "1.25",
      unit: "mg",
      slot: "MORNING_FASTED",
      color: "#a855f7",
      defaultNotes: "Pod jezik, vsak dan"
    },
    {
      id: "tadalafil_5_sl",
      name: "Tadalafil (pod jezik)",
      shortName: "Tadalafil",
      category: "suplement",
      icon: "💊",
      dose: "5",
      unit: "mg",
      slot: "MORNING_FASTED",
      color: "#f472b6",
      defaultNotes: "Pod jezik, zjutraj"
    },
    {
      id: "cdp_choline",
      name: "CDP-holin (citikolin)",
      shortName: "CDP-holin",
      category: "nootropik",
      icon: "🧠",
      dose: "1",
      unit: "mala žlička",
      slot: "WITH_BREAKFAST",
      color: "#60a5fa",
      defaultNotes: "Forest Vitamin prašek, zjutraj"
    },
    {
      id: "vitamin_d3_4000",
      name: "Vitamin D3 4000 IU (Forest Vitamin)",
      shortName: "Vit D3",
      category: "suplement",
      icon: "☀️",
      dose: "4000",
      unit: "IU",
      slot: "WITH_BREAKFAST",
      color: "#facc15",
      defaultNotes: "1 soft kapsula, zjutraj"
    },
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

  /**
   * Izvoz celotnega dnevnika v CSV zapis (kopiranje / preglednice)
   */
  function exportToCSV() {
    const entries = state.entries || [];
    const header = ['Datum', 'Čas', 'Kategorija', 'Substanca', 'Odmerek', 'Enota', 'Reža', 'Opomba'];
    const rows = [header.map(h => `"${h}"`).join(',')];

    entries.forEach(e => {
      const catLabel = CATEGORIES[e.category]?.label || e.category;
      const slotLabel = TIMING_SLOTS[e.slot]?.label || e.slot;
      const row = [
        e.date || '',
        e.time || '',
        catLabel || '',
        e.substance || '',
        e.dose || '',
        e.unit || '',
        slotLabel || '',
        e.notes || ''
      ].map(val => `"${String(val !== null && val !== undefined ? val : '').replace(/"/g, '""')}"`);
      rows.push(row.join(','));
    });

    return rows.join('\r\n');
  }

  /**
   * Pridobi zadnji vnos za določeno substanco (npr. 'Finasterid', 'Testosteron')
   */
  function getLastEntryForSubstance(substanceName) {
    if (!substanceName) return null;
    const clean = substanceName.trim().toLowerCase();
    if (!clean) return null;
    return state.entries.find(e => {
      const s = (e.substance || '').toLowerCase();
      return s === clean || s.includes(clean) || clean.includes(s);
    }) || null;
  }

  /**
   * Izračuna relativni čas v slovenščini za določen vnos ('pred 2 dnevoma', 'pred 1 dnem', 'danes')
   */
  function formatDaysAgoEntry(entry) {
    if (!entry) return null;
    const todayStr = getLocalDateString();
    if (entry.date === todayStr) return 'danes';

    let entryDate;
    if (entry.date) {
      const parts = entry.date.split('-');
      if (parts.length === 3) {
        entryDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      }
    }
    if (!entryDate && entry.timestamp) {
      entryDate = new Date(entry.timestamp);
    }
    if (!entryDate || isNaN(entryDate.getTime())) return null;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const entryStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
    const diffDays = Math.max(0, Math.round((todayStart - entryStart) / (1000 * 60 * 60 * 24)));

    if (diffDays === 0) return 'danes';
    if (diffDays === 1) return 'pred 1 dnem';
    if (diffDays === 2) return 'pred 2 dnevoma';
    if (diffDays === 3 || diffDays === 4) return `pred ${diffDays} dnevi`;
    return `pred ${diffDays} dnevi`;
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

  function clearAllEntries() {
    state.entries = [];
    saveState();
    dispatchDiaryEvent('entriesCleared', {});
    return true;
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
    clearAllEntries,
    getEntriesForDate,
    getTodayEntries,
    getDatesWithEntries,
    getStats,
    exportToObsidianMarkdown,
    exportToCSV,
    getLastEntryForSubstance,
    formatDaysAgoEntry,
    formatDisplayDate,
    getLocalDateString,
    getLocalTimeString
  };
}));
