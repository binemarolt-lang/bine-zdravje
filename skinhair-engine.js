/**
 * Bine Zdravje — Skin & Hair Algorithmic Engine (skinhair-engine.js)
 * 
 * Matematični, dermatološki in trihološki računski modeli:
 * 1. GAGS (Global Acne Grading System) & Leeds Acne Severity Index
 * 2. Norwood-Hamilton Hairline & Scalp Density Index (HDS / HDI)
 * 3. Skincare Conflict & Active Ingredient Incompatibility Matrix
 * 4. Microneedling 24h Lockout & Hair Regrowth Protocol State Machine
 * 5. Malassezia Folliculitis (Fungal Acne) Lipid Safety Filter
 * 6. Lifestyle & Androgen/TRT Trigger Flare-up Correlation Engine
 * 
 * UMD modul brez zunanjih odvisnosti (brskalnik + Node.js testi).
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkinHairEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // =========================================================================
  // 1. GAGS & ACNE SCORING
  // =========================================================================

  const GAGS_ZONES = {
    forehead: { name: 'Čelo', factor: 1 },
    right_cheek: { name: 'Desno lice', factor: 2 },
    left_cheek: { name: 'Levo lice', factor: 2 },
    nose: { name: 'Nos', factor: 1 },
    chin: { name: 'Brada', factor: 1 },
    chest_back: { name: 'Prsni koš in zgornji hrbet', factor: 3 }
  };

  const LESION_WEIGHTS = {
    none: 0,
    comedone_pie: 1, // Komedon ali ploska rdečina (PIE)
    papule: 2,       // Vnetna rdeča papula (<5mm)
    pustule: 3,      // Pustula z gnojnim centrom
    nodule_cyst: 4   // Globok boleč nodul ali cista (>5mm)
  };

  /**
   * Izračuna Global Acne Grading System (GAGS) točke.
   * @param {Object} zoneGrades - { forehead: 0-4, right_cheek: 0-4, ... }
   * @returns {Object} { score: number, maxScore: 44, severity: string, severityLabel: string, zoneDetails: Object }
   */
  function calculateGAGS(zoneGrades) {
    zoneGrades = zoneGrades || {};
    let totalScore = 0;
    const details = {};

    for (const [zoneKey, zoneMeta] of Object.entries(GAGS_ZONES)) {
      const grade = Math.max(0, Math.min(4, parseInt(zoneGrades[zoneKey] || 0, 10)));
      const points = grade * zoneMeta.factor;
      totalScore += points;
      details[zoneKey] = {
        name: zoneMeta.name,
        factor: zoneMeta.factor,
        grade: grade,
        points: points
      };
    }

    let severity = 'clear';
    let severityLabel = 'Čista koža (Brez aken)';
    let color = '#34d399'; // rec-green

    if (totalScore === 0) {
      severity = 'clear';
      severityLabel = 'Čista koža (Brez aken)';
      color = '#34d399';
    } else if (totalScore <= 18) {
      severity = 'mild';
      severityLabel = 'Blage akne (Mild)';
      color = '#60a5fa'; // modra
    } else if (totalScore <= 30) {
      severity = 'moderate';
      severityLabel = 'Zmerne akne (Moderate)';
      color = '#fbbf24'; // opozorilna rumena
    } else if (totalScore <= 38) {
      severity = 'severe';
      severityLabel = 'Hude akne (Severe)';
      color = '#f97316'; // oranžna
    } else {
      severity = 'very_severe';
      severityLabel = 'Zelo hude akne (Very Severe / Cistične)';
      color = '#ef4444'; // rdeča
    }

    // Normaliziran indeks zdravja kože (100 = čisto, 0 = zelo hudo)
    const skinHealthScore = Math.max(0, Math.min(100, Math.round(100 - (totalScore / 40) * 100)));

    return {
      score: totalScore,
      maxScore: 40,
      severity: severity,
      severityLabel: severityLabel,
      color: color,
      skinHealthScore: skinHealthScore,
      zoneDetails: details
    };
  }

  // =========================================================================
  // 2. NORWOOD SCALE & TRICHOMETRY DENSITY INDEX
  // =========================================================================

  const NORWOOD_STAGES = {
    1: { name: 'Norwood I', desc: 'Mladostna polna linija brez vidne recesije', factor: 1.0 },
    2: { name: 'Norwood II', desc: 'Blag odmik zalizkov v sencih (fiziološka zrela linija)', factor: 0.92 },
    '2A': { name: 'Norwood II-A', desc: 'Linearni odmik sprednje linije brez otočka', factor: 0.88 },
    3: { name: 'Norwood III', desc: 'Globoka simetrična recesija v sencih (klinična alopecija)', factor: 0.78 },
    '3A': { name: 'Norwood III-A', desc: 'Globlji frontalni linearni odmik do sredine čela', factor: 0.72 },
    '3V': { name: 'Norwood III-Vertex', desc: 'Recesija v sencih + začetek redčenja na temenu (kronici)', factor: 0.68 },
    4: { name: 'Norwood IV', desc: 'Huda recesija v sencih, ločen obroč redčenja na temenu', factor: 0.55 },
    5: { name: 'Norwood V', desc: 'Mostiček las med sencem in temenom se stanjša', factor: 0.40 },
    6: { name: 'Norwood VI', desc: 'Mostiček izgine, sprednji in temenski del se združita', factor: 0.25 },
    7: { name: 'Norwood VII', desc: 'Ohranjeni le še stranski in zadnji obroč las (podkvica)', factor: 0.12 }
  };

  /**
   * Izračuna sestavljeni indeks gostote in zdravja las (Hair Index 0–100).
   * @param {Object} params
   * @param {string|number} params.norwoodStage - Stopnja Norwood (npr. '2', '3V')
   * @param {number} [params.hairlineRecessionMm] - Odmik linije od bazne črte v mm (0-30)
   * @param {number} [params.vertexCoveragePct] - Pokritost temena v % (0-100)
   * @param {number} [params.sheddingScore] - Dnevno izpadanje 0-10 (0=fiziološko, 10=hudo)
   * @returns {Object}
   */
  function calculateHairIndex(params) {
    params = params || {};
    const stage = NORWOOD_STAGES[params.norwoodStage] || NORWOOD_STAGES[2];
    const norwoodFactor = stage.factor;

    const recessionMm = typeof params.hairlineRecessionMm === 'number' ? params.hairlineRecessionMm : 0;
    const vertexPct = typeof params.vertexCoveragePct === 'number' ? params.vertexCoveragePct : 95;
    const shedding = typeof params.sheddingScore === 'number' ? Math.max(0, Math.min(10, params.sheddingScore)) : 2;

    // Kazen za recesijo: vsak mm nad 2 mm odbije 1.5 točke
    const recessionPenalty = Math.max(0, recessionMm - 2) * 1.5;

    // Kazen za shedding: nad 4/10 odbija točke (shedding 10 odbije 18 točk)
    const sheddingPenalty = Math.max(0, shedding - 3) * 2.5;

    // Vertex faktor: razlika od 100% pokritosti
    const vertexScore = Math.max(0, Math.min(100, vertexPct));

    // Kompozitni rezultat (uteženo: Norwood 50%, Vertex 35%, Shedding 15%)
    let rawIndex = (norwoodFactor * 55) + (vertexScore * 0.35) - recessionPenalty - sheddingPenalty;
    const hairIndex = Math.max(0, Math.min(100, Math.round(rawIndex)));

    let status = 'stabilno';
    let statusLabel = 'Odlično / Stabilno stanje las';
    let color = '#34d399';

    if (hairIndex >= 85) {
      status = 'odlicno';
      statusLabel = 'Visoka gostota & stabilna linija';
      color = '#34d399';
    } else if (hairIndex >= 70) {
      status = 'blago_tveganje';
      statusLabel = 'Zmerna miniaturizacija / Potrebna preventiva';
      color = '#60a5fa';
    } else if (hairIndex >= 50) {
      status = 'aktivno_redcenje';
      statusLabel = 'Aktivno redčenje mešičkov / Nujen protokol';
      color = '#fbbf24';
    } else {
      status = 'kriticno';
      statusLabel = 'Napredovala alopecija / Nujna klinična terapija';
      color = '#ef4444';
    }

    return {
      hairIndex: hairIndex,
      norwoodStage: params.norwoodStage || '2',
      stageName: stage.name,
      stageDesc: stage.desc,
      status: status,
      statusLabel: statusLabel,
      color: color,
      sheddingStatus: shedding <= 3 ? 'Normalen (fiziološki)' : shedding <= 6 ? 'Povečan (možen minoxidil shed)' : 'Akuten telogeni efluvij'
    };
  }

  // =========================================================================
  // 3. SKINCARE INGREDIENT CONFLICT MATRIX
  // =========================================================================

  const ACTIVE_INGREDIENTS = {
    tretinoin: { name: 'Tretinoin / Retinol', category: 'retinoid', preferredSlot: 'pm', photosensitizing: true },
    adapalene: { name: 'Adapalen', category: 'retinoid', preferredSlot: 'pm', photosensitizing: true },
    benzoyl_peroxide: { name: 'Benzoil peroksid (BPO)', category: 'antibacterial', preferredSlot: 'am_or_pm', oxidant: true },
    salicylic_acid: { name: 'Salicilna kislina (BHA 2%)', category: 'exfoliant', preferredSlot: 'am_or_pm', lipidSoluble: true },
    glycolic_acid: { name: 'Glikolna / Mlečna kislina (AHA)', category: 'exfoliant', preferredSlot: 'pm', lowPh: true },
    azelaic_acid: { name: 'Azelainska kislina (15–20%)', category: 'antiinflammatory', preferredSlot: 'am_or_pm', safeWithRetinoids: true },
    vitamin_c_laa: { name: 'Vitamin C (L-Askorbinska kislina)', category: 'antioxidant', preferredSlot: 'am', lowPh: true },
    niacinamide: { name: 'Niacinamid (B3)', category: 'barrier', preferredSlot: 'am_or_pm', neutralPh: true },
    ketoconazole: { name: 'Ketokonazol 2%', category: 'antifungal', preferredSlot: 'post_workout', antiAndrogen: true },
    ceramides: { name: 'Ceramidi / Pantenol / Cica', category: 'barrier_repair', preferredSlot: 'am_or_pm' },
    spf_50: { name: 'Širokospektralni SPF 50+', category: 'sunscreen', preferredSlot: 'am' }
  };

  /**
   * Preveri seznam aktivnih sestavin v določeni rutini glede konfliktov in tveganj.
   * @param {Array<string>} ingredients - Seznam ključev sestavin (npr. ['tretinoin', 'benzoyl_peroxide'])
   * @param {string} slot - 'am', 'pm' ali 'post_workout'
   * @returns {Object} { hasConflicts: boolean, warnings: Array<Object>, recommendations: Array<string> }
   */
  function evaluateSkincareRoutine(ingredients, slot) {
    ingredients = Array.isArray(ingredients) ? ingredients : [];
    slot = slot || 'pm';

    const warnings = [];
    const recommendations = [];

    const hasTretinoin = ingredients.includes('tretinoin');
    const hasAdapalene = ingredients.includes('adapalene');
    const hasBPO = ingredients.includes('benzoyl_peroxide');
    const hasBHA = ingredients.includes('salicylic_acid');
    const hasAHA = ingredients.includes('glycolic_acid');
    const hasVitC = ingredients.includes('vitamin_c_laa');
    const hasNiacinamide = ingredients.includes('niacinamide');
    const hasSPF = ingredients.includes('spf_50');
    const hasRetinoid = hasTretinoin || hasAdapalene;

    // 1. Tretinoin + BPO (Oksidacija)
    if (hasTretinoin && hasBPO) {
      warnings.push({
        severity: 'high',
        rule: 'TRETINOIN_BPO_OXIDATION',
        message: 'Benzoil peroksid v 2–4 urah oksidira in inaktivira tretinoin. BPO prestavi v jutranjo rutino (AM), tretinoin ohrani zvečer (PM).'
      });
    }

    // 2. Retinoid + Močne kisline (AHA / BHA) v istem večeru (Pretirana eksfoliacija)
    if (hasRetinoid && (hasBHA || hasAHA) && slot === 'pm') {
      warnings.push({
        severity: 'medium',
        rule: 'RETINOID_EXFOLIANT_IRRITATION',
        message: 'Sočasna uporaba retinoida in kislin (BHA/AHA) v istem večeru drastično poveča transepidermalno izgubo vode (TEWL) in tveganje za retinoidni dermatitis. Uporabi alternirajoči »Skin Cycling« razpored.'
      });
      recommendations.push('Skin Cycling: Noč 1 eksfoliacija z BHA/AHA, Noč 2 retinoid, Noč 3 & 4 obnova bariere s ceramidi.');
    }

    // 3. Retinoidi v jutranji rutini (AM)
    if (hasRetinoid && slot === 'am') {
      warnings.push({
        severity: 'medium',
        rule: 'RETINOID_SUN_SENSITIVITY',
        message: 'Retinoidi so fotolabilni in povzročajo fotosenzibilizacijo kože. Nanašaj jih izključno v večerni rutini (PM).'
      });
    }

    // 4. Vitamin C (L-AA) + Niacinamid sočasno pri nizkem pH
    if (hasVitC && hasNiacinamide && slot === 'am') {
      warnings.push({
        severity: 'low',
        rule: 'VIT_C_NIACINAMIDE_FLUSH',
        message: 'Sočasni nanos kislega vitamina C (L-AA pH < 3.5) in niacinamida lahko sproži rdečico (niacin flush) in zmanjša absorpcijo. Počakaj 10–15 min med nanosoma ali uporabi stabilno obliko (SAP).'
      });
    }

    // 5. Odsotnost zaščite SPF pri uporabi retinoidov ali AHA v AM
    if (slot === 'am' && !hasSPF) {
      warnings.push({
        severity: 'high',
        rule: 'MISSING_SPF_PROTECTION',
        message: 'Ob uporabi retinoidov ali kislin je epidermalna zaščita zmanjšana. Širokospektralni SPF 50+ je nujen za preprečevanje eritema in hiperpigmentacij (PIH).'
      });
      recommendations.push('V jutranjo rutino vedno dodaj fotostabilen SPF 50+ kot zadnji korak pred odhodom na prosto.');
    }

    // 6. Sinergija: Adapalen + BPO je varna in priporočena kombinacija (npr. Epiduo)
    if (hasAdapalene && hasBPO) {
      recommendations.push('Adapalen je odporen na oksidacijo z BPO. Ta kombinacija je sinergijska in učinkovito uničuje C. acnes ter odpira pore.');
    }

    // 7. Sinergija: Azelainska kislina + Retinoid
    if (hasRetinoid && ingredients.includes('azelaic_acid')) {
      recommendations.push('Azelainska kislina in retinoid delujeta sinergijsko: azelainska zmanjša rdečico (PIE) in zavira lokalno 5α-reduktazo, medtem ko retinoid pospeši obnovo celic.');
    }

    return {
      hasConflicts: warnings.some(w => w.severity === 'high'),
      conflictCount: warnings.length,
      warnings: warnings,
      recommendations: recommendations
    };
  }

  // =========================================================================
  // 4. MICRONEEDLING SAFETY LOCKOUT & HAIR REGROWTH ENGINE
  // =========================================================================

  /**
   * Preveri varnostno zaporo za nanos minoksidila po mikroneedlingu.
   * Zaradi nevarnosti masivnega sistemskega vdora minoksidila v krvni obtok
   * (hipotenzija, tahikardija HR > 110, omotica) je minoksidil prepovedan 24 ur po iglanju!
   * 
   * @param {string|number|Date} lastNeedlingTimestamp - Čas zadnjega iglanja
   * @returns {Object} { isLocked: boolean, hoursRemaining: number, message: string }
   */
  function checkMicroneedleLockout(lastNeedlingTimestamp) {
    if (!lastNeedlingTimestamp) {
      return { isLocked: false, hoursRemaining: 0, message: 'Ni podatka o iglanju — minoksidil dovoljen.' };
    }

    const needlingTime = new Date(lastNeedlingTimestamp).getTime();
    if (isNaN(needlingTime)) {
      return { isLocked: false, hoursRemaining: 0, message: 'Neveljaven datum iglanja.' };
    }

    const now = Date.now();
    const elapsedMs = now - needlingTime;
    const lockoutPeriodMs = 24 * 60 * 60 * 1000; // 24 ur

    if (elapsedMs < lockoutPeriodMs) {
      const remainingMs = lockoutPeriodMs - elapsedMs;
      const hoursRemaining = Math.ceil(remainingMs / (60 * 60 * 1000));
      return {
        isLocked: true,
        hoursRemaining: hoursRemaining,
        message: `⚠️ VARNOSTNA ZAPORA AKTIVNA: Po mikroneedlingu mora miniti vsaj 24 ur pred nanosom minoksidila (še ${hoursRemaining} h), da preprečiš sistemski padec krvnega tlaka in poskok srčnega utripa!`
      };
    }

    return {
      isLocked: false,
      hoursRemaining: 0,
      message: '✓ Varnostno okno 24 ur je poteklo. Topikalni minoksidil je varen za nanos.'
    };
  }

  // =========================================================================
  // 5. MALASSEZIA (FUNGAL ACNE) LIPID SAFETY FILTER
  // =========================================================================

  // Seznam nevarnih maščobnih kislin in estrov z dolžino C11–C24, ki hranijo kvasovke Malassezia
  const MALASSEZIA_UNSAFE_PATTERNS = [
    /lauric/i, /myristic/i, /palmitic/i, /stearic/i, /oleic/i, /linoleic/i,
    /polysorbate/i, /coconut/i, /cocoa butter/i, /shea butter/i, /castor oil/i,
    /isopropyl myristate/i, /isopropyl palmitate/i, /ethylhexyl palmitate/i,
    /peg-\d+ stearate/i, /glyceryl stearate/i, /olive oil/i, /sunflower oil/i
  ];

  const MALASSEZIA_SAFE_EXCEPTIONS = [
    /squalane/i,               // C30H62 nasičen ogljikovodik — kvasovka ga ne more razgraditi
    /caprylic\/capric/i,       // MCT olje (C8 in C10 sta pod pragom C11, C8 deluje fungicidno)
    /mineral oil/i,            // Alifatski ogljikovodiki brez estrskih vezi
    /petrolatum/i              // Popolnoma biološko inerten za lipaze
  ];

  /**
   * Preveri, ali sestavina hrani kvasovko Malassezia (glivične akne na prsih in hrbtu).
   * @param {string} ingredientName
   * @returns {Object} { isSafe: boolean, reason: string }
   */
  function checkMalasseziaSafety(ingredientName) {
    if (!ingredientName || typeof ingredientName !== 'string') {
      return { isSafe: true, reason: 'Neznana sestavina' };
    }

    // Najprej preveri izjeme varne liste
    for (const safePattern of MALASSEZIA_SAFE_EXCEPTIONS) {
      if (safePattern.test(ingredientName)) {
        return { isSafe: true, reason: `Varna sestavina (${ingredientName}): kvasovka Malassezia nima encimov za razgradnjo.` };
      }
    }

    // Preveri nevarne C11–C24 lipide in estre
    for (const unsafePattern of MALASSEZIA_UNSAFE_PATTERNS) {
      if (unsafePattern.test(ingredientName)) {
        return {
          isSafe: false,
          reason: `Nevarna za glivične akne (${ingredientName}): vsebuje lipide z verigo C11–C24, ki jih zunajcelične lipaze Malassezia cepijo v dražeče maščobne kisline.`
        };
      }
    }

    return { isSafe: true, reason: 'Ni zaznanih tveganih lipidov.' };
  }

  // =========================================================================
  // 6. LIFESTYLE & AAS / TRT TRIGGER CORRELATION ENGINE
  // =========================================================================

  /**
   * Analizira korelacije med dnevnimi navadami, hormoni in kožnimi izbruhi.
   * @param {Object} context
   * @param {number} [context.wheyGramsToday] - Zaužiti grami sirotkinih beljakovin
   * @param {number} [context.postWorkoutShowerDelayMin] - Zamuda tuširanja po vadbi v minutah
   * @param {number} [context.whoopRecoveryPct] - Whoop regeneracija v %
   * @param {number} [context.ouraSleepDebtMin] - Oura primanjkljaj spanja v minutah
   * @param {number} [context.testDoseMg] - Odmerek testosterona
   * @param {number} [context.eqDoseMg] - Odmerek boldenona
   * @param {number} [context.estradiolPgMl] - Zadnji izvid estradiola (E2)
   * @returns {Array<Object>} Seznam opozoril in ukrepov
   */
  function analyzeTriggersAndRisks(context) {
    context = context || {};
    const insights = [];

    // 1. Sirotka + Zamuda tuširanja -> Malassezia izbruh na hrbtu ("Bacne")
    const whey = context.wheyGramsToday || 0;
    const showerDelay = context.postWorkoutShowerDelayMin || 0;

    if (whey >= 35 && showerDelay >= 40) {
      insights.push({
        id: 'WHEY_SWEAT_BACKNE_ALERT',
        category: 'higiena_prehrana',
        severity: 'high',
        title: '⚠️ Visoko tveganje za akne na hrbtu (Malassezia + mTORC1)',
        message: `Zaužil si ${whey} g sirotkinih beljakovin (visok levcin aktivira mTORC1 v lojnicah), tuširanje pa je zamujalo ${showerDelay} minut. Znoj in loj ustvarjata idealno gojišče za kvasovke Malassezia.`,
        action: 'Umij zgornji del hrbta in ramena s šamponom Ketokonazol 2% (pusti delovati 3–5 min) ali uporabi 2% BHA sprej.'
      });
    }

    // 2. Sesut estradiol ob Boldenonu (E2 Crash)
    const e2 = context.estradiolPgMl;
    const eq = context.eqDoseMg || 0;
    const test = context.testDoseMg || 0;

    if (typeof e2 === 'number' && e2 < 18) {
      insights.push({
        id: 'E2_CRASH_BARRIER_HAIR_SHED',
        category: 'hormoni',
        severity: 'critical',
        title: '🚨 Kritično nizek Estradiol (<18 pg/mL) — zlom kožne bariere & shedding',
        message: `Nizek E2 (${e2} pg/mL) prek ER-β receptorjev sesuje sintezo kožnih ceramidov (suha, vneta koža) in inducira akutni telogeni efluvij (pospešeno izpadanje las).`,
        action: 'Zmanjšaj ali začasno ukini zaviralce aromataze (AI) oziroma preveri razmerje T:EQ (varno razmerje ≥2.5:1). Predpiši kontrolo pri Dr. Luís Marinho v Portu.'
      });
    } else if (eq > 0 && test > 0 && (test / eq) < 2.0) {
      insights.push({
        id: 'TEQ_RATIO_ALERT',
        category: 'hormoni',
        severity: 'medium',
        title: '⚠️ Tveganje za padec estradiola (Razmerje T:EQ pod 2.0)',
        message: `Razmerje Test:EQ je trenutno ${(test / eq).toFixed(1)}:1. Presnovki boldenona lahko zatrejo aromatazo in povzročijo suho kožo ter redčenje las.`,
        action: 'Spremljaj vlažnost kože in bodi pozoren na znake srbečice ter izpadanja las.'
      });
    }

    // 3. Whoop / Oura stresni biometrični sprožilec
    const recovery = context.whoopRecoveryPct;
    const sleepDebt = context.ouraSleepDebtMin;

    if ((typeof recovery === 'number' && recovery < 35) || (typeof sleepDebt === 'number' && sleepDebt > 90)) {
      insights.push({
        id: 'STRESS_CRH_ACNE_FLARE',
        category: 'regeneracija',
        severity: 'medium',
        title: '⚠️ Zvišan kortizol in nevropeptidi (Slaba regeneracija / Primanjkljaj spanja)',
        message: `Whoop regeneracija ${recovery || 0}% oz. dolg spanja ${sleepDebt || 0} min sproščata substanco P in CRH, kar neposredno spodbuja lojnice k vnetnim izbruhom.`,
        action: 'Osredotoči se na obnovo kožne pregrade (ceramidi, pantenol) in se izogni agresivnim kemičnim pilingom ta večer.'
      });
    }

    return insights;
  }

  // =========================================================================
  // JAVNI VMESNIK MODULA
  // =========================================================================

  return {
    // 1. Akne
    GAGS_ZONES: GAGS_ZONES,
    LESION_WEIGHTS: LESION_WEIGHTS,
    calculateGAGS: calculateGAGS,

    // 2. Lasje
    NORWOOD_STAGES: NORWOOD_STAGES,
    calculateHairIndex: calculateHairIndex,

    // 3. Nega & Rutina
    ACTIVE_INGREDIENTS: ACTIVE_INGREDIENTS,
    evaluateSkincareRoutine: evaluateSkincareRoutine,

    // 4. Mikroneedling & Varnost
    checkMicroneedleLockout: checkMicroneedleLockout,

    // 5. Malassezia varnost
    checkMalasseziaSafety: checkMalasseziaSafety,

    // 6. Korelacijski motor
    analyzeTriggersAndRisks: analyzeTriggersAndRisks
  };
}));
