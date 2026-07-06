import {
  DEFAULT_OLLAMA_URL,
  STORAGE_KEYS,
  DEFAULT_QUICK_TAGS,
  FILTER_LABELS,
  ROLE_LABELS,
  UTILITY_PANEL_LABELS,
  readStored,
  saveStored,
  cleanQuickTags,
  readQuickTags,
  restoreSelectValue,
  apiGet,
  apiPost,
  resolveAssetUrl,
  splitSegmentInput,
  parseSegments,
} from "./frontend/web_shared.js";
import { createProjectsModule } from "./frontend/web_projects.js";
import { createWorkspaceBrowserModule } from "./frontend/web_workspace.js";
import { createImageOpsModule } from "./frontend/web_image_ops.js";
import { createCaptionModule } from "./frontend/web_caption.js";
import { createEditorModule } from "./frontend/web_editor.js";
import { createBrowserModule } from "./frontend/web_browser.js";
import { createShellModule } from "./frontend/web_shell.js";
import { createBootstrapModule } from "./frontend/web_bootstrap.js";

const launcherParams = new URLSearchParams(window.location.search);
if (window.__TAURI__ || window.__TAURI_INTERNALS__ || launcherParams.get("vds_launcher") === "1") {
  document.documentElement.classList.add("vds-tauri-launcher");
}

const state = {
  workspace: null,
  itemStats: null,
  items: [],
  globalSegments: [],
  globalTagQuery: "",
  globalTagDragging: "",
  globalTagPointerDrag: null,
  globalTagSuppressClick: false,
  selectedName: "",
  primarySelectedName: "",
  selectedPanel: "primary",
  batchSelectedNames: new Set(),
  batchSelectionPanel: "primary",
  batchSelectionAnchor: "",
  currentItem: null,
  filter: "all",
  itemFolderFilter: "",
  visibleItems: [],
  segmentQuery: "",
  listSearchMode: readStored(STORAGE_KEYS.listSearchMode, "phrase"),
  listSearchMatchMode: readStored(STORAGE_KEYS.listSearchMatchMode, "contains"),
  secondaryFilter: "all",
  secondaryItemFolderFilter: "",
  secondaryItems: [],
  secondaryVisibleItems: [],
  secondarySelectedName: "",
  secondarySegmentQuery: "",
  secondaryListSearchMode: readStored(STORAGE_KEYS.secondaryListSearchMode, "phrase"),
  secondaryListSearchMatchMode: readStored(STORAGE_KEYS.secondaryListSearchMatchMode, "contains"),
  utilityPanel: readStored(STORAGE_KEYS.utilityPanel, "workspace"),
  utilityOpen: false,
  captionSettingsOpen: false,
  browserPath: "",
  browserParent: "",
  browserRoot: "",
  browserTarget: readStored(STORAGE_KEYS.workspaceBrowserTarget, "control1"),
  browserItems: [],
  browserMessage: "",
  viewMode: readStored(STORAGE_KEYS.viewMode, "two"),
  listThumbMode: readStored(STORAGE_KEYS.listThumbMode, "result"),
  secondaryListThumbMode: readStored(STORAGE_KEYS.secondaryListThumbMode, "result"),
  splitListOpen: readStored(STORAGE_KEYS.splitListOpen, "0") === "1",
  currentText: "",
  captionSavedText: "",
  captionDirty: false,
  captionAutoSaveTimer: 0,
  captionAutoSavePromise: null,
  currentSegments: [],
  quickTags: [],
  quickTagsCollapsed: false,
  quickTagClickTimer: null,
  quickTagDragIndex: null,
  quickTagSortTimer: 0,
  quickTagHoverTimer: 0,
  quickTagHoverRow: null,
  quickTagCaptionDragEndTimer: 0,
  captionTagDragIndex: null,
  captionTagDragging: null,
  captionTagSortTimer: 0,
  captionTagHoverTimer: 0,
  captionTagHoverRow: null,
  aiStatus: null,
  promptTemplates: [],
  aiOptions: {
    local_models: [],
    default_local_model: "qwen3.5-4b",
    default_ollama_url: DEFAULT_OLLAMA_URL,
  },
  apiModels: [],
  apiModelMenuOpen: false,
  apiModelQuery: "",
  ollamaModels: [],
  ollamaModelMenuOpen: false,
  ollamaModelQuery: "",
  lastBatchSignature: "",
  followCaptionCurrent: false,
  lastFollowedCaptionName: "",
  lastImageProcessSignature: "",
  lastExportSignature: "",
  exportDownloadRequested: false,
  aiPollTimer: null,
  aiPollInFlight: false,
  projects: [],
  currentProjectId: "",
  currentProjectName: "",
  projectQuery: "",
  projectSortMode: readStored(STORAGE_KEYS.projectSortMode, "updated"),
  themeMode: readStored(STORAGE_KEYS.themeMode, "auto"),
  wallpaper: readStored(STORAGE_KEYS.wallpaper, "none"),
};

let renderTags = () => {};
let renderGlobalTags = () => {};
let flushCaptionAutosave = async () => true;
let updateCaptionSearchHighlight = () => {};
const wallpaperImageCache = new Map();
let bottomStatusContrastRaf = 0;
const slidingToggleGroups = new Set();
let slidingToggleRaf = 0;

