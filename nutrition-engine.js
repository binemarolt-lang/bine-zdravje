/**
 * Bine Zdravje v2 — Nutrition & Metabolic Engine
 * Reverzno inženirani algoritmi:
 * 1. Kiwi Nutrition (8 funkcionalnih zdravstvenih ocen z asimetričnim sigmoidnim točkovanjem)
 * 2. Cronometer (6 ključnih biokemijskih mineralnih in maščobnih razmerij)
 * 3. MacroFactor (Termodinamični dinamični TDEE in EMA glajenje teže)
 * 4. Open Food Facts & Atwater Quick-Add motor
 */

// ==========================================
// 0. POMOŽNA FUNKCIJA ZA VARNO PARSANJE ŠTEVIL (vejice, prazni vnosi, NaN)
// ==========================================
function _parseNum(v, def = 0) {
  if (typeof v === 'number') return isNaN(v) ? def : v;
  if (v == null || v === '') return def;
  const s = String(v).replace(',', '.').trim();
  const n = parseFloat(s);
  return isNaN(n) ? def : n;
}

// ==========================================
// 1. DRI TABELA (Športnik / Odrasel moški 80 kg)
// ==========================================
const ATHLETE_MALE_DRI = {
  // Vitamini
  vitaminA: { rda: 900, opl: 1500, ul: 3000, penaltyFactor: 2.0 },    // mcg RAE
  vitaminC: { rda: 150, opl: 500, ul: 2000, penaltyFactor: 1.2 },     // mg
  vitaminD: { rda: 50, opl: 100, ul: 100, penaltyFactor: 2.5 },       // mcg (2000-4000 IU)
  vitaminE: { rda: 15, opl: 30, ul: 1000, penaltyFactor: 1.0 },       // mg
  vitaminK: { rda: 120, opl: 300, ul: 10000, penaltyFactor: 0.0 },    // mcg
  vitaminB1: { rda: 1.6, opl: 5.0, ul: 100, penaltyFactor: 0.0 },     // mg
  vitaminB2: { rda: 1.6, opl: 5.0, ul: 100, penaltyFactor: 0.0 },     // mg
  vitaminB3: { rda: 20, opl: 50, ul: 35, penaltyFactor: 1.5 },        // mg
  vitaminB5: { rda: 7, opl: 20, ul: 200, penaltyFactor: 0.0 },        // mg
  vitaminB6: { rda: 2.0, opl: 10, ul: 100, penaltyFactor: 2.0 },      // mg
  vitaminB7: { rda: 35, opl: 100, ul: 1000, penaltyFactor: 0.0 },     // mcg
  vitaminB9: { rda: 400, opl: 600, ul: 1000, penaltyFactor: 1.8 },    // mcg DFE
  vitaminB12: { rda: 4.0, opl: 25, ul: 1000, penaltyFactor: 0.0 },    // mcg
  choline: { rda: 550, opl: 800, ul: 3500, penaltyFactor: 1.5 },      // mg
  
  // Minerali
  calcium: { rda: 1000, opl: 1300, ul: 2500, penaltyFactor: 1.5 },    // mg
  magnesium: { rda: 500, opl: 700, ul: 700, penaltyFactor: 1.2 },     // mg
  phosphorus: { rda: 700, opl: 1200, ul: 4000, penaltyFactor: 1.0 },   // mg
  potassium: { rda: 4700, opl: 5500, ul: 7000, penaltyFactor: 1.5 },  // mg
  sodium: { rda: 2300, opl: 3500, ul: 4500, penaltyFactor: 1.5 },     // mg
  iron: { rda: 12, opl: 20, ul: 45, penaltyFactor: 3.0 },             // mg
  zinc: { rda: 15, opl: 25, ul: 40, penaltyFactor: 2.0 },             // mg
  copper: { rda: 1.2, opl: 2.5, ul: 10, penaltyFactor: 2.0 },         // mg
  selenium: { rda: 70, opl: 150, ul: 400, penaltyFactor: 2.5 },       // mcg
  iodine: { rda: 150, opl: 250, ul: 1100, penaltyFactor: 2.0 },       // mcg
  boron: { rda: 3.0, opl: 10, ul: 20, penaltyFactor: 1.5 },           // mg
  manganese: { rda: 2.5, opl: 5.0, ul: 11, penaltyFactor: 2.0 },      // mg

  // Lipidi & Maščobne kisline
  omega3DHA: { rda: 0.5, opl: 1.5, ul: 3.0, penaltyFactor: 1.0 },     // g
  omega3EPA: { rda: 0.5, opl: 1.5, ul: 3.0, penaltyFactor: 1.0 },     // g
  omega6LA: { rda: 14, opl: 17, ul: 30, penaltyFactor: 1.2 },         // g
  saturatedFat: { rda: 20, opl: 25, ul: 35, penaltyFactor: 1.5 },     // g

  // Beljakovine & Specifične Aminokisline
  protein: { rda: 160, opl: 200, ul: 280, penaltyFactor: 1.0 },       // g (2.0 - 2.5 g/kg)
  leucine: { rda: 4.0, opl: 8.0, ul: 15, penaltyFactor: 1.0 },        // g
  isoleucine: { rda: 2.5, opl: 5.0, ul: 10, penaltyFactor: 1.0 },     // g
  valine: { rda: 3.0, opl: 5.0, ul: 10, penaltyFactor: 1.0 },         // g
  tryptophan: { rda: 0.4, opl: 0.8, ul: 2.0, penaltyFactor: 1.0 },    // g
  glycine: { rda: 5.0, opl: 15.0, ul: 30.0, penaltyFactor: 0.5 },     // g
  proline: { rda: 4.0, opl: 10.0, ul: 25.0, penaltyFactor: 0.5 }      // g
};

