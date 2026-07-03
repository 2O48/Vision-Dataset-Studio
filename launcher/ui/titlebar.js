(function () {
  function internalsInvoke(command, args) {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      return Promise.reject(new Error("Tauri internals unavailable"));
    }
    return internals.invoke(command, args);
  }

  function currentWindowLabel() {
    return window.__TAURI_INTERNALS__ &&
      window.__TAURI_INTERNALS__.metadata &&
      window.__TAURI_INTERNALS__.metadata.currentWindow &&
      window.__TAURI_INTERNALS__.metadata.currentWindow.label;
  }

  function tauriInvoke(command, args) {
    const api = window.__TAURI__ && window.__TAURI__.core;
    if (!api || typeof api.invoke !== "function") return Promise.reject(new Error("Tauri invoke unavailable"));
    return api.invoke(command, args);
  }

  function launcherInvoke(command, args) {
    return tauriInvoke(command, args).catch(() => internalsInvoke(command, args));
  }

  function usesMacWindowChrome() {
    return /Mac/i.test(navigator.platform || "");
  }

  async function control(action) {
    const label = currentWindowLabel();
    try {
      await launcherInvoke(`launcher_${action}`);
      return;
    } catch (_) {}

    try {
      if (action === "minimize") await internalsInvoke("plugin:window|minimize", { label });
      if (action === "close") await internalsInvoke("plugin:window|close", { label });
      if (action === "drag") await internalsInvoke("plugin:window|start_dragging");
      if (action === "maximize") await internalsInvoke("plugin:window|internal_toggle_maximize");
      return;
    } catch (_) {}
  }

  function openTerminal() {
    launcherInvoke("launcher_open_terminal").catch((error) => {
      console.error("[launcher] failed to open terminal", error);
    });
  }

  function cssVar(style, name, fallback) {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  }

  function buildTerminalThemeCss() {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const isDark = root.dataset.theme === "dark";
    const bg = cssVar(style, "--bg", isDark ? "#24262b" : "#eeeeee");
    const text = cssVar(style, "--list-heading", isDark ? "#eef3f7" : "#424956");
    const muted = cssVar(style, "--list-muted", isDark ? "rgba(238, 243, 247, 0.62)" : "#6b7280");
    const line = cssVar(style, "--list-border", isDark ? "rgba(238, 243, 247, 0.12)" : "rgba(55, 56, 60, 0.12)");
    return `:root {
  color-scheme: ${isDark ? "dark" : "light"};
  --terminal-bg: ${bg};
  --terminal-text: ${text};
  --terminal-muted: ${muted};
  --terminal-line: ${line};
}`;
  }

  let themeSyncTimer = 0;
  function syncTerminalTheme() {
    window.clearTimeout(themeSyncTimer);
    themeSyncTimer = window.setTimeout(() => {
      launcherInvoke("launcher_set_terminal_theme", { css: buildTerminalThemeCss() }).catch(() => {});
    }, 50);
  }

  function installProjectRootSetting() {
    if (document.getElementById("launcherProjectRootSetting")) return;
    const card = document.querySelector("#captionSettingsShell > .card");
    if (!card) return;

    const divider = document.createElement("div");
    divider.className = "utility-section-divider";

    const section = document.createElement("section");
    section.className = "utility-inner-section launcher-project-root-setting";
    section.id = "launcherProjectRootSetting";
    section.innerHTML = `
      <div class="card-head compact-head">
        <div>
          <p class="card-kicker">Launcher Root</p>
          <h2>启动器项目路径</h2>
        </div>
        <p class="card-note">仅影响 Tauri 启动器下次启动时读取的 Vision Dataset Studio 根目录。</p>
      </div>
      <div class="form-grid">
        <label class="span-2">
          <span>项目根目录</span>
          <input id="launcherProjectRootInput" placeholder="包含 web_server.py、frontend 和 scripts 的目录">
        </label>
      </div>
      <div class="card-actions">
        <button class="button-primary" id="launcherProjectRootSaveBtn" type="button">保存启动器路径</button>
      </div>
      <p class="config-footnote" id="launcherProjectRootStatus">读取启动器路径中...</p>
    `;

    card.append(divider, section);

    const input = section.querySelector("#launcherProjectRootInput");
    const status = section.querySelector("#launcherProjectRootStatus");
    const saveBtn = section.querySelector("#launcherProjectRootSaveBtn");

    launcherInvoke("launcher_project_root")
      .then((path) => {
        input.value = path || "";
        status.textContent = path ? `当前启动器路径：${path}` : "尚未设置启动器项目路径。";
      })
      .catch(() => {
        status.textContent = "读取启动器路径失败。";
      });

    saveBtn.addEventListener("click", () => {
      const path = input.value.trim();
      launcherInvoke("launcher_set_project_root", { path })
        .then((savedPath) => {
          input.value = savedPath || path;
          status.textContent = `已保存启动器路径：${savedPath || path}`;
          launcherInvoke("launcher_log_status", { message: `已保存启动器路径：${savedPath || path}` }).catch(() => {});
        })
        .catch((error) => {
          status.textContent = error?.message || String(error || "保存启动器路径失败。");
        });
    });
  }

  const statusSelector = ".top-caption-progress, .top-caption-progress-status, .top-caption-progress-track, .top-caption-progress-bar";
  const interactiveSelector = "button, input, select, textarea, label, a, summary, [role='button'], [tabindex], #vds-launcher-window-controls";

  function install() {
    if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) return;
    if (document.documentElement.classList.contains("vds-tauri-launcher-ready")) return;
    if (!document.body) return;

    window.__VDS_TAURI_LAUNCHER__ = true;
    const macWindowChrome = usesMacWindowChrome();
    document.documentElement.classList.add("vds-tauri-launcher");

    const caption = document.querySelector(".command-caption");
    const commandTop = document.querySelector(".command-top");
    if (!caption || !commandTop) return;
    document.documentElement.classList.add("vds-tauri-launcher-ready");
    if (macWindowChrome) {
      document.documentElement.classList.add("vds-tauri-mac-chrome");
    }
    const runActions = document.querySelector(".command-run-actions");
    const progress = document.querySelector(".command-progress");

    syncTerminalTheme();
    installProjectRootSetting();
    new MutationObserver(syncTerminalTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-theme-mode", "data-wallpaper"],
    });
    window.addEventListener("storage", syncTerminalTheme);

    const terminalTarget = document.querySelector(".top-caption-progress");
    if (terminalTarget) {
      terminalTarget.title = terminalTarget.title || "打开终端";
      terminalTarget.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTerminal();
      }, true);
      terminalTarget.addEventListener("mousedown", (event) => {
        event.stopPropagation();
      }, true);
    }

    commandTop.setAttribute("data-tauri-drag-region", "");
    if (runActions) runActions.setAttribute("data-tauri-drag-region", "");
    caption.setAttribute("data-tauri-drag-region", "");
    if (progress) progress.removeAttribute("data-tauri-drag-region");

    const style = document.createElement("style");
    style.id = "vds-launcher-titlebar-style";
    style.textContent = `
	      html.vds-launcher-frameless .command-top {
	        -webkit-user-select: none;
	        user-select: none;
	      }
	      html.vds-tauri-mac-chrome {
	        background: transparent !important;
	      }
	      html.vds-tauri-mac-chrome body,
	      html.vds-tauri-mac-chrome .site-shell {
	        border-radius: 16px;
	      }
	      html.vds-tauri-mac-chrome body {
	        overflow: hidden;
	        clip-path: inset(0 round 16px);
	      }
	      html.vds-tauri-mac-chrome body::before,
	      html.vds-tauri-mac-chrome .backdrop {
	        border-radius: 16px;
	        clip-path: inset(0 round 16px);
	      }
	      html.vds-tauri-mac-chrome .site-shell {
	        overflow: clip;
	        min-height: 100vh;
	        clip-path: inset(0 round 16px);
	      }
	      html.vds-tauri-mac-chrome .command-top {
	        padding-left: 82px;
	      }
	      html.vds-launcher-frameless .command-top button,
	      html.vds-launcher-frameless .command-top select,
      html.vds-launcher-frameless .command-top input,
      html.vds-launcher-frameless .command-top textarea,
      html.vds-launcher-frameless .command-top label,
      html.vds-launcher-frameless .command-top [role="button"],
      html.vds-launcher-frameless .command-top [tabindex] {
        -webkit-user-select: auto;
        user-select: auto;
      }
	      #vds-launcher-window-controls {
	        display: grid;
	        grid-template-columns: repeat(3, 32px);
        height: 32px;
        margin-left: 2px;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
	        color: var(--list-muted);
	        flex: 0 0 auto;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls {
	        position: fixed;
	        z-index: 2147483647;
	        top: 16px;
	        left: 16px;
	        display: flex;
	        align-items: center;
	        gap: 8px;
	        width: auto;
	        height: 14px;
	        margin: 0;
	        color: transparent;
	        pointer-events: none;
	        visibility: hidden;
	      }
	      #vds-launcher-window-controls button {
        width: 32px;
        height: 32px;
        margin: 0;
        border: 0;
        border-radius: 999px;
        padding: 0;
        display: grid;
        place-items: center;
        background: transparent !important;
	        color: inherit;
	        font: inherit;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls button {
	        width: 12px;
	        height: 12px;
	        min-width: 12px;
	        border: 1px solid rgba(0, 0, 0, 0.16);
	        border-radius: 999px;
	        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
	        color: transparent;
	        position: relative;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls button[data-action="close"] {
	        order: 1;
	        background: #ff5f57 !important;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls button[data-action="minimize"] {
	        order: 2;
	        background: #febc2e !important;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls button[data-action="maximize"] {
	        order: 3;
	        background: #28c840 !important;
	      }
	      #vds-launcher-window-controls svg {
        width: 18px;
        height: 18px;
        display: block;
        fill: currentColor;
	        pointer-events: none;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls svg {
	        display: none;
	      }
	      #vds-launcher-window-controls button:hover {
        background: color-mix(in srgb, CanvasText 10%, transparent) !important;
        color: var(--list-heading);
      }
	      #vds-launcher-window-controls button[data-action="close"]:hover {
	        background: #d93025 !important;
	        color: #ffffff;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls button:hover {
	        filter: brightness(0.96);
	        color: transparent;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls:hover button::after {
	        position: absolute;
	        inset: 0;
	        display: grid;
	        place-items: center;
	        color: rgba(0, 0, 0, 0.58);
	        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
	        font-size: 9px;
	        font-weight: 800;
	        line-height: 1;
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls:hover button[data-action="close"]::after {
	        content: "x";
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls:hover button[data-action="minimize"]::after {
	        content: "-";
	        transform: translateY(-0.5px);
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls:hover button[data-action="maximize"]::after {
	        content: "+";
	      }
	      html.vds-tauri-mac-chrome #vds-launcher-window-controls button[data-action="close"]:hover {
	        background: #ff5f57 !important;
	      }
      #vds-launcher-top-drag-zone {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483646;
        height: 0;
        background: transparent;
        cursor: default;
      }
      html.vds-launcher-frameless .top-caption-progress,
      html.vds-launcher-frameless .top-caption-progress-status {
        cursor: pointer;
      }
      html.vds-launcher-frameless .command-top,
      html.vds-launcher-frameless .command-run-actions,
      html.vds-launcher-frameless .command-caption {
        cursor: default;
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("vds-launcher-frameless");

    const topDragZone = document.createElement("div");
    topDragZone.id = "vds-launcher-top-drag-zone";
    topDragZone.setAttribute("data-tauri-drag-region", "deep");
    document.body.prepend(topDragZone);

    const syncTopDragZone = () => {
      const top = Math.max(0, Math.floor(commandTop.getBoundingClientRect().top));
      topDragZone.style.height = `${top}px`;
    };
    syncTopDragZone();
    window.addEventListener("resize", syncTopDragZone, { passive: true });
    window.addEventListener("vds-layout-updated", syncTopDragZone, { passive: true });

    const controls = document.createElement("div");
    controls.id = "vds-launcher-window-controls";
    controls.innerHTML = `
      <button type="button" data-action="minimize" aria-label="最小化" title="最小化">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm40,112H88a8,8,0,0,1,0-16h80a8,8,0,0,1,0,16Z"/></svg>
      </button>
      <button type="button" data-action="maximize" aria-label="最大化/还原" title="最大化/还原">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><path d="M128,24A104,104,0,1,0,232,128,104.13,104.13,0,0,0,128,24Zm40,112H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32a8,8,0,0,1,0,16Z"/></svg>
      </button>
      <button type="button" data-action="close" aria-label="关闭" title="关闭">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>
      </button>
    `;
    if (macWindowChrome) {
      document.body.appendChild(controls);
    } else {
      caption.appendChild(controls);
    }

    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      control(button.getAttribute("data-action"));
    });

    topDragZone.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (event.detail === 2) control("maximize");
      else control("drag");
    });

    commandTop.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(statusSelector) || event.target.closest(interactiveSelector)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.detail === 2) control("maximize");
      else control("drag");
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
