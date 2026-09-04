(() => {
  "use strict";

  const C = window.__dictatCorrections_v1__;
  const A = window.__dictatAlign_v1__;
  const CORPUS_BASE = window.__dictatCorpusBase_v1__ || [];
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const LANG = "ca-ES";
  const MAX_SAMPLES = 800;
  const LISTEN_TIMEOUT_MS = 20000;

  const DEFAULTS = {
    samples: [],
    rules: [],
    manualRules: [],
    vocab: [],
    customCorpus: "",
    sessions: [],
    settings: { minCount: 2, applyCorrections: true, useAlternatives: true, autoAdvance: true, preferLocal: false }
  };

  let store = null;

  // Estat de la sessio en curs.
  const session = { queue: [], index: 0, results: [], listening: false, recognition: null, timer: null };

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- magatzem

  // Repartiment entre els dos magatzems de Chrome:
  //
  // - storage.sync  -> el que ESCRIUS tu (vocabulari, corpus propi, regles
  //   manuals, ajustos). Chrome ho replica a tots els ordinadors on tinguis la
  //   sessio iniciada, aixi que et segueix sol.
  // - storage.local -> les lectures i les regles apreses. Son moltes (fins a
  //   800 mostres, molt per sobre del limit de sync) i, sobretot, les regles es
  //   recalculen de les mostres: si les sincronitzessim, cada ordinador
  //   sobreescriuria les de l'altre amb les seves propies lectures.
  const SYNC_KEYS = ["manualRules", "vocab", "customCorpus", "settings"];
  const isSync = (key) => SYNC_KEYS.indexOf(key) >= 0;

  async function load() {
    const localKeys = Object.keys(DEFAULTS).filter((key) => !isSync(key));
    const [synced, local] = await Promise.all([
      chrome.storage.sync.get(SYNC_KEYS),
      chrome.storage.local.get(localKeys)
    ]);

    // Migracio dels perfils anteriors a la sincronitzacio: si una clau encara
    // no es a sync pero si a local, la hi pugem un sol cop.
    const missing = SYNC_KEYS.filter((key) => synced[key] === undefined);
    if (missing.length) {
      const previous = await chrome.storage.local.get(missing);
      const patch = {};
      for (const key of missing) {
        if (previous[key] !== undefined) patch[key] = previous[key];
      }
      if (Object.keys(patch).length) {
        await chrome.storage.sync.set(patch);
        Object.assign(synced, patch);
      }
    }

    store = Object.assign({}, DEFAULTS, local, synced);
    store.settings = Object.assign({}, DEFAULTS.settings, synced.settings || {});
    return store;
  }

  async function save(patch) {
    Object.assign(store, patch);

    const toSync = {};
    const toLocal = {};
    for (const key of Object.keys(patch)) {
      (isSync(key) ? toSync : toLocal)[key] = patch[key];
    }

    const writes = [];
    if (Object.keys(toSync).length) writes.push(chrome.storage.sync.set(toSync));
    if (Object.keys(toLocal).length) writes.push(chrome.storage.local.set(toLocal));
    await Promise.all(writes);
  }

  function corpus() {
    const custom = store.customCorpus
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return CORPUS_BASE.concat(custom);
  }

  // Recalcula el diccionari a partir de totes les lectures acumulades, tot
  // respectant les regles que hagis desactivat a ma.
  function recomputeRules() {
    const disabled = new Set(
      store.rules.filter((rule) => rule.disabled).map((rule) => rule.from + " => " + rule.to)
    );

    const rules = A.buildRules(store.samples, { minCount: store.settings.minCount });
    for (const rule of rules) {
      if (disabled.has(rule.from + " => " + rule.to)) rule.disabled = true;
    }
    return rules;
  }

  function activeRules() {
    return store.rules.filter((rule) => !rule.disabled).concat(store.manualRules);
  }

  // ------------------------------------------------------------------ pestanyes

  function showTab(name) {
    for (const tab of document.querySelectorAll(".tab")) {
      tab.classList.toggle("is-active", tab.dataset.tab === name);
    }
    for (const panel of document.querySelectorAll(".panel")) {
      panel.classList.toggle("is-active", panel.id === "panel-" + name);
    }
    if (name === "rules") renderRules();
    if (name === "data") renderStats();
    if (name === "train") renderIdleStats();
  }

  // ---------------------------------------------------------------- entrenament

  function renderIdleStats() {
    const total = store.samples.length;
    const rules = activeRules().length;
    const last = store.sessions[store.sessions.length - 1];

    const parts = [`${total} frases llegides`, `${rules} correccions actives`, `${corpus().length} frases al corpus`];
    if (last) parts.push(`darrera sessió: ${Math.round(last.wer * 100)}% d'error`);
    $("idle-stats").textContent = parts.join(" · ");
  }

  async function startSession() {
    if (!SpeechRecognition) {
      alert("Aquest Chrome no exposa la Web Speech API.");
      return;
    }

    // Demanem el permis aqui, amb la pagina encara quieta, en comptes de
    // deixar que el dialeg surti a sobre de la primera frase.
    await ensureMic();

    const size = Number($("session-size").value);
    const pool = corpus().slice();

    // Barreja i agafa les primeres: volem varietat entre sessions, no sempre
    // les mateixes frases del principi de la llista.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    session.queue = pool.slice(0, Math.min(size, pool.length));
    session.index = 0;
    session.results = [];

    $("train-idle").hidden = true;
    $("train-done").hidden = true;
    $("train-active").hidden = false;
    renderSentence();
  }

  function renderSentence() {
    const total = session.queue.length;
    $("sentence").textContent = session.queue[session.index];
    $("progress-bar").style.width = `${(session.index / total) * 100}%`;
    $("progress-label").textContent = `Frase ${session.index + 1} de ${total}`;
    $("result").hidden = true;
    $("learned").textContent = "";
    $("retry").hidden = true;
    $("listen").disabled = false;
    setStatus("Prem Espai o el botó per començar a escoltar.", "");
  }

  // Una extensio no pot declarar el microfon al manifest (`audioCapture` nomes
  // val per a packaged apps), aixi que el permis es demana com a qualsevol web:
  // amb una crida explicita a getUserMedia. Un cop concedit queda desat per a
  // l'origen chrome-extension:// i no el torna a demanar. Ho fem abans
  // d'engegar SpeechRecognition perque, si no, un permis denegat nomes es
  // manifesta com un `not-allowed` sec i sense dialeg.
  let micReady = false;

  async function ensureMic() {
    if (micReady) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micReady = true;
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Nomes voliem el permis: el reconeixedor obre el seu propi flux.
      for (const track of stream.getTracks()) track.stop();
      micReady = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  function setStatus(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
  }

  async function listen() {
    if (session.listening) {
      stopListening();
      return;
    }

    if (!(await ensureMic())) {
      setStatus("Cal permis de microfon. Prem la icona del cadenat a la barra d'adreces, permet el microfon i torna-ho a provar.", "");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = LANG;
    recognition.continuous = false;
    recognition.interimResults = true;
    // Recollim alternatives per poder mesurar si el desempat per vocabulari
    // hauria encertat, pero el que s'apren surt sempre de la primera opcio:
    // es la que rebries dictant sense cap ajuda.
    recognition.maxAlternatives = 5;

    // El biaix de frases nomes el permet Chrome amb reconeixement LOCAL: amb el
    // servei remot, start() peti amb "phrases-not-supported". Van lligats.
    const preferLocal = store.settings.preferLocal === true;
    if ("processLocally" in recognition) {
      recognition.processLocally = preferLocal;
    }

    if (preferLocal) {
      // Hi van el teu vocabulari i la banda correcta de les regles: son, per
      // definicio, les paraules que Chrome et falla.
      const biasTerms = C.parseVocab(store.vocab).concat(
        activeRules()
          .map((rule) => ({ phrase: rule.to, boost: C.DEFAULT_BOOST }))
          .filter((term) => term.phrase)
      );
      session.biasStatus = C.applyPhraseBias(recognition, biasTerms);
    } else {
      session.biasStatus = "desactivat (cal reconeixement local)";
    }
    console.log("[dictat] biaix de reconeixement:", session.biasStatus);

    let finalText = "";
    let bestOfAlternatives = null;

    recognition.onstart = () => {
      session.listening = true;
      $("listen").textContent = "Atura";
      const bias = session.biasStatus && session.biasStatus.indexOf("aplicats") < 0
        ? " (biaix: " + session.biasStatus + ")"
        : "";
      setStatus("Escoltant… llegeix la frase." + bias, "listening");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += (finalText ? " " : "") + (result[0] ? result[0].transcript : "");
          if (result.length > 1) bestOfAlternatives = pickByVocab(result);
        } else {
          interim += result[0] ? result[0].transcript : "";
        }
      }
      if (interim.trim()) setStatus("Sento: " + interim.trim(), "listening");
    };

    recognition.onerror = (event) => {
      const error = event.error || "desconegut";
      if (error === "not-allowed" || error === "service-not-allowed") {
        setStatus("Micròfon bloquejat. Permet-lo per a aquesta pàgina i torna-ho a provar.", "");
      } else if (error === "no-speech") {
        setStatus("No s'ha sentit res. Torna-ho a provar.", "");
      } else if (error === "phrases-not-supported") {
        setStatus("Aquest Chrome no accepta el biaix de paraules amb aquesta configuració. Desactiva el reconeixement local a Dades i ajustos.", "");
      } else if (error !== "aborted") {
        setStatus("Error de reconeixement: " + error, "");
      }
    };

    recognition.onend = () => {
      session.listening = false;
      session.recognition = null;
      clearTimeout(session.timer);
      $("listen").textContent = "Escolta";

      const text = finalText.trim();
      if (text) {
        capture(text, bestOfAlternatives);
      } else if ($("status").className.indexOf("listening") >= 0) {
        setStatus("No s'ha sentit res. Torna-ho a provar.", "");
      }
    };

    session.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      setStatus("No s'ha pogut engegar el micròfon: " + (error.message || error), "");
      return;
    }

    session.timer = setTimeout(stopListening, LISTEN_TIMEOUT_MS);
  }

  function stopListening() {
    clearTimeout(session.timer);
    if (session.recognition) {
      try { session.recognition.stop(); } catch (_) {}
    }
  }

  function pickByVocab(result) {
    const vocabIndex = C.buildVocabIndex(
      C.parseVocab(store.vocab)
        .map((term) => term.phrase)
        .concat(activeRules().map((rule) => rule.to).filter(Boolean))
    );
    if (vocabIndex.size === 0) return null;

    let best = result[0] ? result[0].transcript : "";
    let bestScore = C.scoreAgainstVocab(best, vocabIndex);
    for (let i = 1; i < result.length; i++) {
      const candidate = result[i] ? result[i].transcript : "";
      const score = C.scoreAgainstVocab(candidate, vocabIndex);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  async function capture(hypothesis, alternative) {
    const reference = session.queue[session.index];
    setStatus("", "");

    const alignment = A.alignTexts(reference, hypothesis);
    renderDiff(alignment, hypothesis);

    const before = new Set(activeRules().map((rule) => rule.from + " => " + rule.to));

    const samples = store.samples.concat([{ ref: reference, hyp: hypothesis, t: Date.now() }]);
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    await save({ samples });
    await save({ rules: recomputeRules() });

    const fresh = activeRules().filter((rule) => !before.has(rule.from + " => " + rule.to));
    $("learned").textContent = fresh.length
      ? "Nova correcció: " + fresh.map((rule) => `"${rule.from}" → "${rule.to}"`).join(", ")
      : "";

    session.results.push({ wer: alignment.wer, words: alignment.refCount });

    let note = `${Math.round(alignment.wer * 100)}% de paraules diferents`;
    if (alternative && alternative !== hypothesis) {
      note += " · amb el teu vocabulari Chrome hauria triat: " + alternative;
    }
    $("wer").textContent = note;

    $("retry").hidden = false;
    $("listen").disabled = true;

    if (store.settings.autoAdvance) setTimeout(nextSentence, 1800);
  }

  function renderDiff(alignment, hypothesis) {
    const refLine = $("diff-ref");
    const hypLine = $("diff-hyp");
    refLine.textContent = "";
    hypLine.textContent = "";

    if (!hypothesis) {
      hypLine.innerHTML = '<span class="empty">(res)</span>';
    }

    for (const step of alignment.ops) {
      if (step.op !== "ins") refLine.appendChild(word(step.refRaw, step.op === "eq" ? "eq" : step.op === "del" ? "del" : "sub"));
      if (step.op !== "del") hypLine.appendChild(word(step.hypRaw, step.op === "eq" ? "eq" : step.op === "ins" ? "ins" : "sub"));
    }

    $("result").hidden = false;
  }

  function word(text, kind) {
    const fragment = document.createDocumentFragment();
    const span = document.createElement("span");
    span.className = "w " + kind;
    span.textContent = text || "";
    fragment.appendChild(span);
    fragment.appendChild(document.createTextNode(" "));
    return fragment;
  }

  function nextSentence() {
    if (session.index + 1 >= session.queue.length) {
      endSession();
      return;
    }
    session.index++;
    renderSentence();
  }

  async function endSession() {
    stopListening();
    $("train-active").hidden = true;
    $("train-done").hidden = false;

    if (session.results.length) {
      const words = session.results.reduce((sum, r) => sum + r.words, 0);
      const errors = session.results.reduce((sum, r) => sum + r.wer * r.words, 0);
      const wer = words ? errors / words : 0;

      const sessions = store.sessions.concat([{ t: Date.now(), count: session.results.length, wer }]);
      if (sessions.length > 100) sessions.splice(0, sessions.length - 100);
      await save({ sessions });

      const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null;
      let summary = `${session.results.length} frases · ${Math.round(wer * 100)}% de paraules diferents · ${activeRules().length} correccions actives.`;
      if (previous) {
        const delta = Math.round((previous.wer - wer) * 100);
        if (delta !== 0) summary += delta > 0 ? ` ${delta} punts millor que la sessió anterior.` : ` ${-delta} punts pitjor que la sessió anterior.`;
      }
      $("done-summary").textContent = summary;
    } else {
      $("done-summary").textContent = "No s'ha registrat cap lectura.";
    }

    session.queue = [];
    session.results = [];
  }

  // --------------------------------------------------------------------- regles

  function renderRules() {
    const tbody = document.querySelector("#rules-table tbody");
    tbody.textContent = "";

    const rows = store.rules
      .map((rule, i) => ({ rule, i, manual: false }))
      .concat(store.manualRules.map((rule, i) => ({ rule, i, manual: true })));

    $("rules-count").textContent = `· ${activeRules().length} actives`;
    $("rules-empty").hidden = rows.length > 0;
    document.querySelector("#rules-table").hidden = rows.length === 0;

    for (const row of rows) {
      const tr = document.createElement("tr");
      if (row.rule.disabled) tr.className = "off";

      tr.appendChild(cell(row.rule.from));
      tr.appendChild(cell(row.rule.to || "(esborra)", "to"));
      tr.appendChild(cell(row.manual ? "—" : String(row.rule.count || "")));
      tr.appendChild(cell(row.manual ? "manual" : "apresa", "origin"));

      const actions = document.createElement("td");
      if (row.manual) {
        actions.appendChild(button("Esborra", async () => {
          const manualRules = store.manualRules.slice();
          manualRules.splice(row.i, 1);
          await save({ manualRules });
          renderRules();
        }));
      } else {
        actions.appendChild(button(row.rule.disabled ? "Activa" : "Desactiva", async () => {
          const rules = store.rules.slice();
          rules[row.i] = Object.assign({}, rules[row.i], { disabled: !rules[row.i].disabled });
          await save({ rules });
          renderRules();
        }));
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }

    renderTry();
  }

  function cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function button(label, onClick) {
    const el = document.createElement("button");
    el.textContent = label;
    el.addEventListener("click", onClick);
    return el;
  }

  function renderTry() {
    const input = $("try-input").value;
    if (!input.trim()) {
      $("try-output").textContent = "";
      return;
    }
    $("try-output").textContent = C.apply(input, C.buildIndex(activeRules()));
  }

  // ------------------------------------------------------------------ estadistiques

  function renderStats() {
    const container = $("stats");
    container.textContent = "";

    const words = store.samples.reduce((sum, s) => sum + C.words(s.ref).length, 0);
    const last = store.sessions[store.sessions.length - 1];
    const first = store.sessions[0];

    const items = [
      [store.samples.length, "frases llegides"],
      [words, "paraules d'entrenament"],
      [activeRules().length, "correccions actives"],
      [store.sessions.length, "sessions"]
    ];

    if (last) items.push([Math.round(last.wer * 100) + "%", "error darrera sessió"]);
    if (first && store.sessions.length > 1) items.push([Math.round(first.wer * 100) + "%", "error primera sessió"]);

    for (const [value, label] of items) {
      const stat = document.createElement("div");
      stat.className = "stat";
      const b = document.createElement("b");
      b.textContent = String(value);
      const span = document.createElement("span");
      span.textContent = label;
      stat.append(b, span);
      container.appendChild(stat);
    }
  }

  // ------------------------------------------------------------------------ init

  async function init() {
    await load();

    for (const tab of document.querySelectorAll(".tab")) {
      tab.addEventListener("click", () => showTab(tab.dataset.tab));
    }

    $("start-session").addEventListener("click", startSession);
    $("again").addEventListener("click", startSession);
    $("listen").addEventListener("click", listen);
    $("retry").addEventListener("click", () => {
      $("result").hidden = true;
      $("listen").disabled = false;
      listen();
    });
    $("next").addEventListener("click", () => {
      stopListening();
      nextSentence();
    });
    $("end-session").addEventListener("click", endSession);

    document.addEventListener("keydown", (event) => {
      if (event.target instanceof Element && event.target.matches("input, textarea, select")) return;
      if ($("train-active").hidden || !document.getElementById("panel-train").classList.contains("is-active")) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (!$("listen").disabled) listen();
      } else if (event.code === "Enter") {
        event.preventDefault();
        stopListening();
        nextSentence();
      }
    });

    $("min-count").value = String(store.settings.minCount);
    $("min-count").addEventListener("change", async () => {
      const settings = Object.assign({}, store.settings, { minCount: Number($("min-count").value) });
      await save({ settings });
      await save({ rules: recomputeRules() });
      renderRules();
    });

    $("manual-add").addEventListener("click", async () => {
      const from = C.words($("manual-from").value).map((t) => t.norm).join(" ");
      const to = $("manual-to").value.trim();
      if (!from) return;

      const manualRules = store.manualRules.filter((rule) => rule.from !== from).concat([{ from, to }]);
      await save({ manualRules });
      $("manual-from").value = "";
      $("manual-to").value = "";
      renderRules();
    });

    $("try-input").addEventListener("input", renderTry);

    $("custom-corpus").value = store.customCorpus;
    $("corpus-save").addEventListener("click", async () => {
      await save({ customCorpus: $("custom-corpus").value });
      $("corpus-info").textContent = `Desat · ${corpus().length} frases en total.`;
    });

    $("vocab").value = store.vocab.join("\n");
    $("vocab-save").addEventListener("click", async () => {
      const vocab = $("vocab").value.split("\n").map((line) => line.trim()).filter(Boolean);
      await save({ vocab });
      renderStats();
    });

    for (const [id, key] of [["opt-apply", "applyCorrections"], ["opt-alts", "useAlternatives"], ["opt-auto", "autoAdvance"], ["opt-local", "preferLocal"]]) {
      $(id).checked = store.settings[key] !== false;
      $(id).addEventListener("change", async () => {
        const settings = Object.assign({}, store.settings);
        settings[key] = $(id).checked;
        await save({ settings });
      });
    }

    $("export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `dictat-catala-perfil-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });

    $("import-btn").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const patch = {};
        for (const key of Object.keys(DEFAULTS)) {
          if (data[key] !== undefined) patch[key] = data[key];
        }
        await save(patch);
        location.reload();
      } catch (error) {
        alert("No s'ha pogut llegir el fitxer: " + error.message);
      }
    });

    $("clear-rules").addEventListener("click", async () => {
      if (!confirm("Esborrar les regles apreses i les manuals? Les lectures es conserven.")) return;
      await save({ rules: [], manualRules: [] });
      renderRules();
    });

    $("clear-all").addEventListener("click", async () => {
      if (!confirm("Esborrar totes les lectures, regles i estadístiques?\n\nAtenció: el teu corpus, el vocabulari i les regles manuals estan sincronitzats, així que també desapareixeran de la resta d'ordinadors.")) return;
      await Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear()]);
      location.reload();
    });

    showTab("train");
  }

  init();
})();