// ==========================================
// 2. KIWI 8 FUNKCIONALNIH KATEGORIJ IN UTEŽI
// ==========================================
const KIWI_WEIGHTS = {
  brainPower: {
    label: "🧠 Brain Power & Nevroni",
    sub: "Kognicija, holin, mielin, fluidnost membran",
    weights: {
      omega3DHA: 0.15, omega3EPA: 0.05, choline: 0.15, vitaminB12: 0.15,
      vitaminB6: 0.10, vitaminB9: 0.10, iron: 0.10, magnesium: 0.10,
      zinc: 0.05, vitaminE: 0.05
    }
  },
  musclePerformance: {
    label: "💪 Mišice & Anabolizem",
    sub: "mTORC1 aktivacija, kontraktilnost, hidracija",
    weights: {
      leucine: 0.25, magnesium: 0.15, potassium: 0.15, calcium: 0.10,
      sodium: 0.10, iron: 0.10, vitaminD: 0.10, isoleucine: 0.025, valine: 0.025
    }
  },
  energyMetabolism: {
    label: "⚡ Mitohondriji & Krebs",
    sub: "Glikoliza, sinteza CoA, oksidativna fosforilacija",
    weights: {
      vitaminB1: 0.15, vitaminB2: 0.15, vitaminB3: 0.15, vitaminB5: 0.15,
      magnesium: 0.15, phosphorus: 0.10, iron: 0.10, copper: 0.05
    }
  },
  sleepRecovery: {
    label: "🌙 Spanje & Regeneracija",
    sub: "GABA tonus, melatonin, zniževanje nočnega kortizola",
    weights: {
      magnesium: 0.25, tryptophan: 0.20, glycine: 0.15, vitaminB6: 0.15,
      potassium: 0.10, zinc: 0.10, calcium: 0.05
    }
  },
  immuneFunction: {
    label: "🛡️ Imunski sistem",
    sub: "Nevtrofilni odziv, timulin, antioksidativna zaščita",
    weights: {
      zinc: 0.20, vitaminC: 0.20, vitaminD: 0.20, vitaminA: 0.15,
      selenium: 0.10, copper: 0.05, vitaminB9: 0.05, vitaminE: 0.05
    }
  },
  boneHealth: {
    label: "🦴 Kosti & Sklepi",
    sub: "Hidroksiapatit, karboksilacija osteokalcina",
    weights: {
      calcium: 0.25, vitaminD: 0.25, vitaminK: 0.15, magnesium: 0.15,
      phosphorus: 0.10, protein: 0.05, manganese: 0.05
    }
  },
  beautySkinHair: {
    label: "✨ Koža, lasje & kolagen",
    sub: "Hidroksilacija prolina, sinteza ceramidov",
    weights: {
      vitaminC: 0.20, vitaminB7: 0.15, vitaminA: 0.15, zinc: 0.15,
      proline: 0.05, glycine: 0.05, omega6LA: 0.10, copper: 0.05,
      vitaminE: 0.05, selenium: 0.05
    }
  },
  hormonesLibido: {
    label: "🧬 Hormoni & Libido",
    sub: "Steroidogeneza, T4->T3 pretvorba, cAMP signalizacija",
    weights: {
      zinc: 0.20, vitaminD: 0.20, magnesium: 0.15, selenium: 0.15,
      iodine: 0.10, boron: 0.10, vitaminB6: 0.05, saturatedFat: 0.05
    }
  }
};