const refs = {
  workbenchShell: document.querySelector("#workbenchShell"),
  workbenchLayout: document.querySelector("#workbenchLayout"),
  utilityActions: document.querySelector("#utilityActions"),
  utilityPageShell: document.querySelector("#utilityPageShell"),
  leftPanelResizer: document.querySelector("#leftPanelResizer"),
  listViewerResizer: document.querySelector("#listViewerResizer"),
  wallpaperSwitcher: document.querySelector("#wallpaperSwitcher"),
  wallpaperMenu: document.querySelector("#wallpaperMenu"),
  themeModeGroup: document.querySelector("#themeModeGroup"),
  bottomStatusBar: document.querySelector(".bottom-status-bar"),
  captionSettingsShell: document.querySelector("#captionSettingsShell"),
  rightPanelResizer: document.querySelector("#rightPanelResizer"),
  viewerEditorResizer: document.querySelector("#viewerEditorResizer"),
  captionGlobalResizer: document.querySelector("#captionGlobalResizer"),
  control1Dir: document.querySelector("#control1Dir"),
  control2Dir: document.querySelector("#control2Dir"),
  control3Dir: document.querySelector("#control3Dir"),
  controlCount: document.querySelector("#controlCount"),
  ignoreTokensInput: document.querySelector("#ignoreTokensInput"),
  autoOpenLastWorkspace: document.querySelector("#autoOpenLastWorkspace"),
  resultDir: document.querySelector("#resultDir"),
  mergeControl1Dir: document.querySelector("#mergeControl1Dir"),
  mergeControl2Dir: document.querySelector("#mergeControl2Dir"),
  mergeControl3Dir: document.querySelector("#mergeControl3Dir"),
  mergeResultDir: document.querySelector("#mergeResultDir"),
  mergeWorkspaceBtn: document.querySelector("#mergeWorkspaceBtn"),
  mergeStatus: document.querySelector("#mergeStatus"),
  workspaceBrowserRoot: document.querySelector("#workspaceBrowserRoot"),
  workspaceBrowseBtn: document.querySelector("#workspaceBrowseBtn"),
  workspaceBrowseUpBtn: document.querySelector("#workspaceBrowseUpBtn"),
  workspaceBrowseUseBtn: document.querySelector("#workspaceBrowseUseBtn"),
  workspaceBrowserTargetGroup: document.querySelector("#workspaceBrowserTargetGroup"),
  workspaceBrowserPath: document.querySelector("#workspaceBrowserPath"),
  workspaceBrowserList: document.querySelector("#workspaceBrowserList"),
  loadWorkspaceBtn: document.querySelector("#loadWorkspaceBtn"),
  rescanWorkspaceBtn: document.querySelector("#rescanWorkspaceBtn"),
  saveProjectBtn: document.querySelector("#saveProjectBtn"),
  createProjectBtn: document.querySelector("#createProjectBtn"),
  refreshProjectsBtn: document.querySelector("#refreshProjectsBtn"),
  refreshListBtn: document.querySelector("#refreshListBtn"),
  cleanupTmpBtn: document.querySelector("#cleanupTmpBtn"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectSearchInput: document.querySelector("#projectSearchInput"),
  projectSortMode: document.querySelector("#projectSortMode"),
  projectGrid: document.querySelector("#projectGrid"),
  projectStatus: document.querySelector("#projectStatus"),
  workspaceStat: document.querySelector("#workspaceStat"),
  aiStat: document.querySelector("#aiStat"),
  focusStat: document.querySelector("#focusStat"),
  captionBackend: document.querySelector("#captionBackend"),
  captionBackendTabs: document.querySelector("#captionBackendTabs"),
  openCaptionSettingsBtn: document.querySelector("#openCaptionSettingsBtn"),
  overviewCurrentName: document.querySelector("#overviewCurrentName"),
  overviewCurrentMeta: document.querySelector("#overviewCurrentMeta"),
  metricAll: document.querySelector("#metricAll"),
  metricControlImages: document.querySelector("#metricControlImages"),
  metricResultImages: document.querySelector("#metricResultImages"),
  metricTxt: document.querySelector("#metricTxt"),
  metricIssues: document.querySelector("#metricIssues"),
  metricFiltered: document.querySelector("#metricFiltered"),
  localAiSummary: document.querySelector("#localAiSummary"),
  apiAiSummary: document.querySelector("#apiAiSummary"),
  ollamaAiSummary: document.querySelector("#ollamaAiSummary"),
  localAiStatusText: document.querySelector("#localAiStatusText"),
  apiAiStatusText: document.querySelector("#apiAiStatusText"),
  ollamaAiStatusText: document.querySelector("#ollamaAiStatusText"),
  filterGroup: document.querySelector("#filterGroup"),
  secondaryFilterGroup: document.querySelector("#secondaryFilterGroup"),
  listThumbModeSelect: document.querySelector("#listThumbModeSelect"),
  secondaryListThumbModeSelect: document.querySelector("#secondaryListThumbModeSelect"),
  listPanelShell: document.querySelector("#listPanelShell"),
  secondaryListPanel: document.querySelector("#secondaryListPanel"),
  toggleSplitListBtn: document.querySelector("#toggleSplitListBtn"),
  locateSelectedBtn: document.querySelector("#locateSelectedBtn"),
  tagSearch: document.querySelector("#tagSearch"),
  secondaryTagSearch: document.querySelector("#secondaryTagSearch"),
  tagSearchModeGroup: document.querySelector("#tagSearchModeGroup"),
  secondaryTagSearchModeGroup: document.querySelector("#secondaryTagSearchModeGroup"),
  tagSearchMatchGroup: document.querySelector("#tagSearchMatchGroup"),
  secondaryTagSearchMatchGroup: document.querySelector("#secondaryTagSearchMatchGroup"),
  tagSearchClear: document.querySelector("#tagSearchClear"),
  secondaryTagSearchClear: document.querySelector("#secondaryTagSearchClear"),
  itemList: document.querySelector("#itemList"),
  secondaryItemList: document.querySelector("#secondaryItemList"),
  itemFolderFilters: document.querySelector("#itemFolderFilters"),
  secondaryItemFolderFilters: document.querySelector("#secondaryItemFolderFilters"),
  listStats: document.querySelector("#listStats"),
  secondaryListStats: document.querySelector("#secondaryListStats"),
  currentName: document.querySelector("#currentName"),
  currentMeta: document.querySelector("#currentMeta"),
  viewModeGroup: document.querySelector("#viewModeGroup"),
  viewerGrid: document.querySelector("#viewerGrid"),
  viewerTargetPixels: document.querySelector("#viewerTargetPixels"),
  viewerScaleBtn: document.querySelector("#viewerScaleBtn"),
  viewerMatchResultBtn: document.querySelector("#viewerMatchResultBtn"),
  captionEditor: document.querySelector("#captionEditor"),
  captionHighlight: document.querySelector("#captionHighlight"),
  tagChips: document.querySelector("#tagChips"),
  newTagInput: document.querySelector("#newTagInput"),
  addTagBtn: document.querySelector("#addTagBtn"),
  quickTagGrid: document.querySelector("#quickTagGrid"),
  quickTagPanel: document.querySelector("#quickTagPanel"),
  quickTagToggleBtn: document.querySelector("#quickTagToggleBtn"),
  translateCurrentBtn: document.querySelector("#translateCurrentBtn"),
  translatedText: document.querySelector("#translatedText"),
  globalTagSearch: document.querySelector("#globalTagSearch"),
  globalTagList: document.querySelector("#globalTagList"),
  globalTagCount: document.querySelector("#globalTagCount"),
  batchAddInput: document.querySelector("#batchAddInput"),
  batchDeleteInput: document.querySelector("#batchDeleteInput"),
  batchReplaceOld: document.querySelector("#batchReplaceOld"),
  batchReplaceNew: document.querySelector("#batchReplaceNew"),
  batchAddBeforeBtn: document.querySelector("#batchAddBeforeBtn"),
  batchAddAfterBtn: document.querySelector("#batchAddAfterBtn"),
  batchDeleteBtn: document.querySelector("#batchDeleteBtn"),
  batchReplaceBtn: document.querySelector("#batchReplaceBtn"),
  batchRenameAddInput: document.querySelector("#batchRenameAddInput"),
  batchRenameAddPrefixBtn: document.querySelector("#batchRenameAddPrefixBtn"),
  batchRenameAddSuffixBtn: document.querySelector("#batchRenameAddSuffixBtn"),
  batchRenameDeleteInput: document.querySelector("#batchRenameDeleteInput"),
  batchRenameDeleteBtn: document.querySelector("#batchRenameDeleteBtn"),
  batchRenameReplaceOld: document.querySelector("#batchRenameReplaceOld"),
  batchRenameReplaceNew: document.querySelector("#batchRenameReplaceNew"),
  batchRenameReplaceBtn: document.querySelector("#batchRenameReplaceBtn"),
  deleteCurrentBtn: document.querySelector("#deleteCurrentBtn"),
  swapControlDir: document.querySelector("#swapControlDir"),
  swapResultDir: document.querySelector("#swapResultDir"),
  swapSuffix: document.querySelector("#swapSuffix"),
  swapPairsBtn: document.querySelector("#swapPairsBtn"),
  exportTargetPixels: document.querySelector("#exportTargetPixels"),
  exportSizeMultiple: document.querySelector("#exportSizeMultiple"),
  exportProjectName: document.querySelector("#exportProjectName"),
  exportFormat: document.querySelector("#exportFormat"),
  exportOutputDir: document.querySelector("#exportOutputDir"),
  exportProcessImages: document.querySelector("#exportProcessImages"),
  exportIncludeControls: document.querySelector("#exportIncludeControls"),
  exportPreserveSubfolders: document.querySelector("#exportPreserveSubfolders"),
  processProjectName: document.querySelector("#processProjectName"),
  processIncludeControls: document.querySelector("#processIncludeControls"),
  processLoadWorkspace: document.querySelector("#processLoadWorkspace"),
  processOnlyMismatched: document.querySelector("#processOnlyMismatched"),
  processImagesBtn: document.querySelector("#processImagesBtn"),
  processMatchResultBtn: document.querySelector("#processMatchResultBtn"),
  exportDatasetBtn: document.querySelector("#exportDatasetBtn"),
  aiModel: document.querySelector("#aiModel"),
  overwriteMode: document.querySelector("#overwriteMode"),
  captionMode: document.querySelector("#captionMode"),
  maxTokens: document.querySelector("#maxTokens"),
  customPrompt: document.querySelector("#customPrompt"),
  localThinkingMode: document.querySelector("#localThinkingMode"),
  localModelMeta: document.querySelector("#localModelMeta"),
  localPromptLabel: document.querySelector("#localPromptLabel"),
  localPromptModeHint: document.querySelector("#localPromptModeHint"),
  installDepsBtn: document.querySelector("#installDepsBtn"),
  loadModelBtn: document.querySelector("#loadModelBtn"),
  validateLocalBtn: document.querySelector("#validateLocalBtn"),
  captionCurrentBtn: document.querySelector("#captionCurrentBtn"),
  captionBatchBtn: document.querySelector("#captionBatchBtn"),
  stopBatchBtn: document.querySelector("#stopBatchBtn"),
  apiBaseUrl: document.querySelector("#apiBaseUrl"),
  apiKey: document.querySelector("#apiKey"),
  apiModelPicker: document.querySelector("#apiModelPicker"),
  apiModelName: document.querySelector("#apiModelName"),
  apiModelMenuBtn: document.querySelector("#apiModelMenuBtn"),
  apiModelMenu: document.querySelector("#apiModelMenu"),
  apiModelSearch: document.querySelector("#apiModelSearch"),
  apiModelList: document.querySelector("#apiModelList"),
  apiOverwriteMode: document.querySelector("#apiOverwriteMode"),
  apiCaptionMode: document.querySelector("#apiCaptionMode"),
  apiMaxTokens: document.querySelector("#apiMaxTokens"),
  apiPrompt: document.querySelector("#apiPrompt"),
  apiPromptLabel: document.querySelector("#apiPromptLabel"),
  apiPromptModeHint: document.querySelector("#apiPromptModeHint"),
  apiThinkingMode: document.querySelector("#apiThinkingMode"),
  loadApiModelsBtn: document.querySelector("#loadApiModelsBtn"),
  validateApiBtn: document.querySelector("#validateApiBtn"),
  ollamaBaseUrl: document.querySelector("#ollamaBaseUrl"),
  ollamaModelPicker: document.querySelector("#ollamaModelPicker"),
  ollamaModelName: document.querySelector("#ollamaModelName"),
  ollamaModelMenuBtn: document.querySelector("#ollamaModelMenuBtn"),
  ollamaModelMenu: document.querySelector("#ollamaModelMenu"),
  ollamaModelSearch: document.querySelector("#ollamaModelSearch"),
  ollamaModelList: document.querySelector("#ollamaModelList"),
  ollamaOverwriteMode: document.querySelector("#ollamaOverwriteMode"),
  ollamaCaptionMode: document.querySelector("#ollamaCaptionMode"),
  ollamaMaxTokens: document.querySelector("#ollamaMaxTokens"),
  ollamaPrompt: document.querySelector("#ollamaPrompt"),
  ollamaPromptLabel: document.querySelector("#ollamaPromptLabel"),
  ollamaPromptModeHint: document.querySelector("#ollamaPromptModeHint"),
  ollamaThinkingMode: document.querySelector("#ollamaThinkingMode"),
  loadOllamaModelsBtn: document.querySelector("#loadOllamaModelsBtn"),
  validateOllamaBtn: document.querySelector("#validateOllamaBtn"),
  topAiProgressBar: document.querySelector("#topAiProgressBar"),
  topAiProgressText: document.querySelector("#topAiProgressText"),
  aiProgressBar: document.querySelector("#aiProgressBar"),
  aiStatusLine: document.querySelector("#aiStatusLine"),
  appContextMenu: document.querySelector("#appContextMenu"),
};

function createAppDialog() {
  const root = document.querySelector("#appDialog");
  const title = document.querySelector("#appDialogTitle");
  const message = document.querySelector("#appDialogMessage");
  const input = document.querySelector("#appDialogInput");
  const cancelBtn = document.querySelector("#appDialogCancel");
  const confirmBtn = document.querySelector("#appDialogConfirm");
  let resolver = null;
  let dialogKind = "alert";
  let previousFocus = null;
  let closeTimer = 0;
  let confirmValue = true;
  let cancelValue = false;

  function finish(value) {
    if (!resolver || !root) return;
    const resolve = resolver;
    resolver = null;
    root.classList.remove("dialog-open");
    root.classList.add("dialog-closing");
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      root.setAttribute("aria-hidden", "true");
      root.classList.remove("dialog-closing");
      document.body.classList.remove("dialog-open");
      input.value = "";
      if (previousFocus?.focus) previousFocus.focus();
      resolve(value);
    }, 220);
  }

  function open({
    kind = "alert",
    titleText = "提示",
    messageText = "",
    defaultValue = "",
    cancelText = "取消",
    confirmText = "确定",
    nextCancelValue = false,
    nextConfirmValue = true,
  } = {}) {
    if (!root || !title || !message || !input || !cancelBtn || !confirmBtn) {
      return Promise.resolve(kind === "prompt" ? null : kind === "confirm" ? false : true);
    }
    if (resolver) {
      const resolvePrevious = resolver;
      resolver = null;
      resolvePrevious(kind === "prompt" ? null : false);
    }
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    }
    dialogKind = kind;
    previousFocus = document.activeElement;
    cancelValue = nextCancelValue;
    confirmValue = nextConfirmValue;
    title.textContent = titleText || "提示";
    message.textContent = messageText || "";
    input.hidden = kind !== "prompt";
    input.value = defaultValue || "";
    cancelBtn.hidden = kind === "alert";
    cancelBtn.textContent = cancelText || "取消";
    confirmBtn.textContent = confirmText || "确定";
    root.dataset.kind = kind;
    root.setAttribute("aria-hidden", "false");
    root.classList.remove("dialog-closing");
    document.body.classList.add("dialog-open");
    return new Promise((resolve) => {
      resolver = resolve;
      requestAnimationFrame(() => {
        root.classList.add("dialog-open");
        const target = kind === "prompt" ? input : confirmBtn;
        target.focus();
        if (kind === "prompt") input.select();
      });
    });
  }

  confirmBtn?.addEventListener("click", () => {
    finish(dialogKind === "prompt" ? input.value : confirmValue);
  });
  cancelBtn?.addEventListener("click", () => {
    finish(dialogKind === "prompt" ? null : cancelValue);
  });
  root?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(dialogKind === "alert" ? true : dialogKind === "prompt" ? null : false);
    }
    if ((event.key === " " || event.key === "Spacebar") && document.activeElement !== input) {
      event.preventDefault();
      finish(dialogKind === "prompt" ? input.value : confirmValue);
    }
    if (event.key === "Enter" && dialogKind === "prompt" && document.activeElement === input) {
      event.preventDefault();
      finish(input.value);
    }
    if (event.key === "Enter" && document.activeElement !== input) {
      event.preventDefault();
      finish(dialogKind === "prompt" ? input.value : confirmValue);
    }
  });

  return {
    alert(messageText, titleText = "提示") {
      return open({ kind: "alert", titleText, messageText });
    },
    confirm(messageText, titleText = "确认") {
      return open({ kind: "confirm", titleText, messageText });
    },
    prompt(titleText, defaultValue = "") {
      return open({ kind: "prompt", titleText, defaultValue });
    },
    choice(messageText, titleText = "提示", options = {}) {
      return open({
        kind: "choice",
        titleText,
        messageText,
        cancelText: options.cancelText || "确定",
        confirmText: options.confirmText || "打开文件夹",
        nextCancelValue: options.cancelValue ?? "ok",
        nextConfirmValue: options.confirmValue ?? "open",
      });
    },
  };
}

