export function createBootstrapModule({
  state,
  refs,
  STORAGE_KEYS,
  DEFAULT_OLLAMA_URL,
  readStored,
  readQuickTags,
  saveStored,
  restoreSelectValue,
  apiGet,
  runWithStatus,
  showError,
  setUtilityPanel,
  toggleCaptionSettingsPanel,
  setAiStatusLine,
  activeCaptionBackendLabel,
  activeCaptionPayload,
  closeUtilityPanel,
  openApiModelMenu,
  closeApiModelMenu,
  renderApiModelSuggestions,
  openOllamaModelMenu,
  closeOllamaModelMenu,
  renderOllamaSuggestions,
  renderProjects,
  applyProjectUiState,
  renderViewer,
  renderTags,
  updateCaptionSearchHighlight,
  renderQuickTags,
  renderGlobalTags,
  renderFilters,
  renderWorkspaceSummary,
  renderAiStatus,
  renderOverwriteModeHints,
  renderWorkspaceBrowser,
  updateControlFieldVisibility,
  scrollSelectedItemIntoView,
  renderLocateSelectedState,
  browseWorkspacePath,
  applyWorkspaceBrowserPath,
  setWorkspaceBrowserTarget,
  applyWorkspaceSummary,
  refreshItems,
  selectItem,
  selectRelativeItem,
  trashCurrentItem,
  shouldIgnoreListArrowNavigation,
  loadWorkspace,
  openProject,
  rescanWorkspace,
  saveCurrentProject,
  createProject,
  refreshProjects,
  cleanupTmpNow,
  scheduleCaptionAutosave,
  translateCurrent,
  batchAdd,
  batchDelete,
  batchReplace,
  batchRename,
  swapControlResultPairs,
  deleteCurrent,
  mergeWorkspace,
  scaleViewerItem,
  matchViewerControlsToResult,
  processImages,
  processMatchResultSizes,
  exportDataset,
  installDeps,
  loadModel,
  validateLocalModel,
  captionCurrentWithPayload,
  startBatchCaptionWithPayload,
  stopBatchCaption,
  loadApiModels,
  validateApiModel,
  loadOllamaModels,
  validateOllamaModel,
  nextAiPollDelay,
  scheduleNextAiPoll,
  pollAiStatus,
  loadAiOptions,
  loadPromptTemplates,
  savePromptTemplateFor,
  deletePromptTemplate,
  templateById,
  appendSegmentsToCaption,
  toggleQuickTags,
  setCaptionEditorText,
  normalizeCaptionText,
  normalizeCaptionInputText,
  syncSegmentsFromText,
  syncCaptionDirty,
  restoreCaptionSettings,
}) {
  const appContextState = {
    target: null,
    editable: false,
    closeTimer: 0,
  };

  function closeAppContextMenu() {
    const menu = refs.appContextMenu;
    if (!menu || menu.hidden) return;
    if (appContextState.closeTimer) {
      window.clearTimeout(appContextState.closeTimer);
      appContextState.closeTimer = 0;
    }
    menu.classList.remove("menu-open");
    menu.classList.add("menu-closing");
    appContextState.closeTimer = window.setTimeout(() => {
      appContextState.closeTimer = 0;
      menu.hidden = true;
      menu.classList.remove("menu-closing");
    }, 180);
  }

  function positionAppContextMenu(event) {
    const menu = refs.appContextMenu;
    if (!menu) return;
    if (appContextState.closeTimer) {
      window.clearTimeout(appContextState.closeTimer);
      appContextState.closeTimer = 0;
    }
    menu.classList.remove("menu-open", "menu-closing");
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    const padding = 8;
    const left = Math.min(event.clientX, Math.max(padding, window.innerWidth - rect.width - padding));
    const top = Math.min(event.clientY, Math.max(padding, window.innerHeight - rect.height - padding));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    requestAnimationFrame(() => {
      menu.classList.add("menu-open");
    });
  }

  function isEditableContextTarget(target) {
    if (!(target instanceof Element)) return false;
    const editable = target.closest("textarea, input, [contenteditable='true'], [contenteditable='plaintext-only']");
    return Boolean(editable);
  }

  function resolveEditableTarget(target) {
    if (!(target instanceof Element)) return null;
    return target.closest("textarea, input, [contenteditable='true'], [contenteditable='plaintext-only']");
  }

  function shouldBypassAppContextMenu(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest("#itemContextMenu, .item-card, .folder-filter-chip")
    );
  }

  function isInputReadOnly(target) {
    if (!target) return true;
    if ("disabled" in target && target.disabled) return true;
    if ("readOnly" in target && target.readOnly) return true;
    if (target.getAttribute?.("contenteditable") && target.getAttribute("contenteditable") !== "false") return false;
    return false;
  }

  function textSelectionLength(target) {
    if (!target) return 0;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = typeof target.selectionStart === "number" ? target.selectionStart : 0;
      const end = typeof target.selectionEnd === "number" ? target.selectionEnd : 0;
      return Math.max(0, end - start);
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return 0;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return 0;
    return selection.toString().length;
  }

  function editableTextLength(target) {
    if (!target) return 0;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value?.length || 0;
    }
    return target.textContent?.length || 0;
  }

  function focusEditableTarget(target) {
    if (!target?.focus) return;
    target.focus({ preventScroll: true });
  }

  function configureAppContextMenu(target) {
    const menu = refs.appContextMenu;
    if (!menu) return;
    const editableTarget = resolveEditableTarget(target);
    const editable = Boolean(editableTarget);
    appContextState.target = editableTarget || (target instanceof Element ? target : null);
    appContextState.editable = editable;
    const selectionLength = editable ? textSelectionLength(editableTarget) : 0;
    const textLength = editable ? editableTextLength(editableTarget) : 0;
    const readOnly = editable ? isInputReadOnly(editableTarget) : true;

    menu.querySelectorAll("button[data-action]").forEach((button) => {
      const action = button.dataset.action;
      const show =
        editable
          ? action === "cut" || action === "copy" || action === "paste" || action === "select-all"
          : action === "refresh";
      button.hidden = !show;
      if (!show) return;
      if (action === "refresh") {
        button.disabled = false;
        return;
      }
      if (action === "cut") {
        button.disabled = readOnly || selectionLength <= 0;
        return;
      }
      if (action === "copy") {
        button.disabled = selectionLength <= 0;
        return;
      }
      if (action === "paste") {
        button.disabled = readOnly || !navigator.clipboard?.readText;
        return;
      }
      if (action === "select-all") {
        button.disabled = textLength <= 0;
      }
    });
  }

  async function runAppContextAction(action) {
    const target = appContextState.target;
    if (action === "refresh") {
      window.location.reload();
      return;
    }
    if (!appContextState.editable || !target) return;
    focusEditableTarget(target);

    if (action === "select-all") {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.select();
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return;
    }

    if (action === "copy" || action === "cut") {
      let handled = false;
      try {
        handled = document.execCommand(action);
      } catch {
        handled = false;
      }

      if (!handled && navigator.clipboard?.writeText) {
        let selectedText = "";
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const start = target.selectionStart ?? 0;
          const end = target.selectionEnd ?? 0;
          selectedText = target.value.slice(start, end);
        } else {
          selectedText = window.getSelection()?.toString() || "";
        }
        if (selectedText) {
          await navigator.clipboard.writeText(selectedText);
          handled = true;
          if (action === "cut" && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !isInputReadOnly(target)) {
            const start = target.selectionStart ?? 0;
            const end = target.selectionEnd ?? 0;
            const nextValue = `${target.value.slice(0, start)}${target.value.slice(end)}`;
            target.value = nextValue;
            target.setSelectionRange(start, start);
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }

      if (!handled) showError("当前环境不支持该右键操作。");
      return;
    }

    if (action === "paste") {
      if (!navigator.clipboard?.readText) {
        showError("当前环境不支持粘贴。");
        return;
      }
      try {
        const text = await navigator.clipboard.readText();
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? target.value.length;
          target.setRangeText(text, start, end, "end");
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          const inserted = document.execCommand("insertText", false, text);
          if (!inserted) {
            const selection = window.getSelection();
            if (selection?.rangeCount) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(text));
              range.collapse(false);
            }
          }
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (error) {
        showError(error?.message || "粘贴失败。");
      }
    }
  }

  function bindAppContextMenu() {
    const menu = refs.appContextMenu;
    if (!menu || menu.dataset.bound === "true") return;
    menu.dataset.bound = "true";

    menu.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;
      const { action } = button.dataset;
      closeAppContextMenu();
      await runAppContextAction(action);
    });

    document.addEventListener(
      "contextmenu",
      (event) => {
        if (event.target instanceof Element && event.target.closest("#appContextMenu")) {
          event.preventDefault();
          return;
        }
        if (shouldBypassAppContextMenu(event.target)) {
          closeAppContextMenu();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        configureAppContextMenu(event.target);
        positionAppContextMenu(event);
      },
      true
    );

    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest("#appContextMenu")) return;
      closeAppContextMenu();
    });
    document.addEventListener("scroll", closeAppContextMenu, true);
    window.addEventListener("resize", closeAppContextMenu);
    window.addEventListener("blur", closeAppContextMenu);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAppContextMenu();
    });
  }

  function enhanceTextareaResizers() {
    const textareas = Array.from(document.querySelectorAll("textarea"));

    const createHandle = (host, textarea) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "textarea-resize-handle";
      handle.tabIndex = -1;
      handle.setAttribute("aria-hidden", "true");

      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const computed = getComputedStyle(textarea);
        const minHeight = parseFloat(computed.minHeight) || textarea.getBoundingClientRect().height || 100;
        const startHeight = textarea.getBoundingClientRect().height;
        const startY = event.clientY;
        const hostComputed = getComputedStyle(host);
        const hostBorder =
          (parseFloat(hostComputed.borderTopWidth) || 0) +
          (parseFloat(hostComputed.borderBottomWidth) || 0);

        textarea.focus({ preventScroll: true });
        handle.setPointerCapture?.(event.pointerId);

        const applyHeight = (nextHeight) => {
          const resolvedHeight = Math.max(minHeight, Math.round(nextHeight));
          textarea.style.height = `${resolvedHeight}px`;
          if (host.classList.contains("caption-editor-wrap")) {
            host.style.height = `${resolvedHeight + hostBorder}px`;
          }
        };

        const onMove = (moveEvent) => {
          applyHeight(startHeight + (moveEvent.clientY - startY));
        };

        const onUp = (upEvent) => {
          handle.releasePointerCapture?.(upEvent.pointerId);
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });

      host.appendChild(handle);
    };

    textareas.forEach((textarea) => {
      if (!textarea || textarea.dataset.resizeEnhanced === "true") return;
      textarea.dataset.resizeEnhanced = "true";

      let host = textarea.closest(".caption-editor-wrap");
      if (host && host.contains(textarea)) {
        host.classList.add("multiline-resize-host");
      } else if (textarea.parentElement?.classList.contains("textarea-resize-shell")) {
        host = textarea.parentElement;
        host.classList.add("multiline-resize-host");
      } else {
        host = document.createElement("div");
        host.className = "textarea-resize-shell multiline-resize-host";
        textarea.parentNode?.insertBefore(host, textarea);
        host.appendChild(textarea);
      }

      if (!Array.from(host.children).some((child) => child.classList?.contains("textarea-resize-handle"))) {
        createHandle(host, textarea);
      }
    });
  }

  function enhanceFloatingScrollbars() {
    const sidePanelScrollerSelector = [
      ".utility-page-shell .utility-panel>.card>.panel-scroll-content",
      ".caption-settings-shell>.card>.panel-scroll-content",
    ].join(", ");
    const selector = [
      ".utility-page-shell .utility-panel>.card>.panel-scroll-content",
      ".caption-settings-shell>.card>.panel-scroll-content",
      ".bottom-status-bar",
      ".edit-card-body",
      ".item-list",
      ".item-thumb-grid",
      ".global-tag-list",
      ".folder-browser-list",
      ".custom-select-menu",
      ".model-picker-menu",
      ".model-picker-list",
      ".project-grid",
      ".workspace-browser-list",
      ".image-preview-controls",
    ].join(", ");
    const hosts = new Set();
    let rafId = 0;
    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => schedule()) : null;

    const setActive = (el, active) => {
      if (!el?.__floatingScrollbar) return;
      const { rails } = el.__floatingScrollbar;
      const value = active ? "true" : "false";
      el.dataset.fsbActive = value;
      rails.vertical.dataset.fsbActive = value;
      rails.horizontal.dataset.fsbActive = value;
    };

    const resolveActive = (el, canScrollY, canScrollX) => {
      if (!canScrollY && !canScrollX) return false;
      return Boolean(el.__floatingScrollbar?.dragging || el.__floatingScrollbar?.hovering || el.matches(":hover") || document.activeElement && el.contains(document.activeElement));
    };

    const shouldSuppressHost = (el) => {
      if (!el) return true;
      if (el.closest(".utility-page-shell")?.getAttribute("aria-hidden") === "true") return true;
      if (el.closest(".caption-settings-shell") && !document.querySelector("#workbenchShell")?.classList.contains("caption-settings-open")) return true;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return true;
      const computed = getComputedStyle(el);
      return computed.display === "none" || computed.visibility === "hidden";
    };

    const updateThumbs = (el) => {
      if (!el?.__floatingScrollbar) return;
      const { thumbs, metrics } = el.__floatingScrollbar;
      if (metrics?.vertical) {
        const { maxTop, scrollRange } = metrics.vertical;
        const top = scrollRange <= 0 ? 0 : Math.round(maxTop * el.scrollTop / scrollRange);
        thumbs.vertical.style.transform = `translate3d(0, ${top}px, 0)`;
      }
      if (metrics?.horizontal) {
        const { maxLeft, scrollRange } = metrics.horizontal;
        const left = scrollRange <= 0 ? 0 : Math.round(maxLeft * el.scrollLeft / scrollRange);
        thumbs.horizontal.style.transform = `translate3d(${left}px, 0, 0)`;
      }
    };

    const beginThumbDrag = (el, event) => {
      const thumb = event.target.closest(".floating-scrollbar-thumb");
      if (!thumb || !el.__floatingScrollbar) return;
      const orientation = thumb.parentElement?.dataset.orientation;
      const metrics = el.__floatingScrollbar.metrics?.[orientation];
      if (!orientation || !metrics) return;
      event.preventDefault();
      event.stopPropagation();
      const startPointer = orientation === "vertical" ? event.clientY : event.clientX;
      const startScroll = orientation === "vertical" ? el.scrollTop : el.scrollLeft;
      const scrollRange = Math.max(1, metrics.scrollRange);
      const dragRange = Math.max(1, orientation === "vertical" ? metrics.maxTop : metrics.maxLeft);

      el.__floatingScrollbar.dragging = true;
      setActive(el, true);
      thumb.setPointerCapture?.(event.pointerId);
      const onMove = (moveEvent) => {
        const currentPointer = orientation === "vertical" ? moveEvent.clientY : moveEvent.clientX;
        const delta = currentPointer - startPointer;
        const nextScroll = startScroll + (delta / dragRange) * scrollRange;
        if (orientation === "vertical") {
          el.scrollTop = nextScroll;
        } else {
          el.scrollLeft = nextScroll;
        }
        updateThumbs(el);
      };
      const onUp = (upEvent) => {
        el.__floatingScrollbar.dragging = false;
        thumb.releasePointerCapture?.(upEvent.pointerId);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        schedule();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

    const ensureHost = (el) => {
      if (!el) return el;
      el.classList.add("floating-scrollbar-host");
      if (hosts.has(el) && el.__floatingScrollbar?.rails?.vertical?.isConnected && el.__floatingScrollbar?.rails?.horizontal?.isConnected) return el;
      hosts.add(el);
      const rails = {
        vertical: document.createElement("div"),
        horizontal: document.createElement("div"),
      };
      rails.vertical.className = "floating-scrollbar-rail";
      rails.vertical.dataset.orientation = "vertical";
      rails.horizontal.className = "floating-scrollbar-rail";
      rails.horizontal.dataset.orientation = "horizontal";
      const thumbs = {
        vertical: document.createElement("div"),
        horizontal: document.createElement("div"),
      };
      thumbs.vertical.className = "floating-scrollbar-thumb";
      thumbs.horizontal.className = "floating-scrollbar-thumb";
      rails.vertical.appendChild(thumbs.vertical);
      rails.horizontal.appendChild(thumbs.horizontal);
      rails.vertical.setAttribute("aria-hidden", "true");
      rails.horizontal.setAttribute("aria-hidden", "true");
      thumbs.vertical.addEventListener("pointerdown", (event) => beginThumbDrag(el, event));
      thumbs.horizontal.addEventListener("pointerdown", (event) => beginThumbDrag(el, event));
      const keepActive = () => {
        el.__floatingScrollbar.hovering = true;
        setActive(el, true);
      };
      const releaseActive = () => {
        el.__floatingScrollbar.hovering = false;
        setActive(el, resolveActive(el, el.dataset.fsbVertical === "true", el.dataset.fsbHorizontal === "true"));
      };
      [rails.vertical, rails.horizontal, thumbs.vertical, thumbs.horizontal].forEach((node) => {
        node.addEventListener("pointerenter", keepActive, { passive: true });
        node.addEventListener("pointerleave", releaseActive, { passive: true });
      });
      document.body.append(rails.vertical, rails.horizontal);
      el.__floatingScrollbar = { rails, thumbs, metrics: {} };
      return el;
    };

    const syncHost = (el) => {
      if (!el || !el.__floatingScrollbar) return;
      if (!el.isConnected) {
        el.__floatingScrollbar.rails.vertical.remove();
        el.__floatingScrollbar.rails.horizontal.remove();
        hosts.delete(el);
        return;
      }
      const { rails, thumbs } = el.__floatingScrollbar;
      if (shouldSuppressHost(el)) {
        el.dataset.fsbVertical = "false";
        el.dataset.fsbHorizontal = "false";
        rails.vertical.hidden = true;
        rails.horizontal.hidden = true;
        el.__floatingScrollbar.metrics = {};
        setActive(el, false);
        return;
      }
      const viewH = el.clientHeight;
      const viewW = el.clientWidth;
      const scrollH = el.scrollHeight;
      const scrollW = el.scrollWidth;
      const canScrollY = scrollH > viewH + 1;
      const canScrollX = scrollW > viewW + 1;
      const rect = el.getBoundingClientRect();
      const computed = getComputedStyle(el);
      const zIndex = Number.parseInt(computed.zIndex, 10);
      const railZ = Number.isFinite(zIndex) ? Math.min(199999, zIndex + 1) : 50000;
      const borderTop = el.clientTop || 0;
      const borderLeft = el.clientLeft || 0;
      const isSidePanelScroller = el.matches(sidePanelScrollerSelector);
      const verticalTrim = isSidePanelScroller ? 32 : 2;
      const horizontalTrim = 2;
      const outsideInset = 6;

      el.dataset.fsbVertical = canScrollY ? "true" : "false";
      el.dataset.fsbHorizontal = canScrollX ? "true" : "false";
      setActive(el, resolveActive(el, canScrollY, canScrollX));

      rails.vertical.hidden = !canScrollY;
      rails.horizontal.hidden = !canScrollX;

      el.__floatingScrollbar.metrics = {};

      if (canScrollY) {
        const railWidth = 4;
        const trackTopTrim = verticalTrim;
        const trackBottomTrim = canScrollX ? Math.max(verticalTrim, horizontalTrim + railWidth) : verticalTrim;
        const trackHeight = Math.max(0, viewH - trackTopTrim - trackBottomTrim);
        const thumbHeight = Math.max(36, Math.round(trackHeight * viewH / scrollH));
        const maxTop = Math.max(0, trackHeight - thumbHeight);
        rails.vertical.style.top = `${Math.round(rect.top + borderTop + trackTopTrim)}px`;
        rails.vertical.style.left = `${Math.round(rect.left + borderLeft + viewW + outsideInset)}px`;
        rails.vertical.style.right = "auto";
        rails.vertical.style.bottom = "auto";
        rails.vertical.style.width = `${railWidth}px`;
        rails.vertical.style.height = `${Math.round(trackHeight)}px`;
        rails.vertical.style.zIndex = String(railZ);
        thumbs.vertical.style.height = `${thumbHeight}px`;
        thumbs.vertical.style.width = "100%";
        el.__floatingScrollbar.metrics.vertical = {
          maxTop,
          scrollRange: Math.max(1, scrollH - viewH),
        };
      }

      if (canScrollX) {
        const railHeight = 4;
        const trackLeftTrim = horizontalTrim;
        const trackRightTrim = canScrollY ? Math.max(horizontalTrim, verticalTrim + railHeight) : horizontalTrim;
        const trackWidth = Math.max(0, viewW - trackLeftTrim - trackRightTrim);
        const thumbWidth = Math.max(36, Math.round(trackWidth * viewW / scrollW));
        const maxLeft = Math.max(0, trackWidth - thumbWidth);
        rails.horizontal.style.left = `${Math.round(rect.left + borderLeft + trackLeftTrim)}px`;
        rails.horizontal.style.top = `${Math.round(rect.top + borderTop + viewH + outsideInset)}px`;
        rails.horizontal.style.right = "auto";
        rails.horizontal.style.bottom = "auto";
        rails.horizontal.style.width = `${Math.round(trackWidth)}px`;
        rails.horizontal.style.height = `${railHeight}px`;
        rails.horizontal.style.zIndex = String(railZ);
        thumbs.horizontal.style.width = `${thumbWidth}px`;
        thumbs.horizontal.style.height = "100%";
        el.__floatingScrollbar.metrics.horizontal = {
          maxLeft,
          scrollRange: Math.max(1, scrollW - viewW),
        };
      }

      updateThumbs(el);
    };

    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        hosts.forEach(syncHost);
      });
    };

    const bindHost = (el) => {
      ensureHost(el);
      if (el.__floatingScrollbarBound) return;
      el.__floatingScrollbarBound = true;
      el.addEventListener("scroll", () => updateThumbs(el), { passive: true });
      el.addEventListener("mouseenter", schedule, { passive: true });
      el.addEventListener("mouseleave", schedule, { passive: true });
      el.addEventListener("focusin", schedule);
      el.addEventListener("focusout", schedule);
      resizeObserver?.observe(el);
    };

    document.querySelectorAll(selector).forEach(bindHost);

    const observer = new MutationObserver(() => {
      document.querySelectorAll(selector).forEach(bindHost);
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const stateObserver = new MutationObserver(schedule);
    [
      document.querySelector("#workbenchShell"),
      document.querySelector("#utilityPageShell"),
      document.querySelector(".caption-settings-shell"),
    ].filter(Boolean).forEach((node) => {
      stateObserver.observe(node, { attributes: true, attributeFilter: ["class", "aria-hidden", "hidden"] });
    });
    document.addEventListener("click", schedule, true);
    document.addEventListener("scroll", (event) => {
      if (!hosts.has(event.target)) schedule();
    }, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("load", schedule, { once: true });
    schedule();
  }

  function enhancePanelGlassSampling() {
    const selector = [
      ".utility-page-shell .utility-panel>.card",
      ".caption-settings-shell>.card",
      ".list-card",
      ".viewer-card",
      ".edit-card",
      ".global-tags-card",
    ].join(", ");
    const panels = new Set();
    const imageCache = new Map();
    let rafId = 0;
    let activeImageUrl = "";
    let activeImage = null;

    const cssUrlValue = (value) => {
      const match = `${value || ""}`.match(/url\((['"]?)(.*?)\1\)/);
      return match?.[2] || "";
    };

    const loadGlassImage = (url) => {
      if (!url) return Promise.resolve(null);
      if (imageCache.has(url)) return imageCache.get(url);
      const promise = new Promise((resolve) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
      });
      imageCache.set(url, promise);
      return promise;
    };

    const visiblePanel = (panel) => {
      if (!panel?.isConnected) return false;
      const rect = panel.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      const computed = window.getComputedStyle(panel);
      return computed.display !== "none" && computed.visibility !== "hidden";
    };

    const syncPanels = () => {
      const computedRoot = window.getComputedStyle(document.documentElement);
      const imageUrl = cssUrlValue(computedRoot.getPropertyValue("--app-wallpaper-image"));
      if (imageUrl !== activeImageUrl) {
        activeImageUrl = imageUrl;
        activeImage = null;
        loadGlassImage(imageUrl).then((image) => {
          if (imageUrl !== activeImageUrl) return;
          activeImage = image;
          schedule();
        });
      }

      const bodyRect = document.body.getBoundingClientRect();
      const areaWidth = Math.max(document.body.clientWidth, document.documentElement.clientWidth, 1);
      const areaHeight = Math.max(document.body.scrollHeight, document.body.clientHeight, window.innerHeight, 1);
      const naturalWidth = activeImage?.naturalWidth || 0;
      const naturalHeight = activeImage?.naturalHeight || 0;
      const hasImage = Boolean(activeImageUrl && naturalWidth && naturalHeight);
      const scale = hasImage ? Math.max(areaWidth / naturalWidth, areaHeight / naturalHeight) : 1;
      const renderedWidth = hasImage ? naturalWidth * scale : areaWidth;
      const renderedHeight = hasImage ? naturalHeight * scale : areaHeight;
      const imageLeft = hasImage ? (areaWidth - renderedWidth) / 2 : 0;
      const imageTop = hasImage ? (areaHeight - renderedHeight) / 2 : 0;

      panels.forEach((panel) => {
        if (!visiblePanel(panel)) return;
        const rect = panel.getBoundingClientRect();
        const panelLeft = rect.left - bodyRect.left;
        const panelTop = rect.top - bodyRect.top;
        panel.style.setProperty("--glass-sample-size", `${Math.round(renderedWidth)}px ${Math.round(renderedHeight)}px`);
        panel.style.setProperty("--glass-sample-position", `${Math.round(imageLeft - panelLeft)}px ${Math.round(imageTop - panelTop)}px`);
      });
    };

    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        syncPanels();
      });
    };

    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(schedule) : null;
    const bindPanel = (panel) => {
      if (!panel || panels.has(panel)) return;
      panels.add(panel);
      resizeObserver?.observe(panel);
    };

    document.querySelectorAll(selector).forEach(bindPanel);
    const domObserver = new MutationObserver(() => {
      document.querySelectorAll(selector).forEach(bindPanel);
      schedule();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

    const rootObserver = new MutationObserver(schedule);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-wallpaper", "data-theme"] });
    [refs.workbenchShell, refs.workbenchLayout, document.body].filter(Boolean).forEach((node) => resizeObserver?.observe(node));
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    document.addEventListener("transitionend", (event) => {
      if (event.target instanceof Element && event.target.closest("#workbenchShell, .workbench-layout, .utility-page-shell, .caption-settings-shell")) schedule();
    }, true);
    schedule();
  }

  function enhanceSelectMenus() {
    const viewportPadding = 8;
    const menuGap = 6;

    const positionMenu = (shell, button, menu) => {
      const rect = button.getBoundingClientRect();
      const maxMenuHeight = Math.min(260, Math.floor(window.innerHeight * 0.45));
      const width = Math.min(rect.width, window.innerWidth - (viewportPadding * 2));
      const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);
      const spaceBelow = window.innerHeight - rect.bottom - menuGap - viewportPadding;
      const spaceAbove = rect.top - menuGap - viewportPadding;
      const expectedHeight = Math.min(menu.scrollHeight || maxMenuHeight, maxMenuHeight);
      const opensUp = spaceBelow < expectedHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(72, opensUp ? spaceAbove : spaceBelow);
      const menuHeight = Math.min(expectedHeight, availableHeight);

      shell.classList.toggle("drop-up", opensUp);
      menu.style.width = `${Math.round(width)}px`;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.maxHeight = `${Math.round(Math.min(maxMenuHeight, availableHeight))}px`;
      menu.style.top = opensUp
        ? `${Math.round(Math.max(viewportPadding, rect.top - menuGap - menuHeight))}px`
        : `${Math.round(rect.bottom + menuGap)}px`;
      menu.classList.toggle("drop-up", opensUp);
    };

    const openMenu = (shell, button, menu) => {
      window.clearTimeout(menu.closeTimer);
      menu.classList.remove("menu-open", "menu-closing");
      menu.hidden = false;
      positionMenu(shell, button, menu);
      window.requestAnimationFrame(() => {
        menu.classList.add("menu-open");
      });
    };

    const closeMenu = (shell) => {
      const menu = shell.customSelectMenu;
      if (!menu || menu.hidden) return;
      window.clearTimeout(menu.closeTimer);
      shell.classList.remove("open");
      shell.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
      menu.classList.remove("menu-open");
      menu.classList.add("menu-closing");
      menu.closeTimer = window.setTimeout(() => {
        menu.hidden = true;
        menu.classList.remove("menu-closing", "drop-up");
      }, 230);
    };

    const closeMenus = (except = null) => {
      document.querySelectorAll(".custom-select.open").forEach((node) => {
        if (node === except) return;
        closeMenu(node);
      });
    };

    if (!enhanceSelectMenus.bound) {
      document.addEventListener("click", (event) => {
        if (event.target.closest(".custom-select, .custom-select-menu")) return;
        closeMenus();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenus();
      });
      window.addEventListener("resize", () => closeMenus());
      enhanceSelectMenus.bound = true;
    }

    document.querySelectorAll("select").forEach((select) => {
      if (select.dataset.customSelectReady === "true") return;
      select.dataset.customSelectReady = "true";
      select.classList.add("native-select-hidden");

      const shell = document.createElement("div");
      shell.className = "custom-select";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "custom-select-button";
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      const label = document.createElement("span");
      label.className = "custom-select-label";
      const arrow = document.createElement("span");
      arrow.className = "custom-select-arrow";
      button.append(label, arrow);

      const menu = document.createElement("div");
      menu.className = "custom-select-menu select-menu-portal";
      menu.setAttribute("role", "listbox");
      menu.hidden = true;
      shell.customSelectMenu = menu;
      shell.append(button);
      select.insertAdjacentElement("afterend", shell);
      document.body.appendChild(menu);

      const sync = () => {
        const selected = select.selectedOptions?.[0] || select.options?.[select.selectedIndex] || select.options?.[0];
        label.textContent = selected?.textContent?.trim() || "选择";
        button.disabled = select.disabled;
        button.setAttribute("aria-label", select.getAttribute("aria-label") || label.textContent);
        menu.textContent = "";
        Array.from(select.options).forEach((option) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "custom-select-option";
          item.textContent = option.textContent;
          item.disabled = option.disabled;
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(option.selected));
          if (option.selected) item.classList.add("selected");
          item.addEventListener("click", () => {
            if (option.disabled) return;
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            sync();
            closeMenus();
          });
          menu.appendChild(item);
        });
      };

      button.addEventListener("click", () => {
        const willOpen = !shell.classList.contains("open");
        closeMenus(shell);
        sync();
        shell.classList.toggle("open", willOpen);
        button.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) {
          openMenu(shell, button, menu);
        } else {
          closeMenu(shell);
        }
      });
      select.addEventListener("change", sync);
      select.addEventListener("vds-select-sync", sync);
      new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
      sync();
    });
  }

  function restorePersistedSettings() {
    refs.controlCount.value = readStored(STORAGE_KEYS.controlCount, "1");
    refs.ignoreTokensInput.value = readStored(STORAGE_KEYS.ignoreTokens, "");
    if (refs.autoOpenLastWorkspace) {
      refs.autoOpenLastWorkspace.checked = readStored(STORAGE_KEYS.autoOpenLastWorkspace, "false") === "true";
    }
    refs.workspaceBrowserRoot.value = readStored(STORAGE_KEYS.workspaceBrowserRoot, "");
    state.browserRoot = refs.workspaceBrowserRoot.value.trim();
    restoreSelectValue(refs.exportTargetPixels, STORAGE_KEYS.exportTargetPixels, "4");
    restoreSelectValue(refs.exportSizeMultiple, STORAGE_KEYS.exportSizeMultiple, "16");
    refs.exportProjectName.value = "";
    refs.exportFormat.value = readStored(STORAGE_KEYS.exportFormat, refs.exportFormat.value);
    refs.exportOutputDir.value = readStored(STORAGE_KEYS.exportOutputDir, "");
    refs.exportProcessImages.checked = readStored(STORAGE_KEYS.exportProcessImages, "true") !== "false";
    refs.exportIncludeControls.checked = readStored(STORAGE_KEYS.exportIncludeControls, "true") !== "false";
    ensureExportIncludeControlsForActiveControls();
    refs.exportPreserveSubfolders.checked = readStored(STORAGE_KEYS.exportPreserveSubfolders, "false") === "true";
    refs.viewerTargetPixels.value = normalizeViewerTargetPixelsValue(readStored(STORAGE_KEYS.viewerTargetPixels, "4"));
    refs.processProjectName.value = "";
    refs.processIncludeControls.checked = readStored(STORAGE_KEYS.processIncludeControls, "true") !== "false";
    refs.processLoadWorkspace.checked = readStored(STORAGE_KEYS.processLoadWorkspace, "true") !== "false";
    refs.processOnlyMismatched.checked = readStored(STORAGE_KEYS.processOnlyMismatched, "true") !== "false";
    if (refs.swapControlDir) refs.swapControlDir.value = readStored(STORAGE_KEYS.swapControlDir, "");
    if (refs.swapResultDir) refs.swapResultDir.value = readStored(STORAGE_KEYS.swapResultDir, "");
    if (refs.swapSuffix) refs.swapSuffix.value = readStored(STORAGE_KEYS.swapSuffix, "_swap") || "_swap";
    state.quickTags = readQuickTags();
    state.quickTagsCollapsed = readStored(STORAGE_KEYS.quickTagsCollapsed, "false") === "true";
    restoreCaptionSettings();
  }

  function ensureExportIncludeControlsForActiveControls() {
    const controlCount = Number(refs.controlCount?.value ?? 0);
    if (!refs.exportIncludeControls || !Number.isFinite(controlCount) || controlCount < 1) return;
    refs.exportIncludeControls.checked = true;
    saveStored(STORAGE_KEYS.exportIncludeControls, "true");
  }

  function normalizeViewerTargetPixelsValue(rawValue) {
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed)) return "4";
    return String(Math.min(64, Math.max(1, Math.round(parsed))));
  }

  function bindSettingsPersistence() {
    const refreshModelStatus = () => renderAiStatus();
    refs.controlCount.addEventListener("change", () => {
      saveStored(STORAGE_KEYS.controlCount, refs.controlCount.value);
      updateControlFieldVisibility();
      ensureExportIncludeControlsForActiveControls();
    });
    refs.ignoreTokensInput.addEventListener("change", () => {
      saveStored(STORAGE_KEYS.ignoreTokens, refs.ignoreTokensInput.value.trim());
    });
    refs.autoOpenLastWorkspace?.addEventListener("change", () => {
      saveStored(STORAGE_KEYS.autoOpenLastWorkspace, refs.autoOpenLastWorkspace.checked ? "true" : "false");
    });
    refs.workspaceBrowserRoot.addEventListener("change", () => {
      state.browserRoot = refs.workspaceBrowserRoot.value.trim();
      saveStored(STORAGE_KEYS.workspaceBrowserRoot, state.browserRoot);
    });
    refs.projectSortMode?.addEventListener("change", () => {
      state.projectSortMode = refs.projectSortMode.value;
      saveStored(STORAGE_KEYS.projectSortMode, state.projectSortMode);
      renderProjects();
    });
    refs.projectSearchInput?.addEventListener("input", () => {
      state.projectQuery = refs.projectSearchInput.value;
      renderProjects();
    });
    refs.exportTargetPixels.addEventListener("change", () => saveStored(STORAGE_KEYS.exportTargetPixels, refs.exportTargetPixels.value));
    refs.exportSizeMultiple.addEventListener("change", () => saveStored(STORAGE_KEYS.exportSizeMultiple, refs.exportSizeMultiple.value));
    refs.exportFormat.addEventListener("change", () => saveStored(STORAGE_KEYS.exportFormat, refs.exportFormat.value));
    refs.exportOutputDir.addEventListener("change", () => saveStored(STORAGE_KEYS.exportOutputDir, refs.exportOutputDir.value.trim()));
    refs.exportProcessImages.addEventListener("change", () => saveStored(STORAGE_KEYS.exportProcessImages, refs.exportProcessImages.checked ? "true" : "false"));
    refs.exportIncludeControls.addEventListener("change", () => saveStored(STORAGE_KEYS.exportIncludeControls, refs.exportIncludeControls.checked ? "true" : "false"));
    refs.exportPreserveSubfolders.addEventListener("change", () => saveStored(STORAGE_KEYS.exportPreserveSubfolders, refs.exportPreserveSubfolders.checked ? "true" : "false"));
    refs.viewerTargetPixels.addEventListener("change", () => {
      refs.viewerTargetPixels.value = normalizeViewerTargetPixelsValue(refs.viewerTargetPixels.value);
      saveStored(STORAGE_KEYS.viewerTargetPixels, refs.viewerTargetPixels.value);
    });
    refs.processIncludeControls.addEventListener("change", () => saveStored(STORAGE_KEYS.processIncludeControls, refs.processIncludeControls.checked ? "true" : "false"));
    refs.processLoadWorkspace.addEventListener("change", () => saveStored(STORAGE_KEYS.processLoadWorkspace, refs.processLoadWorkspace.checked ? "true" : "false"));
    refs.processOnlyMismatched.addEventListener("change", () => saveStored(STORAGE_KEYS.processOnlyMismatched, refs.processOnlyMismatched.checked ? "true" : "false"));
    refs.swapControlDir?.addEventListener("change", () => saveStored(STORAGE_KEYS.swapControlDir, refs.swapControlDir.value.trim()));
    refs.swapResultDir?.addEventListener("change", () => saveStored(STORAGE_KEYS.swapResultDir, refs.swapResultDir.value.trim()));
    refs.swapSuffix?.addEventListener("change", () => saveStored(STORAGE_KEYS.swapSuffix, refs.swapSuffix.value.trim() || "_swap"));

    refs.aiModel.addEventListener("change", () => {
      saveStored(STORAGE_KEYS.localModel, refs.aiModel.value);
      renderOverwriteModeHints();
      refreshModelStatus();
    });
    refs.overwriteMode.addEventListener("change", () => saveStored(STORAGE_KEYS.localOverwriteMode, refs.overwriteMode.value));
    refs.overwriteMode.addEventListener("change", renderOverwriteModeHints);
    refs.captionMode.addEventListener("change", () => saveStored(STORAGE_KEYS.localCaptionMode, refs.captionMode.value));
    refs.maxTokens.addEventListener("change", () => saveStored(STORAGE_KEYS.localMaxTokens, refs.maxTokens.value));
    refs.localThinkingMode?.addEventListener("change", () => saveStored(STORAGE_KEYS.localThinkingMode, refs.localThinkingMode.checked ? "true" : "false"));
    refs.customPrompt.addEventListener("change", () => saveStored(STORAGE_KEYS.localPrompt, refs.customPrompt.value));
    refs.apiThinkingMode?.addEventListener("change", () => saveStored(STORAGE_KEYS.apiThinkingMode, refs.apiThinkingMode.checked ? "true" : "false"));
    refs.ollamaThinkingMode?.addEventListener("change", () => saveStored(STORAGE_KEYS.ollamaThinkingMode, refs.ollamaThinkingMode.checked ? "true" : "false"));

    function renderCaptionBackendTabs() {
      const backend = refs.captionBackend?.value || readStored(STORAGE_KEYS.captionBackend, "local");
      refs.captionBackendTabs?.querySelectorAll("button[data-caption-backend]").forEach((button) => {
        const isActive = button.dataset.captionBackend === backend;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });
      document.querySelectorAll("[data-caption-backend-section]").forEach((section) => {
        const isActive = section.dataset.captionBackendSection === backend;
        section.classList.toggle("active", isActive);
        section.hidden = !isActive;
      });
    }

    function setCaptionBackend(backend) {
      if (refs.captionBackend) {
        refs.captionBackend.value = backend;
        refs.captionBackend.dispatchEvent(new Event("vds-select-sync"));
      }
      saveStored(STORAGE_KEYS.captionBackend, backend);
      renderCaptionBackendTabs();
      setAiStatusLine(`当前标注引擎：${activeCaptionBackendLabel()}`);
      renderAiStatus();
    }

    refs.captionBackendTabs?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-caption-backend]");
      if (!button) return;
      setCaptionBackend(button.dataset.captionBackend);
    });

    refs.captionBackend?.addEventListener("change", () => {
      setCaptionBackend(refs.captionBackend.value);
    });
    renderCaptionBackendTabs();

    refs.apiBaseUrl.addEventListener("change", () => saveStored(STORAGE_KEYS.apiBaseUrl, refs.apiBaseUrl.value.trim()));
    refs.apiKey.addEventListener("input", () => saveStored(STORAGE_KEYS.apiKey, refs.apiKey.value.trim()));
    refs.apiModelName.addEventListener("input", () => {
      saveStored(STORAGE_KEYS.apiModelName, refs.apiModelName.value.trim());
      refreshModelStatus();
    });
    refs.apiModelName.addEventListener("change", () => {
      saveStored(STORAGE_KEYS.apiModelName, refs.apiModelName.value.trim());
      refreshModelStatus();
    });
    refs.ollamaBaseUrl.addEventListener("change", () => saveStored(STORAGE_KEYS.ollamaBaseUrl, refs.ollamaBaseUrl.value.trim()));
    refs.ollamaModelName.addEventListener("input", () => {
      saveStored(STORAGE_KEYS.ollamaModelName, refs.ollamaModelName.value.trim());
      refreshModelStatus();
    });
    refs.ollamaModelName.addEventListener("change", () => {
      saveStored(STORAGE_KEYS.ollamaModelName, refs.ollamaModelName.value.trim());
      refreshModelStatus();
    });
  }

  function readLastWorkspaceOpenPayload() {
    const raw = readStored(STORAGE_KEYS.lastWorkspaceDirs, "");
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object") return null;
      if (`${payload.project_id || ""}`.trim()) return payload;
      const hasDirectory = ["control1_dir", "control2_dir", "control3_dir", "result_dir"].some((key) => `${payload[key] || ""}`.trim());
      return hasDirectory ? payload : null;
    } catch (_) {
      return null;
    }
  }

  function readLastProjectOpenPayload() {
    const projectId = `${readStored(STORAGE_KEYS.lastProjectId, "") || ""}`.trim();
    if (projectId) {
      return {
        project_id: projectId,
        project_name: `${readStored(STORAGE_KEYS.lastProjectName, "") || ""}`.trim(),
      };
    }
    const payload = readLastWorkspaceOpenPayload();
    return `${payload?.project_id || ""}`.trim() ? payload : null;
  }

  function applyLastWorkspaceOpenPayload(payload) {
    state.currentProjectId = `${payload.project_id || ""}`;
    state.currentProjectName = `${payload.project_name || ""}`;
    if (refs.projectNameInput && state.currentProjectName) refs.projectNameInput.value = state.currentProjectName;
    refs.control1Dir.value = `${payload.control1_dir || ""}`;
    refs.control2Dir.value = `${payload.control2_dir || ""}`;
    refs.control3Dir.value = `${payload.control3_dir || ""}`;
    refs.resultDir.value = `${payload.result_dir || ""}`;
    refs.controlCount.value = `${payload.control_count ?? refs.controlCount.value ?? "1"}`;
    refs.ignoreTokensInput.value = `${payload.ignore_tokens || ""}`;
    updateControlFieldVisibility();
  }

  function restoreCurrentProjectFromLastWorkspace(workspace) {
    const payload = readLastWorkspaceOpenPayload();
    if (!payload) return false;
    const dirs = workspace?.dirs || {};
    const sameWorkspace = [
      [dirs.control1 || "", payload.control1_dir || ""],
      [dirs.control2 || "", payload.control2_dir || ""],
      [dirs.control3 || "", payload.control3_dir || ""],
      [dirs.result || "", payload.result_dir || ""],
    ].some(([current, remembered]) => remembered && current === remembered);
    if (!sameWorkspace) return false;
    state.currentProjectId = `${payload.project_id || ""}`;
    state.currentProjectName = `${payload.project_name || ""}`;
    if (refs.projectNameInput && state.currentProjectName) refs.projectNameInput.value = state.currentProjectName;
    if (refs.projectStatus && state.currentProjectName) {
      refs.projectStatus.textContent = `当前项目：${state.currentProjectName} · 已载入 ${state.projects.length} 个项目`;
    }
    renderWorkspaceSummary();
    return Boolean(state.currentProjectId || state.currentProjectName);
  }

  function inferSingleProjectForCurrentWorkspace() {
    if (state.currentProjectId || state.currentProjectName) return false;
    if (!state.workspace?.counts?.all || state.projects.length !== 1) return false;
    const project = state.projects[0];
    state.currentProjectId = project.id || "";
    state.currentProjectName = project.name || project.id || "";
    if (refs.projectNameInput && state.currentProjectName) refs.projectNameInput.value = state.currentProjectName;
    if (refs.projectStatus && state.currentProjectName) {
      refs.projectStatus.textContent = `当前项目：${state.currentProjectName} · 已载入 ${state.projects.length} 个项目`;
    }
    const payload = readLastWorkspaceOpenPayload() || {};
    saveStored(STORAGE_KEYS.lastWorkspaceDirs, JSON.stringify({
      ...payload,
      project_id: state.currentProjectId,
      project_name: state.currentProjectName,
    }));
    renderWorkspaceSummary();
    return true;
  }

  async function openLastWorkspaceOnStartup() {
    if (!refs.autoOpenLastWorkspace?.checked) return false;
    const payload = readLastProjectOpenPayload() || readLastWorkspaceOpenPayload();
    if (!payload) return false;
    const projectId = `${payload.project_id || ""}`.trim();
    if (projectId && openProject) {
      await runWithStatus("正在打开上次项目...", async () => {
        await openProject(projectId, { skipCurrentStateSave: true });
        setAiStatusLine("已打开上次项目。");
      });
      return true;
    }
    applyLastWorkspaceOpenPayload(payload);
    await runWithStatus("正在打开上次加载的数据目录...", async () => {
      await loadWorkspace();
      setAiStatusLine("已打开上次加载的数据目录。");
    });
    return true;
  }

  function bindEvents() {
    enhanceFloatingScrollbars();
    enhanceSelectMenus();
    bindAppContextMenu();

    function numericCssVar(name, fallback) {
      const value = window.getComputedStyle(refs.workbenchShell).getPropertyValue(name).trim();
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function cssVarStorageKey(name) {
      return `vds-ui.${name.replace(/^--/, "")}`;
    }

    function legacyCssVarStorageKey(name) {
      return `lora-ui.${name.replace(/^--/, "")}`;
    }

    function setPanelWidthVar(name, value, min, max) {
      const clamped = Math.max(min, Math.min(max, value));
      refs.workbenchShell.style.setProperty(name, `${Math.round(clamped)}px`);
      window.localStorage.setItem(cssVarStorageKey(name), String(Math.round(clamped)));
    }

    function restorePanelWidthVar(name, fallback, min, max) {
      const stored = Number.parseFloat(
        window.localStorage.getItem(cssVarStorageKey(name)) || window.localStorage.getItem(legacyCssVarStorageKey(name)) || ""
      );
      if (Number.isFinite(stored)) setPanelWidthVar(name, stored, min, max);
      else refs.workbenchShell.style.setProperty(name, `${fallback}px`);
    }

    function bindPanelResizer(handle, { cssVar, fallback, min, max, direction }) {
      if (!handle) return;
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = numericCssVar(cssVar, fallback);
        refs.workbenchShell.classList.add("manual-resizing");
        handle.classList.add("dragging");
        handle.setPointerCapture?.(event.pointerId);
        const onMove = (moveEvent) => {
          const delta = (moveEvent.clientX - startX) * direction;
          setPanelWidthVar(cssVar, startWidth + delta, min, max);
        };
        const onUp = () => {
          handle.classList.remove("dragging");
          refs.workbenchShell.classList.remove("manual-resizing");
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp, { once: true });
      });
    }

    function setContentSizeVar(name, value, min, max) {
      const clamped = Math.max(min, Math.min(max, value));
      refs.workbenchShell.style.setProperty(name, `${Math.round(clamped)}px`);
      if (name === "--thumb-list-width") {
        refs.workbenchLayout?.style.removeProperty("--split-list-card-width");
        refs.workbenchLayout?.style.removeProperty("--split-list-card-target-width");
        const listCard = refs.listPanelShell?.closest(".list-card");
        listCard?.style.removeProperty("--split-list-gap");
        listCard?.style.removeProperty("--split-list-panel-width");
        listCard?.style.removeProperty("--split-list-shell-target-width");
      }
      window.localStorage.setItem(cssVarStorageKey(name), String(Math.round(clamped)));
    }

    function restoreContentSizeVar(name, fallback, min, max) {
      const stored = Number.parseFloat(
        window.localStorage.getItem(cssVarStorageKey(name)) || window.localStorage.getItem(legacyCssVarStorageKey(name)) || ""
      );
      if (Number.isFinite(stored)) setContentSizeVar(name, stored, min, max);
      else refs.workbenchShell.style.setProperty(name, `${fallback}px`);
    }

    function bindContentResizer(handle, { cssVar, axis, fallback, min, maxFor, direction = 1 }) {
      if (!handle) return;
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const start = axis === "y" ? event.clientY : event.clientX;
        const rawMax = Number(maxFor?.()) || fallback;
        const isSplitThumbResize = cssVar === "--thumb-list-width" && state.splitListOpen;
        const splitListCardWidth = refs.listPanelShell?.closest(".list-card")?.getBoundingClientRect().width;
        const startSize = isSplitThumbResize && Number.isFinite(splitListCardWidth)
          ? (splitListCardWidth + 13) / 2
          : numericCssVar(cssVar, fallback);
        const max = Math.max(min, isSplitThumbResize ? (rawMax + 13) / 2 : rawMax);
        refs.workbenchShell.classList.add("manual-resizing");
        handle.classList.add("dragging");
        handle.setPointerCapture?.(event.pointerId);
        const onMove = (moveEvent) => {
          const current = axis === "y" ? moveEvent.clientY : moveEvent.clientX;
          const deltaScale = isSplitThumbResize ? 0.5 : 1;
          setContentSizeVar(cssVar, startSize + (current - start) * direction * deltaScale, min, max);
        };
        const onUp = () => {
          handle.classList.remove("dragging");
          refs.workbenchShell.classList.remove("manual-resizing");
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp, { once: true });
      });
    }

    restorePanelWidthVar("--left-panel-width", 300, 240, 620);
    restorePanelWidthVar("--right-panel-width", 320, 280, 680);
    bindPanelResizer(refs.leftPanelResizer, { cssVar: "--left-panel-width", fallback: 300, min: 240, max: 620, direction: 1 });
    bindPanelResizer(refs.rightPanelResizer, { cssVar: "--right-panel-width", fallback: 320, min: 280, max: 680, direction: -1 });
    restoreContentSizeVar("--thumb-list-width", 320, 164, Math.max(320, (refs.workbenchLayout?.clientWidth || 980) - 460));
    restoreContentSizeVar("--viewer-panel-height", 520, 220, Math.max(320, (refs.workbenchLayout?.clientHeight || 820) - 220));
    restoreContentSizeVar("--caption-panel-width", 560, 280, Math.max(280, (refs.workbenchLayout?.clientWidth || 980) - 409));
    bindContentResizer(refs.listViewerResizer, {
      cssVar: "--thumb-list-width",
      axis: "x",
      fallback: 320,
      min: 164,
      maxFor: () => (refs.workbenchLayout?.clientWidth || window.innerWidth) - 460,
    });
    bindContentResizer(refs.viewerEditorResizer, {
      cssVar: "--viewer-panel-height",
      axis: "y",
      fallback: 520,
      min: 220,
      maxFor: () => (refs.workbenchLayout?.clientHeight || window.innerHeight) - 220,
    });
    bindContentResizer(refs.captionGlobalResizer, {
      cssVar: "--caption-panel-width",
      axis: "x",
      fallback: 560,
      min: 280,
      maxFor: () => refs.captionGlobalResizer?.parentElement?.clientWidth - 409,
    });

    refs.utilityActions.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-panel]");
      if (!button) return;
      if (state.utilityOpen && state.utilityPanel === button.dataset.panel) {
        closeUtilityPanel();
        return;
      }
      setUtilityPanel(button.dataset.panel);
    });

    refs.closeUtilityBtn?.addEventListener("click", () => {
      closeUtilityPanel();
    });

    refs.workspaceBrowseBtn.addEventListener("click", () => {
      browseWorkspacePath().catch(showError);
    });
    refs.workspaceBrowseUpBtn.addEventListener("click", () => {
      if (!state.browserParent) return;
      browseWorkspacePath(state.browserParent).catch(showError);
    });
    refs.workspaceBrowseUseBtn.addEventListener("click", () => {
      applyWorkspaceBrowserPath(state.browserPath || refs.workspaceBrowserRoot.value);
    });
    refs.workspaceBrowserRoot.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      browseWorkspacePath().catch(showError);
    });
    refs.workspaceBrowserTargetGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-browser-target]");
      if (!button) return;
      setWorkspaceBrowserTarget(button.dataset.browserTarget);
    });

    refs.apiModelMenuBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      state.apiModelMenuOpen ? closeApiModelMenu() : openApiModelMenu();
    });
    refs.apiModelName?.addEventListener("focus", () => {
      if (state.apiModels.length) openApiModelMenu({ focusSearch: false });
    });
    refs.apiModelSearch?.addEventListener("input", () => {
      state.apiModelQuery = refs.apiModelSearch.value.trim();
      renderApiModelSuggestions();
    });
    refs.apiModelSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const firstOption = refs.apiModelList?.querySelector(".model-picker-option");
        if (firstOption) firstOption.click();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeApiModelMenu();
      }
    });
    refs.ollamaModelMenuBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      state.ollamaModelMenuOpen ? closeOllamaModelMenu() : openOllamaModelMenu();
    });
    refs.ollamaModelName?.addEventListener("focus", () => {
      if (state.ollamaModels.length) openOllamaModelMenu({ focusSearch: false });
    });
    refs.ollamaModelSearch?.addEventListener("input", () => {
      state.ollamaModelQuery = refs.ollamaModelSearch.value.trim();
      renderOllamaSuggestions();
    });
    refs.ollamaModelSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const firstOption = refs.ollamaModelList?.querySelector(".model-picker-option");
        if (firstOption) firstOption.click();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeOllamaModelMenu();
      }
    });

    refs.loadWorkspaceBtn.addEventListener("click", () => runWithStatus("正在加载工作区...", () => loadWorkspace()).catch(showError));
    refs.rescanWorkspaceBtn.addEventListener("click", () => runWithStatus("正在重扫工作区...", () => rescanWorkspace()).catch(showError));
    refs.saveProjectBtn?.addEventListener("click", () => runWithStatus("正在提交版本...", () => saveCurrentProject()).catch(showError));
    refs.createProjectBtn?.addEventListener("click", () => createProject().catch(showError));
    refs.refreshProjectsBtn?.addEventListener("click", () => runWithStatus("正在刷新项目列表...", () => refreshProjects()).catch(showError));
    refs.refreshListBtn?.addEventListener("click", () => runWithStatus("正在重扫本地数据...", () => rescanWorkspace()).catch(showError));
    refs.cleanupTmpBtn?.addEventListener("click", () => runWithStatus("正在清理回收项目...", () => cleanupTmpNow()).catch(showError));
    refs.openCaptionSettingsBtn?.addEventListener("click", () => toggleCaptionSettingsPanel());

    refs.toggleSplitListBtn?.addEventListener("click", () => {
      (async () => {
        const wasOpen = Boolean(state.splitListOpen);
        const wasSecondarySelection = state.selectedPanel === "secondary";
        if (!wasOpen && state.selectedPanel === "primary" && state.selectedName) {
          state.primarySelectedName = state.selectedName;
        }
        state.splitListOpen = !state.splitListOpen;
        saveStored(STORAGE_KEYS.splitListOpen, state.splitListOpen ? "1" : "0");
        if (wasOpen && wasSecondarySelection) {
          state.selectedPanel = "primary";
          const primaryName = state.primarySelectedName || state.visibleItems?.[0]?.name || state.items?.[0]?.name || "";
          if (primaryName && state.items.some((item) => item.name === primaryName)) {
            await selectItem(primaryName, true, { skipDirtyCheck: true, panelId: "primary" });
          } else {
            state.selectedName = primaryName;
          }
        }
        renderFilters();
        renderViewer();
        await refreshItems({ skipDirtyCheck: true, suppressSelectionSync: true });
      })().catch(showError);
    });
    refs.locateSelectedBtn?.addEventListener("click", () => {
      (async () => {
        const batch = state.aiStatus?.batch || {};
        if (batch.running) {
          state.followCaptionCurrent = !state.followCaptionCurrent;
          state.lastFollowedCaptionName = "";
          renderLocateSelectedState?.();
          const currentName = `${batch.current || ""}`.trim();
          if (state.followCaptionCurrent && currentName) {
            await selectItem(currentName, false, { skipDirtyCheck: true, panelId: "primary" });
            scrollSelectedItemIntoView?.("center");
          } else if (state.selectedName) {
            scrollSelectedItemIntoView?.("center");
          }
          return;
        }

        state.followCaptionCurrent = false;
        state.lastFollowedCaptionName = "";
        renderLocateSelectedState?.();
        if (state.selectedName) scrollSelectedItemIntoView?.("center");
      })().catch(showError);
    });
    const panelControls = {
      primary: {
        filterGroup: refs.filterGroup,
        searchInput: refs.tagSearch,
        clearButton: refs.tagSearchClear,
        searchModeGroup: refs.tagSearchModeGroup,
        searchMatchGroup: refs.tagSearchMatchGroup,
        thumbModeSelect: refs.listThumbModeSelect,
      },
      secondary: {
        filterGroup: refs.secondaryFilterGroup,
        searchInput: refs.secondaryTagSearch,
        clearButton: refs.secondaryTagSearchClear,
        searchModeGroup: refs.secondaryTagSearchModeGroup,
        searchMatchGroup: refs.secondaryTagSearchMatchGroup,
        thumbModeSelect: refs.secondaryListThumbModeSelect,
      },
    };
    const panelSearchMode = (panelId) => panelId === "secondary" ? state.secondaryListSearchMode : state.listSearchMode;
    const setPanelSearchMode = (panelId, value) => {
      if (panelId === "secondary") {
        state.secondaryListSearchMode = value === "name" ? "name" : "phrase";
        saveStored(STORAGE_KEYS.secondaryListSearchMode, state.secondaryListSearchMode);
      } else {
        state.listSearchMode = value === "name" ? "name" : "phrase";
        saveStored(STORAGE_KEYS.listSearchMode, state.listSearchMode);
      }
    };
    const panelSearchMatchMode = (panelId) => panelId === "secondary" ? state.secondaryListSearchMatchMode : state.listSearchMatchMode;
    const setPanelSearchMatchMode = (panelId, value) => {
      if (panelId === "secondary") {
        state.secondaryListSearchMatchMode = value === "exact" ? "exact" : "contains";
        saveStored(STORAGE_KEYS.secondaryListSearchMatchMode, state.secondaryListSearchMatchMode);
      } else {
        state.listSearchMatchMode = value === "exact" ? "exact" : "contains";
        saveStored(STORAGE_KEYS.listSearchMatchMode, state.listSearchMatchMode);
      }
    };
    const setPanelQuery = (panelId, value) => {
      if (panelId === "secondary") state.secondarySegmentQuery = value || "";
      else state.segmentQuery = value || "";
    };
    const panelQuery = (panelId) => panelId === "secondary" ? (state.secondarySegmentQuery || "") : (state.segmentQuery || "");
    const syncCaptionSearchHighlight = (panelId) => {
      if (panelId !== "primary") return;
      updateCaptionSearchHighlight?.();
      renderTags?.();
    };
    const syncCaptionSearchTags = (panelId) => {
      if (panelId !== "primary") return;
      renderTags?.();
    };
    const syncSearchClear = (panelId) => {
      const controls = panelControls[panelId];
      if (controls?.clearButton && controls.searchInput) controls.clearButton.hidden = !controls.searchInput.value.trim();
    };
    const syncSearchMode = (panelId) => {
      const controls = panelControls[panelId];
      if (!controls) return;
      const mode = panelSearchMode(panelId) === "name" ? "name" : "phrase";
      const matchMode = panelSearchMatchMode(panelId) === "exact" ? "exact" : "contains";
      if (controls.searchInput) {
        controls.searchInput.placeholder = mode === "name" ? "搜索图片名称 / 子文件夹" : "搜索 caption 短语";
      }
      controls.searchModeGroup?.querySelectorAll("button[data-search-mode]").forEach((button) => {
        const isActive = button.dataset.searchMode === mode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
      controls.searchMatchGroup?.querySelectorAll("button[data-search-match]").forEach((button) => {
        const isActive = button.dataset.searchMatch === matchMode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    };
    const debounceTimers = { primary: 0, secondary: 0 };
    const clearDebounce = (panelId) => {
      if (!debounceTimers[panelId]) return;
      window.clearTimeout(debounceTimers[panelId]);
      debounceTimers[panelId] = 0;
    };
    const applySearch = (panelId, options = {}) => {
      clearDebounce(panelId);
      const input = panelControls[panelId]?.searchInput;
      setPanelQuery(panelId, input?.value.trim() || "");
      syncSearchClear(panelId);
      syncCaptionSearchTags(panelId);
      refreshItems(options).catch(showError);
    };
    const scheduleSearch = (panelId) => {
      clearDebounce(panelId);
      debounceTimers[panelId] = window.setTimeout(() => {
        debounceTimers[panelId] = 0;
        applySearch(panelId, { skipDirtyCheck: true, suppressSelectionSync: true });
      }, 1000);
    };
    Object.entries(panelControls).forEach(([panelId, controls]) => {
      if (controls.searchInput) controls.searchInput.value = panelQuery(panelId);
      syncSearchMode(panelId);
      syncSearchClear(panelId);
    });
    Object.entries(panelControls).forEach(([panelId, controls]) => {
      const group = controls.filterGroup;
      if (!group) return;
      group.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-filter]");
        if (!button) return;
        if (panelId === "secondary") state.secondaryFilter = button.dataset.filter;
        else state.filter = button.dataset.filter;
        renderFilters();
        refreshItems().catch(showError);
      });
    });
    Object.entries(panelControls).forEach(([panelId, controls]) => {
      const input = controls.searchInput;
      if (!input) return;
      input.addEventListener("input", () => {
        setPanelQuery(panelId, input.value.trim() || "");
        syncSearchClear(panelId);
        syncCaptionSearchHighlight(panelId);
        scheduleSearch(panelId);
      });
      input.addEventListener("change", () => {
        applySearch(panelId);
      });
      input.addEventListener("keyup", (event) => {
        syncSearchClear(panelId);
        if (event.key === "Enter") {
          applySearch(panelId);
        }
      });
    });
    Object.entries(panelControls).forEach(([panelId, controls]) => {
      let pointerHandled = false;
      controls.clearButton?.addEventListener("pointerdown", (event) => {
        pointerHandled = true;
        event.preventDefault();
        event.stopPropagation();
        if (controls.searchInput) controls.searchInput.value = "";
        controls.searchInput?.focus();
        applySearch(panelId, { skipDirtyCheck: true, suppressSelectionSync: true });
      });
      controls.clearButton?.addEventListener("click", (event) => {
        if (pointerHandled) {
          pointerHandled = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (controls.searchInput) controls.searchInput.value = "";
        controls.searchInput?.focus();
        applySearch(panelId, { skipDirtyCheck: true, suppressSelectionSync: true });
      });
    });
    Object.entries(panelControls).forEach(([panelId, controls]) => {
      controls.searchModeGroup?.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-search-mode]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const nextMode = button.dataset.searchMode === "name" ? "name" : "phrase";
        if (nextMode === panelSearchMode(panelId)) return;
        setPanelSearchMode(panelId, nextMode);
        syncSearchMode(panelId);
        syncCaptionSearchTags(panelId);
        refreshItems({ skipDirtyCheck: true, suppressSelectionSync: true }).catch(showError);
      });
      controls.searchMatchGroup?.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-search-match]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const nextMode = button.dataset.searchMatch === "exact" ? "exact" : "contains";
        if (nextMode === panelSearchMatchMode(panelId)) return;
        setPanelSearchMatchMode(panelId, nextMode);
        syncSearchMode(panelId);
        syncCaptionSearchTags(panelId);
        refreshItems({ skipDirtyCheck: true, suppressSelectionSync: true }).catch(showError);
      });
    });
    Object.entries(panelControls).forEach(([panelId, controls]) => {
      controls.thumbModeSelect?.addEventListener("change", () => {
        const rawMode = controls.thumbModeSelect.value || "result";
        const nextMode = /^(combined|control[1-3])$/.test(rawMode) ? rawMode : "result";
        if (panelId === "secondary") {
          state.secondaryListThumbMode = nextMode;
          saveStored(STORAGE_KEYS.secondaryListThumbMode, state.secondaryListThumbMode);
        } else {
          state.listThumbMode = nextMode;
          saveStored(STORAGE_KEYS.listThumbMode, state.listThumbMode);
        }
        renderFilters();
        renderViewer();
        refreshItems({ skipDirtyCheck: true, suppressSelectionSync: true }).catch(showError);
      });
    });

    refs.viewModeGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      state.viewMode = button.dataset.mode;
      saveStored(STORAGE_KEYS.viewMode, state.viewMode);
      renderViewer();
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!event.repeat) {
          runWithStatus("正在提交版本...", () => saveCurrentProject()).catch(showError);
        }
        return;
      }
      const isTaskShortcutBlocked = document.body.classList.contains("dialog-open") || shouldIgnoreListArrowNavigation(event.target);
      if (event.key === "Escape") {
        if (event.repeat || isTaskShortcutBlocked) return;
        event.preventDefault();
        runWithStatus("正在停止当前任务...", () => stopBatchCaption()).catch(showError);
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        if (event.repeat || event.altKey || isTaskShortcutBlocked) return;
        event.preventDefault();
        runWithStatus(`正在使用${activeCaptionBackendLabel()}批量标注...`, () => startBatchCaptionWithPayload(activeCaptionPayload())).catch(showError);
        return;
      }
      if (event.key === "Enter") {
        if (event.repeat || event.altKey || event.shiftKey || isTaskShortcutBlocked) return;
        event.preventDefault();
        runWithStatus(`正在使用${activeCaptionBackendLabel()}标注当前图片...`, () => captionCurrentWithPayload(activeCaptionPayload())).catch(showError);
        return;
      }
      // a 单张标注（Enter 的别名）
      if (event.key === "a") {
        if (event.repeat || isTaskShortcutBlocked) return;
        event.preventDefault();
        runWithStatus(`正在使用${activeCaptionBackendLabel()}标注当前图片...`, () => captionCurrentWithPayload(activeCaptionPayload())).catch(showError);
        return;
      }
      if (event.key === "Delete") {
        if (event.repeat || shouldIgnoreListArrowNavigation(event.target)) return;
        event.preventDefault();
        runWithStatus("正在删除当前图片...", () => trashCurrentItem()).catch(showError);
        return;
      }
      if (shouldIgnoreListArrowNavigation(event.target)) return;
      const activeItems = state.selectedPanel === "secondary" && state.splitListOpen ? state.secondaryVisibleItems : state.visibleItems;
      if (!activeItems?.length) return;
      // j/k 作为 ArrowDown/ArrowUp 的快捷别名（vim 风格）
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        selectRelativeItem(1).catch(showError);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        selectRelativeItem(-1).catch(showError);
      }
      // e 编辑当前 caption（聚焦编辑器）
      if (event.key === "e") {
        event.preventDefault();
        if (refs.captionEditor) {
          refs.captionEditor.focus();
          refs.captionEditor.select();
        }
        return;
      }
      // / 聚焦搜索
      if (event.key === "/") {
        event.preventDefault();
        const searchInput = refs.tagSearch || refs.secondaryTagSearch;
        if (searchInput) { searchInput.focus(); searchInput.select(); }
      }
    });

    document.addEventListener("click", (event) => {
      if (state.apiModelMenuOpen && !event.target.closest("#apiModelPicker, #apiModelMenu")) {
        closeApiModelMenu();
      }
      if (state.ollamaModelMenuOpen && !event.target.closest("#ollamaModelPicker, #ollamaModelMenu")) {
        closeOllamaModelMenu();
      }
    });

    refs.addTagBtn?.addEventListener("click", () => {
      const segments = splitSegmentInput(refs.newTagInput.value);
      if (!segments.length) return;
      appendSegmentsToCaption(segments);
      refs.newTagInput.value = "";
    });
    refs.quickTagToggleBtn.addEventListener("click", () => toggleQuickTags());
    refs.captionEditor?.addEventListener("input", () => {
      const rawValue = refs.captionEditor.value;
      const normalized = normalizeCaptionInputText(rawValue);
      if (normalized !== rawValue) {
        const start = refs.captionEditor.selectionStart;
        const end = refs.captionEditor.selectionEnd;
        refs.captionEditor.value = normalized;
        refs.captionEditor.selectionStart = normalizeCaptionInputText(rawValue.slice(0, start)).length;
        refs.captionEditor.selectionEnd = normalizeCaptionInputText(rawValue.slice(0, end)).length;
      }
      state.currentText = normalized;
      syncSegmentsFromText();
      syncCaptionDirty();
      renderTags();
      scheduleCaptionAutosave?.();
    });
    refs.newTagInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        refs.addTagBtn?.click();
      }
    });

    document.querySelectorAll(".template-row").forEach((row) => {
      const targetId = row.dataset.templateTarget;
      const select = row.querySelector(".promptTemplateSelect");
      row.querySelector(".applyTemplateBtn").addEventListener("click", () => {
        const template = templateById(select.value);
        const textarea = document.querySelector(`#${targetId}`);
        if (template && textarea) {
          textarea.value = template.content;
          textarea.dispatchEvent(new Event("change"));
        }
      });
      row.querySelector(".saveTemplateBtn").addEventListener("click", () => {
        savePromptTemplateFor(targetId).catch(showError);
      });
      row.querySelector(".deleteTemplateBtn").addEventListener("click", async () => {
        const template = templateById(select.value);
        if (!template) return;
        if (!(await window.appConfirm(`确定删除模板「${template.name}」？`))) return;
        deletePromptTemplate(template.id).catch(showError);
      });
    });

    refs.translateCurrentBtn.addEventListener("click", () => runWithStatus("正在翻译当前内容...", () => translateCurrent()).catch(showError));
    refs.batchAddBeforeBtn?.addEventListener("click", () => runWithStatus("正在批量添加短语到最前...", () => batchAdd("before")).catch(showError));
    refs.batchAddAfterBtn?.addEventListener("click", () => runWithStatus("正在批量添加短语到最后...", () => batchAdd("after")).catch(showError));
    refs.batchDeleteBtn.addEventListener("click", () => runWithStatus("正在批量删除短语...", () => batchDelete()).catch(showError));
    refs.batchReplaceBtn.addEventListener("click", () => runWithStatus("正在批量替换短语...", () => batchReplace()).catch(showError));
    refs.batchRenameAddPrefixBtn?.addEventListener("click", () => runWithStatus("正在批量添加文件名前缀...", () => batchRename("add_prefix")).catch(showError));
    refs.batchRenameAddSuffixBtn?.addEventListener("click", () => runWithStatus("正在批量添加文件名后缀...", () => batchRename("add_suffix")).catch(showError));
    refs.batchRenameDeleteBtn?.addEventListener("click", () => runWithStatus("正在批量删除文件名文字...", () => batchRename("delete")).catch(showError));
    refs.batchRenameReplaceBtn?.addEventListener("click", () => runWithStatus("正在批量替换文件名文字...", () => batchRename("replace")).catch(showError));
    refs.swapPairsBtn?.addEventListener("click", () => runWithStatus("正在生成对调副本...", () => swapControlResultPairs()).catch(showError));
    refs.deleteCurrentBtn.addEventListener("click", () => runWithStatus("正在排除当前条目...", () => deleteCurrent()).catch(showError));
    refs.mergeWorkspaceBtn.addEventListener("click", () => runWithStatus("正在追加数据集...", () => mergeWorkspace()).catch(showError));
    refs.viewerScaleBtn.addEventListener("click", () => runWithStatus("正在缩放 Viewer 当前条目...", () => scaleViewerItem()).catch(showError));
    refs.viewerMatchResultBtn.addEventListener("click", () => runWithStatus("正在匹配 Viewer 控制图尺寸...", () => matchViewerControlsToResult()).catch(showError));
    refs.processImagesBtn.addEventListener("click", () => runWithStatus("正在处理图像工作集...", () => processImages()).catch(showError));
    refs.processMatchResultBtn?.addEventListener("click", () => runWithStatus("正在批量匹配结果尺寸...", () => processMatchResultSizes()).catch(showError));
    refs.exportDatasetBtn.addEventListener("click", () => runWithStatus("正在导出数据集...", () => exportDataset()).catch(showError));

    refs.installDepsBtn.addEventListener("click", () => runWithStatus("正在安装本地 Qwen 依赖...", () => installDeps()).catch(showError));
    refs.loadModelBtn.addEventListener("click", () => runWithStatus("正在加载本地模型...", () => loadModel()).catch(showError));
    refs.validateLocalBtn.addEventListener("click", () => runWithStatus("正在验证本地模型...", () => validateLocalModel()).catch(showError));
    refs.captionCurrentBtn.addEventListener("click", () => runWithStatus(`正在使用${activeCaptionBackendLabel()}标注当前图片...`, () => captionCurrentWithPayload(activeCaptionPayload())).catch(showError));
    refs.captionBatchBtn.addEventListener("click", () => runWithStatus(`正在使用${activeCaptionBackendLabel()}批量标注...`, () => startBatchCaptionWithPayload(activeCaptionPayload())).catch(showError));
    refs.stopBatchBtn.addEventListener("click", () => runWithStatus("正在停止当前任务...", () => stopBatchCaption()).catch(showError));

    refs.loadApiModelsBtn.addEventListener("click", () => runWithStatus("正在读取 API 模型列表...", () => loadApiModels()).catch(showError));
    refs.validateApiBtn.addEventListener("click", () => runWithStatus("正在验证 API 模型...", () => validateApiModel()).catch(showError));
    refs.loadOllamaModelsBtn.addEventListener("click", () => runWithStatus("正在读取 Ollama 模型列表...", () => loadOllamaModels()).catch(showError));
    refs.validateOllamaBtn.addEventListener("click", () => runWithStatus("正在验证 Ollama 模型...", () => validateOllamaModel()).catch(showError));

    document.addEventListener("visibilitychange", () => {
      pollAiStatus({ scheduleNext: true }).catch((error) => console.warn(error));
    });
  }

  async function bootstrap() {
    enhanceTextareaResizers();
    enhancePanelGlassSampling();
    restorePersistedSettings();
    bindEvents();
    bindSettingsPersistence();
    setUtilityPanel(state.utilityPanel, { open: false, persist: false });
    updateControlFieldVisibility();
    renderWorkspaceBrowser();
    renderFilters();
    renderWorkspaceSummary();
    renderViewer();
    setCaptionEditorText("", { markSaved: true });
    renderTags();
    renderQuickTags();
    renderGlobalTags();
    refs.projectSortMode.value = state.projectSortMode;
    renderProjects();
    renderAiStatus();
    renderOverwriteModeHints();

    try {
      await loadAiOptions();
    } catch (error) {
      console.warn(error);
    }

    try {
      await loadPromptTemplates();
    } catch (error) {
      console.warn(error);
    }

    try {
      await refreshProjects();
    } catch (error) {
      console.warn(error);
    }

    let openedLastProject = false;
    const lastProjectPayload = readLastProjectOpenPayload();
    if (lastProjectPayload) {
      try {
        openedLastProject = await openLastWorkspaceOnStartup();
      } catch (error) {
        console.warn(error);
        setAiStatusLine(`打开上次项目失败：${error.message || error}`);
      }
    }

    if (!openedLastProject) {
      try {
        const data = await apiGet("/api/workspace");
        applyWorkspaceSummary(data.workspace);
        if (!restoreCurrentProjectFromLastWorkspace(data.workspace)) inferSingleProjectForCurrentWorkspace();
        if (state.currentProjectId && applyProjectUiState) {
          try {
            const detail = await apiGet("/api/projects/detail", { id: state.currentProjectId });
            applyProjectUiState(detail.workspace?.ui_state, detail.project?.name || state.currentProjectName);
          } catch (error) {
            console.warn(error);
          }
        }
        if (state.workspace?.counts?.all) {
          await refreshItems();
        }
      } catch (error) {
        console.warn(error);
      }

      if (!state.workspace?.counts?.all && !lastProjectPayload) {
        try {
          await openLastWorkspaceOnStartup();
        } catch (error) {
          console.warn(error);
          setAiStatusLine(`打开上次加载的数据目录失败：${error.message || error}`);
        }
      }
    }

    await pollAiStatus();
    scheduleNextAiPoll(nextAiPollDelay(state.aiStatus));
  }

  return {
    restorePersistedSettings,
    bindSettingsPersistence,
    bindEvents,
    bootstrap,
  };
}