// ==========================================
// 3. NUTRITION ENGINE (KIWI + CRONOMETER)
// ==========================================
const NutritionEngine = {
  /**
   * Izračuna točko posameznega hranila (0-100) glede na asimetrično krivuljo:
   * - 0 do RDA: linearno (intake/RDA * 100)
   * - RDA do OPL: 100 (optimalni plato)
   * - OPL do UL: 100 (varno območje)
   * - Nad UL: kvadratna kazen glede na koeficient toksičnosti
   */
  calculateSingleNutrientScore(intake, target) {
    const cleanIntake = _parseNum(intake, 0);
    if (cleanIntake <= 0) return 0;
    if (!target) return 50;

    // Faza 1: Pod OPL
    if (cleanIntake <= target.opl) {
      if (cleanIntake < target.rda) {
        return Math.min(100, (cleanIntake / target.rda) * 100);
      }
      return 100;
    }

    // Faza 2: Med OPL in UL
    if (cleanIntake <= target.ul) {
      return 100;
    }

    // Faza 3: Nad UL s kvadratno kaznijo
    const overage = (cleanIntake - target.ul) / target.ul;
    const penalty = target.penaltyFactor * Math.pow(overage, 2) * 100;
    return Math.max(0, 100 - penalty);
  },

  /**
   * Izračun vseh 8 funkcionalnih ocen (0 - 100)
   */
  calculateFunctionalHealthScores(profile, driTable = ATHLETE_MALE_DRI) {
    const scores = {};
    const p = profile && typeof profile === 'object' ? profile : {};
    for (const [catKey, catData] of Object.entries(KIWI_WEIGHTS)) {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const [nutrient, weight] of Object.entries(catData.weights)) {
        const intake = _parseNum(p[nutrient], 0);
        const dri = driTable[nutrient];
        if (dri && weight) {
          const score = this.calculateSingleNutrientScore(intake, dri);
          weightedSum += score * weight;
          totalWeight += weight;
        }
      }

      scores[catKey] = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;
    }
    return scores;
  },

  /**
   * Izračun 6 ključnih biokemijskih razmerij (Cronometer model)
   */
  calculateBiochemicalRatios(p) {
    const pSafe = p && typeof p === 'object' ? p : {};
    const na = _parseNum(pSafe.sodium, 0);
    const k = _parseNum(pSafe.potassium, 0);
    const ca = _parseNum(pSafe.calcium, 0);
    const mg = _parseNum(pSafe.magnesium, 0);
    const zn = _parseNum(pSafe.zinc, 0);
    const cu = _parseNum(pSafe.copper, 0);
    const fe = _parseNum(pSafe.iron, 0);
    const phos = _parseNum(pSafe.phosphorus, 0);
    const o6 = _parseNum(pSafe.omega6LA, 0);
    const o3 = _parseNum(pSafe.omega3DHA, 0) + _parseNum(pSafe.omega3EPA, 0);

    // 1. Natrij : Kalij (Optimalno 1:1.8 do 1:3; torej na/k < 0.45)
    const naKRatio = k > 0 ? (na / k) : 0;
    let naKStatus = 'optimal';
    let naKDesc = 'Optimalno (1 : ' + (k > 0 && na > 0 ? (k / na).toFixed(1) : (k > 0 ? '>10' : '0')) + ')';
    if (naKRatio > 0.6) {
      naKStatus = 'critical';
      naKDesc = 'Presežek natrija (krvni tlak)';
    } else if (naKRatio > 0.45 || (naKRatio < 0.15 && k > 0)) {
      naKStatus = 'suboptimal';
      naKDesc = 'Zmerno povišan natrij';
    }

    // 2. Cink : Baker (Optimalno 10:1 do 15:1)
    const znCuRatio = cu > 0 ? (zn / cu) : 0;
    let znCuStatus = 'optimal';
    let znCuDesc = znCuRatio.toFixed(1) + ' : 1 (Optimalno)';
    if (znCuRatio < 8) {
      znCuStatus = 'suboptimal';
      znCuDesc = znCuRatio.toFixed(1) + ' : 1 (Premalo cinka)';
    } else if (znCuRatio > 20) {
      znCuStatus = 'critical';
      znCuDesc = znCuRatio.toFixed(1) + ' : 1 (Tveganje pomanjkanja bakra)';
    }

    // 3. Kalcij : Magnezij (Optimalno 1.7 : 1 do 2.0 : 1)
    const caMgRatio = mg > 0 ? (ca / mg) : 0;
    let caMgStatus = 'optimal';
    let caMgDesc = caMgRatio.toFixed(1) + ' : 1 (Optimalno)';
    if (caMgRatio > 2.5) {
      caMgStatus = 'critical';
      caMgDesc = caMgRatio.toFixed(1) + ' : 1 (Presežek Ca, krči)';
    } else if (caMgRatio < 1.2 && mg > 0) {
      caMgStatus = 'suboptimal';
      caMgDesc = caMgRatio.toFixed(1) + ' : 1 (Visok magnezij)';
    }

    // 4. Omega-6 : Omega-3 (Optimalno < 4:1)
    const o6o3Ratio = o3 > 0 ? (o6 / o3) : 0;
    let o6o3Status = 'optimal';
    let o6o3Desc = o6o3Ratio.toFixed(1) + ' : 1 (Protivnetno)';
    if (o6o3Ratio > 10) {
      o6o3Status = 'critical';
      o6o3Desc = o6o3Ratio.toFixed(1) + ' : 1 (Visoko vnetno)';
    } else if (o6o3Ratio > 4) {
      o6o3Status = 'suboptimal';
      o6o3Desc = o6o3Ratio.toFixed(1) + ' : 1 (Zmerno vnetno)';
    }

    // 5. Železo : Cink (Optimalno 0.8 : 1 do 1.5 : 1)
    const feZnRatio = zn > 0 ? (fe / zn) : 0;
    let feZnStatus = 'optimal';
    let feZnDesc = feZnRatio.toFixed(1) + ' : 1 (Optimalno)';
    if (feZnRatio > 2.5) {
      feZnStatus = 'critical';
      feZnDesc = feZnRatio.toFixed(1) + ' : 1 (Železo zavira cink)';
    }

    // 6. Kalcij : Fosfor (Optimalno 1.0 : 1 do 1.5 : 1)
    const caPRatio = phos > 0 ? (ca / phos) : 0;
    let caPStatus = 'optimal';
    let caPDesc = caPRatio.toFixed(1) + ' : 1 (Optimalno)';
    if (caPRatio < 0.7 && phos > 0) {
      caPStatus = 'suboptimal';
      caPDesc = caPRatio.toFixed(1) + ' : 1 (Presežek fosfata)';
    }

    // 9.11.2026: brez podatka o hranilu ne prikaži izmišljenega 0.0 : 1
    const ND = 'Ni podatka v bazi živil';
    if (!(k > 0) || !(na > 0)) { naKStatus = 'unknown'; naKDesc = ND; }
    if (!(cu > 0) || !(zn > 0)) { znCuStatus = 'unknown'; znCuDesc = ND; }
    if (!(mg > 0) || !(ca > 0)) { caMgStatus = 'unknown'; caMgDesc = ND; }
    if (!(o3 > 0) || !(o6 > 0)) { o6o3Status = 'unknown'; o6o3Desc = ND; }
    if (!(zn > 0) || !(fe > 0)) { feZnStatus = 'unknown'; feZnDesc = ND; }
    if (!(phos > 0) || !(ca > 0)) { caPStatus = 'unknown'; caPDesc = ND; }

    return {
      sodiumPotassium: { value: naKRatio, status: naKStatus, label: naKDesc },
      zincCopper: { value: znCuRatio, status: znCuStatus, label: znCuDesc },
      calciumMagnesium: { value: caMgRatio, status: caMgStatus, label: caMgDesc },
      omega6Omega3: { value: o6o3Ratio, status: o6o3Status, label: o6o3Desc },
      ironZinc: { value: feZnRatio, status: feZnStatus, label: feZnDesc },
      calciumPhosphorus: { value: caPRatio, status: caPStatus, label: caPDesc }
    };
  }
};