const appDialog = createAppDialog();
window.appAlert = (message, title) => appDialog.alert(message, title);
window.appConfirm = (message, title) => appDialog.confirm(message, title);
window.appPrompt = (title, defaultValue) => appDialog.prompt(title, defaultValue);
window.appChoice = (message, title, options) => appDialog.choice(message, title, options);

function bindAboutDialog() {
  const trigger = document.querySelector("#aboutStudioBtn");
  const root = document.querySelector("#aboutDialog");
  const confirmBtn = document.querySelector("#aboutDialogConfirm");
  let previousFocus = null;
  let closeTimer = 0;

  function close() {
    if (!root || root.getAttribute("aria-hidden") === "true") return;
    root.classList.remove("dialog-open");
    root.classList.add("dialog-closing");
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      root.setAttribute("aria-hidden", "true");
      root.classList.remove("dialog-closing");
      document.body.classList.remove("dialog-open");
      if (previousFocus?.focus) previousFocus.focus();
    }, 220);
  }

  function open() {
    if (!root || !confirmBtn) return;
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    }
    previousFocus = document.activeElement;
    root.setAttribute("aria-hidden", "false");
    root.classList.remove("dialog-closing");
    document.body.classList.add("dialog-open");
    requestAnimationFrame(() => {
      root.classList.add("dialog-open");
      confirmBtn.focus();
    });
  }

  trigger?.addEventListener("click", open);
  confirmBtn?.addEventListener("click", close);
  root?.addEventListener("click", (event) => {
    if (event.target === root) close();
  });
  root?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" && event.key !== " " && event.key !== "Spacebar" && event.key !== "Enter") return;
    event.preventDefault();
    close();
  });
}

