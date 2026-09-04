// Motor de correccions personals compartit entre la pagina d'entrenament
// (training.html) i el dictat injectat a la pestanya (dictation.js).
//
// No toca el reconeixement: treballa nomes sobre el text que Chrome ja ha
// transcrit. La idea es que els errors del reconeixedor son sistematics, aixi
// que un diccionari apres de les teves lectures els pot desfer.
(() => {
  "use strict";

  const NS = "__dictatCorrections_v1__";
  // La guarda ha de ser per VERSIO, no per presencia. Si nomes miressim si hi
  // ha alguna cosa, una pestanya que ja tingues una copia antiga no s'
  // actualitzaria mai i cridariem funcions que alli encara no existeixen.
  // Puja aquest numero cada cop que canvii el que exporta el modul.
  const VERSION = 2;
  if (typeof window !== "undefined" && window[NS] && window[NS].version >= VERSION) return;

  const MAX_N = 5;
  const WORD_RE = /[\p{L}\p{N}'’·-]+/gu;

  function normalize(word) {
    return word.toLowerCase().replace(/[’`]/g, "'").trim();
  }

  // Parteix el text en paraules i separadors, conservant l'original de cada
  // tros perque la reconstruccio no perdi puntuacio ni espais.
  function tokenize(text) {
    const tokens = [];
    let last = 0;

    for (const match of text.matchAll(WORD_RE)) {
      if (match.index > last) {
        tokens.push({ type: "gap", text: text.slice(last, match.index) });
      }
      tokens.push({ type: "word", text: match[0], norm: normalize(match[0]) });
      last = match.index + match[0].length;
    }

    if (last < text.length) tokens.push({ type: "gap", text: text.slice(last) });
    return tokens;
  }

  function words(text) {
    return tokenize(text).filter((t) => t.type === "word");
  }

  // Agafa n paraules consecutives a partir de `start`. Retorna null si pel mig
  // hi ha puntuacio: no volem que una regla creui el final d'una frase.
  function span(tokens, start, n) {
    const collected = [];
    let i = start;

    while (i < tokens.length && collected.length < n) {
      const token = tokens[i];
      if (token.type === "word") {
        collected.push(token.norm);
        i++;
        continue;
      }
      if (collected.length === 0) break;
      if (!/^[ \t]*$/.test(token.text)) return null;
      i++;
    }

    if (collected.length < n) return null;
    return { key: collected.join(" "), end: i };
  }

  // regles: [{ from, to }] amb `from` ja normalitzat.
  function buildIndex(rules) {
    const index = new Map();
    let maxWords = 1;

    for (const rule of rules || []) {
      if (!rule || typeof rule.from !== "string") continue;
      const key = rule.from.trim();
      if (!key) continue;
      index.set(key, typeof rule.to === "string" ? rule.to : "");
      maxWords = Math.max(maxWords, key.split(/\s+/).length);
    }

    index.maxWords = Math.min(maxWords, MAX_N);
    return index;
  }

  function apply(text, index) {
    if (!text || !index || index.size === 0) return text;

    const tokens = tokenize(text);
    const maxWords = index.maxWords || MAX_N;
    const out = [];
    let deleted = false;
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      if (token.type !== "word") {
        out.push(token.text);
        i++;
        continue;
      }

      let matched = false;
      for (let n = maxWords; n >= 1 && !matched; n--) {
        const candidate = span(tokens, i, n);
        if (!candidate) continue;

        const replacement = index.get(candidate.key);
        if (replacement === undefined) continue;

        out.push(replacement);
        if (replacement === "") deleted = true;
        i = candidate.end;
        matched = true;
      }

      if (!matched) {
        out.push(token.text);
        i++;
      }
    }

    const result = out.join("");
    return deleted ? result.replace(/[ \t]{2,}/g, " ").trim() : result;
  }

  // Puntua una alternativa del reconeixedor per quants termes del teu
  // vocabulari conte. Serveix per triar entre els `maxAlternatives` que
  // retorna Chrome en comptes de quedar-nos sempre amb el primer.
  function scoreAgainstVocab(text, vocabIndex) {
    if (!text || !vocabIndex || vocabIndex.size === 0) return 0;

    const tokens = tokenize(text);
    const maxWords = vocabIndex.maxWords || MAX_N;
    let score = 0;
    let i = 0;

    while (i < tokens.length) {
      if (tokens[i].type !== "word") {
        i++;
        continue;
      }

      let hit = null;
      for (let n = maxWords; n >= 1 && !hit; n--) {
        const candidate = span(tokens, i, n);
        if (candidate && vocabIndex.has(candidate.key)) hit = candidate;
      }

      if (hit) {
        score++;
        i = hit.end;
      } else {
        i++;
      }
    }

    return score;
  }

  function buildVocabIndex(terms) {
    const index = new Map();
    let maxWords = 1;

    for (const term of terms || []) {
      if (typeof term !== "string") continue;
      const key = words(term).map((t) => t.norm).join(" ");
      if (!key) continue;
      index.set(key, true);
      maxWords = Math.max(maxWords, key.split(" ").length);
    }

    index.maxWords = Math.min(maxWords, MAX_N);
    return index;
  }

  // -------------------------------------------------- biaix de reconeixement
  //
  // Chrome admet passar-li termes probables ABANS de reconeixer
  // (contextual biasing). Es molt millor que corregir despres: actua sobre la
  // decisio del reconeixedor, i per tant tambe pot salvar paraules que ara no
  // arriba a escriure mai i que cap substitucio podria recuperar.
  //
  // Cada linia del vocabulari admet un pes opcional:  "Girofeeds | 8"

  const DEFAULT_BOOST = 5;

  function parseTerm(line) {
    if (typeof line !== "string") return null;
    const parts = line.split("|");
    const phrase = parts[0].trim();
    if (!phrase) return null;

    let boost = DEFAULT_BOOST;
    if (parts.length > 1) {
      const parsed = parseFloat(parts[1].replace(",", ".").trim());
      // L'especificacio accepta de 0 a 10; fora d'aqui Chrome ho rebutjaria.
      if (!isNaN(parsed)) boost = Math.min(10, Math.max(0, parsed));
    }
    return { phrase: phrase, boost: boost };
  }

  function parseVocab(lines) {
    const out = [];
    for (const line of lines || []) {
      const term = parseTerm(line);
      if (term) out.push(term);
    }
    return out;
  }

  function phraseBiasSupported() {
    return typeof SpeechRecognition !== "undefined" || typeof webkitSpeechRecognition !== "undefined";
  }

  // Aplica els termes al reconeixedor. Torna un text curt amb el que ha passat,
  // per poder ensenyar-ho a la pantalla en comptes d'endevinar-ho.
  //
  // L'API encara s'esta assentant i la llista pot ser un array o un
  // SpeechRecognitionPhraseList segons la versio, aixi que ho provem tot i, si
  // res funciona, no passa res: el dictat continua sense biaix.
  function applyPhraseBias(recognition, terms) {
    if (!recognition || !terms || !terms.length) return "sense termes";

    const Phrase = typeof SpeechRecognitionPhrase !== "undefined" ? SpeechRecognitionPhrase : null;
    if (!Phrase) return "no suportat (falta SpeechRecognitionPhrase)";
    if (!("phrases" in Object.getPrototypeOf(recognition))) return "no suportat (falta phrases)";

    const items = [];
    for (const term of terms) {
      try {
        items.push(new Phrase(term.phrase, term.boost));
      } catch (error) {
        // Un terme que l'API no accepti no ha de tombar la resta.
      }
    }
    if (!items.length) return "cap terme acceptat per l'API";

    const List = typeof SpeechRecognitionPhraseList !== "undefined" ? SpeechRecognitionPhraseList : null;
    const candidates = List ? [() => new List(items), () => items] : [() => items];

    for (const build of candidates) {
      try {
        recognition.phrases = build();
        return items.length + " termes aplicats";
      } catch (error) {
        // Provem la forma seguent.
      }
    }
    return "l'API ha rebutjat la llista";
  }

  const api = { version: VERSION,
                MAX_N, normalize, tokenize, words, buildIndex, apply, buildVocabIndex, scoreAgainstVocab,
                DEFAULT_BOOST, parseTerm, parseVocab, phraseBiasSupported, applyPhraseBias };

  if (typeof window !== "undefined") window[NS] = api;
  if (typeof globalThis !== "undefined") globalThis.DictatCorrections = api;
})();
