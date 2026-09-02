(() => {
  "use strict";

  const STATE_KEY = "__chromeVoiceDictationState_v1__";
  const OVERLAY_ID = "__chrome_voice_dictation_overlay_v1__";
  const LANG = "ca-ES";

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // El service worker deixa aqui el diccionari apres abans d'injectar-nos.
  const Corrections = window.__dictatCorrections_v1__ || null;
  const profile = window.__dictatProfile_v1__ || { rules: [], vocab: [], settings: {} };
  const ruleIndex = Corrections ? Corrections.buildIndex(profile.rules) : null;
  const vocabIndex = Corrections ? Corrections.buildVocabIndex(profile.vocab) : null;
  const useAlternatives = profile.settings.useAlternatives !== false && !!vocabIndex && vocabIndex.size > 0;

  // Entre les alternatives que retorna Chrome, ens quedem la que conte mes
  // termes del teu vocabulari. En cas d'empat mana la primera, que es la que
  // el reconeixedor considera millor.
  function pickAlternative(result) {
    let best = result[0] ? result[0].transcript || "" : "";
    if (!useAlternatives || result.length < 2) return best;

    let bestScore = Corrections.scoreAgainstVocab(best, vocabIndex);
    for (let i = 1; i < result.length; i++) {
      const candidate = result[i] ? result[i].transcript || "" : "";
      if (!candidate) continue;
      const score = Corrections.scoreAgainstVocab(candidate, vocabIndex);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function correct(transcript) {
    if (!ruleIndex || ruleIndex.size === 0) return transcript;
    return Corrections.apply(transcript, ruleIndex);
  }

  function deepestActiveElement() {
    let element = document.activeElement;
    while (element && element.shadowRoot && element.shadowRoot.activeElement) {
      element = element.shadowRoot.activeElement;
    }
    return element;
  }

  function isTextInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const allowed = new Set([
      "text", "search", "email", "url", "tel", "password", "number"
    ]);
    return allowed.has((element.type || "text").toLowerCase());
  }

  function isEditable(element) {
    if (!element) return false;
    return element instanceof HTMLTextAreaElement ||
      isTextInput(element) ||
      element.isContentEditable;
  }

  function createOverlay() {
    let host = document.getElementById(OVERLAY_ID);
    if (host) return host;

    host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.position = "fixed";
    host.style.right = "18px";
    host.style.bottom = "18px";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .box {
          all: initial;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 9px;
          max-width: 420px;
          padding: 10px 14px;
          border-radius: 12px;
          background: rgba(28, 28, 30, 0.94);
          color: white;
          box-shadow: 0 5px 24px rgba(0,0,0,.28);
          font: 500 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: normal;
        }
        .dot {
          width: 9px;
          height: 9px;
          flex: 0 0 9px;
          border-radius: 999px;
          background: #ff453a;
          box-shadow: 0 0 0 4px rgba(255,69,58,.18);
        }
        .error .dot { background: #ffd60a; box-shadow: none; }
        .ok .dot { background: #30d158; box-shadow: none; }
      </style>
      <div class="box"><span class="dot"></span><span class="text">Dictando...</span></div>
    `;

    (document.documentElement || document.body).appendChild(host);
    return host;
  }

  function showOverlay(message, kind = "listening", autoHideMs = 0) {
    const host = createOverlay();
    const shadow = host.shadowRoot;
    const box = shadow.querySelector(".box");
    const text = shadow.querySelector(".text");

    box.className = `box ${kind === "error" ? "error" : kind === "ok" ? "ok" : ""}`;
    text.textContent = message;
    host.style.display = "block";

    if (autoHideMs > 0) {
      clearTimeout(host.__hideTimer);
      host.__hideTimer = setTimeout(() => {
        host.style.display = "none";
      }, autoHideMs);
    }
  }

  function hideOverlay() {
    const host = document.getElementById(OVERLAY_ID);
    if (host) host.style.display = "none";
  }

  function captureSelection(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return {
        type: "input",
        start: target.selectionStart ?? target.value.length,
        end: target.selectionEnd ?? target.value.length
      };
    }

    if (target.isContentEditable) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (target.contains(range.commonAncestorContainer) || target === range.commonAncestorContainer) {
          return { type: "range", range: range.cloneRange() };
        }
      }

      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      return { type: "range", range };
    }

    return null;
  }

  function dispatchInput(target, text) {
    try {
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text
      }));
    } catch (_) {
      target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
  }

  function insertIntoInput(target, state, text) {
    target.focus();

    const start = state.selection?.start ?? target.selectionStart ?? target.value.length;
    const end = state.selection?.end ?? target.selectionEnd ?? start;

    target.setRangeText(text, start, end, "end");
    const newPos = start + text.length;
    state.selection = { type: "input", start: newPos, end: newPos };

    dispatchInput(target, text);
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertIntoContentEditable(target, state, text) {
    target.focus();

    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    if (state.selection?.type === "range" && state.selection.range) {
      selection.addRange(state.selection.range);
    } else {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.addRange(range);
    }

    let inserted = false;
    try {
      // Aunque execCommand esta obsoleto, sigue siendo la via mas compatible
      // con editores contenteditable complejos (incluido WhatsApp Web), porque
      // respeta el cursor y genera los eventos de edicion que esperan estas apps.
      inserted = document.execCommand("insertText", false, text);
    } catch (_) {
      inserted = false;
    }

    if (!inserted) {
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        dispatchInput(target, text);
      }
    }

    if (selection.rangeCount > 0) {
      state.selection = { type: "range", range: selection.getRangeAt(0).cloneRange() };
    }
  }

  function needsLeadingSpace(target, state, transcript) {
    if (!transcript || /^\s|^[,.;:!?)]/.test(transcript)) return false;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const pos = state.selection?.start ?? target.selectionStart ?? target.value.length;
      if (pos <= 0) return false;
      const previous = target.value.charAt(pos - 1);
      return previous !== "" && !/\s|[(\[{¿¡]/.test(previous);
    }

    if (target.isContentEditable && state.selection?.type === "range") {
      const range = state.selection.range.cloneRange();
      try {
        range.setStart(target, 0);
        const before = range.toString();
        if (!before) return false;
        return !/\s|[(\[{¿¡]$/.test(before);
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  function insertText(state, rawTranscript) {
    const target = state.target;
    if (!target || !target.isConnected) {
      state.shouldContinue = false;
      showOverlay("El campo de texto ya no esta disponible.", "error", 3000);
      try { state.recognition.abort(); } catch (_) {}
      return;
    }

    let text = rawTranscript.trim();
    if (!text) return;

    if (needsLeadingSpace(target, state, text)) text = " " + text;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      insertIntoInput(target, state, text);
    } else if (target.isContentEditable) {
      insertIntoContentEditable(target, state, text);
    }
  }

  function stopDictation(state, message = "Dictado detenido") {
    state.shouldContinue = false;
    state.listening = false;
    try { state.recognition.stop(); } catch (_) {}
    showOverlay(message, "ok", 1300);
  }

  if (!SpeechRecognition) {
    showOverlay("Chrome no expone SpeechRecognition en esta pagina.", "error", 4000);
    return;
  }

  const existing = window[STATE_KEY];
  if (existing && existing.shouldContinue) {
    stopDictation(existing);
    return;
  }

  const target = deepestActiveElement();
  if (!isEditable(target)) {
    showOverlay("Pon el cursor en un campo de texto y vuelve a pulsar Ctrl+Space.", "error", 4000);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = LANG;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = useAlternatives ? 5 : 1;

  // processLocally se deja en false/valor por defecto a proposito. Asi Chrome
  // puede utilizar su servicio de reconocimiento remoto cuando corresponda.
  if ("processLocally" in recognition) {
    recognition.processLocally = false;
  }

  const state = {
    recognition,
    target,
    selection: captureSelection(target),
    shouldContinue: true,
    listening: false,
    restarting: false
  };
  window[STATE_KEY] = state;

  recognition.onstart = () => {
    state.listening = true;
    state.restarting = false;
    showOverlay("Dictant en catala...  Ctrl+Space per aturar");
  };

  recognition.onaudiostart = () => {
    showOverlay("Escuchando...  Ctrl+Space para detener");
  };

  recognition.onresult = (event) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        insertText(state, correct(pickAlternative(result)));
      } else {
        interim += result[0]?.transcript || "";
      }
    }

    if (interim.trim()) {
      showOverlay(`Oyendo: ${interim.trim()}`);
    } else if (state.shouldContinue) {
      showOverlay("Dictant en catala...  Ctrl+Space per aturar");
    }
  };

  recognition.onerror = (event) => {
    const error = event.error || "desconocido";

    if (error === "not-allowed" || error === "service-not-allowed") {
      state.shouldContinue = false;
      showOverlay(
        "Microfono bloqueado. Permite el microfono para este sitio en Chrome y vuelve a intentarlo.",
        "error",
        6000
      );
      return;
    }

    if (error === "audio-capture") {
      state.shouldContinue = false;
      showOverlay("No se encuentra un microfono disponible.", "error", 5000);
      return;
    }

    if (error === "network") {
      showOverlay("Error de red del servicio de reconocimiento. Reintentando...", "error");
      return;
    }

    if (error !== "no-speech" && error !== "aborted") {
      showOverlay(`Error de dictado: ${error}`, "error", 3500);
    }
  };

  recognition.onend = () => {
    state.listening = false;

    if (!state.shouldContinue) {
      setTimeout(hideOverlay, 1400);
      return;
    }

    // Chrome puede cerrar una sesion de reconocimiento tras un periodo de
    // silencio. La reiniciamos mientras el usuario no haya detenido el dictado.
    if (!state.restarting) {
      state.restarting = true;
      setTimeout(() => {
        if (!state.shouldContinue) return;
        try {
          recognition.start();
        } catch (_) {
          state.restarting = false;
          showOverlay("No se pudo reiniciar el dictado. Pulsa Ctrl+Space otra vez.", "error", 4000);
          state.shouldContinue = false;
        }
      }, 250);
    }
  };

  try {
    recognition.start();
    showOverlay("Solicitando acceso al microfono...");
  } catch (error) {
    state.shouldContinue = false;
    showOverlay(`No se pudo iniciar el dictado: ${error.message || error}`, "error", 5000);
  }
})();