bindAboutDialog();

function syncSegmentsFromText() {
  state.currentSegments = parseSegments(state.currentText);
}

function syncCaptionDirty() {
  state.captionDirty = state.currentText !== state.captionSavedText;
}

function normalizeCaptionText(text) {
  return `${text || ""}`
    .replace(/[，,]/g, ",")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/,\s*/g, ", ");
}

function normalizeCaptionInputText(text) {
  return `${text || ""}`
    .replace(/，/g, ",")
    .replace(/(?:,\s*){2,}/g, ", ");
}

function setCaptionEditorText(text, { markSaved = false } = {}) {
  state.currentText = normalizeCaptionText(text);
  if (refs.captionEditor) refs.captionEditor.value = state.currentText;
  syncSegmentsFromText();
  if (markSaved) {
    state.captionSavedText = state.currentText;
    state.captionDirty = false;
  } else {
    syncCaptionDirty();
  }
}

async function confirmDiscardCaptionChanges() {
  return await flushCaptionAutosave();
}

function visibleNames() {
  const items = Array.isArray(state.visibleItems) ? state.visibleItems : state.items;
  return items.map((item) => item.name);
}

function syncBottomStatusTooltips() {
  document.querySelectorAll(".bottom-status-item").forEach((item) => {
    const baseTip = item.dataset.tooltip || item.getAttribute("title") || "";
    const label = item.querySelector("span")?.textContent.trim() || "";
    const value = item.querySelector("strong")?.textContent.trim() || "";
    const currentText = label && value ? `${label}：${value}` : label || value;
    const title = [currentText, baseTip].filter(Boolean).join("\n");
    item.dataset.tooltip = baseTip;
    item.setAttribute("title", title);
    item.setAttribute("aria-label", title.replace(/\n/g, "，"));
  });
}

