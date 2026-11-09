/**
 * Bine Zdravje — ExerciseMatch: hitro lokalno iskanje po bazi vaj (exercise-db.json).
 * UMD modul: deluje v brskalniku (window.ExerciseMatch) in v Node (module.exports).
 *
 * Funkcionalnosti:
 * - Brez zunanjih odvisnosti
 * - Diacritic-insensitive (č->c, š->s, ž->z, ã->a, ç->c itd.)
 * - Case-insensitive
 * - Damerau-Levenshtein toleranca tipkarskih napak (<=1 za besede >=4 znakov, <=2 za >=8 znakov)
 * - Neodvisnost od vrstnega reda besed (token order independence)
 * - Najmočnejša prednost točnemu ujemanju vzdevka (alias exact match strongest)
 * - Prefiksno ujemanje med tipkanjem ('ben' -> bench)
 * - Upoštevanje opreme (barbell/drog, dumbbell/ročke/ročka, cable/škripec, machine/naprava, smith)
 * - Popularity tiebreak prek 'pop' (0-100)
 * - Slovenske, portugalske in angleške stop-besede
 * - Visoka odzivnost (<15 ms za celotno bazo 6500 vaj prek vnaprejšnjega indeksiranja)
 */
(function (root) {
  'use strict';

  // Slovenian, Portuguese, English stopwords (prepositions, conjunctions, articles)
  const STOP_WORDS = new Set([
    // Slovenian
    'in', 'z', 's', 'na', 'iz', 'za', 'pri', 'po', 'v', 'do', 'ter', 'od', 'ob', 'pod', 'nad', 'med', 'skozi', 'k', 'h', 'o',
    // Portuguese
    'e', 'de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'em', 'para', 'pra', 'no', 'nas', 'nos', 'por', 'um', 'uma', 'uns', 'umas', 'ao', 'aos',
    // English
    'and', 'or', 'with', 'without', 'of', 'the', 'a', 'an', 'in', 'to', 'for', 'from', 'on', 'at', 'by'
  ]);

  // Multilingual equipment mappings to canonical equipment
  const EQUIPMENT_MAP = {
    // Barbell
    'barbell': 'barbell', 'drog': 'barbell', 'drogu': 'barbell', 'drogom': 'barbell',
    'stanga': 'barbell', 'stango': 'barbell', 'stangi': 'barbell', 'barra': 'barbell',
    // Dumbbell
    'dumbbell': 'dumbbell', 'dumbbells': 'dumbbell', 'db': 'dumbbell',
    'rocka': 'dumbbell', 'rocke': 'dumbbell', 'rockami': 'dumbbell', 'rocko': 'dumbbell',
    'rocni': 'dumbbell', 'rocne': 'dumbbell', 'rocna': 'dumbbell',
    'halter': 'dumbbell', 'haltere': 'dumbbell', 'halteres': 'dumbbell',
    // Cable
    'cable': 'cable', 'cables': 'cable',
    'skripec': 'cable', 'skripcu': 'cable', 'skripci': 'cable', 'skripcem': 'cable',
    'cabo': 'cable', 'cabos': 'cable',
    // Machine
    'machine': 'machine', 'naprava': 'machine', 'napravi': 'machine', 'napravo': 'machine',
    'trenazer': 'machine', 'maquina': 'machine',
    // Smith machine
    'smith': 'smith', 'smitt': 'smith',
    // Bodyweight
    'bodyweight': 'bodyweight', 'lastna': 'bodyweight', 'lastno': 'bodyweight', 'telesna': 'bodyweight',
    // Kettlebell
    'kettlebell': 'kettlebell', 'kettlebells': 'kettlebell', 'kb': 'kettlebell',
    'girja': 'kettlebell', 'girje': 'kettlebell',
    // Band
    'band': 'band', 'bands': 'band', 'elastika': 'band', 'elastiko': 'band'
  };

  // Common gym slang & multilingual core aliases mapped to standard exercise IDs / names
  const CORE_ALIASES = [
    { targetId: '0025', matchName: /^barbell bench press$/i, aliases: ['bench', 'benc', 'benč', 'bench press', 'potisk s prsi', 'ravni bench', 'supino', 'supino reto'] },
    { targetId: '0043', matchName: /^barbell (full )?squat$/i, aliases: ['pocep', 'počep', 'squat', 'full squat', 'agachamento'] },
    { targetId: '0032', matchName: /^barbell deadlift$/i, aliases: ['deadlift', 'mrtvi dvig', 'mrtvi', 'terra', 'levantamento terra'] },
    { targetId: '0085', matchName: /^(barbell )?romanian deadlift$/i, aliases: ['rdl', 'romanian deadlift', 'romunski mrtvi dvig', 'romunski mrtvi'] },
    { targetId: '0047', matchName: /^(barbell )?incline bench press$/i, aliases: ['incline bench', 'incline bench press', 'posevni bench', 'poševni bench', 'supino inclinado'] },
    { targetId: '0091', matchName: /^(barbell )?(seated |standing )?(overhead|military) press$/i, aliases: ['ohp', 'overhead press', 'military press', 'ramenski potisk', 'desenvolvimento'] },
    { targetId: '0652', matchName: /^pull-?up$/i, aliases: ['zgibi', 'zgib', 'pull up', 'pull-up', 'chin up', 'barra fixa'] },
    { targetId: '0198', matchName: /^(cable )?(lat )?pulldown$/i, aliases: ['lat pulldown', 'lat', 'pulldown', 'puxada', 'puxada alta'] },
    { targetId: '0294', matchName: /^(dumbbell )?(alternate )?biceps? curl$/i, aliases: ['biceps curl', 'bicep curl', 'biceps', 'curl', 'rosca', 'rosca direta'] },
    { targetId: '0241', matchName: /^(cable )?triceps pushdown/i, aliases: ['triceps pushdown', 'pushdown', 'potisk s skripcem', 'potisk s škripcem'] },
    { targetId: '0739', matchName: /(sled 45°|seated )?leg press/i, aliases: ['leg press', 'nozna presa', 'nožna preša', 'presa za noge'] },
    { targetId: '1060', matchName: /^(barbell )?hip thrust/i, aliases: ['hip thrust', 'dvig bokov', 'elevacao pelvica'] }
  ];

  // Variation modifiers that should receive a slight penalty if not in query
  const VARIATION_PENALTIES = [
    { word: 'assisted', penalty: 25 },
    { word: 'kneeling', penalty: 15 },
    { word: 'with towel', penalty: 20 },
    { word: 'on stability ball', penalty: 20 },
    { word: 'on bosu ball', penalty: 20 }
  ];

  let RAW_EXERCISES = [];
  let BY_ID = new Map();
  let INDEXED = [];
  let ALIAS_MAP = new Map();      // exact normalized string -> Array<index>
  let TOKEN_INDEX = new Map();    // token -> Array<index>
  let VOCABULARY = [];            // Array<string> of unique tokens
  let IS_LOADED = false;

  /**
   * Normalization:
   * - Lowercase
   * - Diacritic stripping (NFD unicode normalization)
   * - Replace non-alphanumeric characters with space
   * - Collapse multiple spaces and trim
   */
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đ]/g, 'd')
      .replace(/[ß]/g, 'ss')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Returns normalized words sorted alphabetically (for token order independence).
   */
  function sortedWords(s) {
    return normalize(s).split(/\s+/).filter(Boolean).sort().join(' ');
  }

  /**
   * Canonicalize equipment from eq and exercise name.
   */
  function canonicalEq(eq, name) {
    const s = ((eq || '') + ' ' + (name || '')).toLowerCase();
    if (s.includes('smith')) return 'smith';
    if (s.includes('dumbbell')) return 'dumbbell';
    if (s.includes('barbell') || s.includes('trap bar') || s.includes('olympic') || s.includes('ez bar')) return 'barbell';
    if (s.includes('cable')) return 'cable';
    if (s.includes('machine') || s.includes('leverage')) return 'machine';
    if (s.includes('body weight') || s.includes('bodyweight')) return 'bodyweight';
    if (s.includes('kettlebell')) return 'kettlebell';
    if (s.includes('band')) return 'band';
    return '';
  }

  const DL_SIZE = 64;
  const DL_MATRIX = Array.from({ length: DL_SIZE }, () => new Int32Array(DL_SIZE));
  for (let i = 0; i < DL_SIZE; i++) {
    DL_MATRIX[i][0] = i;
    DL_MATRIX[0][i] = i;
  }

  /**
   * Restricted Damerau-Levenshtein distance (Optimal String Alignment).
   * Supports insertion, deletion, substitution, and transposition of two adjacent characters.
   */
  function damerauLevenshtein(a, b) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 2) return Math.abs(la - lb);
    if (la >= DL_SIZE || lb >= DL_SIZE) return Math.abs(la - lb);

    for (let i = 1; i <= la; i++) {
      for (let j = 1; j <= lb; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        let min = DL_MATRIX[i - 1][j] + 1;
        const ins = DL_MATRIX[i][j - 1] + 1;
        if (ins < min) min = ins;
        const sub = DL_MATRIX[i - 1][j - 1] + cost;
        if (sub < min) min = sub;
        if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          const trans = DL_MATRIX[i - 2][j - 2] + 1;
          if (trans < min) min = trans;
        }
        DL_MATRIX[i][j] = min;
      }
    }
    return DL_MATRIX[la][lb];
  }

  /**
   * Loads and indexes exercise database.
   * @param {Object|Array} db - Database object with .exercises or array of exercises.
   * @returns {number} Number of exercises loaded.
   */
  function load(db) {
    const list = Array.isArray(db) ? db : (db && Array.isArray(db.exercises)) ? db.exercises : [];
    RAW_EXERCISES = list;
    BY_ID = new Map();
    INDEXED = [];
    ALIAS_MAP = new Map();
    TOKEN_INDEX = new Map();
    const vocabSet = new Set();

    list.forEach((ex, idx) => {
      BY_ID.set(ex.id, ex);
      const nameNorm = normalize(ex.name);
      const nameSorted = sortedWords(nameNorm);
      const slNorm = normalize(ex.sl || '');
      const slSorted = slNorm ? sortedWords(slNorm) : '';
      const aliasesNorm = (ex.aliases || []).map(normalize);

      // Merge core aliases if matched by id or regex name
      for (let c = 0; c < CORE_ALIASES.length; c++) {
        const ca = CORE_ALIASES[c];
        if (ca.targetId === ex.id || (ca.matchName && ca.matchName.test(ex.name))) {
          for (let a = 0; a < ca.aliases.length; a++) {
            const an = normalize(ca.aliases[a]);
            if (!aliasesNorm.includes(an)) aliasesNorm.push(an);
          }
        }
      }

      const aliasesSorted = aliasesNorm.map(sortedWords);

      const allTokens = new Set();
      function indexText(str) {
        if (!str) return;
        const words = str.split(/\s+/);
        for (let w = 0; w < words.length; w++) {
          const word = words[w];
          if (word && !STOP_WORDS.has(word)) {
            allTokens.add(word);
            vocabSet.add(word);
          }
        }
      }

      indexText(nameNorm);
      if (slNorm) indexText(slNorm);
      for (let a = 0; a < aliasesNorm.length; a++) {
        const al = aliasesNorm[a];
        indexText(al);
        if (!ALIAS_MAP.has(al)) ALIAS_MAP.set(al, []);
        ALIAS_MAP.get(al).push(idx);

        const alSorted = aliasesSorted[a];
        if (alSorted !== al) {
          if (!ALIAS_MAP.has(alSorted)) ALIAS_MAP.set(alSorted, []);
          ALIAS_MAP.get(alSorted).push(idx);
        }
      }
      if (!ALIAS_MAP.has(nameNorm)) ALIAS_MAP.set(nameNorm, []);
      ALIAS_MAP.get(nameNorm).push(idx);
      if (nameSorted !== nameNorm) {
        if (!ALIAS_MAP.has(nameSorted)) ALIAS_MAP.set(nameSorted, []);
        ALIAS_MAP.get(nameSorted).push(idx);
      }
      if (slNorm) {
        if (!ALIAS_MAP.has(slNorm)) ALIAS_MAP.set(slNorm, []);
        ALIAS_MAP.get(slNorm).push(idx);
        if (slSorted !== slNorm) {
          if (!ALIAS_MAP.has(slSorted)) ALIAS_MAP.set(slSorted, []);
          ALIAS_MAP.get(slSorted).push(idx);
        }
      }

      for (const t of allTokens) {
        if (!TOKEN_INDEX.has(t)) TOKEN_INDEX.set(t, []);
        TOKEN_INDEX.get(t).push(idx);
      }

      INDEXED.push({
        idx,
        id: ex.id,
        raw: ex,
        nameNorm,
        nameSorted,
        slNorm,
        slSorted,
        aliasesNorm,
        aliasesSorted,
        tokens: allTokens,
        canonicalEq: canonicalEq(ex.eq, ex.name),
        pop: typeof ex.pop === 'number' ? ex.pop : 20
      });
    });

    VOCABULARY = Array.from(vocabSet);
    IS_LOADED = true;
    return list.length;
  }

  /**
   * Retrieves an exercise by ID.
   * @param {string} id - Exercise identifier.
   * @returns {Object|null} Raw exercise or null.
   */
  function get(id) {
    return BY_ID.get(id) || null;
  }

  /**
   * Search exercises with ranking, diacritic/case/typo tolerance, equipment boosts,
   * token order independence, and popularity tiebreaks.
   *
   * @param {string} q - Query text.
   * @param {number} [limit=10] - Maximum results to return.
   * @returns {Array<Object>} Sorted array of [{id, name, sl, score, bp, eq, cat, pop}].
   */
  function search(q, limit = 10) {
    if (!IS_LOADED || !q || typeof q !== 'string' || !q.trim()) return [];

    const cleanQ = normalize(q);
    if (!cleanQ) return [];

    const rawWords = cleanQ.split(/\s+/).filter(Boolean);
    const qSorted = sortedWords(cleanQ);

    let meaningfulTokens = rawWords.filter(w => !STOP_WORDS.has(w));
    if (meaningfulTokens.length === 0) meaningfulTokens = rawWords;

    // Detect equipment in query
    let queryEq = null;
    for (let i = 0; i < rawWords.length; i++) {
      const w = rawWords[i];
      if (EQUIPMENT_MAP[w]) {
        queryEq = EQUIPMENT_MAP[w];
        break;
      }
    }

    const candidateIndices = new Set();

    // 1. Direct exact alias / name hits (with order-independence)
    if (ALIAS_MAP.has(cleanQ)) {
      const exactHits = ALIAS_MAP.get(cleanQ);
      for (let i = 0; i < exactHits.length; i++) candidateIndices.add(exactHits[i]);
    }
    if (qSorted !== cleanQ && ALIAS_MAP.has(qSorted)) {
      const exactHits = ALIAS_MAP.get(qSorted);
      for (let i = 0; i < exactHits.length; i++) candidateIndices.add(exactHits[i]);
    }

    // 2. Token index lookup (exact + prefix + typo)
    for (let k = 0; k < meaningfulTokens.length; k++) {
      const qt = meaningfulTokens[k];

      // Exact token posting
      let hasExact = false;
      if (TOKEN_INDEX.has(qt)) {
        hasExact = true;
        const post = TOKEN_INDEX.get(qt);
        for (let i = 0; i < post.length; i++) candidateIndices.add(post[i]);
      }

      // Prefix & Damerau-Levenshtein typo lookup in vocabulary
      const maxDist = qt.length >= 8 ? 2 : (qt.length >= 4 ? 1 : 0);
      for (let i = 0; i < VOCABULARY.length; i++) {
        const vt = VOCABULARY[i];
        if (vt === qt) continue;

        let matched = false;
        // Prefix matching while typing
        if (qt.length >= 2 && vt.startsWith(qt)) {
          matched = true;
        } else if (!hasExact && maxDist > 0 && Math.abs(vt.length - qt.length) <= maxDist) {
          // Typo matching within distance
          if (damerauLevenshtein(qt, vt) <= maxDist) {
            matched = true;
          }
        }

        if (matched) {
          const post = TOKEN_INDEX.get(vt);
          if (post) {
            for (let j = 0; j < post.length; j++) candidateIndices.add(post[j]);
          }
        }
      }
    }

    // Score candidates
    const scored = [];
    for (const idx of candidateIndices) {
      const item = INDEXED[idx];
      let score = 0;

      // Exact alias match check (highest tier: "alias exact match strongest")
      let exactAlias = false;
      for (let i = 0; i < item.aliasesNorm.length; i++) {
        if (item.aliasesNorm[i] === cleanQ || item.aliasesSorted[i] === qSorted) {
          exactAlias = true;
          break;
        }
      }

      const exactName = (
        item.nameNorm === cleanQ ||
        item.nameSorted === qSorted ||
        (item.slNorm && (item.slNorm === cleanQ || item.slSorted === qSorted))
      );

      if (exactAlias) {
        score += 800;
      } else if (exactName) {
        score += 750;
      }

      // Prefix match for single-word queries while typing (e.g. 'ben' -> bench)
      if (!exactAlias && !exactName && rawWords.length === 1 && cleanQ.length >= 2) {
        let prefixAliasHit = false;
        for (let i = 0; i < item.aliasesNorm.length; i++) {
          const a = item.aliasesNorm[i];
          if (cleanQ.length < a.length && a.startsWith(cleanQ)) {
            score += 250 * (cleanQ.length / a.length);
            prefixAliasHit = true;
            break;
          }
        }
        if (!prefixAliasHit && cleanQ.length < item.nameNorm.length && item.nameNorm.startsWith(cleanQ)) {
          score += 200 * (cleanQ.length / item.nameNorm.length);
        }
      }

      // Token-level scoring (order independent)
      let matchedTokenCount = 0;
      for (let i = 0; i < meaningfulTokens.length; i++) {
        const qt = meaningfulTokens[i];
        let bestTokScore = 0;

        for (const et of item.tokens) {
          if (et === qt) {
            bestTokScore = Math.max(bestTokScore, 100);
          } else if (qt.length >= 2 && et.startsWith(qt)) {
            bestTokScore = Math.max(bestTokScore, 70 * (qt.length / et.length));
          } else {
            const maxDist = qt.length >= 8 ? 2 : (qt.length >= 4 ? 1 : 0);
            if (maxDist > 0 && Math.abs(et.length - qt.length) <= maxDist) {
              const d = damerauLevenshtein(qt, et);
              if (d <= maxDist) {
                bestTokScore = Math.max(bestTokScore, d === 1 ? 60 : 40);
              }
            }
          }
        }

        if (bestTokScore >= 40) matchedTokenCount++;
        score += bestTokScore;
      }

      // Token coverage bonus
      const coverage = matchedTokenCount / meaningfulTokens.length;
      score += coverage * 80;
      if (coverage === 1) score += 40;

      // Equipment match or mismatch
      if (queryEq) {
        if (item.canonicalEq === queryEq) {
          score += 150;
        } else if (item.canonicalEq && item.canonicalEq !== 'bodyweight') {
          score -= 120;
        }
      }

      // Variation penalty if query didn't ask for variation
      for (let i = 0; i < VARIATION_PENALTIES.length; i++) {
        const vp = VARIATION_PENALTIES[i];
        if (item.nameNorm.includes(vp.word) && !cleanQ.includes(vp.word)) {
          score -= vp.penalty;
        }
      }

      // Popularity tiebreak via pop (0-100)
      score += (item.pop || 20) * 0.3;

      scored.push({
        id: item.id,
        name: item.raw.name,
        sl: item.raw.sl || '',
        score: Math.round(score * 10) / 10,
        bp: item.raw.bp || '',
        eq: item.raw.eq || '',
        cat: item.raw.cat || '',
        pop: item.pop
      });
    }

    // Sort descending by score, tiebreak with popularity and ID
    scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      if (b.pop !== a.pop) return b.pop - a.pop;
      return a.id.localeCompare(b.id);
    });

    return scored.slice(0, limit);
  }

  /**
   * Returns the single best matching exercise, or null.
   * @param {string} q - Query text.
   * @returns {Object|null} Top result or null.
   */
  function best(q) {
    const results = search(q, 1);
    if (!results || results.length === 0) return null;
    const top = results[0];
    const full = get(top.id);
    return full ? { ...full, score: top.score } : top;
  }

  const ExerciseMatch = {
    load,
    search,
    get,
    best,
    normalize,
    damerauLevenshtein,
    isLoaded: () => IS_LOADED
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExerciseMatch;
  }
  if (typeof window !== 'undefined') {
    window.ExerciseMatch = ExerciseMatch;
  }
})(typeof window !== 'undefined' ? window : globalThis);
