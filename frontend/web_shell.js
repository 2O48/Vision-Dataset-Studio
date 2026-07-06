export function createShellModule({
  state,
  refs,
  UTILITY_PANEL_LABELS,
  STORAGE_KEYS,
  saveStored,
  readStored,
  getLocalCaptionPayload,
  getApiCaptionPayload,
  getOllamaCaptionPayload,
}) {
  let lastTerminalStatusLine = "";
  let sidePanelAnimationTimer = 0;
  let panelVisualObserver = null;
  let panelVisualRaf = 0;

  function launcherInvoke(command, args) {
    const api = window.__TAURI__?.core;
    if (api && typeof api.invoke === "function") {
      return api.invoke(command, args);
    }
    const internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === "function") {
      return internals.invoke(command, args);
    }
    return Promise.reject(new Error("Tauri invoke unavailable"));
  }

  function logStatusToBackendTerminal(message) {
    return fetch("/api/status/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      keepalive: true,
    });
  }

  function logStatusToTerminal(message) {
    const line = String(message || "待命").trim() || "待命";
    if (line === lastTerminalStatusLine) return;
    lastTerminalStatusLine = line;
    logStatusToBackendTerminal(line).catch(() => {
      launcherInvoke("launcher_log_status", { message: line }).catch(() => {});
    });
  }

  function utilityPanelExists(panel) {
    return refs.utilityPageShell?.querySelector(`.utility-panel[data-panel="${panel}"]`);
  }

  function syncPanelVisualClasses() {
    const sidePanels = [
      refs.utilityPageShell?.querySelectorAll(".utility-panel>.card"),
      refs.captionSettingsShell ? [refs.captionSettingsShell.querySelector(":scope>.card")].filter(Boolean) : [],
    ].filter(Boolean);
    sidePanels.forEach((group) => {
      group.forEach((node) => {
        node.classList.add("panel-visual", "panel-visual-side");
        ensurePanelScrollContent(node);
      });
    });

    document.querySelectorAll(".list-card, .viewer-card, .edit-card, .global-tags-card").forEach((node) => {
      node.classList.add("panel-visual", "panel-visual-center");
    });

    refs.workbenchShell?.classList.add("panel-visual-ready");
  }

  function ensurePanelScrollContent(card) {
    if (!card || card.querySelector(":scope>.panel-scroll-content")) return;
    const scroller = document.createElement("div");
    scroller.className = "panel-scroll-content";
    Array.from(card.childNodes).forEach((child) => {
      if (child.classList?.contains("floating-scrollbar-rail")) return;
      scroller.appendChild(child);
    });
    card.appendChild(scroller);
  }

  function ensurePanelVisualObserver() {
    if (panelVisualObserver || !document.body) return;
    syncPanelVisualClasses();
    const schedulePanelVisualSync = () => {
      if (panelVisualRaf) return;
      panelVisualRaf = window.requestAnimationFrame(() => {
        panelVisualRaf = 0;
        syncPanelVisualClasses();
      });
    };
    panelVisualObserver = new MutationObserver(schedulePanelVisualSync);
    panelVisualObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", schedulePanelVisualSync, { passive: true });
  }

  function markSidePanelAnimating(nextState = {}) {
    const shell = refs.workbenchShell;
    if (!shell) return;
    const willOpenUtility = Boolean(nextState.utilityOpen);
    const willOpenCaption = Boolean(nextState.captionSettingsOpen);
    shell.classList.toggle("side-panel-opening", willOpenUtility || willOpenCaption);
    shell.classList.toggle("side-panel-closing", !willOpenUtility && !willOpenCaption);
    shell.classList.add("side-panel-animating");
    window.clearTimeout(sidePanelAnimationTimer);
    sidePanelAnimationTimer = window.setTimeout(() => {
      shell.classList.remove("side-panel-animating");
      shell.classList.remove("side-panel-opening", "side-panel-closing");
    }, 620);
  }

  function syncCaptionSettingsPanel() {
    const shell = refs.workbenchShell;
    if (!shell) return;
    refs.captionSettingsShell?.setAttribute("aria-hidden", state.captionSettingsOpen ? "false" : "true");
    shell.classList.toggle("caption-settings-open", state.captionSettingsOpen);
    shell.classList.toggle("caption-settings-resizer-hidden", !state.captionSettingsOpen);
  }

  function renderUtilityPanelState() {
    ensurePanelVisualObserver();
    markSidePanelAnimating({
      utilityOpen: state.utilityOpen,
      captionSettingsOpen: state.captionSettingsOpen,
    });
    const panel = utilityPanelExists(state.utilityPanel) ? state.utilityPanel : "workspace";
    state.utilityPanel = panel;
    refs.utilityPageShell?.setAttribute("aria-hidden", state.utilityOpen ? "false" : "true");
    refs.workbenchShell?.classList.toggle("utility-open", state.utilityOpen);
    syncCaptionSettingsPanel();
    refs.utilityActions?.querySelectorAll("button[data-panel]").forEach((button) => {
      const isCurrent = button.dataset.panel === panel;
      button.classList.toggle("active", state.utilityOpen && isCurrent);
      button.setAttribute("aria-expanded", String(state.utilityOpen && isCurrent));
    });
    refs.utilityPageShell?.querySelectorAll(".utility-panel").forEach((node) => {
      node.classList.toggle("active", node.dataset.panel === panel);
    });
    refs.openCaptionSettingsBtn?.classList.toggle("active", state.captionSettingsOpen);
    refs.openCaptionSettingsBtn?.setAttribute("aria-pressed", String(state.captionSettingsOpen));
    syncPanelVisualClasses();
  }

  function setUtilityPanel(panel, { open = true, persist = true } = {}) {
    state.utilityPanel = utilityPanelExists(panel) ? panel : "workspace";
    state.utilityOpen = Boolean(open);
    renderUtilityPanelState();
    if (state.utilityOpen && refs.utilityPageShell) {
      refs.utilityPageShell.scrollTop = 0;
    }
    if (persist) saveStored(STORAGE_KEYS.utilityPanel, state.utilityPanel);
  }

  function closeUtilityPanel() {
    state.utilityOpen = false;
    renderUtilityPanelState();
  }

  function toggleCaptionSettingsPanel(forceOpen = null) {
    const nextOpen = forceOpen === null ? !state.captionSettingsOpen : Boolean(forceOpen);
    state.captionSettingsOpen = nextOpen;
    renderUtilityPanelState();
  }

  function setAiStatusLine(message) {
    const line = message || "待命";
    if (refs.aiStatusLine) refs.aiStatusLine.textContent = line;
    if (refs.topAiProgressText) {
      refs.topAiProgressText.textContent = line;
    }
    logStatusToTerminal(line);
  }

  async function runWithStatus(message, task) {
    setAiStatusLine(message);
    return await task();
  }

  function activeCaptionBackend() {
    return refs.captionBackend?.value || readStored(STORAGE_KEYS.captionBackend, "local");
  }

  function activeCaptionBackendLabel() {
    return {
      local: "本地 Qwen",
      api: "OpenAI 兼容 API",
      ollama: "Ollama",
    }[activeCaptionBackend()] || "本地 Qwen";
  }

  function activeCaptionPayload() {
    const backend = activeCaptionBackend();
    if (backend === "api") return getApiCaptionPayload();
    if (backend === "ollama") return getOllamaCaptionPayload();
    return getLocalCaptionPayload();
  }

  return {
    renderUtilityPanelState,
    setUtilityPanel,
    closeUtilityPanel,
    toggleCaptionSettingsPanel,
    setAiStatusLine,
    runWithStatus,
    activeCaptionBackend,
    activeCaptionBackendLabel,
    activeCaptionPayload,
  };
}