function slidingToggleButtons(group) {
  return Array.from(group?.querySelectorAll(":scope > button") || []);
}

function slidingToggleActiveButton(group) {
  const buttons = slidingToggleButtons(group);
  return buttons.find((button) =>
    button.classList.contains("active") ||
    button.getAttribute("aria-pressed") === "true" ||
    button.getAttribute("aria-selected") === "true"
  ) || buttons[0] || null;
}

function updateSlidingToggleIndicator(group) {
  if (!group?.isConnected) return;
  let indicator = group.querySelector(":scope > .sliding-toggle-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "sliding-toggle-indicator";
    indicator.setAttribute("aria-hidden", "true");
    group.append(indicator);
  }
  const activeButton = slidingToggleActiveButton(group);
  if (!activeButton) {
    indicator.style.opacity = "0";
    return;
  }
  const groupRect = group.getBoundingClientRect();
  const buttonRect = activeButton.getBoundingClientRect();
  const left = buttonRect.left - groupRect.left - group.clientLeft;
  const top = buttonRect.top - groupRect.top - group.clientTop;
  indicator.style.opacity = "1";
  indicator.style.left = `${Math.round(left)}px`;
  indicator.style.top = `${Math.round(top)}px`;
  indicator.style.width = `${Math.round(buttonRect.width)}px`;
  indicator.style.height = `${Math.round(buttonRect.height)}px`;
}

function scheduleSlidingToggleIndicators(root = document) {
  if (slidingToggleRaf) return;
  slidingToggleRaf = window.requestAnimationFrame(() => {
    slidingToggleRaf = 0;
    syncSlidingToggleIndicators(root);
  });
}

function registerSlidingToggleGroup(group) {
  if (!group || slidingToggleGroups.has(group)) return;
  group.classList.add("sliding-toggle-host");
  slidingToggleGroups.add(group);
  updateSlidingToggleIndicator(group);
  const observer = new MutationObserver(() => scheduleSlidingToggleIndicators());
  observer.observe(group, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-pressed", "aria-selected", "hidden"],
  });
  group.__slidingToggleObserver = observer;
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => scheduleSlidingToggleIndicators());
    resizeObserver.observe(group);
    slidingToggleButtons(group).forEach((button) => resizeObserver.observe(button));
    group.__slidingToggleResizeObserver = resizeObserver;
  }
}

function syncSlidingToggleIndicators(root = document) {
  root.querySelectorAll(".caption-backend-tabs, .list-search-mode-toggle, .image-preview-controls").forEach(registerSlidingToggleGroup);
  slidingToggleGroups.forEach((group) => updateSlidingToggleIndicator(group));
}

window.__vdsScheduleSlidingToggleIndicators = scheduleSlidingToggleIndicators;

const themeMediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

function normalizeThemeMode(mode) {
  return ["auto", "light", "dark"].includes(mode) ? mode : "auto";
}

function resolveThemeMode(mode) {
  const normalized = normalizeThemeMode(mode);
  if (normalized === "auto") return themeMediaQuery?.matches ? "dark" : "light";
  return normalized;
}

