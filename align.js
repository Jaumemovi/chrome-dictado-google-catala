// Alineacio paraula a paraula entre el text que havies de llegir (referencia)
// i el que Chrome ha entes (hipotesi), i extraccio de regles de correccio.
//
// Nomes el fa servir training.html; el dictat no necessita alinear res.
(() => {
  "use strict";

  const NS = "__dictatAlign_v1__";
  if (typeof window !== "undefined" && window[NS]) return;

  const C = (typeof window !== "undefined" && window.__dictatCorrections_v1__) || globalThis.DictatCorrections;

  // Mida maxima d'una zona d'error acceptable. Si una frase surt mes trencada
  // que aixo, probablement va fallar l'audio i no en volem aprendre res.
  const MAX_REGION = 4;

  // Needleman-Wunsch amb cost 1 per substitucio, insercio i esborrat.
  function align(refWords, hypWords) {
    const n = refWords.length;
    const m = hypWords.length;
    const d = [];

    for (let i = 0; i <= n; i++) {
      d.push(new Array(m + 1).fill(0));
      d[i][0] = i;
    }
    for (let j = 0; j <= m; j++) d[0][j] = j;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1);
      }
    }

    const ops = [];
    let i = n;
    let j = m;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (refWords[i - 1] === hypWords[j - 1] ? 0 : 1)) {
        ops.push({
          op: refWords[i - 1] === hypWords[j - 1] ? "eq" : "sub",
          ref: refWords[i - 1],
          hyp: hypWords[j - 1]
        });
        i--;
        j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        // El reconeixedor s'ha menjat una paraula.
        ops.push({ op: "del", ref: refWords[i - 1], hyp: null });
        i--;
      } else {
        // El reconeixedor s'ha inventat una paraula.
        ops.push({ op: "ins", ref: null, hyp: hypWords[j - 1] });
        j--;
      }
    }

    ops.reverse();
    return { ops, distance: d[n][m] };
  }

  function alignTexts(reference, hypothesis) {
    const refTokens = C.words(reference);
    const hypTokens = C.words(hypothesis);
    const result = align(refTokens.map((t) => t.norm), hypTokens.map((t) => t.norm));

    // Reenganxem la grafia original: la referencia porta les majuscules bones
    // (Girofeeds, no girofeeds), i les volem a la sortida de la regla.
    let ri = 0;
    let hi = 0;
    for (const step of result.ops) {
      if (step.op !== "ins") {
        const token = refTokens[ri++];
        step.refRaw = token ? token.text : null;
      }
      if (step.op !== "del") {
        const token = hypTokens[hi++];
        step.hypRaw = token ? token.text : null;
      }
    }

    result.refCount = refTokens.length;
    result.wer = refTokens.length ? result.distance / refTokens.length : 0;
    return result;
  }

  // Agrupa els errors consecutius en regions i les converteix en parells
  // { from: el que s'ha sentit, to: el que hi havia d'haver }.
  function extractPairs(reference, hypothesis) {
    const { ops } = alignTexts(reference, hypothesis);
    const pairs = [];
    let region = null;

    const flush = () => {
      if (!region) return;
      const from = region.hyp.map((t) => C.normalize(t)).join(" ");
      const to = region.ref.join(" ");

      // Sense `from` no hi ha res a on enganxar la correccio: una paraula que
      // el reconeixedor no ha arribat a escriure no la podem recuperar amb una
      // substitucio de text.
      if (from && region.ref.length <= MAX_REGION && region.hyp.length <= MAX_REGION) {
        pairs.push({ from, to, deletion: to === "" });
      }
      region = null;
    };

    for (const step of ops) {
      if (step.op === "eq") {
        flush();
        continue;
      }
      if (!region) region = { ref: [], hyp: [] };
      if (step.refRaw) region.ref.push(step.refRaw);
      if (step.hypRaw) region.hyp.push(step.hypRaw);
    }
    flush();

    return pairs;
  }

  // Converteix tots els parells acumulats de totes les sessions en el
  // diccionari final. Un error que nomes ha passat un cop es soroll; un `from`
  // que apunta a dos `to` diferents es queda amb el guanyador clar.
  function buildRules(samples, options = {}) {
    const minCount = options.minCount === undefined ? 2 : options.minCount;
    const minDeletionCount = options.minDeletionCount === undefined ? 3 : options.minDeletionCount;
    const counts = new Map();

    for (const sample of samples || []) {
      if (!sample || !sample.ref || !sample.hyp) continue;
      for (const pair of extractPairs(sample.ref, sample.hyp)) {
        const key = pair.from + " => " + pair.to;
        const entry = counts.get(key) || { from: pair.from, to: pair.to, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }

    const byFrom = new Map();
    for (const entry of counts.values()) {
      const list = byFrom.get(entry.from) || [];
      list.push(entry);
      byFrom.set(entry.from, list);
    }

    const rules = [];
    for (const [from, candidates] of byFrom) {
      candidates.sort((a, b) => b.count - a.count);
      const best = candidates[0];
      const total = candidates.reduce((sum, c) => sum + c.count, 0);
      const threshold = best.to === "" ? minDeletionCount : minCount;

      if (best.count < threshold) continue;
      // Si el mateix so t'ha donat correccions contradictories, no ens hi
      // fiquem: mes val no corregir que corregir malament.
      if (best.count / total < 0.6) continue;

      rules.push({ from, to: best.to, count: best.count, total });
    }

    rules.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
    return rules;
  }

  const api = { align, alignTexts, extractPairs, buildRules, MAX_REGION };

  if (typeof window !== "undefined") window[NS] = api;
  if (typeof globalThis !== "undefined") globalThis.DictatAlign = api;
})();
