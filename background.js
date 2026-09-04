const DEFAULT_SETTINGS = { useAlternatives: true, applyCorrections: true };

// Llegeix el diccionari apres i el deixa a punt per injectar-lo. El service
// worker es l'unic que pot tocar chrome.storage: dictation.js viu al mon MAIN
// de la pagina i alli les APIs de chrome no hi arriben.
async function loadProfile() {
  // Les regles apreses surten de les lectures d'aquest ordinador (local);
  // les manuals, el vocabulari i els ajustos els escrius tu i et segueixen
  // a tots els ordinadors (sync).
  const [local, synced] = await Promise.all([
    chrome.storage.local.get(["rules"]),
    chrome.storage.sync.get(["manualRules", "vocab", "settings"])
  ]);
  const stored = Object.assign({}, local, synced);
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});

  const derived = (stored.rules || []).filter((rule) => rule && !rule.disabled);
  const manual = stored.manualRules || [];
  // Les manuals van despres perque, si xoquen amb una d'apresa, guanyin elles.
  const rules = settings.applyCorrections ? derived.concat(manual) : [];

  const vocab = (stored.vocab || []).concat(
    derived.concat(manual).map((rule) => rule.to).filter(Boolean)
  );

  return { rules, vocab, settings };
}

async function runDictation(tab) {
  if (!tab || !tab.id) return;

  try {
    const profile = await loadProfile();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["corrections.js"],
      world: "MAIN"
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (data) => { window.__dictatProfile_v1__ = data; },
      args: [profile]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dictation.js"],
      world: "MAIN"
    });
  } catch (error) {
    console.error("No se pudo activar el dictado en esta pagina:", error);
    try {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b3261e" });
      setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }), 2500);
    } catch (_) {
      // Nada que hacer si ni siquiera podemos modificar el badge.
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  runDictation(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-training") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (command !== "toggle-dictation") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  runDictation(tab);
});