function renderThemeMode() {
  const mode = normalizeThemeMode(state.themeMode);
  const resolved = resolveThemeMode(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  refs.themeModeGroup?.querySelectorAll("button[data-theme-mode]").forEach((button) => {
    const isActive = button.dataset.themeMode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  scheduleBottomStatusContrastUpdate();
}

function setThemeMode(mode, { persist = true } = {}) {
  state.themeMode = normalizeThemeMode(mode);
  if (persist) saveStored(STORAGE_KEYS.themeMode, state.themeMode);
  renderThemeMode();
}

function wallpaperOptions() {
  return Array.from(refs.wallpaperMenu?.querySelectorAll("button[data-wallpaper]") || []);
}

function normalizeWallpaper(wallpaper) {
  const value = `${wallpaper || "none"}`;
  const options = wallpaperOptions();
  return options.some((button) => button.dataset.wallpaper === value) ? value : "none";
}

function renderWallpaper() {
  const wallpaper = normalizeWallpaper(state.wallpaper);
  state.wallpaper = wallpaper;
  document.documentElement.dataset.wallpaper = wallpaper === "none" ? "none" : "image";
  if (wallpaper === "none") {
    document.documentElement.style.removeProperty("--app-wallpaper-image");
  } else {
    document.documentElement.style.setProperty("--app-wallpaper-image", `url("${resolveAssetUrl(`wallpapers/${wallpaper}`)}")`);
  }
  wallpaperOptions().forEach((button) => {
    const isSelected = button.dataset.wallpaper === wallpaper;
    button.dataset.selected = isSelected ? "true" : "false";
    button.setAttribute("aria-selected", String(isSelected));
  });
  scheduleBottomStatusContrastUpdate();
}

function setWallpaper(wallpaper, { persist = true } = {}) {
  state.wallpaper = normalizeWallpaper(wallpaper);
  if (persist) saveStored(STORAGE_KEYS.wallpaper, state.wallpaper);
  renderWallpaper();
}

function updateWallpaperMenuPosition() {
  const trigger = refs.wallpaperSwitcher?.querySelector(".wallpaper-trigger");
  const menu = refs.wallpaperMenu;
  if (!trigger || !menu) return;
  const triggerRect = trigger.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 174;
  const menuHeight = menu.offsetHeight || 174;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const gutter = 12;
  const edge = 8;
  const left = Math.max(edge, Math.min(triggerRect.right + gutter, viewportWidth - menuWidth - edge));
  const top = Math.max(edge, Math.min(triggerRect.bottom - menuHeight, viewportHeight - menuHeight - edge));
  menu.style.setProperty("--wallpaper-menu-left", `${Math.round(left)}px`);
  menu.style.setProperty("--wallpaper-menu-top", `${Math.round(top)}px`);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}

function parseRgbColor(colorText) {
  const match = `${colorText || ""}`.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const [r, g, b] = match[1].split(",").slice(0, 3).map((part) => clampByte(Number.parseFloat(part)));
  return [r, g, b];
}

function srgbToLinear(channel) {
  const normalized = clampByte(channel) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function averagePixels(data) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha <= 0) continue;
    r += data[index] * alpha;
    g += data[index + 1] * alpha;
    b += data[index + 2] * alpha;
    count += alpha;
  }
  if (!count) return [238, 238, 238];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function loadWallpaperImage(src) {
  if (!src) return Promise.resolve(null);
  if (wallpaperImageCache.has(src)) return wallpaperImageCache.get(src);
  const imagePromise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  wallpaperImageCache.set(src, imagePromise);
  return imagePromise;
}

function sampleSolidBackgroundColor() {
  const bodyColor = parseRgbColor(window.getComputedStyle(document.body).backgroundColor);
  return bodyColor || [238, 238, 238];
}

async function sampleBottomStatusBackgroundColor() {
  const footer = refs.bottomStatusBar;
  if (!footer) return sampleSolidBackgroundColor();
  if (document.documentElement.dataset.wallpaper !== "image") return sampleSolidBackgroundColor();

  const wallpaper = normalizeWallpaper(state.wallpaper);
  if (!wallpaper || wallpaper === "none") return sampleSolidBackgroundColor();
  const image = await loadWallpaperImage(resolveAssetUrl(`wallpapers/${wallpaper}`));
  if (!image?.naturalWidth || !image?.naturalHeight) return sampleSolidBackgroundColor();

  const footerRect = footer.getBoundingClientRect();
  const bodyRect = document.body.getBoundingClientRect();
  const bodyWidth = Math.max(document.body.clientWidth, document.documentElement.clientWidth, 1);
  const bodyHeight = Math.max(document.body.scrollHeight, document.body.clientHeight, window.innerHeight, 1);
  const coverScale = Math.max(bodyWidth / image.naturalWidth, bodyHeight / image.naturalHeight);
  const renderedWidth = image.naturalWidth * coverScale;
  const renderedHeight = image.naturalHeight * coverScale;
  const offsetX = (bodyWidth - renderedWidth) / 2;
  const offsetY = (bodyHeight - renderedHeight) / 2;

  const sampleLeft = Math.max(0, footerRect.left - bodyRect.left);
  const sampleTop = Math.max(0, footerRect.top - bodyRect.top);
  const sampleWidth = Math.max(1, Math.min(footerRect.width, bodyWidth - sampleLeft));
  const sampleHeight = Math.max(1, Math.min(footerRect.height, bodyHeight - sampleTop));

  const sourceX = Math.max(0, (sampleLeft - offsetX) / coverScale);
  const sourceY = Math.max(0, (sampleTop - offsetY) / coverScale);
  const sourceWidth = Math.max(1, Math.min(image.naturalWidth - sourceX, sampleWidth / coverScale));
  const sourceHeight = Math.max(1, Math.min(image.naturalHeight - sourceY, sampleHeight / coverScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return sampleSolidBackgroundColor();
  canvas.width = 24;
  canvas.height = 8;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return averagePixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

async function updateBottomStatusContrast() {
  bottomStatusContrastRaf = 0;
  const footer = refs.bottomStatusBar;
  if (!footer) return;
  const background = await sampleBottomStatusBackgroundColor();
  if (!footer.isConnected) return;
  const rootStyle = window.getComputedStyle(document.documentElement);
  const darkText = parseRgbColor(rootStyle.getPropertyValue("--emphasis-color")) || [66, 73, 86];
  const lightText = parseRgbColor(rootStyle.getPropertyValue("--ink-contrast")) || [247, 249, 245];
  const darkContrast = contrastRatio(darkText, background);
  const lightContrast = contrastRatio(lightText, background);
  const preferredMode = lightContrast > darkContrast ? "light" : "dark";
  footer.classList.toggle("status-contrast-light", preferredMode === "light");
  footer.classList.toggle("status-contrast-dark", preferredMode === "dark");
}

function scheduleBottomStatusContrastUpdate() {
  if (bottomStatusContrastRaf) window.cancelAnimationFrame(bottomStatusContrastRaf);
  bottomStatusContrastRaf = window.requestAnimationFrame(() => {
    updateBottomStatusContrast().catch(() => {});
  });
}

refs.themeModeGroup?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-theme-mode]");
  if (!button) return;
  setThemeMode(button.dataset.themeMode);
});

refs.wallpaperMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-wallpaper]");
  if (!button) return;
  setWallpaper(button.dataset.wallpaper);
});