// ==========================================
// 4. METABOLIC ENGINE (MACROFACTOR TDEE)
// ==========================================
const MetabolicEngine = {
  KCAL_PER_KG_TISSUE: 7700, // Forbes / Wishnofsky energijska gostota telesnega tkiva

  /**
   * EMA glajenje teže (Exponential Moving Average) čez N dni
   */
  calculateWeightTrend(logs, windowDays = 14) {
    if (!Array.isArray(logs)) return [];
    const alpha = 2 / (windowDays + 1);
    const results = [];
    let prevSmoothed = null;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const rawW = _parseNum(log?.weightKg, 0);
      if (rawW <= 0) {
        if (prevSmoothed !== null) {
          results.push({ date: log.date, smoothedWeightKg: Number(prevSmoothed.toFixed(2)) });
        }
        continue;
      }

      if (prevSmoothed === null) {
        prevSmoothed = rawW;
      } else {
        prevSmoothed = alpha * rawW + (1 - alpha) * prevSmoothed;
      }

      results.push({
        date: log.date,
        rawWeightKg: rawW,
        smoothedWeightKg: Number(prevSmoothed.toFixed(2))
      });
    }

    return results;
  },

  /**
   * Izračun dinamičnega TDEE iz energijske bilance:
   * TDEE = Povprečni vnos kalorij - (Sprememba zglajene teže na dan * 7700 kcal/kg)
   */
  calculateDynamicTDEE(logs, smoothedWeights, lookbackDays = 14) {
    if (!logs || logs.length < 3 || !smoothedWeights || smoothedWeights.length < 3) {
      // Privzeta vrednost za športnika če še ni zgodovine
      return 2800;
    }

    const recentLogs = logs.slice(-lookbackDays);
    const recentWeights = smoothedWeights.slice(-lookbackDays);

    const validCalorieLogs = recentLogs.filter(l => _parseNum(l.caloriesIn, 0) > 500);
    if (validCalorieLogs.length < 2) {
      return 2800;
    }

    const totalCalories = validCalorieLogs.reduce((sum, l) => sum + _parseNum(l.caloriesIn, 0), 0);
    const avgCaloriesIn = totalCalories / validCalorieLogs.length;

    const startWeight = _parseNum(recentWeights[0]?.smoothedWeightKg, 0);
    const endWeight = _parseNum(recentWeights[recentWeights.length - 1]?.smoothedWeightKg, 0);
    if (startWeight <= 0 || endWeight <= 0) {
      return 2800;
    }
    const totalDays = recentWeights.length - 1 || 1;
    const dailyWeightChangeKg = (endWeight - startWeight) / totalDays;

    // Dnevna shranjena/izgubljena energija (kcal)
    const dailyStoredEnergyKcal = dailyWeightChangeKg * this.KCAL_PER_KG_TISSUE;

    // Termodinamična poraba
    const dynamicTdee = avgCaloriesIn - dailyStoredEnergyKcal;

    // Fiziološka varovalka (med 1500 in 4800 kcal)
    return Math.round(Math.max(1500, Math.min(4800, dynamicTdee)));
  },

  /**
   * Tedenski adaptivni načrt makrohranil glede na cilj
   */
  generateMacroCoachPlan(tdee, weightKg = 80, goalType = 'FAT_LOSS', proteinPerKg = 2.2, fatPerKg = 0.8) {
    const cleanTdee = Math.round(_parseNum(tdee, 2800));
    const cleanWeight = _parseNum(weightKg, 80);
    const cleanPPerKg = _parseNum(proteinPerKg, 2.2);
    const cleanFPerKg = _parseNum(fatPerKg, 0.8);

    let targetCalories = cleanTdee;
    let goalDescription = "Vzdrževanje teže";

    if (goalType === 'FAT_LOSS') {
      targetCalories = cleanTdee - 450; // ~0.4 kg na teden
      goalDescription = "Hujšanje / Deficit (-450 kcal)";
    } else if (goalType === 'MUSCLE_GAIN') {
      targetCalories = cleanTdee + 250; // ~0.25 kg na teden
      goalDescription = "Pusta mišična masa (+250 kcal)";
    }

    const proteinGrams = Math.round(cleanWeight * cleanPPerKg);
    const fatGrams = Math.round(cleanWeight * cleanFPerKg);

    const proteinKcal = proteinGrams * 4;
    const fatKcal = fatGrams * 9;
    const remainingKcal = Math.max(0, targetCalories - (proteinKcal + fatKcal));
    const carbGrams = Math.round(remainingKcal / 4);

    return {
      tdee: cleanTdee,
      targetCalories: Math.round(targetCalories),
      goalType,
      goalDescription,
      proteinGrams,
      fatGrams,
      carbGrams,
      waterLiters: Number((cleanWeight * 0.045).toFixed(1)) // 45 ml / kg za športnika
    };
  }
};

