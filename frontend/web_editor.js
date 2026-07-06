import { setNativeDragFeedbackActive } from "./shared/drag.js";

export function createEditorModule({
  state,
  refs,
  STORAGE_KEYS,
  saveStored,
  cleanQuickTags,
  splitSegmentInput,
  apiGet,
  apiPost,
  setAiStatusLine,
  refreshItems,
  applyWorkspaceSummary,
  visibleNames,
  renderViewer,
  confirmDiscardCaptionChanges,
  setCaptionEditorText,
  prepareSelectionAfterRemoving,
  normalizeCaptionText,
  normalizeCaptionInputText,
  syncSegmentsFromText,
  syncCaptionDirty,
  onGlobalTagClick,
}) {
  const GLOBAL_TAG_DRAG_TYPE = "application/x-vds-global-tag";
  const QUICK_TAG_DRAG_TYPE = "application/x-vds-quick-tag";
  const CAPTION_SEGMENT_DRAG_TYPE = "application/x-vds-caption-segment";
  const GLOBAL_TAG_ROW_HEIGHT = 42;
  const GLOBAL_TAG_ROW_GAP = 4;
  const GLOBAL_TAG_IDLE_OVERSCAN = 1;
  const GLOBAL_TAG_SCROLL_OVERSCAN = 5;
  const GLOBAL_TAG_SCROLL_IDLE_MS = 140;
  let globalTagDragGhost = null;
  let globalTagScrollFrame = 0;
  let globalTagScrollEndTimer = 0;
  let globalTagViewportSignature = "";
  let globalTagScrolling = false;

  function normalizeGlobalTagQuery(value = state.globalTagQuery) {
    return `${value || ""}`.trim().toLowerCase();
  }

  function removeGlobalTagDragGhost() {
    globalTagDragGhost?.remove();
    globalTagDragGhost = null;
  }

  function updateGlobalTagDragGhost(event) {
    const drag = state.globalTagPointerDrag;
    if (!drag?.segment) return;
    if (!globalTagDragGhost) {
      globalTagDragGhost = document.createElement("div");
      globalTagDragGhost.className = "global-tag-drag-ghost";
      globalTagDragGhost.textContent = drag.segment;
      document.body.appendChild(globalTagDragGhost);
    }
    globalTagDragGhost.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
  }

  function renderPromptTemplateSelectors() {
    document.querySelectorAll(".promptTemplateSelect").forEach((select) => {
      const previous = select.value;
      select.innerHTML = state.promptTemplates
        .map((item) => `<option value="${item.id}">${item.name}</option>`)
        .join("");
      if (state.promptTemplates.some((item) => item.id === previous)) {
        select.value = previous;
      }
      select.dispatchEvent(new Event("vds-select-sync", { bubbles: true }));
    });
  }

  function templateById(id) {
    return state.promptTemplates.find((item) => item.id === id) || null;
  }

  function selectedTemplateNameFor(targetId) {
    const row = document.querySelector(`.template-row[data-template-target="${targetId}"]`);
    const select = row?.querySelector(".promptTemplateSelect");
    const template = templateById(select?.value);
    return template?.name || "中文·极简变化";
  }

  function writeSegmentsToText(segments) {
    state.currentText = normalizeCaptionText(segments.join(", "));
    if (refs.captionEditor) refs.captionEditor.value = state.currentText;
    syncSegmentsFromText();
    syncCaptionDirty();
    updateCaptionSearchHighlight();
    scheduleCaptionAutosave();
  }

  function appendHighlightedText(parent, text, query) {
    const value = `${text ?? ""}`;
    const needle = `${query ?? ""}`.trim();
    if (!needle) {
      parent.textContent = value;
      return;
    }
    const lowerValue = value.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let index = 0;
    let matchIndex = lowerValue.indexOf(lowerNeedle);
    if (matchIndex < 0) {
      parent.textContent = value;
      return;
    }
    parent.textContent = "";
    while (matchIndex >= 0) {
      if (matchIndex > index) {
        parent.appendChild(document.createTextNode(value.slice(index, matchIndex)));
      }
      const mark = document.createElement("mark");
      mark.className = "caption-search-hit";
      mark.textContent = value.slice(matchIndex, matchIndex + needle.length);
      parent.appendChild(mark);
      index = matchIndex + needle.length;
      matchIndex = lowerValue.indexOf(lowerNeedle, index);
    }
    if (index < value.length) {
      parent.appendChild(document.createTextNode(value.slice(index)));
    }
  }

  function appendInlineSearchHighlightedText(parent, text, query) {
    const value = `${text ?? ""}`;
    const needle = `${query ?? ""}`.trim();
    if (!needle) {
      parent.textContent = value;
      return;
    }
    const lowerValue = value.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let index = 0;
    let matchIndex = lowerValue.indexOf(lowerNeedle);
    if (matchIndex < 0) {
      parent.textContent = value;
      return;
    }
    parent.textContent = "";
    while (matchIndex >= 0) {
      if (matchIndex > index) {
        parent.appendChild(document.createTextNode(value.slice(index, matchIndex)));
      }
      const mark = document.createElement("span");
      mark.className = "search-hit";
      mark.textContent = value.slice(matchIndex, matchIndex + needle.length);
      parent.appendChild(mark);
      index = matchIndex + needle.length;
      matchIndex = lowerValue.indexOf(lowerNeedle, index);
    }
    if (index < value.length) {
      parent.appendChild(document.createTextNode(value.slice(index)));
    }
  }

  function updateCaptionSearchHighlight() {
    if (!refs.captionHighlight || !refs.captionEditor) return;
    const query = state.listSearchMode === "name" ? "" : `${state.segmentQuery || ""}`.trim();
    refs.captionHighlight.textContent = "";
    refs.captionHighlight.classList.toggle("active", Boolean(query));
    refs.captionEditor.classList.toggle("search-active", Boolean(query));
    if (!query) return;
    appendHighlightedText(refs.captionHighlight, refs.captionEditor.value || state.currentText || "", query);
    refs.captionHighlight.appendChild(document.createTextNode("\n"));
    refs.captionHighlight.scrollTop = refs.captionEditor.scrollTop;
    refs.captionHighlight.scrollLeft = refs.captionEditor.scrollLeft;
  }

  function segmentMatchesListSearch(segment, query) {
    const value = `${segment || ""}`.trim().toLowerCase();
    const needle = `${query || ""}`.trim().toLowerCase();
    if (!needle) return false;
    return state.listSearchMatchMode === "exact" ? value === needle : value.includes(needle);
  }

  function persistCaptionTagOrder() {
    writeSegmentsToText([...state.currentSegments]);
    renderTags();
  }

  function renderTags() {
    refs.tagChips.innerHTML = "";
    const searchQuery = state.listSearchMode === "name" ? "" : `${state.segmentQuery || ""}`.trim().toLowerCase();
    updateCaptionSearchHighlight();
    state.currentSegments.forEach((segment, index) => {
      const row = document.createElement("div");
      row.className = `chip${segmentMatchesListSearch(segment, searchQuery) ? " search-match" : ""}`;
      row.draggable = true;
      row.dataset.captionSegment = segment;
      row.dataset.captionIndex = String(index);
      row.title = "拖动排序，拖到快捷标注中添加";
      row.addEventListener("dragstart", (event) => {
        state.captionTagDragIndex = Number(row.dataset.captionIndex);
        state.captionTagDragging = {
          index: state.captionTagDragIndex,
          value: state.currentSegments[state.captionTagDragIndex] || segment,
          moved: false,
        };
        state.quickTagDragging = { type: "caption", value: segment };
        row.classList.add("dragging");
        setNativeDragFeedbackActive(true);
        event.dataTransfer?.setData(CAPTION_SEGMENT_DRAG_TYPE, segment);
        event.dataTransfer?.setData("text/plain", segment);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
      });
      row.addEventListener("dragend", () => {
        setNativeDragFeedbackActive(false);
        if (state.captionTagDragging?.moved) persistCaptionTagOrder();
        cleanupCaptionTagDragState();
        scheduleCaptionDragEndCleanup();
      });
      const input = document.createElement("input");
      input.className = "chip-input";
      input.value = segment;
      input.addEventListener("dragover", (event) => {
        if (!captionTagDragSource()) return;
        event.preventDefault();
        event.stopPropagation();
      });
      input.addEventListener("drop", (event) => {
        if (!captionTagDragSource()) return;
        event.preventDefault();
        event.stopPropagation();
        handleCaptionTagDrop(event);
      });
      input.addEventListener("change", () => {
        const next = [...state.currentSegments];
        next[index] = input.value.trim();
        writeSegmentsToText(next.filter(Boolean));
        renderTags();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-x";
      remove.setAttribute("aria-label", "删除标签");
      remove.addEventListener("click", () => {
        const next = state.currentSegments.filter((_, i) => i !== index);
        writeSegmentsToText(next);
        renderTags();
      });
      row.appendChild(input);
      row.appendChild(remove);
      refs.tagChips.appendChild(row);
    });
  }

  function appendSegmentsToCaption(segments) {
    const additions = (segments || []).map((segment) => `${segment || ""}`.trim()).filter(Boolean);
    if (!additions.length) return;
    state.currentText = `${state.currentText || ""}`.trim();
    const prefix = state.currentText ? ", " : "";
    state.currentText = normalizeCaptionText(`${state.currentText}${prefix}${additions.join(", ")}`);
    if (refs.captionEditor) refs.captionEditor.value = state.currentText;
    syncSegmentsFromText();
    syncCaptionDirty();
    renderTags();
    scheduleCaptionAutosave();
  }

  function appendQuickTagToCaption(value) {
    const text = `${value ?? ""}`.trim();
    if (!text) return;
    const current = `${state.currentText || refs.captionEditor?.value || ""}`.replace(/\s+$/, "");
    const separator = current ? (/[，,;；。]\s*$/.test(current) ? " " : ", ") : "";
    state.currentText = normalizeCaptionText(`${current}${separator}${text}`);
    if (refs.captionEditor) refs.captionEditor.value = state.currentText;
    syncSegmentsFromText();
    syncCaptionDirty();
    renderTags();
    scheduleCaptionAutosave();
  }

  function appendDraggedGlobalTagToCaption(value) {
    const segment = `${value ?? ""}`.trim();
    if (!segment) return;
    const current = `${state.currentText || refs.captionEditor?.value || ""}`.replace(/\s+$/, "");
    const separator = current ? (/[，,;；]\s*$/.test(current) ? " " : ", ") : "";
    state.currentText = normalizeCaptionText(`${current}${separator}${segment}`);
    if (refs.captionEditor) {
      refs.captionEditor.value = state.currentText;
      refs.captionEditor.focus();
      refs.captionEditor.selectionStart = refs.captionEditor.value.length;
      refs.captionEditor.selectionEnd = refs.captionEditor.value.length;
    }
    syncSegmentsFromText();
    syncCaptionDirty();
    renderTags();
    scheduleCaptionAutosave();
  }

  function eventHasGlobalTagDrag(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return Boolean(state.globalTagDragging) || types.includes(GLOBAL_TAG_DRAG_TYPE);
  }

  function readGlobalTagDragValue(event) {
    return event.dataTransfer?.getData(GLOBAL_TAG_DRAG_TYPE) || state.globalTagDragging || event.dataTransfer?.getData("text/plain") || "";
  }

  function isGlobalTagDropTarget(target) {
    return target instanceof Element && Boolean(target.closest("#captionEditor, .edit-card-body"));
  }

  function isGlobalTagDropPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return isGlobalTagDropTarget(event.target);
    }

    const hit = document.elementFromPoint(x, y);
    if (isGlobalTagDropTarget(hit)) return true;

    const targets = [refs.captionEditor, document.querySelector(".edit-card-body")].filter(Boolean);
    return targets.some((target) => {
      const rect = target.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
  }

  function bindGlobalTagDropTarget() {
    const suppressNextGlobalTagClick = () => {
      state.globalTagSuppressClick = true;
      window.setTimeout(() => {
        state.globalTagSuppressClick = false;
      }, 0);
    };

    const finishPointerLikeGlobalTagDrop = (event) => {
      const drag = state.globalTagPointerDrag;
      if (!drag?.segment) return;
      state.globalTagPointerDrag = null;
      drag.source?.classList.remove("dragging");
      removeGlobalTagDragGhost();
      refs.captionEditor?.classList.remove("drag-over");
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (moved >= 8) suppressNextGlobalTagClick();
      if (moved < 8 || !isGlobalTagDropPoint(event)) return;
      event.preventDefault();
      appendDraggedGlobalTagToCaption(drag.segment);
    };

    const movePointerLikeGlobalTagDrag = (event) => {
      const drag = state.globalTagPointerDrag;
      if (!drag?.segment) return;
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (moved >= 4) {
        drag.source?.classList.add("dragging");
        updateGlobalTagDragGhost(event);
      }
      refs.captionEditor?.classList.toggle("drag-over", isGlobalTagDropPoint(event));
    };

    const targets = [refs.captionEditor, document.querySelector(".edit-card-body")].filter(Boolean);
    targets.forEach((target) => {
      target.addEventListener("dragover", (event) => {
        if (!eventHasGlobalTagDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        refs.captionEditor?.classList.add("drag-over");
      });
      target.addEventListener("dragleave", (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          refs.captionEditor?.classList.remove("drag-over");
        }
      });
      target.addEventListener("drop", (event) => {
        const segment = readGlobalTagDragValue(event);
        if (!segment) return;
        event.preventDefault();
        event.stopPropagation();
        refs.captionEditor?.classList.remove("drag-over");
        appendDraggedGlobalTagToCaption(segment);
      });
    });

    document.addEventListener("dragover", (event) => {
      if (!state.globalTagDragging || !isGlobalTagDropPoint(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      refs.captionEditor?.classList.add("drag-over");
    }, true);

    document.addEventListener("drop", (event) => {
      if (!state.globalTagDragging || !isGlobalTagDropPoint(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const segment = readGlobalTagDragValue(event);
      refs.captionEditor?.classList.remove("drag-over");
      state.globalTagDragging = "";
      appendDraggedGlobalTagToCaption(segment);
    }, true);

    document.addEventListener("pointermove", (event) => {
      movePointerLikeGlobalTagDrag(event);
    }, true);

    document.addEventListener("mousemove", (event) => {
      movePointerLikeGlobalTagDrag(event);
    }, true);

    document.addEventListener("pointerup", finishPointerLikeGlobalTagDrop, true);
    document.addEventListener("mouseup", finishPointerLikeGlobalTagDrop, true);
    window.addEventListener("blur", () => {
      state.globalTagPointerDrag = null;
      document.querySelector(".global-tag-row.dragging")?.classList.remove("dragging");
      refs.captionEditor?.classList.remove("drag-over");
      removeGlobalTagDragGhost();
    });
  }

  bindGlobalTagDropTarget();

  refs.captionEditor?.addEventListener("scroll", () => {
    if (!refs.captionHighlight) return;
    refs.captionHighlight.scrollTop = refs.captionEditor.scrollTop;
    refs.captionHighlight.scrollLeft = refs.captionEditor.scrollLeft;
  });

  refs.globalTagSearch?.addEventListener("input", () => {
    state.globalTagQuery = refs.globalTagSearch.value;
    renderGlobalTags();
  });

  refs.globalTagList?.addEventListener("scroll", () => {
    if (!Array.isArray(state.globalTagVirtualRows)) return;
    globalTagScrolling = true;
    if (globalTagScrollEndTimer) window.clearTimeout(globalTagScrollEndTimer);
    globalTagScrollEndTimer = window.setTimeout(() => {
      globalTagScrollEndTimer = 0;
      globalTagScrolling = false;
      globalTagViewportSignature = "";
      renderGlobalTagViewport();
    }, GLOBAL_TAG_SCROLL_IDLE_MS);
    scheduleGlobalTagViewportRender();
  });

  function persistQuickTags() {
    state.quickTags = cleanQuickTags(state.quickTags);
    saveStored(STORAGE_KEYS.quickTags, JSON.stringify(state.quickTags));
    refs.quickTagPanel?.classList.remove("delete-mode");
  }

  function renderQuickTags() {
    refs.quickTagPanel?.classList.toggle("collapsed", state.quickTagsCollapsed);
    refs.quickTagToggleBtn?.setAttribute("aria-expanded", state.quickTagsCollapsed ? "false" : "true");
    if (refs.quickTagToggleBtn) {
      refs.quickTagToggleBtn.textContent = "快捷标注";
    }
    refs.quickTagGrid.textContent = "";

    state.quickTags.forEach((tag, index) => {
      const row = document.createElement("div");
      const isCaptionDraft =
        state.quickTagDragging?.type === "caption" &&
        state.quickTagDragging.inserted &&
        Number(state.quickTagDragIndex) === index;
      row.className = `quick-tag-item${isCaptionDraft ? " dragging caption-draft" : ""}`;
      row.draggable = true;
      row.dataset.quickTagIndex = String(index);

      const handle = document.createElement("span");
      handle.className = "quick-tag-handle";
      handle.textContent = "::";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "button-ghost quick-tag-btn";
      button.textContent = tag;
      button.addEventListener("click", () => scheduleQuickTagAppend(index));
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        window.clearTimeout(state.quickTagClickTimer);
        state.quickTagClickTimer = null;
        editQuickTag(index);
      });

      row.addEventListener("dragstart", (event) => {
        state.quickTagDragIndex = Number(row.dataset.quickTagIndex);
        state.quickTagDragging = {
          type: "quick",
          index: state.quickTagDragIndex,
          value: state.quickTags[state.quickTagDragIndex] || "",
          moved: false,
          deleting: false,
        };
        row.classList.add("dragging");
        setNativeDragFeedbackActive(true);
        event.dataTransfer?.setData(QUICK_TAG_DRAG_TYPE, String(state.quickTagDragIndex));
        event.dataTransfer?.setData("text/plain", String(state.quickTagDragIndex));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        setNativeDragFeedbackActive(false);
        if (state.quickTagDragging?.type === "quick" && state.quickTagDragging.moved && !state.quickTagDragging.deleting) {
          persistQuickTags();
          renderQuickTags();
        }
        cleanupQuickTagDragState();
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleQuickTagDragOver(event, row);
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleQuickTagDrop(event);
      });

      row.appendChild(handle);
      row.appendChild(button);
      refs.quickTagGrid.appendChild(row);
    });
  }

  function updateQuickTagDomIndexes() {
    refs.quickTagGrid?.querySelectorAll(".quick-tag-item").forEach((node, index) => {
      node.dataset.quickTagIndex = String(index);
    });
  }

  function updateCaptionTagDomIndexes() {
    refs.tagChips?.querySelectorAll(".chip").forEach((node, index) => {
      node.dataset.captionIndex = String(index);
    });
  }

  function captionTagDragSource() {
    return state.captionTagDragging || null;
  }

  function captionTagRowFromPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const hit = document.elementFromPoint(x, y);
    const direct = hit instanceof Element ? hit.closest(".chip") : null;
    if (direct && refs.tagChips?.contains(direct) && !direct.classList.contains("dragging")) return direct;
    return null;
  }

  function captionTagIndexForHoveredRow(row) {
    const targetIndex = Number(row?.dataset?.captionIndex);
    if (!Number.isFinite(targetIndex)) return 0;
    return targetIndex;
  }

  function captionTagReflowRects() {
    return new Map(
      [...refs.tagChips.querySelectorAll(".chip:not(.dragging)")].map((row) => [row, row.getBoundingClientRect()])
    );
  }

  function moveCaptionTagDom(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return false;
    if (fromIndex >= state.currentSegments.length || toIndex >= state.currentSegments.length) return false;
    const beforeRects = captionTagReflowRects();
    const next = [...state.currentSegments];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    state.currentSegments = next;

    const rows = [...refs.tagChips.querySelectorAll(".chip")];
    const moving = rows.find((row) => Number(row.dataset.captionIndex) === fromIndex);
    const target = rows.find((row) => Number(row.dataset.captionIndex) === toIndex);
    if (moving && target) {
      if (fromIndex < toIndex) refs.tagChips.insertBefore(moving, target.nextSibling);
      else refs.tagChips.insertBefore(moving, target);
      updateCaptionTagDomIndexes();
    }
    animateCaptionTagReflow(beforeRects);
    return true;
  }

  function animateCaptionTagReflow(beforeRects) {
    const rows = [...refs.tagChips.querySelectorAll(".chip:not(.dragging)")];
    refs.tagChips.classList.add("sorting");
    for (const row of rows) {
      const before = beforeRects.get(row);
      if (!before) continue;
      const after = row.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) continue;
      row.style.transition = "none";
      row.style.transform = `translate(${dx}px, ${dy}px)`;
      row.getBoundingClientRect();
      requestAnimationFrame(() => {
        row.style.transition = "";
        row.style.transform = "";
      });
    }
    window.clearTimeout(state.captionTagSortTimer);
    state.captionTagSortTimer = window.setTimeout(() => {
      refs.tagChips?.classList.remove("sorting");
      refs.tagChips?.querySelectorAll(".chip").forEach((row) => {
        row.style.transition = "";
        row.style.transform = "";
      });
    }, 220);
  }

  function clearCaptionTagHoverTimer() {
    if (state.captionTagHoverTimer) {
      window.clearTimeout(state.captionTagHoverTimer);
      state.captionTagHoverTimer = 0;
    }
    state.captionTagHoverRow = null;
  }

  function scheduleCaptionTagHover(row) {
    if (!row || state.captionTagHoverRow === row) return;
    clearCaptionTagHoverTimer();
    state.captionTagHoverRow = row;
    state.captionTagHoverTimer = window.setTimeout(() => {
      state.captionTagHoverTimer = 0;
      if (state.captionTagHoverRow !== row || !row.isConnected) return;
      state.captionTagHoverRow = null;
      const drag = captionTagDragSource();
      if (!drag) return;
      const fromIndex = Number(state.captionTagDragIndex);
      const toIndex = Math.min(captionTagIndexForHoveredRow(row), state.currentSegments.length - 1);
      if (moveCaptionTagDom(fromIndex, toIndex)) {
        state.captionTagDragIndex = toIndex;
        drag.index = toIndex;
        drag.moved = true;
      }
    }, 200);
  }

  function isCaptionTagDropPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const rect = refs.tagChips?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function handleCaptionTagDragOver(event) {
    if (!captionTagDragSource()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const targetRow = captionTagRowFromPoint(event);
    if (targetRow) {
      scheduleCaptionTagHover(targetRow);
      return;
    }
    clearCaptionTagHoverTimer();
  }

  function handleCaptionTagDrop(event) {
    const drag = captionTagDragSource();
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.moved) persistCaptionTagOrder();
    cleanupCaptionTagDragState();
    cleanupQuickTagDragState();
  }

  function cleanupCaptionTagDragState() {
    clearCaptionTagHoverTimer();
    state.captionTagDragIndex = null;
    state.captionTagDragging = null;
    refs.tagChips?.classList.remove("sorting");
    refs.tagChips?.querySelectorAll(".chip.dragging").forEach((node) => {
      node.classList.remove("dragging");
    });
  }

  function quickTagDragSource() {
    return state.quickTagDragging || null;
  }

  function eventHasQuickTagDrop(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return Boolean(quickTagDragSource()) || types.includes(QUICK_TAG_DRAG_TYPE) || types.includes(CAPTION_SEGMENT_DRAG_TYPE);
  }

  function quickTagRowFromPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const hit = document.elementFromPoint(x, y);
    const direct = hit instanceof Element ? hit.closest(".quick-tag-item") : null;
    if (direct && refs.quickTagGrid?.contains(direct) && !direct.classList.contains("dragging")) return direct;
    return null;
  }

  function quickTagIndexForHoveredRow(row) {
    const targetIndex = Number(row?.dataset?.quickTagIndex);
    if (!Number.isFinite(targetIndex)) return 0;
    return targetIndex;
  }

  function quickTagReflowRects() {
    return new Map(
      [...refs.quickTagGrid.querySelectorAll(".quick-tag-item:not(.dragging)")].map((row) => [row, row.getBoundingClientRect()])
    );
  }

  function moveQuickTagDom(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return false;
    if (fromIndex >= state.quickTags.length || toIndex >= state.quickTags.length) return false;
    const beforeRects = quickTagReflowRects();
    const next = [...state.quickTags];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    state.quickTags = next;

    const rows = [...refs.quickTagGrid.querySelectorAll(".quick-tag-item")];
    const moving = rows.find((row) => Number(row.dataset.quickTagIndex) === fromIndex);
    const target = rows.find((row) => Number(row.dataset.quickTagIndex) === toIndex);
    if (moving && target) {
      if (fromIndex < toIndex) refs.quickTagGrid.insertBefore(moving, target.nextSibling);
      else refs.quickTagGrid.insertBefore(moving, target);
      updateQuickTagDomIndexes();
    }
    animateQuickTagReflow(beforeRects);
    return true;
  }

  function animateQuickTagReflow(beforeRects) {
    const rows = [...refs.quickTagGrid.querySelectorAll(".quick-tag-item:not(.dragging)")];
    refs.quickTagGrid.classList.add("sorting");
    for (const row of rows) {
      const before = beforeRects.get(row);
      if (!before) continue;
      const after = row.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) continue;
      row.style.transition = "none";
      row.style.transform = `translate(${dx}px, ${dy}px)`;
      row.getBoundingClientRect();
      requestAnimationFrame(() => {
        row.style.transition = "";
        row.style.transform = "";
      });
    }
    window.clearTimeout(state.quickTagSortTimer);
    state.quickTagSortTimer = window.setTimeout(() => {
      refs.quickTagGrid?.classList.remove("sorting");
      refs.quickTagGrid?.querySelectorAll(".quick-tag-item").forEach((row) => {
        row.style.transition = "";
        row.style.transform = "";
      });
    }, 220);
  }

  function clearQuickTagHoverTimer() {
    if (state.quickTagHoverTimer) {
      window.clearTimeout(state.quickTagHoverTimer);
      state.quickTagHoverTimer = 0;
    }
    state.quickTagHoverRow = null;
  }

  function clearCaptionDragEndCleanup() {
    if (state.quickTagCaptionDragEndTimer) {
      window.clearTimeout(state.quickTagCaptionDragEndTimer);
      state.quickTagCaptionDragEndTimer = 0;
    }
  }

  function scheduleCaptionDragEndCleanup() {
    clearCaptionDragEndCleanup();
    state.quickTagCaptionDragEndTimer = window.setTimeout(() => {
      state.quickTagCaptionDragEndTimer = 0;
      cleanupQuickTagDragState();
    }, 140);
  }

  function scheduleQuickTagHover(row) {
    if (!row || state.quickTagHoverRow === row) return;
    clearQuickTagHoverTimer();
    state.quickTagHoverRow = row;
    state.quickTagHoverTimer = window.setTimeout(() => {
      state.quickTagHoverTimer = 0;
      if (state.quickTagHoverRow !== row || !row.isConnected) return;
      state.quickTagHoverRow = null;
      const drag = quickTagDragSource();
      if (drag?.type === "quick") {
        const fromIndex = Number(state.quickTagDragIndex);
        const toIndex = Math.min(quickTagIndexForHoveredRow(row), state.quickTags.length - 1);
        if (moveQuickTagDom(fromIndex, toIndex)) {
          state.quickTagDragIndex = toIndex;
          drag.index = toIndex;
          drag.moved = true;
        }
      }
    }, 200);
  }

  function moveCaptionDraftQuickTag(targetIndex) {
    const drag = quickTagDragSource();
    if (drag?.type !== "caption") return false;
    const value = `${drag.value || ""}`.trim();
    if (!value) return false;
    const nextIndex = Math.max(0, Math.min(targetIndex, state.quickTags.length));
    if (!drag.inserted) {
      const next = [...state.quickTags];
      next.splice(nextIndex, 0, value);
      state.quickTags = next;
      state.quickTagDragIndex = nextIndex;
      drag.index = nextIndex;
      drag.inserted = true;
      renderQuickTags();
      return true;
    }
    const fromIndex = Number(state.quickTagDragIndex);
    const toIndex = Math.min(fromIndex <= nextIndex ? nextIndex + 1 : nextIndex, state.quickTags.length - 1);
    if (moveQuickTagDom(fromIndex, toIndex)) {
      state.quickTagDragIndex = toIndex;
      drag.index = toIndex;
      drag.moved = true;
      return true;
    }
    return false;
  }

  function removeCaptionDraftQuickTag() {
    const drag = quickTagDragSource();
    if (drag?.type !== "caption" || !drag.inserted || drag.committed) return;
    const index = Number(state.quickTagDragIndex);
    if (index >= 0 && index < state.quickTags.length) {
      state.quickTags.splice(index, 1);
      renderQuickTags();
    }
    drag.inserted = false;
    drag.index = null;
    state.quickTagDragIndex = null;
  }

  function handleQuickTagDragOver(event, row = null) {
    if (!eventHasQuickTagDrop(event)) return;
    event.preventDefault();
    refs.quickTagPanel?.classList.remove("delete-mode");
    refs.quickTagGrid?.classList.add("drop-ready");
    const drag = quickTagDragSource();
    if (event.dataTransfer) event.dataTransfer.dropEffect = drag?.type === "caption" ? "copy" : "move";
    if (drag?.type === "caption") clearCaptionDragEndCleanup();

    if (drag?.type === "caption") {
      clearQuickTagHoverTimer();
      moveCaptionDraftQuickTag(state.quickTags.length);
      return;
    }

    const targetRow = quickTagRowFromPoint(event) || row;
    if (targetRow) {
      scheduleQuickTagHover(targetRow);
      return;
    }

    clearQuickTagHoverTimer();

    if (drag?.type === "quick") {
      return;
    }

    if (drag?.type === "caption") {
      return;
    }
  }

  function handleQuickTagDrop(event) {
    const drag = quickTagDragSource();
    refs.quickTagGrid?.classList.remove("drop-ready");
    if (drag?.type === "caption") {
      if (!drag.inserted) moveCaptionDraftQuickTag(state.quickTags.length);
      drag.committed = true;
      persistQuickTags();
      renderQuickTags();
      cleanupQuickTagDragState();
      return;
    }
    if (drag?.type === "quick") {
      persistQuickTags();
      renderQuickTags();
      cleanupQuickTagDragState();
    }
  }

  function isQuickTagDropPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const rect = refs.quickTagPanel?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function deleteDraggingQuickTag() {
    const drag = quickTagDragSource();
    if (drag?.type !== "quick") return;
    const index = Number(state.quickTagDragIndex);
    if (index < 0 || index >= state.quickTags.length) return;
    drag.deleting = true;
    state.quickTags.splice(index, 1);
    persistQuickTags();
    renderQuickTags();
  }

  function cleanupQuickTagDragState() {
    removeCaptionDraftQuickTag();
    clearCaptionDragEndCleanup();
    state.quickTagDragIndex = null;
    state.quickTagDragging = null;
    refs.quickTagPanel?.classList.remove("delete-mode");
    refs.quickTagGrid?.classList.remove("drop-ready");
    refs.quickTagGrid?.querySelectorAll(".quick-tag-item.dragging").forEach((node) => {
      node.classList.remove("dragging");
    });
    clearQuickTagHoverTimer();
  }

  refs.quickTagGrid?.addEventListener("dragover", (event) => {
    if (!eventHasQuickTagDrop(event)) return;
    handleQuickTagDragOver(event);
  });

  refs.quickTagGrid?.addEventListener("drop", (event) => {
    if (!eventHasQuickTagDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    handleQuickTagDrop(event);
  });

  refs.tagChips?.addEventListener("dragover", (event) => {
    if (!captionTagDragSource()) return;
    handleCaptionTagDragOver(event);
  }, true);

  refs.tagChips?.addEventListener("drop", (event) => {
    if (!captionTagDragSource()) return;
    handleCaptionTagDrop(event);
  }, true);

  document.addEventListener("dragover", (event) => {
    const drag = quickTagDragSource();
    const outside = !isQuickTagDropPoint(event);
    if (drag?.type === "caption") {
      if (outside) clearQuickTagHoverTimer();
      return;
    }
    if (drag?.type !== "quick") return;
    if (outside) clearQuickTagHoverTimer();
    refs.quickTagPanel?.classList.toggle("delete-mode", outside);
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (outside) event.preventDefault();
  }, true);

  document.addEventListener("dragover", (event) => {
    if (!captionTagDragSource()) return;
    if (!isCaptionTagDropPoint(event)) clearCaptionTagHoverTimer();
  }, true);

  document.addEventListener("drop", (event) => {
    const drag = quickTagDragSource();
    if (drag?.type !== "quick" || isQuickTagDropPoint(event)) return;
    event.preventDefault();
    event.stopPropagation();
    deleteDraggingQuickTag();
    cleanupQuickTagDragState();
  }, true);

  function toggleQuickTags(force = null) {
    state.quickTagsCollapsed = force === null ? !state.quickTagsCollapsed : Boolean(force);
    saveStored(STORAGE_KEYS.quickTagsCollapsed, state.quickTagsCollapsed ? "true" : "false");
    renderQuickTags();
  }

  function moveQuickTag(fromIndex, toIndex, options = {}) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= state.quickTags.length || toIndex >= state.quickTags.length) return;
    const next = [...state.quickTags];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    state.quickTags = next;
    if (options.persist) persistQuickTags();
    renderQuickTags();
  }

  function editQuickTag(index) {
    if (index < 0 || index >= state.quickTags.length) return;
    toggleQuickTags(false);
    const row = refs.quickTagGrid.querySelector(`[data-quick-tag-index="${index}"]`);
    if (!row) return;
    const button = row.querySelector(".quick-tag-btn");
    if (!button) return;
    const input = document.createElement("input");
    input.className = "quick-tag-edit";
    input.value = state.quickTags[index];
    button.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const value = input.value;
      if (value.trim()) {
        state.quickTags[index] = value;
      } else {
        state.quickTags.splice(index, 1);
      }
      state.quickTags = cleanQuickTags(state.quickTags);
      persistQuickTags();
      renderQuickTags();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        committed = true;
        renderQuickTags();
      }
    });
    input.addEventListener("blur", commit);
  }

  function scheduleQuickTagAppend(index) {
    window.clearTimeout(state.quickTagClickTimer);
    state.quickTagClickTimer = window.setTimeout(() => {
      appendQuickTagToCaption(state.quickTags[index] || "");
      state.quickTagClickTimer = null;
    }, 240);
  }

  function createGlobalTagRow(row) {
    const segment = row.segment || row.tag || "";
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = false;
    button.className = `global-tag-row${state.listSearchMode !== "name" && state.segmentQuery.toLowerCase() === segment.toLowerCase() ? " active" : ""}`;
    button.title = "拖到左侧 Caption 中追加";
    const name = document.createElement("span");
    appendInlineSearchHighlightedText(name, segment, state.globalTagQuery);
    const count = document.createElement("span");
    count.textContent = `${row.count}`;
    button.appendChild(name);
    button.appendChild(count);
    button.addEventListener("click", (event) => {
      if (state.globalTagSuppressClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onGlobalTagClick(segment);
    });
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      removeGlobalTagDragGhost();
      state.globalTagPointerDrag = {
        segment,
        startX: event.clientX,
        startY: event.clientY,
        source: button,
      };
    });
    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      removeGlobalTagDragGhost();
      state.globalTagPointerDrag = {
        segment,
        startX: event.clientX,
        startY: event.clientY,
        source: button,
      };
    });
    button.addEventListener("dragstart", (event) => {
      state.globalTagDragging = segment;
      button.classList.add("dragging");
      setNativeDragFeedbackActive(true);
      event.dataTransfer?.setData(GLOBAL_TAG_DRAG_TYPE, segment);
      event.dataTransfer?.setData("text/plain", segment);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    button.addEventListener("dragend", () => {
      setNativeDragFeedbackActive(false);
      state.globalTagDragging = "";
      button.classList.remove("dragging");
      refs.captionEditor?.classList.remove("drag-over");
      removeGlobalTagDragGhost();
    });
    return button;
  }

  function scheduleGlobalTagViewportRender() {
    if (globalTagScrollFrame) return;
    globalTagScrollFrame = window.requestAnimationFrame(() => {
      globalTagScrollFrame = 0;
      renderGlobalTagViewport();
    });
  }

  function renderGlobalTagViewport() {
    const rows = Array.isArray(state.globalTagVirtualRows) ? state.globalTagVirtualRows : [];
    const list = refs.globalTagList;
    if (!list) return;
    const rowStep = GLOBAL_TAG_ROW_HEIGHT + GLOBAL_TAG_ROW_GAP;
    const viewportHeight = list.clientHeight || 480;
    const overscan = globalTagScrolling ? GLOBAL_TAG_SCROLL_OVERSCAN : GLOBAL_TAG_IDLE_OVERSCAN;
    const start = Math.max(0, Math.floor(list.scrollTop / rowStep) - overscan);
    const end = Math.min(rows.length, Math.ceil((list.scrollTop + viewportHeight) / rowStep) + overscan);
    const active = state.listSearchMode === "name" ? "" : state.segmentQuery.toLowerCase();
    const signature = `${start}:${end}:${rows.length}:${active}:${globalTagScrolling ? "scroll" : "idle"}`;
    if (signature === globalTagViewportSignature) return;
    globalTagViewportSignature = signature;

    const canvas = document.createElement("div");
    canvas.className = "global-tag-virtual-canvas";
    canvas.style.height = `${rows.length * rowStep}px`;

    const fragment = document.createDocumentFragment();
    rows.slice(start, end).forEach((row, offset) => {
      const item = createGlobalTagRow(row);
      item.style.transform = `translate3d(0, ${(start + offset) * rowStep}px, 0)`;
      fragment.appendChild(item);
    });
    canvas.appendChild(fragment);
    list.replaceChildren(canvas);
  }

  function setGlobalTagsEmpty(text) {
    if (globalTagScrollEndTimer) {
      window.clearTimeout(globalTagScrollEndTimer);
      globalTagScrollEndTimer = 0;
    }
    globalTagScrolling = false;
    const empty = document.createElement("div");
    empty.className = "global-tag-empty";
    empty.textContent = text;
    refs.globalTagList.replaceChildren(empty);
  }

  function resetGlobalTagSearchState(query, rows) {
    if (refs.globalTagSearch) {
      refs.globalTagSearch.disabled = false;
      refs.globalTagSearch.placeholder = `搜索全局短语，共${state.globalSegments.length}项`;
      refs.globalTagSearch.title = query ? `匹配 ${rows.length} / 共 ${state.globalSegments.length} 项` : `共 ${state.globalSegments.length} 项`;
    }
    if (refs.globalTagCount) refs.globalTagCount.textContent = query ? `${rows.length}/${state.globalSegments.length}` : `${state.globalSegments.length}`;
  }

  function renderGlobalTags() {
    const query = normalizeGlobalTagQuery();
    const rows = state.globalSegments.filter((row) => {
      const segment = `${row.segment || row.tag || ""}`;
      return !query || segment.toLowerCase().includes(query);
    });
    const previousQuery = state.globalTagVirtualQuery || "";
    state.globalTagVirtualQuery = query;
    state.globalTagVirtualRows = rows;
    if (globalTagScrollEndTimer) {
      window.clearTimeout(globalTagScrollEndTimer);
      globalTagScrollEndTimer = 0;
    }
    globalTagScrolling = false;
    globalTagViewportSignature = "";
    resetGlobalTagSearchState(query, rows);
    refs.globalTagList.classList.toggle("virtualized", rows.length > 0);
    if (!rows.length) {
      setGlobalTagsEmpty(query ? "没有匹配的全局短语。" : "暂无全局短语。");
      return;
    }
    if (previousQuery !== query) {
      refs.globalTagList.scrollTop = 0;
    }
    renderGlobalTagViewport();
  }

  function clearCaptionAutosaveTimer() {
    if (!state.captionAutoSaveTimer) return;
    window.clearTimeout(state.captionAutoSaveTimer);
    state.captionAutoSaveTimer = 0;
  }

  async function saveCaptionSnapshot(name, text, { refresh = false, preserveEditor = true } = {}) {
    if (!name) return true;
    const savedText = normalizeCaptionInputText(text);
    const data = await apiPost("/api/item/save", {
      name,
      text: savedText,
    });
    if (name === state.selectedName) {
      state.currentItem = data.item;
      state.captionSavedText = savedText;
      state.captionDirty = state.currentText !== state.captionSavedText;
      if (!preserveEditor) {
        setCaptionEditorText(data.item.text || "", { markSaved: true });
      }
      if (refs.translatedText && !state.captionDirty) refs.translatedText.value = "";
    }
    if (refresh) {
      await refreshItems({ skipDirtyCheck: true, suppressSelectionSync: true });
    }
    return true;
  }

  function scheduleCaptionAutosave(delay = 700) {
    clearCaptionAutosaveTimer();
    if (!state.selectedName || !state.captionDirty) return;
    const name = state.selectedName;
    const text = state.currentText;
    state.captionAutoSaveTimer = window.setTimeout(() => {
      state.captionAutoSaveTimer = 0;
      state.captionAutoSavePromise = saveCaptionSnapshot(name, text, { preserveEditor: true })
        .catch((error) => {
          state.captionDirty = true;
          setAiStatusLine(`自动保存 Caption 失败：${error.message || error}`);
          return false;
        });
    }, delay);
  }

  async function flushCaptionAutosave() {
    clearCaptionAutosaveTimer();
    if (state.captionAutoSavePromise) {
      await state.captionAutoSavePromise;
      state.captionAutoSavePromise = null;
    }
    if (!state.selectedName || !state.captionDirty) return true;
    try {
      return await saveCaptionSnapshot(state.selectedName, state.currentText, { preserveEditor: true });
    } catch (error) {
      state.captionDirty = true;
      setAiStatusLine(`自动保存 Caption 失败：${error.message || error}`);
      return false;
    }
  }

  async function saveCurrentCaption() {
    if (!state.selectedName) return true;
    clearCaptionAutosaveTimer();
    if (state.captionAutoSavePromise) {
      await state.captionAutoSavePromise;
      state.captionAutoSavePromise = null;
    }
    if (!state.captionDirty) return true;
    try {
      return await saveCaptionSnapshot(state.selectedName, state.currentText, { refresh: true, preserveEditor: true });
    } catch (error) {
      state.captionDirty = true;
      throw error;
    }
  }

  async function translateCurrent() {
    if (!state.currentItem) return;
    let text = state.currentText || state.currentItem.text || "";
    if (refs.captionEditor) {
      const start = Number(refs.captionEditor.selectionStart);
      const end = Number(refs.captionEditor.selectionEnd);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        text = refs.captionEditor.value.slice(start, end);
      }
    }
    if (!text.trim()) return;
    const data = await apiPost("/api/translate", { text });
    refs.translatedText.value = data.translated;
  }

  async function batchAdd(position = "after") {
    const segments = splitSegmentInput(refs.batchAddInput.value);
    if (!segments.length) {
      setAiStatusLine("请输入要批量添加的短语。");
      return;
    }
    const normalizedPosition = position === "before" ? "before" : "after";
    await apiPost("/api/batch/add-segments", { names: visibleNames(), segments, position: normalizedPosition });
    refs.batchAddInput.value = "";
    await refreshItems();
    setAiStatusLine(`批量添加至${normalizedPosition === "before" ? "最前" : "最后"}完成：${segments.length} 个短语`);
  }

  async function batchDelete() {
    const segments = splitSegmentInput(refs.batchDeleteInput.value);
    if (!segments.length) {
      setAiStatusLine("请输入要批量删除的短语。");
      return;
    }
    await apiPost("/api/batch/delete-segments", { names: visibleNames(), segments });
    refs.batchDeleteInput.value = "";
    await refreshItems();
    setAiStatusLine(`批量删除完成：${segments.length} 个短语`);
  }

  async function batchReplace() {
    const oldSegment = refs.batchReplaceOld.value.trim();
    if (!oldSegment) {
      setAiStatusLine("请输入要批量替换的旧短语。");
      return;
    }
    await apiPost("/api/batch/replace-segment", {
      names: visibleNames(),
      old_segment: oldSegment,
      new_segment: refs.batchReplaceNew.value.trim(),
    });
    refs.batchReplaceOld.value = "";
    refs.batchReplaceNew.value = "";
    await refreshItems();
    setAiStatusLine(`批量替换完成：${oldSegment}`);
  }

  async function batchRename(operation) {
    if (!(await confirmDiscardCaptionChanges())) return;
    const payload = { names: visibleNames(), operation };
    if (operation === "add_prefix" || operation === "add_suffix") {
      const value = refs.batchRenameAddInput.value.trim();
      if (!value) {
        setAiStatusLine("请输入要添加到文件名的文字。");
        return;
      }
      payload.value = value;
    } else if (operation === "delete") {
      const value = refs.batchRenameDeleteInput.value.trim();
      if (!value) {
        setAiStatusLine("请输入要从文件名删除的文字。");
        return;
      }
      payload.value = value;
    } else if (operation === "replace") {
      const oldValue = refs.batchRenameReplaceOld.value.trim();
      if (!oldValue) {
        setAiStatusLine("请输入要批量替换的旧文件名文字。");
        return;
      }
      payload.old_value = oldValue;
      payload.new_value = refs.batchRenameReplaceNew.value.trim();
    }

    const data = await apiPost("/api/batch/rename", payload);
    if (data.workspace) applyWorkspaceSummary(data.workspace);
    if (operation === "add_prefix" || operation === "add_suffix") refs.batchRenameAddInput.value = "";
    if (operation === "delete") refs.batchRenameDeleteInput.value = "";
    if (operation === "replace") {
      refs.batchRenameReplaceOld.value = "";
      refs.batchRenameReplaceNew.value = "";
    }
    await refreshItems({ skipDirtyCheck: true, suppressSelectionSync: true });
    setAiStatusLine(`批量重命名完成：${data.changed || 0} 项`);
  }

  async function swapControlResultPairs() {
    if (!(await confirmDiscardCaptionChanges())) return;
    const controlDir = refs.swapControlDir?.value.trim() || "";
    const resultDir = refs.swapResultDir?.value.trim() || "";
    const suffix = refs.swapSuffix?.value.trim() || "_swap";
    if (!controlDir || !resultDir) {
      setAiStatusLine("请先填写控制图目录和结果图目录。");
      return;
    }
    const ok = await window.appConfirm("将按同名图片生成对调副本：结果图复制到控制图目录，控制图复制到结果图目录。原始文件不会被修改。");
    if (!ok) return;
    setAiStatusLine("正在生成对调副本...");
    const data = await apiPost("/api/batch/swap-control-result", {
      control_dir: controlDir,
      result_dir: resultDir,
      suffix,
    });
    if (data.workspace) applyWorkspaceSummary(data.workspace);
    await refreshItems({ skipDirtyCheck: true });
    const skipped = Array.isArray(data.skipped) && data.skipped.length ? ` · 跳过 ${data.skipped.length} 项` : "";
    setAiStatusLine(`对调扩增完成：${data.swapped || 0} 对${skipped}`);
  }

  async function deleteCurrent() {
    if (!state.selectedName) return;
    if (!(await confirmDiscardCaptionChanges())) return;
    const ok = await window.appConfirm(`确定从导出数据集中排除 ${state.selectedName}？原始文件不会被删除。`);
    if (!ok) return;
    const selectNext = prepareSelectionAfterRemoving?.([state.selectedName]);
    await apiPost("/api/item/delete", { name: state.selectedName });
    if (selectNext) await selectNext();
    else await refreshItems();
  }

  async function loadPromptTemplates() {
    const data = await apiGet("/api/prompt-templates");
    state.promptTemplates = data.templates || [];
    renderPromptTemplateSelectors();
  }

  async function savePromptTemplateFor(targetId) {
    const textarea = document.querySelector(`#${targetId}`);
    if (!textarea) return;
    const name = await window.appPrompt("模板名称", selectedTemplateNameFor(targetId));
    if (!name) return;
    const data = await apiPost("/api/prompt-templates/save", {
      name,
      content: textarea.value,
    });
    state.promptTemplates = data.templates || [];
    renderPromptTemplateSelectors();
    setAiStatusLine(`模板已保存：${name}`);
  }

  async function deletePromptTemplate(templateId) {
    if (!templateId) return;
    const data = await apiPost("/api/prompt-templates/delete", { id: templateId });
    state.promptTemplates = data.templates || [];
    renderPromptTemplateSelectors();
    setAiStatusLine("模板已删除");
  }

  return {
    renderPromptTemplateSelectors,
    templateById,
    renderTags,
    updateCaptionSearchHighlight,
    appendSegmentsToCaption,
    toggleQuickTags,
    renderQuickTags,
    renderGlobalTags,
    saveCurrentCaption,
    scheduleCaptionAutosave,
    flushCaptionAutosave,
    translateCurrent,
    batchAdd,
    batchDelete,
    batchReplace,
    batchRename,
    swapControlResultPairs,
    deleteCurrent,
    loadPromptTemplates,
    savePromptTemplateFor,
    deletePromptTemplate,
  };
}