refs.wallpaperSwitcher?.querySelector(".wallpaper-trigger")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const nextOpen = !refs.wallpaperSwitcher?.classList.contains("open");
  if (nextOpen) updateWallpaperMenuPosition();
  refs.wallpaperSwitcher?.classList.toggle("open", nextOpen);
  event.currentTarget?.setAttribute("aria-expanded", String(nextOpen));
});

document.addEventListener("click", (event) => {
  if (!refs.wallpaperSwitcher?.contains(event.target)) {
    refs.wallpaperSwitcher?.classList.remove("open");
    refs.wallpaperSwitcher?.querySelector(".wallpaper-trigger")?.setAttribute("aria-expanded", "false");
  }
});

window.addEventListener("resize", () => {
  if (refs.wallpaperSwitcher?.classList.contains("open")) updateWallpaperMenuPosition();
  scheduleBottomStatusContrastUpdate();
  scheduleSlidingToggleIndicators();
});

refs.workbenchShell?.addEventListener("transitionend", (event) => {
  if (["width", "opacity", "transform"].includes(event.propertyName)) {
    scheduleSlidingToggleIndicators();
  }
});

refs.captionSettingsShell?.addEventListener("transitionend", () => {
  scheduleSlidingToggleIndicators();
});

window.addEventListener("scroll", () => {
  if (refs.wallpaperSwitcher?.classList.contains("open")) updateWallpaperMenuPosition();
  scheduleBottomStatusContrastUpdate();
}, { passive: true });

themeMediaQuery?.addEventListener?.("change", () => {
  if (state.themeMode === "auto") renderThemeMode();
  scheduleBottomStatusContrastUpdate();
});

renderThemeMode();
renderWallpaper();
scheduleBottomStatusContrastUpdate();
syncSlidingToggleIndicators();

const bottomStatusTooltipObserver = new MutationObserver(syncBottomStatusTooltips);
document.querySelectorAll(".bottom-status-item").forEach((item) => {
  bottomStatusTooltipObserver.observe(item, { childList: true, subtree: true, characterData: true });
});
syncBottomStatusTooltips();

function showError(error) {
  console.error(error);
  window.appAlert(error.message || String(error), "错误");
}

function activeControlCount() {
  const rawCount = refs.controlCount?.value ?? state.workspace?.settings?.control_count ?? 1;
  const count = Number(rawCount);
  return Math.max(0, Math.min(3, Number.isFinite(count) ? count : 1));
}

function renderLocateSelectedState() {
  const button = refs.locateSelectedBtn;
  if (!button) return;
  const following = Boolean(state.followCaptionCurrent);
  button.classList.toggle("active", following);
  button.setAttribute("aria-pressed", following ? "true" : "false");
  const title = following ? "正在跟随批量打标图片，点击关闭" : "定位到选中的图片";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = false;
}
renderLocateSelectedState();

function renderRefreshListState() {
  const button = refs.refreshListBtn;
  if (!button) return;
  button.disabled = false;
  button.setAttribute("aria-label", "刷新本地数据");
  button.title = "刷新本地数据";
}
renderRefreshListState();

const shellModule = createShellModule({
  state,
  refs,
  UTILITY_PANEL_LABELS,
  STORAGE_KEYS,
  saveStored,
  readStored,
  getLocalCaptionPayload: () => localCaptionPayload(),
  getApiCaptionPayload: () => apiCaptionPayload(),
  getOllamaCaptionPayload: () => ollamaCaptionPayload(),
});
const {
  renderUtilityPanelState,
  setUtilityPanel,
  closeUtilityPanel,
  toggleCaptionSettingsPanel,
  setAiStatusLine,
  runWithStatus,
  activeCaptionBackend,
  activeCaptionBackendLabel,
  activeCaptionPayload,
} = shellModule;

const {
  setWorkspaceBrowserTarget,
  seedWorkspaceBrowserRootFromInputs,
  syncWorkspaceBrowserTargetVisibility,
  applyWorkspaceBrowserPath,
  resolveWorkspaceInputPath,
  workspacePathRelativeToBrowserRoot,
  renderWorkspaceBrowser,
  browseWorkspacePath,
} = createWorkspaceBrowserModule({
  state,
  refs,
  ROLE_LABELS,
  STORAGE_KEYS,
  saveStored,
  apiGet,
  showError,
  activeControlCount,
});

let autoSaveProjectAfterWorkspaceOpen = null;