// ==========================================
// 5. PREDPRIPRAVLJENA BOGATA ŽIVILA (PRESETS)
// ==========================================
const PRESET_FOODS = [
  {
    id: "p_jajca",
    name: "Jajca kokošja cela (3 kom / 150g)",
    serving: "150g (3 večja jajca)",
    calories: 215,
    protein: 19,
    carbs: 1.2,
    fat: 15,
    micros: {
      choline: 420, vitaminB12: 2.4, vitaminA: 270, iron: 2.7,
      zinc: 1.9, selenium: 46, leucine: 1.6, vitaminD: 3.2,
      vitaminB2: 0.7, vitaminB5: 2.1, phosphorus: 295
    }
  },
  {
    id: "p_losos",
    name: "Divji atlantski losos (200g pečen)",
    serving: "200g file",
    calories: 284,
    protein: 40,
    carbs: 0,
    fat: 12,
    micros: {
      omega3DHA: 1.4, omega3EPA: 0.9, vitaminD: 22, vitaminB12: 6.4,
      vitaminB6: 1.6, selenium: 72, potassium: 980, magnesium: 60,
      leucine: 3.4, phosphorus: 520, iodine: 60
    }
  },
  {
    id: "p_govedina",
    name: "Pusti goveji zrezek / stegno (200g)",
    serving: "200g pečen",
    calories: 380,
    protein: 48,
    carbs: 0,
    fat: 18,
    micros: {
      iron: 5.2, zinc: 12.4, vitaminB12: 4.8, vitaminB3: 14,
      vitaminB6: 1.2, potassium: 720, phosphorus: 440,
      leucine: 4.2, saturatedFat: 7.2
    }
  },
  {
    id: "p_jogurt",
    name: "Grški jogurt 0% maščobe (250g)",
    serving: "250g lonček",
    calories: 145,
    protein: 25,
    carbs: 9,
    fat: 0.5,
    micros: {
      calcium: 280, phosphorus: 340, potassium: 350,
      vitaminB12: 1.5, vitaminB2: 0.6, leucine: 2.4, zinc: 1.4
    }
  },
  {
    id: "p_oves_borovnice",
    name: "Ovsena kaša z gozdnimi borovnicami",
    serving: "100g ovsa + 100g borovnic",
    calories: 430,
    protein: 14,
    carbs: 78,
    fat: 7,
    micros: {
      magnesium: 140, manganese: 3.8, iron: 4.5, zinc: 3.2,
      potassium: 520, vitaminB1: 0.6, vitaminC: 15, phosphorus: 420
    }
  },
  {
    id: "p_spinaca",
    name: "Mlada špinača na pari z oljčnim oljem (150g)",
    serving: "150g špinače + 10g olja",
    calories: 125,
    protein: 4.2,
    carbs: 5.4,
    fat: 10.5,
    micros: {
      vitaminA: 720, vitaminK: 720, vitaminC: 42, vitaminB9: 290,
      magnesium: 125, potassium: 840, iron: 3.8, calcium: 150
    }
  },
  {
    id: "p_whey_banana",
    name: "Whey izolat + zrela banana (Post-workout)",
    serving: "30g whey + 120g banana",
    calories: 235,
    protein: 28,
    carbs: 30,
    fat: 1,
    micros: {
      leucine: 3.4, isoleucine: 1.8, valine: 1.7, potassium: 560,
      vitaminB6: 0.6, magnesium: 45, calcium: 160
    }
  },
  {
    id: "p_riz_avokado",
    name: "Basmati riž z avokadom (200g riža + 80g avokada)",
    serving: "200g kuhan riž + 1/2 avokada",
    calories: 385,
    protein: 6.5,
    carbs: 64,
    fat: 13,
    micros: {
      potassium: 540, vitaminE: 2.2, vitaminB9: 75, magnesium: 55
    }
  }
];

