/**
 * Bine Zdravje — WorkoutParser: offline Slovenian / English / Portuguese
 * free-text workout parser. Deluje v brskalniku (window.WorkoutParser)
 * in v Node (module.exports) za teste.
 *
 * Podpira zapis vaj, serij, ponovitev, kg, RPE/RIR, ogrevanja, dropsetov,
 * odpovedi ter pretvorbo lbs v kg in slovenskih besednih številk.
 */
(function (root) {
  'use strict';

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'vaja';
  }

  const ALL_NUM_WORDS = {
    // Slovenian
    'ena': 1, 'eden': 1, 'en': 1,
    'dva': 2, 'dve': 2,
    'tri': 3,
    'štiri': 4, 'stiri': 4,
    'pet': 5,
    'šest': 6, 'sest': 6,
    'sedem': 7,
    'osem': 8,
    'devet': 9,
    'deset': 10,
    'enajst': 11,
    'dvanajst': 12,
    'trinajst': 13,
    'štirinajst': 14, 'stirinajst': 14,
    'petnajst': 15,
    'šestnajst': 16, 'sestnajst': 16,
    'sedemnajst': 17,
    'osemnajst': 18,
    'devetnajst': 19,
    'dvajset': 20,
    'trideset': 30,
    'štirideset': 40, 'stirideset': 40,
    'petdeset': 50,
    'šestdeset': 60, 'sestdeset': 60,
    'sedemdeset': 70,
    'osemdeset': 80,
    'devetdeset': 90,
    'sto': 100,
    // English
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
    'eighty': 80, 'ninety': 90, 'hundred': 100,
    // Portuguese
    'um': 1, 'uma': 1,
    'dois': 2, 'duas': 2,
    'três': 3, 'tres': 3,
    'quatro': 4,
    'cinco': 5,
    'seis': 6,
    'sete': 7,
    'oito': 8,
    'nove': 9,
    'dez': 10,
    'onze': 11,
    'doze': 12,
    'treze': 13,
    'catorze': 14, 'quatorze': 14,
    'quinze': 15,
    'dezesseis': 16, 'dezasseis': 16,
    'dezessete': 17, 'dezassete': 17,
    'dezoito': 18,
    'dezenove': 19, 'dezanove': 19,
    'vinte': 20,
    'trinta': 30,
    'quarenta': 40,
    'cinquenta': 50,
    'sessenta': 60,
    'setenta': 70,
    'oitenta': 80,
    'noventa': 90,
    'cem': 100
  };

  function replaceNumberWords(text) {
    let s = text;
    const setKeywords = 'serij[eia]?|sets?|séries?|série';
    const repKeywords = 'ponovitev|ponovitve|repeti(?:ções|coes|ção|cao|tions?)|reps?';
    const weightKeywords = 'kg|kile|kilos|kilo|lbs?|quilogramas?';

    const wordKeys = Object.keys(ALL_NUM_WORDS).sort((a, b) => b.length - a.length).join('|');

    // Before set keywords: e.g. "tri serije", "dve seriji"
    const reSet = new RegExp(`\\b(${wordKeys})\\s+(${setKeywords})\\b`, 'giu');
    s = s.replace(reSet, (m, w, kw) => `${ALL_NUM_WORDS[w.toLowerCase()]} ${kw}`);

    // Before rep keywords: e.g. "deset ponovitev", "osem reps"
    const reRep = new RegExp(`\\b(${wordKeys})\\s+(${repKeywords})\\b`, 'giu');
    s = s.replace(reRep, (m, w, kw) => `${ALL_NUM_WORDS[w.toLowerCase()]} ${kw}`);

    // After "po" / "of" / "de": e.g. "po deset ponovitev", "po osem"
    const rePo = new RegExp(`\\b(po|of|de)\\s+(${wordKeys})\\b`, 'giu');
    s = s.replace(rePo, (m, prep, w) => `${prep} ${ALL_NUM_WORDS[w.toLowerCase()]}`);

    // Before weight keywords: e.g. "petdeset kg", "sto kil"
    const reWt = new RegExp(`\\b(${wordKeys})\\s*(${weightKeywords})\\b`, 'giu');
    s = s.replace(reWt, (m, w, kw) => `${ALL_NUM_WORDS[w.toLowerCase()]} ${kw}`);

    // Standalone numbers: replace unambiguous numbers (exclude 'en', 'one', 'um', 'uma')
    const unambiguousKeys = Object.keys(ALL_NUM_WORDS)
      .filter(k => !['en', 'one', 'um', 'uma'].includes(k))
      .sort((a, b) => b.length - a.length)
      .join('|');
    const reStand = new RegExp(`\\b(${unambiguousKeys})\\b`, 'giu');
    s = s.replace(reStand, (m, w) => `${ALL_NUM_WORDS[w.toLowerCase()]}`);

    // "krat" / "times" / "vezes" as 'x': e.g. "3 krat 8" -> "3x8"
    s = s.replace(/(\d+)\s*(?:krat|times|vezes)\s*(\d+)/gi, '$1x$2');

    return s;
  }

  function normalizeUnitsAndNumbers(text) {
    let s = text;

    // 1. Pounds to kg conversion: e.g. "185 lbs", "185lb", "185 libras"
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:lbs?|funtov|libras?)\b/gi, (m, val) => {
      const lbs = parseFloat(val.replace(',', '.'));
      const kg = Math.round(lbs * 0.45359237 * 10) / 10;
      return `${kg}kg`;
    });

    // 2. Decimal commas with units or before x
    s = s.replace(/(\d+),(\d+)\s*(kg|kile|kila|kilos|quilogramas|lbs?)\b/gi, '$1.$2$3');
    s = s.replace(/(\d+),(\d+)\s*(?=[xX*])/g, '$1.$2');
    s = s.replace(/(\d+),(\d+)\s+(?=[xX*])/g, '$1.$2 ');

    // 3. Normalize rep lists with commas: e.g. "5,5,4" or "12, 10, 8"
    s = s.replace(/(\b\d+)\s*,\s*(?=\d+\b)/g, '$1 ');

    // 4. Protect compound names with "and" or "in"
    s = s.replace(/\bclean\s+and\s+(jerk|press)\b/gi, 'clean_and_$1');
    s = s.replace(/\bpotisk\s+in\s+poteg\b/gi, 'potisk_in_poteg');

    return s;
  }

  function cleanIntro(s) {
    let prev;
    do {
      prev = s;
      s = s.replace(/^(?:ok|okay|em|um|uh|aha|evo|ajde|bora|tipo|ent[aã]o|well|so)(?:[,\s:]+|$)/iu, '');
      s = s.replace(/^(?:dana[sš]nji\s+trening|trening\s+danes|trening|today(?:'s)?\s+workout|workout|treino\s+de\s+hoje|treino)(?:[,\s:]+|$)/iu, '');
      s = s.replace(/^(?:danes\s+sem\s+(?:delal|treniral|naredil)|delal\s+sem|naredil\s+sem|today\s+i\s+did|i\s+did|hoje\s+fiz|hoje\s+treinei|fiz)\s+/iu, '');
      s = s.replace(/^(?:danes|today|hoje)(?:[,\s:]+|$)/iu, '');
      s = s.replace(/^(?:za[cč]el\s+sem\s+z|started\s+with|comecei\s+com)\s+/iu, '');
      s = s.replace(/^(?:kon[cč]al\s+z|za\s+konec|finished\s+with|terminei\s+com)\s+/iu, '');
      s = s.replace(/^(?:še|tudi|pa|in|also|and|e)\s+/iu, '');
    } while (s !== prev);
    return s.trim();
  }

  function parseSegment(rawSeg, matcher) {
    let s = rawSeg.trim();
    s = cleanIntro(s);
    if (!s) return null;

    // Modifiers: warmup, drop, failure
    let type = 'normal';
    if (/\b(?:ogrevanje|ogrevalna|ogrevalne|ogrevalni|ogrevalno|warmup|warm-up|warm\s+up|aquecimento|aquecer)\b/i.test(s)) {
      type = 'warmup';
      s = s.replace(/\b(?:ogrevanje|ogrevalna|ogrevalne|ogrevalni|ogrevalno|warmup|warm-up|warm\s+up|aquecimento|aquecer)\b/gi, ' ');
    } else if (/\b(?:dropset|drop-set|drop\s+set|serie\s+de\s+queda)\b/i.test(s)) {
      type = 'drop';
      s = s.replace(/\b(?:dropset|drop-set|drop\s+set|serie\s+de\s+queda)\b/gi, ' ');
    } else if (/\b(?:do\s+odpovedi|do\s+odpoved|odpoved|do\s+limita|to\s+failure|till\s+failure|until\s+failure|failure|ate\s+a\s+falha|até\s+à\s+falha|ate\s+a\s+exaustao|até\s+à\s+exaustão|falha)\b/i.test(s)) {
      type = 'failure';
      s = s.replace(/\b(?:do\s+odpovedi|do\s+odpoved|odpoved|do\s+limita|to\s+failure|till\s+failure|until\s+failure|failure|ate\s+a\s+falha|até\s+à\s+falha|ate\s+a\s+exaustao|até\s+à\s+exaustão|falha)\b/gi, ' ');
    }

    // RPE: @8 or rpe 9
    let rpe = null;
    const mRpeAt = s.match(/@\s*([0-9]+(?:\.[0-9]+)?)/);
    if (mRpeAt) {
      const val = parseFloat(mRpeAt[1]);
      if (val <= 10) {
        rpe = val;
        s = s.replace(mRpeAt[0], ' ');
      }
    }
    const mRpe = s.match(/\brpe\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mRpe) {
      rpe = parseFloat(mRpe[1]);
      s = s.replace(mRpe[0], ' ');
    }

    // RIR: rir 2, rir1, 2 rir
    let rir = null;
    const mRir = s.match(/\brir\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (mRir) {
      rir = parseFloat(mRir[1]);
      s = s.replace(mRir[0], ' ');
    } else {
      const mRir2 = s.match(/\b([0-9]+(?:\.[0-9]+)?)\s*rir\b/i);
      if (mRir2) {
        rir = parseFloat(mRir2[1]);
        s = s.replace(mRir2[0], ' ');
      } else {
        const mRir3 = s.match(/\b(?:rezerva|reps\s+in\s+reserve)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i);
        if (mRir3) {
          rir = parseFloat(mRir3[1]);
          s = s.replace(mRir3[0], ' ');
        }
      }
    }

    let sets = [];

    // Pattern 1: Natural Language
    // e.g. "3 serije po 10 ponovitev biceps 14 kg" or "potisk nad glavo 2 seriji 8 ponovitev 50kg"
    const mNL = s.match(/(\d+)\s*(?:serij[eia]?|sets?|séries?|série)\s*(?:po|of|de)?\s*(\d+)(?:\s*(?:ponovitev|ponovitve|repeti(?:ções|coes|ção|cao|tions?)|reps?))?\b/iu);
    if (mNL) {
      const numSets = parseInt(mNL[1], 10);
      const numReps = parseInt(mNL[2], 10);
      s = s.replace(mNL[0], ' ');

      let weight = null;
      const mW = s.match(/([+-]?\d+(?:\.\d+)?)\s*(?:kg|kile|kila|kilos|quilogramas)?\b/i);
      if (mW) {
        weight = parseFloat(mW[1]);
        s = s.replace(mW[0], ' ');
      }
      for (let i = 0; i < numSets; i++) {
        sets.push({ w: weight, reps: numReps, rir, rpe, type, done: true });
      }
    }

    // Pattern 2: Duration / Time-based sets (plank 3x60s, deska 45 sek)
    if (sets.length === 0) {
      const mDur = s.match(/\b(\d+)\s*[xX*]\s*(\d+)\s*(?:s|sek|sekund|seconds?|segundos?)\b/i);
      if (mDur) {
        const numSets = parseInt(mDur[1], 10);
        const sec = parseInt(mDur[2], 10);
        for (let i = 0; i < numSets; i++) {
          sets.push({ w: null, reps: null, sec, rir, rpe, type, done: true });
        }
        s = s.replace(mDur[0], ' ');
      } else {
        const mDurSingle = s.match(/\b(\d+)\s*(?:s|sek|sekund|seconds?|segundos?)\b/i);
        if (mDurSingle) {
          const sec = parseInt(mDurSingle[1], 10);
          sets.push({ w: null, reps: null, sec, rir, rpe, type, done: true });
          s = s.replace(mDurSingle[0], ' ');
        }
      }
    }

    // Pattern 3: Multi-WxR (per-set weights: "bench 60x10 80x8 85x6" or "dropset 50x12 40x10")
    if (sets.length === 0) {
      const wxrRegex = /\b([+-]?\d+(?:\.\d+)?)\s*(?:kg)?\s*[xX*]\s*(\d+)\b/gi;
      const matches = [...s.matchAll(wxrRegex)];
      if (matches.length >= 2) {
        for (const m of matches) {
          sets.push({ w: parseFloat(m[1]), reps: parseInt(m[2], 10), rir, rpe, type, done: true });
          s = s.replace(m[0], ' ');
        }
      }
    }

    // Pattern 4: Weight x Reps x Sets ("mrtvi dvig 140 x 5 x 3 @8")
    if (sets.length === 0) {
      const mWRS = s.match(/\b([+-]?\d+(?:\.\d+)?)\s*(?:kg)?\s*[xX*]\s*(\d+)\s*[xX*]\s*(\d+)\b/i);
      if (mWRS) {
        let n1 = parseFloat(mWRS[1]), n2 = parseInt(mWRS[2], 10), n3 = parseInt(mWRS[3], 10);
        let w, numReps, numSets;
        if (n1 > 20 || s.includes('kg')) {
          w = n1;
          if (n2 <= 6 && n3 > 6) { numSets = n2; numReps = n3; }
          else if (n2 > 6 && n3 <= 6) { numSets = n3; numReps = n2; }
          else { numSets = n3; numReps = n2; }
        } else {
          w = n3; numReps = n2; numSets = n1;
        }
        for (let i = 0; i < numSets; i++) {
          sets.push({ w, reps: numReps, rir, rpe, type, done: true });
        }
        s = s.replace(mWRS[0], ' ');
      }
    }

    // Pattern 5: Reps list with weight ("počep 100kg 5 5 4", "počep 100 5 5 4", "lat 60kg 12 10 8")
    if (sets.length === 0) {
      const mRepsList = s.match(/(?:^|\s)([+-]?\d+(?:\.\d+)?)\s*(?:kg|kile|kilos|kilo)?\s+((?:\d+\s+)+\d+)(?:\s|$)/i);
      if (mRepsList) {
        const w = parseFloat(mRepsList[1]);
        const repsArray = mRepsList[2].trim().split(/\s+/).map(x => parseInt(x, 10));
        if (repsArray.every(r => r <= 50)) {
          for (const r of repsArray) {
            sets.push({ w, reps: r, rir, rpe, type, done: true });
          }
          s = s.replace(mRepsList[0], ' ');
        }
      }
    }

    // Pattern 6: Single NxM (with or without separate weight)
    // e.g. "bench 3x8 80", "bench 80kg 3x8", "zgibi +10kg 3x6", "zgibi 3x10", "bench 40x10"
    if (sets.length === 0) {
      const mNxM = s.match(/\b(\d+(?:\.\d+)?)\s*(?:kg)?\s*[xX*]\s*(\d+)\b/i);
      if (mNxM) {
        const n1 = parseFloat(mNxM[1]);
        const n2 = parseInt(mNxM[2], 10);
        const hasKgOnN1 = /kg\s*[xX*]/i.test(mNxM[0]);
        s = s.replace(mNxM[0], ' ');

        let weight = null;
        const mW = s.match(/([+-]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:kg|kile|kilos|kilo)\b/i);
        if (mW) {
          weight = parseFloat(mW[1].replace(/\s+/g, ''));
          s = s.replace(mW[0], ' ');
        } else {
          const mSign = s.match(/([+-]\s*\d+(?:\.\d+)?)\b/);
          if (mSign) {
            weight = parseFloat(mSign[1].replace(/\s+/g, ''));
            s = s.replace(mSign[0], ' ');
          } else {
            const mNum = s.match(/\b(\d+(?:\.\d+)?)\b/);
            if (mNum) {
              weight = parseFloat(mNum[1]);
              s = s.replace(mNum[0], ' ');
            }
          }
        }

        if (weight !== null) {
          for (let i = 0; i < n1; i++) {
            sets.push({ w: weight, reps: n2, rir, rpe, type, done: true });
          }
        } else if (hasKgOnN1 || n1 > 15) {
          // Weight x Reps: 1 set of n2 reps @ n1 kg
          sets.push({ w: n1, reps: n2, rir, rpe, type, done: true });
        } else {
          // Sets x Reps bodyweight (null kg)
          for (let i = 0; i < n1; i++) {
            sets.push({ w: null, reps: n2, rir, rpe, type, done: true });
          }
        }
      }
    }

    if (sets.length === 0) {
      return null;
    }

    // Clean exercise name
    let cleanName = s
      .replace(/_/g, ' ')
      .replace(/[@#]/g, ' ')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    cleanName = cleanIntro(cleanName);

    if (!cleanName) {
      if (type === 'drop') cleanName = 'dropset';
      else if (type === 'warmup') cleanName = 'ogrevanje';
      else cleanName = 'vaja';
    }

    let exId = null;
    let finalName = cleanName;
    if (matcher && typeof matcher.best === 'function') {
      try {
        const match = matcher.best(cleanName);
        if (match && match.id) {
          exId = match.id;
          if (match.name) finalName = match.name;
        }
      } catch (e) {}
    }
    if (!exId) {
      exId = 'custom:' + slugify(cleanName);
    }

    return {
      exercise: {
        exId,
        name: finalName,
        sets
      }
    };
  }

  function parse(text, matcher) {
    if (!text || typeof text !== 'string') {
      return { exercises: [], unknown: [] };
    }

    let normalized = replaceNumberWords(text);
    normalized = normalizeUnitsAndNumbers(normalized);

    const transitionRegex = /;|(?:[\r\n]+)|\b(?:in\s+)?(?:potem|nato)\b|\bza\s+tem\b|\bter\b|\b(?:pa\s+pol|pol\s+pa|in\s+pol|pol)\b|\bnaslednja\s+vaja\b|\bnaslednje\b|\b(?:and\s+)?then\b|\bafter\s+that\b|\bnext\s+exercise\b|\bnext\b|\bafterwards\b|\b(?:e\s+)?depois\b|\bem\s+seguida\b|\b(?:e\s+)?a\s+seguir\b|\bpr[oó]ximo(?:\s+exerc[ií]cio)?\b|\b(?:in|and|e)\s+(?=[\p{L}]|\d+\s*(?:serij[eia]?|sets?|séries?|série))|,\s*(?=[\p{L}]|\d+\s*(?:serij[eia]?|sets?|séries?|série))/iu;

    const rawSegments = normalized.split(transitionRegex).map(s => s.trim()).filter(Boolean);

    const exercises = [];
    const unknown = [];

    for (const rawSeg of rawSegments) {
      const parsed = parseSegment(rawSeg, matcher);
      if (parsed) {
        exercises.push(parsed.exercise);
      } else {
        const cleaned = cleanIntro(rawSeg);
        if (cleaned.length > 0 && !/^(?:ok|em|danes|trening|pol|pa|then|workout|today|hoje|tipo)$/i.test(cleaned)) {
          unknown.push(rawSeg);
        }
      }
    }

    return { exercises, unknown };
  }

  const WorkoutParser = {
    parse,
    slugify,
    normalizeText: text => normalizeUnitsAndNumbers(replaceNumberWords(text || ''))
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkoutParser;
  }
  if (typeof window !== 'undefined') {
    window.WorkoutParser = WorkoutParser;
  }
})(typeof window !== 'undefined' ? window : globalThis);