const browserModule = createBrowserModule({
  state,
  refs,
  STORAGE_KEYS,
  FILTER_LABELS,
  ROLE_LABELS,
  saveStored,
  apiGet,
  apiPost,
  showError,
  confirmDiscardCaptionChanges,
  setCaptionEditorText,
  renderTags: (...args) => renderTags(...args),
  renderGlobalTags: (...args) => renderGlobalTags(...args),
  seedWorkspaceBrowserRootFromInputs,
  syncWorkspaceBrowserTargetVisibility,
  resolveWorkspaceInputPath,
  workspacePathRelativeToBrowserRoot,
  renderWorkspaceBrowser,
  closeUtilityPanel,
  setAiStatusLine,
  autoSaveProjectAfterWorkspaceOpen: () => autoSaveProjectAfterWorkspaceOpen?.(),
});
const {
  renderWorkspaceSummary,
  renderFilters,
  renderItemList,
  renderViewer,
  shouldIgnoreListArrowNavigation,
  scrollSelectedItemIntoView,
  selectRelativeItem,
  prepareSelectionAfterRemoving,
  trashCurrentItem,
  refreshItems,
  selectItem,
  applyWorkspaceSummary,
  clearWorkspaceView,
  loadWorkspace,
  rescanWorkspace,
  mergeWorkspace,
  updateControlFieldVisibility,
} = browserModule;

const {
  renderProjects,
  refreshProjects,
  applyProjectUiState,
  saveCurrentProject,
  saveImportedWorkspaceToProject,
  createProject,
  openProject,
  saveOpenProjectUiState,
  cleanupTmpNow,
} = createProjectsModule({
  state,
  refs,
  apiGet,
  apiPost,
  runWithStatus,
  setAiStatusLine,
  showError,
  applyWorkspaceSummary,
  clearWorkspaceView,
  refreshItems,
  renderWorkspaceSummary,
  closeUtilityPanel,
  saveStored,
  STORAGE_KEYS,
  renderQuickTags: (...args) => renderQuickTags(...args),
  renderOverwriteModeHints: (...args) => renderOverwriteModeHints(...args),
  selectItem,
  saveCurrentCaption: (...args) => saveCurrentCaption(...args),
});

autoSaveProjectAfterWorkspaceOpen = saveImportedWorkspaceToProject;

const editorModule = createEditorModule({
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
  onGlobalTagClick: (segment) => {
    state.segmentQuery = segment;
    state.listSearchMode = "phrase";
    saveStored(STORAGE_KEYS.listSearchMode, state.listSearchMode);
    refs.tagSearch.value = segment;
    refs.tagSearch.dispatchEvent(new Event("input", { bubbles: true }));
    refs.tagSearchModeGroup?.querySelectorAll("button[data-search-mode]").forEach((button) => {
      const isActive = button.dataset.searchMode === state.listSearchMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    refs.tagSearchMatchGroup?.querySelectorAll("button[data-search-match]").forEach((button) => {
      const isActive = button.dataset.searchMatch === state.listSearchMatchMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    refs.tagSearch.placeholder = "搜索 caption 短语";
    refreshItems().catch(showError);
  },
});
const {
  renderPromptTemplateSelectors,
  templateById,
  updateCaptionSearchHighlight: syncCaptionSearchHighlight,
  appendSegmentsToCaption,
  toggleQuickTags,
  renderQuickTags,
  saveCurrentCaption,
  scheduleCaptionAutosave,
  flushCaptionAutosave: editorFlushCaptionAutosave,
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
} = editorModule;
renderTags = editorModule.renderTags;
renderGlobalTags = editorModule.renderGlobalTags;
flushCaptionAutosave = editorFlushCaptionAutosave;
updateCaptionSearchHighlight = syncCaptionSearchHighlight;

const {
  renderImageProcessStatus,
  processImages,
  processMatchResultSizes,
  scaleViewerItem,
  matchViewerControlsToResult,
  exportDataset,
} = createImageOpsModule({
  state,
  refs,
  apiPost,
  pollAiStatus: (...args) => pollAiStatus(...args),
  renderViewer,
  refreshItems,
  setAiStatusLine,
});

const captionModule = createCaptionModule({
  state,
  refs,
  STORAGE_KEYS,
  DEFAULT_OLLAMA_URL,
  readStored,
  saveStored,
  restoreSelectValue,
  apiGet,
  apiPost,
  setAiStatusLine,
  activeCaptionBackendLabel,
  renderLocateSelectedState,
  renderImageProcessStatus,
  refreshItems,
  selectItem,
  scrollSelectedItemIntoView,
  visibleNames,
  applyWorkspaceSummary,
  renderViewer,
  renderTags,
  setCaptionEditorText,
});
const {
  renderLocalModelMeta,
  renderOverwriteModeHints,
  renderLocalModelOptions,
  renderOllamaSuggestions,
  openApiModelMenu,
  closeApiModelMenu,
  renderApiModelSuggestions,
  openOllamaModelMenu,
  closeOllamaModelMenu,
  renderAiStatus,
  localCaptionPayload,
  apiCaptionPayload,
  ollamaCaptionPayload,
  loadModel,
  validateLocalModel,
  validateApiModel,
  validateOllamaModel,
  loadApiModels,
  loadOllamaModels,
  captionCurrentWithPayload,
  startBatchCaptionWithPayload,
  stopBatchCaption,
  installDeps,
  nextAiPollDelay,
  scheduleNextAiPoll,
  pollAiStatus,
  loadAiOptions,
  restoreCaptionSettings,
} = captionModule;

const { restorePersistedSettings, bindSettingsPersistence, bindEvents, bootstrap } = createBootstrapModule({
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
  applyWorkspaceSummary,
  renderAiStatus,
  renderOverwriteModeHints,
  renderWorkspaceBrowser,
  updateControlFieldVisibility,
  scrollSelectedItemIntoView,
  renderLocateSelectedState,
  browseWorkspacePath,
  applyWorkspaceBrowserPath,
  setWorkspaceBrowserTarget,
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
});

bootstrap().catch(showError);
