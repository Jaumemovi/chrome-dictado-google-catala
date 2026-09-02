// Motor de correccions personals compartit entre la pagina d'entrenament
// (training.html) i el dictat injectat a la pestanya (dictation.js).
//
// No toca el reconeixement: treballa nomes sobre el text que Chrome ja ha
// transcrit. La idea es que els errors del reconeixedor son sistematics, aixi
// que un diccionari apres de les teves lectures els pot desfer.
(() => {
  "use strict";

  const NS = "__dictatCorrections_v1__";
  if (typeof window !== "undefined" && window[NS]) return;

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

  const api = { MAX_N, normalize, tokenize, words, buildIndex, apply, buildVocabIndex, scoreAgainstVocab };

  if (typeof window !== "undefined") window[NS] = api;
  if (typeof globalThis !== "undefined") globalThis.DictatCorrections = api;
})();