// ==========================================
// 6. OPEN FOOD FACTS API & SEARCH CLIENT
// ==========================================
const OpenFoodFactsClient = {
  baseUrl: 'https://world.openfoodfacts.org',

  async getProductByBarcode(barcode) {
    const clean = String(barcode || '').replace(/\D/g, '').trim();
    if (!clean) return null;

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 7000) : null;
    try {
      const url = `${this.baseUrl}/api/v2/product/${clean}.json?fields=code,product_name,brands,nutriments,serving_size,serving_quantity,image_url`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: ctrl?.signal
      });
      if (to) clearTimeout(to);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status !== 1 || !data.product) return null;
      return this.normalizeProduct(data.product);
    } catch (e) {
      if (to) clearTimeout(to);
      console.warn("Open Food Facts Barcode error:", e?.message || e);
      return null;
    }
  },

  async searchProducts(query, limit = 8) {
    const clean = encodeURIComponent(String(query || '').trim());
    if (!clean) return [];

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 7000) : null;
    try {
      const url = `${this.baseUrl}/cgi/search.pl?search_terms=${clean}&search_simple=1&action=process&json=1&page_size=${limit}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: ctrl?.signal
      });
      if (to) clearTimeout(to);
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.products) return [];
      return data.products.map(p => this.normalizeProduct(p)).filter(Boolean);
    } catch (e) {
      if (to) clearTimeout(to);
      console.warn("Open Food Facts Search error:", e?.message || e);
      return [];
    }
  },

  normalizeProduct(p) {
    if (!p || typeof p !== 'object') return null;
    const n = p.nutriments || {};
    const rawKcal = n['energy-kcal_100g'] != null ? n['energy-kcal_100g'] : (n['energy_100g'] ? _parseNum(n['energy_100g']) / 4.184 : 0);
    const calories = Math.round(_parseNum(rawKcal, 0));
    const protein = Number(_parseNum(n['proteins_100g'], 0).toFixed(1));
    const carbs = Number(_parseNum(n['carbohydrates_100g'], 0).toFixed(1));
    const fat = Number(_parseNum(n['fat_100g'], 0).toFixed(1));

    const hasAnyNutriments = n['energy-kcal_100g'] != null || n['proteins_100g'] != null || n['carbohydrates_100g'] != null || n['fat_100g'] != null;
    if (calories === 0 && protein === 0 && carbs === 0 && fat === 0 && !hasAnyNutriments && !p.product_name) {
      return null;
    }

    return {
      barcode: p.code || '',
      name: p.product_name || 'Neznano živilo',
      brand: p.brands || '',
      imageUrl: p.image_url || '',
      servingSize: p.serving_size || '100g',
      per100g: {
        calories,
        protein,
        carbs,
        fat,
        fiber: _parseNum(n['fiber_100g'], 0),
        sodium: _parseNum(n['sodium_100g'], 0) * 1000, // v mg
        calcium: _parseNum(n['calcium_100g'], 0) * 1000,
        iron: _parseNum(n['iron_100g'], 0) * 1000,
        potassium: _parseNum(n['potassium_100g'], 0) * 1000
      }
    };
  }
};

// ==========================================
// 7. REALNA 14-DNEVNA ZGODOVINA ZA TDEE DEMO
// ==========================================
const TEST_14DAY_HISTORY = [
  { date: "2026-10-21", weightKg: 82.2, caloriesIn: 2540 },
  { date: "2026-10-22", weightKg: 82.0, caloriesIn: 2600 },
  { date: "2026-10-23", weightKg: 81.9, caloriesIn: 2480 },
  { date: "2026-10-24", weightKg: 82.3, caloriesIn: 2750 }, // Refeed dan
  { date: "2026-10-25", weightKg: 81.8, caloriesIn: 2420 },
  { date: "2026-10-26", weightKg: 81.7, caloriesIn: 2510 },
  { date: "2026-10-27", weightKg: 81.6, caloriesIn: 2490 },
  { date: "2026-10-28", weightKg: 81.8, caloriesIn: 2530 },
  { date: "2026-10-29", weightKg: 81.5, caloriesIn: 2470 },
  { date: "2026-10-30", weightKg: 81.4, caloriesIn: 2500 },
  { date: "2026-10-31", weightKg: 81.3, caloriesIn: 2460 },
  { date: "2026-11-01", weightKg: 81.5, caloriesIn: 2680 },
  { date: "2026-11-02", weightKg: 81.2, caloriesIn: 2450 },
  { date: "2026-11-03", weightKg: 81.1, caloriesIn: 2490 }
];

// ---------- PREHRANA: dnevi, voda, teža, kopiranje, CSV (čiste funkcije brez DOM) ----------
const PrehranaDays = (function () {
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n) => String(n).padStart(2, '0');

  // Lokalni datum yyyy-mm-dd
  function isoOf(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }

  function isValidIso(s) {
    if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Premik datuma za delta dni (UTC aritmetika, brez DST težav)
  function shiftIso(iso, delta) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  // Obroki brez veljavnega datuma dobijo `today`; nič drugega se ne spremeni.
  function migrateMeals(meals, today) {
    let changed = false;
    const list = (Array.isArray(meals) ? meals : []).map((m) => {
      if (!m || typeof m !== 'object') return m;
      if (isValidIso(m.date)) return m;
      changed = true;
      return Object.assign({}, m, { date: today });
    });
    return { meals: list, changed: changed };
  }

  function forDay(meals, iso) {
    return (Array.isArray(meals) ? meals : []).filter((m) => m && m.date === iso);
  }

  function sumDay(list) {
    return (list || []).reduce((t, m) => {
      if (!m) return t;
      t.kcal += _parseNum(m.calories, 0);
      t.protein += _parseNum(m.protein, 0);
      t.carbs += _parseNum(m.carbs, 0);
      t.fat += _parseNum(m.fat, 0);
      return t;
    }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  }

  // Kopije obrokov z novim id-jem in datumom; izvirniki se ne spremenijo.
  function copyDay(meals, fromIso, toIso, makeId) {
    return forDay(meals, fromIso).map((m) =>
      Object.assign(JSON.parse(JSON.stringify(m)), { id: makeId(), date: toIso })
    );
  }

  // Ime brez oklepajev na koncu, npr. "Nutella (30g)" -> "Nutella"
  function baseName(name) {
    const s = String(name || '').trim();
    const b = s.replace(/\s*\([^()]*\)\s*$/, '').trim();
    return b || s;
  }

  // Zadnjih `limit` unikatnih živil (od najnovejšega), po osnovnem imenu.
  function recentUnique(meals, limit) {
    const max = limit || 12;
    const list = Array.isArray(meals) ? meals : [];
    const seen = new Set();
    const out = [];
    for (let i = list.length - 1; i >= 0 && out.length < max; i--) {
      const m = list[i];
      if (!m || !m.name) continue;
      const key = baseName(m.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }

  // Voda v mililitrih po dnevih: { "2026-11-07": 1250 }
  function waterGet(store, iso) {
    return _parseNum(store && store[iso], 0);
  }

  function waterAdd(store, iso, ml) {
    const s = store && typeof store === 'object' ? store : {};
    const next = Math.max(0, _parseNum(s[iso], 0) + _parseNum(ml, 0));
    return Object.assign({}, s, { [iso]: next });
  }

  // En zapis na dan v weightHistory (današnji se prepiše, ne podvaja).
  function upsertWeight(history, iso, kg, caloriesIn) {
    const h = (Array.isArray(history) ? history : []).slice();
    const cleanKg = _parseNum(kg, 0);
    if (cleanKg <= 0) return h;
    const cleanCal = typeof caloriesIn === 'number' && !isNaN(caloriesIn) ? caloriesIn : _parseNum(caloriesIn, 0);
    const idx = h.findIndex((x) => x && x.date === iso);
    if (idx >= 0) {
      const patch = { weightKg: cleanKg };
      if (caloriesIn !== undefined) patch.caloriesIn = cleanCal;
      h[idx] = Object.assign({}, h[idx], patch);
    } else {
      h.push({ date: iso, weightKg: cleanKg, caloriesIn: cleanCal });
    }
    h.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return h;
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // CSV vseh obrokov (vrstni red po datumu, nato po vrstnem redu vnosa). Brez BOM.
  function mealsToCsv(meals) {
    const head = ['datum', 'cas', 'ime', 'porcija', 'kcal', 'beljakovine_g', 'ogljikovi_g', 'mascobe_g'];
    const list = (Array.isArray(meals) ? meals : []).map((m, i) => ({ m: m, i: i })).filter((x) => x.m);
    list.sort((a, b) => {
      const da = String(a.m.date || ''), db = String(b.m.date || '');
      if (da !== db) return da < db ? -1 : 1;
      return a.i - b.i;
    });
    const rows = list.map((x) => {
      const m = x.m;
      return [
        m.date || '', m.time || '', m.name || '', m.serving || '',
        Math.round(_parseNum(m.calories, 0)), _parseNum(m.protein, 0),
        _parseNum(m.carbs, 0), _parseNum(m.fat, 0)
      ].map(csvCell).join(',');
    });
    return [head.join(',')].concat(rows).join('\r\n') + '\r\n';
  }

  return {
    isoOf, isValidIso, shiftIso, migrateMeals, forDay, sumDay, copyDay,
    baseName, recentUnique, waterGet, waterAdd, upsertWeight, csvCell, mealsToCsv
  };
})();

// Izvoz za okolje (brskalnik ali Node)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATHLETE_MALE_DRI,
    KIWI_WEIGHTS,
    NutritionEngine,
    MetabolicEngine,
    PRESET_FOODS,
    OpenFoodFactsClient,
    TEST_14DAY_HISTORY,
    PrehranaDays
  };
}

if (typeof window !== 'undefined') {
  window.PrehranaDays = PrehranaDays;
  window.ATHLETE_MALE_DRI = ATHLETE_MALE_DRI;
  window.KIWI_WEIGHTS = KIWI_WEIGHTS;
  window.NutritionEngine = NutritionEngine;
  window.MetabolicEngine = MetabolicEngine;
  window.PRESET_FOODS = PRESET_FOODS;
  window.OpenFoodFactsClient = OpenFoodFactsClient;
  window.TEST_14DAY_HISTORY = TEST_14DAY_HISTORY;
}
