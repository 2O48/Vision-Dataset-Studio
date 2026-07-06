import { resolveApiUrl } from "./web_shared.js";

export function createProjectsModule({
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
  renderQuickTags,
  renderOverwriteModeHints,
  selectItem,
  saveCurrentCaption,
}) {
  const PROJECT_STATE_VERSION = 1;
  let projectUiStateSaveTimer = 0;
  let versionDialog = null;
  let activeVersionProject = null;
  let projectSavePromise = null;
  let projectTags = [];
  let projectTagDragIndex = -1;
  let projectTagDragMoved = false;
  let projectTagHoverTimer = 0;
  let projectTagHoverRow = null;
  let projectTagSortTimer = 0;
  let projectEditDialog = null;
  let projectTagDialog = null;

  function setProjectStatus(message) {
    if (refs.projectStatus) refs.projectStatus.textContent = message;
    setAiStatusLine?.(message);
  }

  function selectedTemplateIds() {
    const values = {};
    document.querySelectorAll(".template-row").forEach((row) => {
      const targetId = row.dataset.templateTarget;
      const select = row.querySelector(".promptTemplateSelect");
      if (targetId && select) values[targetId] = select.value;
    });
    return values;
  }

  function restoreTemplateIds(values) {
    if (!values || typeof values !== "object") return;
    document.querySelectorAll(".template-row").forEach((row) => {
      const targetId = row.dataset.templateTarget;
      const select = row.querySelector(".promptTemplateSelect");
      const value = values[targetId];
      if (!targetId || !select || !value) return;
      if (Array.from(select.options).some((option) => option.value === value)) {
        select.value = value;
        select.dispatchEvent(new Event("vds-select-sync", { bubbles: true }));
      }
    });
  }

  function setValue(ref, value, storageKey = "") {
    if (!ref || value === undefined || value === null) return;
    ref.value = `${value}`;
    ref.dispatchEvent?.(new Event("vds-select-sync", { bubbles: true }));
    if (storageKey) saveStored(storageKey, ref.value);
  }

  function setChecked(ref, value, storageKey = "") {
    if (!ref || value === undefined || value === null) return;
    ref.checked = Boolean(value);
    if (storageKey) saveStored(storageKey, ref.checked ? "true" : "false");
  }

  function ensureExportIncludeControlsForActiveControls() {
    const controlCount = Number(refs.controlCount?.value ?? 0);
    if (!refs.exportIncludeControls || !Number.isFinite(controlCount) || controlCount < 1) return;
    refs.exportIncludeControls.checked = true;
    saveStored(STORAGE_KEYS.exportIncludeControls, "true");
  }

  function normalizeProjectThumbMode(value) {
    const mode = `${value || "result"}`;
    return /^(combined|control[1-3])$/.test(mode) ? mode : "result";
  }

  function collectProjectUiState(projectName) {
    return {
      version: PROJECT_STATE_VERSION,
      selected_name: state.selectedName || "",
      selected_panel: state.selectedPanel || "primary",
      filter: state.filter || "all",
      item_folder_filter: state.itemFolderFilter || "",
      segment_query: refs.tagSearch?.value.trim() || state.segmentQuery || "",
      list_search_mode: state.listSearchMode === "name" ? "name" : "phrase",
      list_search_match_mode: state.listSearchMatchMode === "exact" ? "exact" : "contains",
      list_thumb_mode: normalizeProjectThumbMode(state.listThumbMode),
      secondary_filter: state.secondaryFilter || "all",
      secondary_item_folder_filter: state.secondaryItemFolderFilter || "",
      secondary_segment_query: refs.secondaryTagSearch?.value.trim() || state.secondarySegmentQuery || "",
      secondary_list_search_mode: state.secondaryListSearchMode === "name" ? "name" : "phrase",
      secondary_list_search_match_mode: state.secondaryListSearchMatchMode === "exact" ? "exact" : "contains",
      secondary_list_thumb_mode: normalizeProjectThumbMode(state.secondaryListThumbMode),
      split_list_open: Boolean(state.splitListOpen),
      utility_panel: state.utilityPanel || "projects",
      view_mode: state.viewMode || "two",
      workspace_browser_target: state.browserTarget || "control1",
      quick_tags: Array.isArray(state.quickTags) ? state.quickTags : [],
      quick_tags_collapsed: Boolean(state.quickTagsCollapsed),
      template_selections: selectedTemplateIds(),
      workspace_settings: {
        control_count: refs.controlCount?.value || "",
        ignore_tokens: refs.ignoreTokensInput?.value || "",
        auto_open_last_workspace: Boolean(refs.autoOpenLastWorkspace?.checked),
        workspace_browser_root: refs.workspaceBrowserRoot?.value || "",
      },
      caption_settings: {
        backend: refs.captionBackend?.value || "",
        local_model: refs.aiModel?.value || "",
        local_overwrite_mode: refs.overwriteMode?.value || "",
        local_caption_mode: refs.captionMode?.value || "",
        local_max_tokens: refs.maxTokens?.value || "",
        local_thinking_mode: Boolean(refs.localThinkingMode?.checked),
        local_prompt: refs.customPrompt?.value || "",
        api_base_url: refs.apiBaseUrl?.value || "",
        api_key: refs.apiKey?.value || "",
        api_model_name: refs.apiModelName?.value || "",
        api_overwrite_mode: refs.apiOverwriteMode?.value || "",
        api_caption_mode: refs.apiCaptionMode?.value || "",
        api_max_tokens: refs.apiMaxTokens?.value || "",
        api_thinking_mode: Boolean(refs.apiThinkingMode?.checked),
        api_prompt: refs.apiPrompt?.value || "",
        ollama_base_url: refs.ollamaBaseUrl?.value || "",
        ollama_model_name: refs.ollamaModelName?.value || "",
        ollama_overwrite_mode: refs.ollamaOverwriteMode?.value || "",
        ollama_caption_mode: refs.ollamaCaptionMode?.value || "",
        ollama_max_tokens: refs.ollamaMaxTokens?.value || "",
        ollama_thinking_mode: Boolean(refs.ollamaThinkingMode?.checked),
        ollama_prompt: refs.ollamaPrompt?.value || "",
      },
      processing_settings: {
        viewer_target_pixels: refs.viewerTargetPixels?.value || "",
        process_project_name: refs.processProjectName?.value || "",
        process_include_controls: Boolean(refs.processIncludeControls?.checked),
        process_load_workspace: Boolean(refs.processLoadWorkspace?.checked),
        process_only_mismatched: Boolean(refs.processOnlyMismatched?.checked),
        export_project_name: projectName || "",
        export_target_pixels: refs.exportTargetPixels?.value || "",
        export_size_multiple: refs.exportSizeMultiple?.value || "",
        export_format: refs.exportFormat?.value || "",
        export_output_dir: refs.exportOutputDir?.value || "",
        export_process_images: Boolean(refs.exportProcessImages?.checked),
        export_include_controls: Boolean(refs.exportIncludeControls?.checked),
      },
    };
  }

  function rememberOpenedWorkspace(workspace) {
    const dirs = workspace?.dirs || {};
    if (!Object.values(dirs).some(Boolean)) return;
    const projectId = state.currentProjectId || workspace?.project_id || "";
    const projectName = state.currentProjectName || workspace?.project_name || "";
    if (projectId) {
      saveStored(STORAGE_KEYS.lastProjectId, `${projectId}`);
      saveStored(STORAGE_KEYS.lastProjectName, `${projectName || projectId}`);
    }
    saveStored(STORAGE_KEYS.lastWorkspaceDirs, JSON.stringify({
      project_id: projectId,
      project_name: projectName,
      control1_dir: dirs.control1 || "",
      control2_dir: dirs.control2 || "",
      control3_dir: dirs.control3 || "",
      result_dir: dirs.result || "",
      control_count: workspace?.settings?.control_count ?? refs.controlCount?.value ?? 1,
      ignore_tokens: Array.isArray(workspace?.settings?.ignore_tokens)
        ? workspace.settings.ignore_tokens.join(", ")
        : refs.ignoreTokensInput?.value || "",
    }));
  }

  function setExportProjectNameDefault(projectName) {
    if (!refs.exportProjectName) return;
    refs.exportProjectName.value = `${projectName || ""}`.trim();
  }

  function setProcessProjectNameDefault(projectName) {
    if (!refs.processProjectName) return;
    refs.processProjectName.value = `${projectName || ""}`.trim();
  }

  function applyProjectUiState(uiState, projectName) {
    setExportProjectNameDefault(projectName);
    setProcessProjectNameDefault(projectName);
    if (!uiState || typeof uiState !== "object") return;
    const workspaceSettings = uiState.workspace_settings || {};
    const captionSettings = uiState.caption_settings || {};
    const processingSettings = uiState.processing_settings || {};

    setValue(refs.controlCount, workspaceSettings.control_count, STORAGE_KEYS.controlCount);
    setValue(refs.ignoreTokensInput, workspaceSettings.ignore_tokens, STORAGE_KEYS.ignoreTokens);
    setChecked(refs.autoOpenLastWorkspace, workspaceSettings.auto_open_last_workspace, STORAGE_KEYS.autoOpenLastWorkspace);
    setValue(refs.workspaceBrowserRoot, workspaceSettings.workspace_browser_root, STORAGE_KEYS.workspaceBrowserRoot);

    setValue(refs.captionBackend, captionSettings.backend, STORAGE_KEYS.captionBackend);
    setValue(refs.aiModel, captionSettings.local_model, STORAGE_KEYS.localModel);
    setValue(refs.overwriteMode, captionSettings.local_overwrite_mode, STORAGE_KEYS.localOverwriteMode);
    setValue(refs.captionMode, captionSettings.local_caption_mode, STORAGE_KEYS.localCaptionMode);
    setValue(refs.maxTokens, captionSettings.local_max_tokens, STORAGE_KEYS.localMaxTokens);
    setChecked(refs.localThinkingMode, captionSettings.local_thinking_mode ?? false, STORAGE_KEYS.localThinkingMode);
    setValue(refs.customPrompt, captionSettings.local_prompt, STORAGE_KEYS.localPrompt);
    setValue(refs.apiBaseUrl, captionSettings.api_base_url, STORAGE_KEYS.apiBaseUrl);
    setValue(refs.apiKey, captionSettings.api_key, STORAGE_KEYS.apiKey);
    setValue(refs.apiModelName, captionSettings.api_model_name, STORAGE_KEYS.apiModelName);
    setValue(refs.apiOverwriteMode, captionSettings.api_overwrite_mode, STORAGE_KEYS.apiOverwriteMode);
    setValue(refs.apiCaptionMode, captionSettings.api_caption_mode, STORAGE_KEYS.apiCaptionMode);
    setValue(refs.apiMaxTokens, captionSettings.api_max_tokens, STORAGE_KEYS.apiMaxTokens);
    setChecked(refs.apiThinkingMode, captionSettings.api_thinking_mode ?? false, STORAGE_KEYS.apiThinkingMode);
    setValue(refs.apiPrompt, captionSettings.api_prompt, STORAGE_KEYS.apiPrompt);
    setValue(refs.ollamaBaseUrl, captionSettings.ollama_base_url, STORAGE_KEYS.ollamaBaseUrl);
    setValue(refs.ollamaModelName, captionSettings.ollama_model_name, STORAGE_KEYS.ollamaModelName);
    setValue(refs.ollamaOverwriteMode, captionSettings.ollama_overwrite_mode, STORAGE_KEYS.ollamaOverwriteMode);
    setValue(refs.ollamaCaptionMode, captionSettings.ollama_caption_mode, STORAGE_KEYS.ollamaCaptionMode);
    setValue(refs.ollamaMaxTokens, captionSettings.ollama_max_tokens, STORAGE_KEYS.ollamaMaxTokens);
    setChecked(refs.ollamaThinkingMode, captionSettings.ollama_thinking_mode ?? false, STORAGE_KEYS.ollamaThinkingMode);
    setValue(refs.ollamaPrompt, captionSettings.ollama_prompt, STORAGE_KEYS.ollamaPrompt);

    setValue(refs.viewerTargetPixels, processingSettings.viewer_target_pixels, STORAGE_KEYS.viewerTargetPixels);
    setProcessProjectNameDefault(projectName);
    setChecked(refs.processIncludeControls, processingSettings.process_include_controls, STORAGE_KEYS.processIncludeControls);
    setChecked(refs.processLoadWorkspace, processingSettings.process_load_workspace, STORAGE_KEYS.processLoadWorkspace);
    setChecked(refs.processOnlyMismatched, processingSettings.process_only_mismatched, STORAGE_KEYS.processOnlyMismatched);
    setExportProjectNameDefault(projectName);
    setValue(refs.exportTargetPixels, processingSettings.export_target_pixels, STORAGE_KEYS.exportTargetPixels);
    setValue(refs.exportSizeMultiple, processingSettings.export_size_multiple, STORAGE_KEYS.exportSizeMultiple);
    setValue(refs.exportFormat, processingSettings.export_format, STORAGE_KEYS.exportFormat);
    setValue(refs.exportOutputDir, processingSettings.export_output_dir, STORAGE_KEYS.exportOutputDir);
    setChecked(refs.exportProcessImages, processingSettings.export_process_images, STORAGE_KEYS.exportProcessImages);
    setChecked(refs.exportIncludeControls, processingSettings.export_include_controls, STORAGE_KEYS.exportIncludeControls);
    ensureExportIncludeControlsForActiveControls();

    if (Array.isArray(uiState.quick_tags)) {
      state.quickTags = uiState.quick_tags;
      saveStored(STORAGE_KEYS.quickTags, JSON.stringify(state.quickTags));
    }
    if (uiState.quick_tags_collapsed !== undefined) {
      state.quickTagsCollapsed = Boolean(uiState.quick_tags_collapsed);
      saveStored(STORAGE_KEYS.quickTagsCollapsed, state.quickTagsCollapsed ? "true" : "false");
    }
    state.quickTagsDirty = false;
    renderQuickTags();

    state.viewMode = uiState.view_mode || state.viewMode;
    saveStored(STORAGE_KEYS.viewMode, state.viewMode);
    state.selectedPanel = uiState.selected_panel === "secondary" ? "secondary" : "primary";
    state.filter = uiState.filter || "all";
    state.itemFolderFilter = uiState.item_folder_filter || "";
    state.segmentQuery = uiState.segment_query || "";
    if (refs.tagSearch) refs.tagSearch.value = state.segmentQuery;
    state.listSearchMode = uiState.list_search_mode === "name" ? "name" : "phrase";
    saveStored(STORAGE_KEYS.listSearchMode, state.listSearchMode);
    state.listSearchMatchMode = uiState.list_search_match_mode === "exact" ? "exact" : "contains";
    saveStored(STORAGE_KEYS.listSearchMatchMode, state.listSearchMatchMode);
    state.listThumbMode = normalizeProjectThumbMode(uiState.list_thumb_mode);
    saveStored(STORAGE_KEYS.listThumbMode, state.listThumbMode);
    state.secondaryFilter = uiState.secondary_filter || "all";
    state.secondaryItemFolderFilter = uiState.secondary_item_folder_filter || "";
    state.secondarySegmentQuery = uiState.secondary_segment_query || "";
    if (refs.secondaryTagSearch) refs.secondaryTagSearch.value = state.secondarySegmentQuery;
    state.secondaryListSearchMode = uiState.secondary_list_search_mode === "name" ? "name" : "phrase";
    saveStored(STORAGE_KEYS.secondaryListSearchMode, state.secondaryListSearchMode);
    state.secondaryListSearchMatchMode = uiState.secondary_list_search_match_mode === "exact" ? "exact" : "contains";
    saveStored(STORAGE_KEYS.secondaryListSearchMatchMode, state.secondaryListSearchMatchMode);
    state.secondaryListThumbMode = normalizeProjectThumbMode(uiState.secondary_list_thumb_mode);
    saveStored(STORAGE_KEYS.secondaryListThumbMode, state.secondaryListThumbMode);
    state.splitListOpen = Boolean(uiState.split_list_open);
    saveStored(STORAGE_KEYS.splitListOpen, state.splitListOpen ? "1" : "0");
    [
      [refs.tagSearchModeGroup, state.listSearchMode],
      [refs.secondaryTagSearchModeGroup, state.secondaryListSearchMode],
    ].filter(([group]) => Boolean(group)).forEach(([group, mode]) => {
      group.querySelectorAll("button[data-search-mode]").forEach((button) => {
        const isActive = button.dataset.searchMode === mode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    });
    [
      [refs.tagSearchMatchGroup, state.listSearchMatchMode],
      [refs.secondaryTagSearchMatchGroup, state.secondaryListSearchMatchMode],
    ].filter(([group]) => Boolean(group)).forEach(([group, matchMode]) => {
      group.querySelectorAll("button[data-search-match]").forEach((button) => {
        const isActive = button.dataset.searchMatch === matchMode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    });
    if (refs.tagSearch) {
      refs.tagSearch.placeholder = state.listSearchMode === "name" ? "搜索图片名称 / 子文件夹" : "搜索 caption 短语";
    }
    if (refs.secondaryTagSearch) {
      refs.secondaryTagSearch.placeholder = state.secondaryListSearchMode === "name" ? "搜索图片名称 / 子文件夹" : "搜索 caption 短语";
    }
    state.browserTarget = uiState.workspace_browser_target || state.browserTarget;
    saveStored(STORAGE_KEYS.workspaceBrowserTarget, state.browserTarget);
    state.utilityPanel = uiState.utility_panel || state.utilityPanel;
    restoreTemplateIds(uiState.template_selections);
    renderOverwriteModeHints();
  }

  function projectProgressText(project) {
    const total = Number(project.item_count || 0);
    const done = Number(project.captioned_count || 0);
    if (!total) return "0 项";
    return `${done}/${total} 已标注`;
  }

  function visibleProjects() {
    const query = state.projectQuery.trim().toLowerCase();
    const tagFilters = activeProjectTagFilters();
    let rows = state.projects.filter((project) => {
      const matchesQuery = !query || `${project.name || ""} ${project.id || ""}`.toLowerCase().includes(query);
      if (!matchesQuery) return false;
      if (!tagFilters.length) return true;
      const projectTagSet = new Set(_cleanTagList(project.tags || []).map((tag) => tag.toLowerCase()));
      return tagFilters.every((tag) => projectTagSet.has(tag.toLowerCase()));
    });
    rows = [...rows].sort((a, b) => {
      if (state.projectSortMode === "name") {
        return `${a.name || ""}`.localeCompare(`${b.name || ""}`, "zh-CN");
      }
      const key = state.projectSortMode === "created" ? "created_at" : "updated_at";
      return `${b[key] || ""}`.localeCompare(`${a[key] || ""}`);
    });
    return rows;
  }

  function availableProjectFilterTags() {
    const tags = [];
    const seen = new Set();
    const add = (value) => {
      const tag = _cleanTagList([value])[0] || "";
      const key = tag.toLowerCase();
      if (tag && !seen.has(key)) {
        tags.push(tag);
        seen.add(key);
      }
    };
    projectTags.forEach(add);
    state.projects.forEach((project) => (Array.isArray(project.tags) ? project.tags : []).forEach(add));
    return tags;
  }

  function activeProjectTagFilters() {
    return _cleanTagList(state.projectTagFilters || []);
  }

  function saveProjectTagFilters(filters) {
    state.projectTagFilters = _cleanTagList(filters);
    saveStored(STORAGE_KEYS.projectTagFilters, JSON.stringify(state.projectTagFilters));
  }

  function normalizeProjectTagFilters() {
    const available = new Set(availableProjectFilterTags().map((tag) => tag.toLowerCase()));
    const next = activeProjectTagFilters().filter((tag) => available.has(tag.toLowerCase()));
    if (next.length !== activeProjectTagFilters().length) saveProjectTagFilters(next);
  }

  function renderProjectTagFilters() {
    if (!refs.projectTagFilter) return;
    refs.projectTagFilter.textContent = "";
    const tags = availableProjectFilterTags();
    const selected = activeProjectTagFilters();
    refs.projectTagFilter.hidden = !tags.length;
    if (!tags.length) return;

    const all = document.createElement("button");
    all.type = "button";
    all.className = "project-tag-filter-tab folder-filter-chip";
    all.textContent = "全部";
    all.classList.toggle("active", !selected.length);
    all.setAttribute("aria-pressed", String(!selected.length));
    all.addEventListener("click", () => {
      saveProjectTagFilters([]);
      renderProjects();
    });
    refs.projectTagFilter.appendChild(all);

    const options = document.createElement("div");
    options.className = "project-tag-filter-options folder-filter-group";
    refs.projectTagFilter.appendChild(options);

    const selectedSet = new Set(selected.map((tag) => tag.toLowerCase()));
    for (const tag of tags) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-tag-filter-tab folder-filter-chip";
      button.textContent = tag;
      button.dataset.tag = tag;
      const active = selectedSet.has(tag.toLowerCase());
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => {
        const next = active
          ? selected.filter((item) => item.toLowerCase() !== tag.toLowerCase())
          : [...selected, tag];
        saveProjectTagFilters(next);
        renderProjects();
      });
      options.appendChild(button);
    }
  }

  async function refreshProjects() {
    const data = await apiGet("/api/projects");
    state.projects = data.projects || [];
    await loadProjectTags();
    normalizeProjectTagFilters();
    if (!state.currentProjectId && !state.currentProjectName && state.projects.length === 1 && state.workspace?.counts?.all) {
      const project = state.projects[0];
      state.currentProjectId = project.id || "";
      state.currentProjectName = project.name || project.id || "";
      if (refs.projectNameInput && state.currentProjectName) refs.projectNameInput.value = state.currentProjectName;
      rememberOpenedWorkspace(state.workspace);
      renderWorkspaceSummary();
    }
    renderProjects();
    setProjectStatus(
      state.currentProjectName
        ? `当前项目：${state.currentProjectName} · 已载入 ${state.projects.length} 个项目`
        : `已载入 ${state.projects.length} 个项目`
    );
  }

  function projectNameFromInput() {
    return `${state.currentProjectName || state.workspace?.project_name || ""}`.trim() || importedWorkspaceProjectName();
  }

  function formatVersionTime(value) {
    if (!value) return "未记录时间";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function shortCommit(hash) {
    return `${hash || ""}`.slice(0, 7);
  }

  function formatProjectCardTime(value) {
    const raw = `${value || ""}`.trim();
    if (!raw) return "未记录时间";
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const pad = (num) => `${num}`.padStart(2, "0");
      return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
      ].join(" ");
    }
    return raw.replace("T", " ").replace(/([+-]\d{2}:\d{2}|Z)$/, "");
  }

  function projectCardTime(project) {
    const useCreated = state.projectSortMode === "created";
    const time = formatProjectCardTime(useCreated ? project.created_at : project.updated_at);
    const commit = shortCommit(useCreated ? project.created_commit : project.updated_commit);
    return commit ? `${time} · ${commit}` : time;
  }

  const VERSION_ICONS = {
    edit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><path d="M96,216H48a8,8,0,0,1-8-8V163.31a8,8,0,0,1,2.34-5.65L165.66,34.34a8,8,0,0,1,11.31,0L221.66,79a8,8,0,0,1,0,11.31Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="216" y1="216" x2="96" y2="216" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="136" y1="64" x2="192" y2="120" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
    current: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><line x1="128" y1="176" x2="128" y2="240" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="64" y1="40" x2="192" y2="40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="40" y1="176" x2="216" y2="176" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="56" y1="176" x2="80" y2="40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="176" y1="40" x2="200" y2="176" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
    version: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><circle cx="128" cy="128" r="48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="8" y1="128" x2="80" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="176" y1="128" x2="248" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
    rollback: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><polyline points="80 136 32 88 80 40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M80,200h88a56,56,0,0,0,56-56h0a56,56,0,0,0-56-56H32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
    fork: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><path d="M64,88v24a16,16,0,0,0,16,16h96a16,16,0,0,0,16-16V88" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="128" y1="128" x2="128" y2="168" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="64" cy="64" r="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="128" cy="192" r="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="192" cy="64" r="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
    close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><line x1="200" y1="56" x2="56" y2="200" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="200" y1="200" x2="56" y2="56" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
    delete: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" fill="none"/><line x1="216" y1="56" x2="40" y2="56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="104" y1="104" x2="104" y2="168" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="152" y1="104" x2="152" y2="168" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M168,56V40a16,16,0,0,0-16-16H104A16,16,0,0,0,88,40V56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>',
  };

  function makeVersionIconButton({ icon, label, disabled = false } = {}) {
    const button = document.createElement("button");
    button.className = "button-ghost project-version-icon-btn";
    button.type = "button";
    button.innerHTML = icon || "";
    button.disabled = Boolean(disabled);
    button.setAttribute("aria-label", label || "");
    button.title = label || "";
    return button;
  }

  async function loadProjectTags() {
    const data = await apiGet("/api/projects/tags");
    projectTags = Array.isArray(data.tags) ? data.tags : [];
    return projectTags;
  }

  function openDialogBackdrop(backdrop) {
    backdrop.classList.remove("dialog-closing");
    backdrop.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => backdrop.classList.add("dialog-open"));
  }

  function closeDialogBackdrop(backdrop) {
    if (!backdrop) return;
    backdrop.classList.remove("dialog-open");
    backdrop.classList.add("dialog-closing");
    backdrop.setAttribute("aria-hidden", "true");
    window.setTimeout(() => backdrop.classList.remove("dialog-closing"), 180);
  }

  function renderTagChoices(container, selected = []) {
    container.textContent = "";
    const selectedSet = new Set(_cleanTagList(selected).map((tag) => tag.casefold?.() || tag.toLowerCase()));
    if (!projectTags.length) {
      const empty = document.createElement("p");
      empty.className = "project-tag-empty";
      empty.textContent = "暂无可选标签";
      container.appendChild(empty);
      return;
    }
    for (const tag of projectTags) {
      const button = document.createElement("button");
      button.className = "project-tag-choice";
      button.type = "button";
      button.dataset.tag = tag;
      button.textContent = tag;
      const active = selectedSet.has(tag.casefold?.() || tag.toLowerCase());
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => {
        const nextActive = !button.classList.contains("active");
        button.classList.toggle("active", nextActive);
        button.setAttribute("aria-pressed", String(nextActive));
      });
      container.appendChild(button);
    }
  }

  function selectedTagChoices(container) {
    return Array.from(container.querySelectorAll(".project-tag-choice.active")).map((button) => button.dataset.tag || "");
  }

  function _cleanTagList(values) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const tag = `${value || ""}`.trim().replace(/\s+/g, " ").slice(0, 40);
      const key = tag.toLowerCase();
      if (tag && !seen.has(key)) {
        result.push(tag);
        seen.add(key);
      }
    }
    return result;
  }

  function ensureProjectEditDialog() {
    if (projectEditDialog?.backdrop?.isConnected) return projectEditDialog;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop project-edit-dialog";
    backdrop.setAttribute("aria-hidden", "true");
    const panel = document.createElement("section");
    panel.className = "dialog-panel project-edit-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.textContent = "修改项目";
    const input = document.createElement("input");
    input.className = "dialog-input";
    input.placeholder = "项目名称";
    const tags = document.createElement("div");
    tags.className = "project-tag-select";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.className = "button-ghost";
    cancel.type = "button";
    cancel.textContent = "取消";
    const confirm = document.createElement("button");
    confirm.className = "button-primary";
    confirm.type = "button";
    confirm.textContent = "确定";
    actions.append(cancel, confirm);
    panel.append(title, input, tags, actions);
    backdrop.appendChild(panel);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeDialogBackdrop(backdrop);
    });
    cancel.addEventListener("click", () => closeDialogBackdrop(backdrop));
    document.body.appendChild(backdrop);
    projectEditDialog = { backdrop, input, tags, confirm };
    return projectEditDialog;
  }

  async function openProjectEditor(project) {
    await loadProjectTags();
    const dialog = ensureProjectEditDialog();
    dialog.input.value = project.name || project.id || "";
    renderTagChoices(dialog.tags, project.tags || []);
    dialog.confirm.onclick = async () => {
      const name = dialog.input.value.trim();
      if (!name) return;
      closeDialogBackdrop(dialog.backdrop);
      await runWithStatus("正在修改项目...", async () => {
        const data = await apiPost("/api/projects/rename", {
          id: project.id,
          name,
          tags: selectedTagChoices(dialog.tags),
        });
        if (state.currentProjectId === project.id) {
          state.currentProjectId = data.project?.id || project.id;
          state.currentProjectName = data.project?.name || name;
          if (refs.projectNameInput) refs.projectNameInput.value = state.currentProjectName;
          renderWorkspaceSummary();
        }
        setProjectStatus(`已修改项目：${data.project?.name || name}`);
        await refreshProjects();
      });
    };
    openDialogBackdrop(dialog.backdrop);
    dialog.input.focus({ preventScroll: true });
  }

  function ensureProjectTagDialog() {
    if (projectTagDialog?.backdrop?.isConnected) return projectTagDialog;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop project-tag-dialog";
    backdrop.setAttribute("aria-hidden", "true");
    const panel = document.createElement("section");
    panel.className = "dialog-panel project-version-panel project-tag-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const head = document.createElement("div");
    head.className = "project-version-head";
    const title = document.createElement("h2");
    title.textContent = "标签管理";
    const close = makeVersionIconButton({ icon: VERSION_ICONS.close, label: "关闭" });
    close.classList.add("project-version-close-btn");
    head.append(title, close);
    const row = document.createElement("div");
    row.className = "project-tag-add-row";
    const input = document.createElement("input");
    input.className = "dialog-input";
    input.placeholder = "新增标签";
    const add = document.createElement("button");
    add.className = "button-primary";
    add.type = "button";
    add.textContent = "添加";
    row.append(input, add);
    const list = document.createElement("div");
    list.className = "project-version-list project-tag-manager-list";
    panel.append(head, row, list);
    backdrop.appendChild(panel);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeDialogBackdrop(backdrop);
    });
    close.addEventListener("click", () => closeDialogBackdrop(backdrop));
    add.addEventListener("click", () => addProjectTag(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addProjectTag(input.value);
      }
    });
    document.body.appendChild(backdrop);
    projectTagDialog = { backdrop, input, list };
    return projectTagDialog;
  }

  async function saveProjectTagList(tags) {
    const data = await apiPost("/api/projects/tags", { tags: _cleanTagList(tags) });
    projectTags = Array.isArray(data.tags) ? data.tags : [];
    renderProjectTagManager();
    await refreshProjects();
  }

  async function addProjectTag(value) {
    const tag = _cleanTagList([value])[0] || "";
    if (!tag) return;
    const next = _cleanTagList([...projectTags, tag]);
    if (projectTagDialog?.input) projectTagDialog.input.value = "";
    await saveProjectTagList(next);
  }

  function renderProjectTagManager() {
    const dialog = ensureProjectTagDialog();
    dialog.list.textContent = "";
    if (!projectTags.length) {
      const empty = document.createElement("p");
      empty.className = "project-tag-empty";
      empty.textContent = "暂无标签";
      dialog.list.appendChild(empty);
      return;
    }
    projectTags.forEach((tag, index) => {
      const row = document.createElement("div");
      row.className = "project-version-row project-tag-manager-row";
      row.dataset.tagIndex = String(index);
      row.draggable = true;
      const handle = document.createElement("span");
      handle.className = "quick-tag-handle project-tag-drag-handle";
      handle.textContent = "::";
      handle.draggable = true;
      handle.title = "拖拽排序";
      const body = document.createElement("div");
      body.className = "project-tag-manager-body";
      const name = document.createElement("span");
      name.className = "project-tag-manager-name";
      name.textContent = tag;
      body.appendChild(name);
      const actions = document.createElement("div");
      actions.className = "project-version-actions";
      const remove = makeVersionIconButton({ icon: VERSION_ICONS.delete, label: "删除" });
      remove.addEventListener("click", () => saveProjectTagList(projectTags.filter((item) => item !== tag)).catch(showError));
      actions.appendChild(remove);
      row.addEventListener("dragstart", (event) => {
        if (event.target?.closest?.("button")) {
          event.preventDefault();
          return;
        }
        projectTagDragIndex = Number(row.dataset.tagIndex);
        projectTagDragMoved = false;
        row.classList.add("dragging");
        event.dataTransfer?.setData("text/plain", String(projectTagDragIndex));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        clearProjectTagHoverTimer();
        const moved = projectTagDragMoved;
        projectTagDragIndex = -1;
        projectTagDragMoved = false;
        row.classList.remove("dragging");
        dialog.list.classList.remove("sorting");
        if (moved) saveProjectTagList([...projectTags]).catch(showError);
      });
      row.addEventListener("dragover", handleProjectTagDragOver);
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        clearProjectTagHoverTimer();
      });
      row.addEventListener("dblclick", () => renameProjectTag(tag).catch(showError));
      row.append(handle, body, actions);
      dialog.list.appendChild(row);
    });
  }

  function projectTagRowFromPoint(event) {
    const dialog = ensureProjectTagDialog();
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const hit = document.elementFromPoint(x, y);
    const row = hit instanceof Element ? hit.closest(".project-tag-manager-row") : null;
    if (row && dialog.list.contains(row) && !row.classList.contains("dragging")) return row;
    return null;
  }

  function updateProjectTagDomIndexes() {
    const dialog = ensureProjectTagDialog();
    [...dialog.list.querySelectorAll(".project-tag-manager-row")].forEach((row, index) => {
      row.dataset.tagIndex = String(index);
    });
  }

  function projectTagReflowRects() {
    const dialog = ensureProjectTagDialog();
    return new Map(
      [...dialog.list.querySelectorAll(".project-tag-manager-row:not(.dragging)")].map((row) => [row, row.getBoundingClientRect()])
    );
  }

  function animateProjectTagReflow(beforeRects) {
    const dialog = ensureProjectTagDialog();
    const rows = [...dialog.list.querySelectorAll(".project-tag-manager-row:not(.dragging)")];
    dialog.list.classList.add("sorting");
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
    window.clearTimeout(projectTagSortTimer);
    projectTagSortTimer = window.setTimeout(() => {
      dialog.list.classList.remove("sorting");
      dialog.list.querySelectorAll(".project-tag-manager-row").forEach((row) => {
        row.style.transition = "";
        row.style.transform = "";
      });
    }, 220);
  }

  function moveProjectTagDom(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return false;
    if (fromIndex >= projectTags.length || toIndex >= projectTags.length) return false;
    const dialog = ensureProjectTagDialog();
    const beforeRects = projectTagReflowRects();
    const next = [...projectTags];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    projectTags = next;

    const rows = [...dialog.list.querySelectorAll(".project-tag-manager-row")];
    const moving = rows.find((row) => Number(row.dataset.tagIndex) === fromIndex);
    const target = rows.find((row) => Number(row.dataset.tagIndex) === toIndex);
    if (moving && target) {
      if (fromIndex < toIndex) dialog.list.insertBefore(moving, target.nextSibling);
      else dialog.list.insertBefore(moving, target);
      updateProjectTagDomIndexes();
    }
    animateProjectTagReflow(beforeRects);
    return true;
  }

  function clearProjectTagHoverTimer() {
    if (projectTagHoverTimer) {
      window.clearTimeout(projectTagHoverTimer);
      projectTagHoverTimer = 0;
    }
    projectTagHoverRow = null;
  }

  function scheduleProjectTagHover(row) {
    if (!row || projectTagHoverRow === row) return;
    clearProjectTagHoverTimer();
    projectTagHoverRow = row;
    projectTagHoverTimer = window.setTimeout(() => {
      projectTagHoverTimer = 0;
      if (projectTagHoverRow !== row || !row.isConnected) return;
      projectTagHoverRow = null;
      const fromIndex = Number(projectTagDragIndex);
      const toIndex = Number(row.dataset.tagIndex);
      if (moveProjectTagDom(fromIndex, toIndex)) {
        projectTagDragIndex = toIndex;
        projectTagDragMoved = true;
      }
    }, 200);
  }

  function handleProjectTagDragOver(event) {
    if (projectTagDragIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const targetRow = projectTagRowFromPoint(event);
    if (targetRow) {
      scheduleProjectTagHover(targetRow);
      return;
    }
    clearProjectTagHoverTimer();
  }

  async function renameProjectTag(tag) {
    const name = await window.appPrompt("输入新的标签名称", tag);
    if (!name || !name.trim()) return;
    const data = await apiPost("/api/projects/tags/rename", { old: tag, name: name.trim() });
    projectTags = Array.isArray(data.tags) ? data.tags : [];
    renderProjectTagManager();
    await refreshProjects();
  }

  async function openProjectTagManager() {
    await loadProjectTags();
    const dialog = ensureProjectTagDialog();
    renderProjectTagManager();
    openDialogBackdrop(dialog.backdrop);
    dialog.input.focus({ preventScroll: true });
  }

  function ensureVersionDialog() {
    if (versionDialog?.backdrop?.isConnected) return versionDialog;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop project-version-dialog";
    backdrop.setAttribute("aria-hidden", "true");

    const panel = document.createElement("section");
    panel.className = "dialog-panel project-version-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "project-version-head";
    const title = document.createElement("h2");
    title.textContent = "版本管理";
    const closeBtn = makeVersionIconButton({ icon: VERSION_ICONS.close, label: "关闭" });
    closeBtn.classList.add("project-version-close-btn");
    closeBtn.addEventListener("click", closeVersionDialog);
    head.append(title, closeBtn);

    const status = document.createElement("p");
    status.className = "project-version-status";
    status.textContent = "正在读取版本...";

    const list = document.createElement("div");
    list.className = "project-version-list";

    panel.append(head, status, list);
    backdrop.append(panel);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeVersionDialog();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && backdrop.classList.contains("dialog-open")) closeVersionDialog();
    });
    document.body.appendChild(backdrop);
    versionDialog = { backdrop, title, status, list };
    return versionDialog;
  }

  function closeVersionDialog() {
    const dialog = versionDialog;
    if (!dialog?.backdrop) return;
    dialog.backdrop.classList.remove("dialog-open");
    dialog.backdrop.classList.add("dialog-closing");
    dialog.backdrop.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      dialog.backdrop.classList.remove("dialog-closing");
    }, 180);
  }

  function showVersionDialog(project) {
    const dialog = ensureVersionDialog();
    activeVersionProject = project;
    dialog.title.textContent = `版本管理：${project.name || project.id}`;
    dialog.status.textContent = "正在读取版本...";
    dialog.list.textContent = "";
    dialog.backdrop.classList.remove("dialog-closing");
    dialog.backdrop.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => dialog.backdrop.classList.add("dialog-open"));
    loadProjectVersions(project).catch((error) => {
      dialog.status.textContent = error?.message || "读取版本失败。";
      showError(error);
    });
  }

  async function loadProjectVersions(project) {
    const dialog = ensureVersionDialog();
    const data = await apiGet("/api/projects/versions", { id: project.id });
    const versions = Array.isArray(data.versions) ? data.versions : [];
    dialog.list.textContent = "";
    dialog.status.textContent = versions.length ? `共 ${versions.length} 个提交版本` : "暂无提交版本";
    if (!versions.length) return;
    for (const version of versions) {
      const row = document.createElement("article");
      row.className = "project-version-row";
      const body = document.createElement("div");
      body.className = "project-version-body";
      const title = document.createElement("strong");
      title.textContent = version.display_message || version.message || "未命名提交";
      const meta = document.createElement("span");
      meta.textContent = `${version.short_hash || shortCommit(version.hash)} · ${formatVersionTime(version.created_at)}`;
      body.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "project-version-actions";
      const isCurrent = data.head === version.hash;
      const rollbackBtn = makeVersionIconButton({
        icon: isCurrent ? VERSION_ICONS.current : VERSION_ICONS.rollback,
        label: isCurrent ? "当前版本" : "回退",
        disabled: isCurrent,
      });
      if (!isCurrent) rollbackBtn.addEventListener("click", () => rollbackProjectVersion(project, version));

      const forkBtn = makeVersionIconButton({ icon: VERSION_ICONS.fork, label: "分叉" });
      forkBtn.addEventListener("click", () => forkProjectVersion(project, version));
      actions.append(rollbackBtn, forkBtn);

      row.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        renameProjectVersion(project, version).catch(showError);
      });
      row.append(body, actions);
      dialog.list.appendChild(row);
    }
  }

  function isProjectNotFoundError(error) {
    return /Project not found:/i.test(`${error?.message || error || ""}`);
  }

  function clearCurrentProjectReference(projectId = state.currentProjectId) {
    const staleId = `${projectId || ""}`;
    if (!staleId || state.currentProjectId === staleId) {
      state.currentProjectId = "";
      state.currentProjectName = "";
      renderWorkspaceSummary();
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.lastWorkspaceDirs);
      const payload = raw ? JSON.parse(raw) : null;
      if (payload && typeof payload === "object" && `${payload.project_id || ""}` === staleId) {
        delete payload.project_id;
        delete payload.project_name;
        saveStored(STORAGE_KEYS.lastWorkspaceDirs, JSON.stringify(payload));
      }
      if (`${window.localStorage.getItem(STORAGE_KEYS.lastProjectId) || ""}` === staleId) {
        saveStored(STORAGE_KEYS.lastProjectId, "");
        saveStored(STORAGE_KEYS.lastProjectName, "");
      }
    } catch (_) {
      saveStored(STORAGE_KEYS.lastWorkspaceDirs, "");
    }
  }

  async function saveProject({ asNew = false, nameOverride = "" } = {}) {
    if (projectSavePromise) return projectSavePromise;
    projectSavePromise = (async () => {
      if (state.captionDirty && state.selectedName) {
        await saveCurrentCaption();
      }
      const name = `${nameOverride || projectNameFromInput()}`.trim() || "未命名项目";
      const payload = {
        name,
        control_count: Number(refs.controlCount?.value ?? 1),
        ui_state: collectProjectUiState(name),
      };
      if (!asNew && state.currentProjectId) {
        payload.overwrite_id = state.currentProjectId;
      }
      const data = await apiPost("/api/projects/save", payload);
      state.currentProjectId = data.project?.id || "";
      state.currentProjectName = data.project?.name || name;
      if (refs.projectNameInput) refs.projectNameInput.value = data.project?.name || name;
      if (state.currentProjectId) {
        saveStored(STORAGE_KEYS.lastProjectId, state.currentProjectId);
        saveStored(STORAGE_KEYS.lastProjectName, state.currentProjectName || state.currentProjectId);
      }
      renderWorkspaceSummary();
      if (data.workspace) {
        applyWorkspaceSummary(data.workspace);
        rememberOpenedWorkspace(data.workspace);
        await refreshItems({ skipDirtyCheck: true });
      }
      const version = data.version?.hash ? `（${shortCommit(data.version.hash)}）` : "";
      setProjectStatus(`${asNew || !payload.overwrite_id ? "已提交项目版本" : "已提交当前版本"}：${data.project?.name || name}${version}`);
      await refreshProjects();
    })();
    try {
      return await projectSavePromise;
    } finally {
      projectSavePromise = null;
    }
  }

  async function saveCurrentProject() {
    await saveProject({ asNew: false });
  }

  function importedWorkspaceProjectName() {
    if (state.currentProjectId && state.currentProjectName) return state.currentProjectName;
    const dirs = state.workspace?.dirs || {};
    const source = dirs.result || dirs.control1 || dirs.control2 || dirs.control3 || "";
    const normalized = `${source || ""}`.replace(/[\\/]+$/, "");
    const leaf = normalized.split(/[\\/]/).filter(Boolean).at(-1) || "";
    return leaf ? `缓存项目-${leaf}` : "缓存项目";
  }

  async function saveImportedWorkspaceToProject() {
    if (!state.workspace?.counts?.all) return;
    if (state.currentProjectId) {
      await saveProject({ asNew: false });
      return;
    }
    const name = importedWorkspaceProjectName();
    if (refs.projectNameInput) refs.projectNameInput.value = name;
    await saveProject({ asNew: true, nameOverride: name });
    setProjectStatus(`已导入到缓存项目：${state.currentProjectName || name}`);
  }

  async function createProject() {
    const defaultName = `${state.currentProjectName || state.workspace?.project_name || ""}`.trim() || "新项目";
    const name = await window.appPrompt("输入新项目名称", defaultName);
    if (!name || !name.trim()) return;
    await runWithStatus("正在新建项目...", async () => {
      await saveOpenProjectUiState({ ignoreMissingCurrent: true });
      const cleanName = name.trim();
      const data = await apiPost("/api/projects/create", {
        name: cleanName,
        control_count: Number(refs.controlCount?.value ?? 1),
        ui_state: collectProjectUiState(cleanName),
      });
      setProjectStatus(`已新建项目：${data.project?.name || cleanName}`);
      await refreshProjects();
      await openProject(data.project?.id || "", { skipCurrentStateSave: true });
    }).catch(showError);
  }

  async function saveOpenProjectUiState({ ignoreMissingCurrent = false } = {}) {
    if (!state.currentProjectId) return;
    if (projectUiStateSaveTimer) {
      window.clearTimeout(projectUiStateSaveTimer);
      projectUiStateSaveTimer = 0;
    }
    const projectId = state.currentProjectId;
    try {
      await apiPost("/api/projects/ui-state", {
        id: projectId,
        ui_state: collectProjectUiState(state.currentProjectName || ""),
      });
    } catch (error) {
      if (ignoreMissingCurrent && isProjectNotFoundError(error)) {
        clearCurrentProjectReference(projectId);
        return;
      }
      throw error;
    }
  }

  function saveOpenProjectUiStateNow() {
    if (!state.currentProjectId) return;
    const payload = {
      id: state.currentProjectId,
      ui_state: collectProjectUiState(state.currentProjectName || ""),
    };
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(resolveApiUrl("api/projects/ui-state"), new Blob([body], { type: "application/json" }));
    }
  }

  function scheduleOpenProjectUiStateSave() {
    if (!state.currentProjectId) return;
    if (projectUiStateSaveTimer) window.clearTimeout(projectUiStateSaveTimer);
    projectUiStateSaveTimer = window.setTimeout(() => {
      projectUiStateSaveTimer = 0;
      saveOpenProjectUiState().catch((error) => console.warn(error));
    }, 650);
  }

  function bindProjectCaptionSettingsAutosave() {
    const bind = (ref, eventName) => ref?.addEventListener(eventName, scheduleOpenProjectUiStateSave);
    bind(refs.overwriteMode, "change");
    bind(refs.captionMode, "change");
    bind(refs.maxTokens, "input");
    bind(refs.maxTokens, "change");
    bind(refs.localThinkingMode, "change");
    bind(refs.apiThinkingMode, "change");
    bind(refs.ollamaThinkingMode, "change");
    bind(refs.customPrompt, "input");
    bind(refs.customPrompt, "change");
    document.querySelectorAll(".template-row .promptTemplateSelect").forEach((select) => {
      select.addEventListener("change", scheduleOpenProjectUiStateSave);
    });
    window.addEventListener("beforeunload", saveOpenProjectUiStateNow);
  }

  bindProjectCaptionSettingsAutosave();

  async function openProject(projectId, { skipCurrentStateSave = false } = {}) {
    if (!skipCurrentStateSave) await saveOpenProjectUiState({ ignoreMissingCurrent: true });
    refs.itemList.textContent = "";
    if (refs.secondaryItemList) refs.secondaryItemList.textContent = "";
    refs.listStats.textContent = "正在切换项目...";
    if (refs.secondaryListStats) refs.secondaryListStats.textContent = "正在切换项目...";
    state.selectedName = "";
    state.currentItem = null;
    state.imageRefreshToken = `${Date.now()}-opening-${projectId}`;
    const data = await apiPost("/api/projects/open", { id: projectId });
    state.currentProjectId = data.project?.id || projectId;
    state.currentProjectName = data.project?.name || projectId;
    if (refs.projectNameInput) refs.projectNameInput.value = data.project?.name || projectId;
    saveStored(STORAGE_KEYS.lastProjectId, state.currentProjectId);
    saveStored(STORAGE_KEYS.lastProjectName, state.currentProjectName || state.currentProjectId);
    renderWorkspaceSummary();
    applyProjectUiState(data.ui_state, data.project?.name || projectId);
    applyWorkspaceSummary(data.workspace);
    rememberOpenedWorkspace(data.workspace);
    await refreshItems({ skipDirtyCheck: true });
    if (data.ui_state?.selected_name) {
      const selectedPanel = data.ui_state.selected_panel === "secondary" ? "secondary" : "primary";
      const sourceItems = selectedPanel === "secondary" ? state.secondaryItems : state.items;
      const target = sourceItems.find((item) => item.name === data.ui_state.selected_name);
      if (target) {
        await selectItem(target.name, true, { skipDirtyCheck: true, panelId: selectedPanel });
      }
    }
    setProjectStatus(`已打开项目：${data.project?.name || projectId}`);
    closeUtilityPanel();
  }

  async function forkProject(project) {
    const defaultName = `${project.name || project.id} 分叉`;
    const name = await window.appPrompt("输入分叉后的项目名称", defaultName);
    if (!name || !name.trim()) return;
    await runWithStatus("正在分叉项目...", async () => {
      const data = await apiPost("/api/projects/fork", { id: project.id, name: name.trim() });
      setProjectStatus(`已分叉项目：${data.project?.name || name.trim()}`);
      await refreshProjects();
    }).catch(showError);
  }

  async function rollbackProjectVersion(project, version) {
    if (!(await window.appConfirm(`回退项目「${project.name || project.id}」到版本 ${version.short_hash || shortCommit(version.hash)}？当前项目文件会恢复到该提交。`))) return;
    await runWithStatus("正在回退项目版本...", async () => {
      const data = await apiPost("/api/projects/versions/rollback", { id: project.id, commit: version.hash });
      closeVersionDialog();
      setProjectStatus(`已回退到版本：${version.short_hash || shortCommit(version.hash)}`);
      if (state.currentProjectId === project.id || activeVersionProject?.id === project.id) {
        await openProject(data.project?.id || project.id, { skipCurrentStateSave: true });
      }
      await refreshProjects();
    }).catch(showError);
  }

  async function forkProjectVersion(project, version) {
    const defaultName = `${project.name || project.id} ${version.short_hash || shortCommit(version.hash)} 分叉`;
    const name = await window.appPrompt("输入分叉项目名称", defaultName);
    if (!name || !name.trim()) return;
    await runWithStatus("正在分叉历史版本...", async () => {
      const data = await apiPost("/api/projects/versions/fork", { id: project.id, commit: version.hash, name: name.trim() });
      setProjectStatus(`已分叉项目：${data.project?.name || name.trim()}`);
      await refreshProjects();
      await loadProjectVersions(project);
    }).catch(showError);
  }

  async function renameProjectVersion(project, version) {
    const currentName = version.custom_label || version.display_message || version.message || "";
    const name = await window.appPrompt("输入新的版本名称", currentName);
    if (!name || !name.trim() || name.trim() === currentName) return;
    await runWithStatus("正在重命名版本...", async () => {
      await apiPost("/api/projects/versions/rename", { id: project.id, commit: version.hash, name: name.trim() });
      setProjectStatus(`已重命名版本：${version.short_hash || shortCommit(version.hash)}`);
      await loadProjectVersions(project);
    }).catch(showError);
  }

  async function deleteProject(project) {
    if (!(await window.appConfirm(`删除项目「${project.name || project.id}」？项目会移动到用户目录 .vision_dataset_studio/trash。`))) return;
    await runWithStatus("正在删除项目...", async () => {
      await apiPost("/api/projects/delete", { id: project.id });
      if (state.currentProjectId === project.id) {
        state.currentProjectId = "";
        state.currentProjectName = "";
        if (refs.projectNameInput) refs.projectNameInput.value = "";
        saveStored(STORAGE_KEYS.lastProjectId, "");
        saveStored(STORAGE_KEYS.lastProjectName, "");
        saveStored(STORAGE_KEYS.lastWorkspaceDirs, "");
        clearWorkspaceView?.();
        renderWorkspaceSummary();
      }
      setProjectStatus(`已删除项目：${project.name || project.id}`);
      await refreshProjects();
    }).catch(showError);
  }

  async function cleanupTmpNow() {
    if (!(await window.appConfirm("清空用户目录 .vision_dataset_studio/trash 中的回收项目？此操作无法撤销。"))) return;
    const data = await apiPost("/api/trash/cleanup", {});
    const cleanup = data.cleanup || {};
    const errors = cleanup.errors?.length ? `，失败 ${cleanup.errors.length} 项` : "";
    setProjectStatus(`回收项目清理完成：删除 ${cleanup.removed?.length || 0} 项${errors}`);
  }

  function renderProjects() {
    if (!refs.projectGrid) return;
    refs.projectGrid.textContent = "";
    renderProjectTagFilters();
    const rows = visibleProjects();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "project-empty";
      empty.textContent = state.projects.length ? "没有匹配的项目" : "暂无已保存项目";
      refs.projectGrid.appendChild(empty);
      return;
    }

    for (const project of rows) {
      const card = document.createElement("article");
      card.className = "project-card";
      const thumb = document.createElement("div");
      thumb.className = "project-thumb";
      if (project.thumbnail) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = resolveApiUrl("api/projects/thumbnail", {
          id: project.id,
          width: 520,
          height: 320,
        }).toString();
        img.alt = project.name || project.id;
        img.addEventListener("error", () => {
          thumb.textContent = "No Preview";
        }, { once: true });
        thumb.appendChild(img);
      } else {
        thumb.textContent = "No Preview";
      }

      const body = document.createElement("div");
      body.className = "project-card-body";
      const title = document.createElement("h3");
      title.textContent = project.name || project.id;
      const meta = document.createElement("p");
      meta.textContent = `${projectProgressText(project)} · ${projectCardTime(project)}`;
      const actions = document.createElement("div");
      actions.className = "project-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "button-primary";
      openBtn.type = "button";
      openBtn.textContent = "打开";
      openBtn.addEventListener("click", () => runWithStatus("正在打开项目...", () => openProject(project.id)).catch(showError));

      const renameBtn = makeVersionIconButton({ icon: VERSION_ICONS.edit, label: "修改" });
      renameBtn.addEventListener("click", () => openProjectEditor(project).catch(showError));

      const forkBtn = makeVersionIconButton({ icon: VERSION_ICONS.fork, label: "分叉" });
      forkBtn.addEventListener("click", () => forkProject(project));

      const versionsBtn = makeVersionIconButton({ icon: VERSION_ICONS.version, label: "版本管理" });
      versionsBtn.addEventListener("click", () => showVersionDialog(project));

      const deleteBtn = makeVersionIconButton({ icon: VERSION_ICONS.delete, label: "删除" });
      deleteBtn.classList.add("danger");
      deleteBtn.addEventListener("click", () => deleteProject(project));

      actions.append(openBtn, renameBtn, forkBtn, versionsBtn, deleteBtn);
      const tags = document.createElement("div");
      tags.className = "project-card-tags";
      for (const tag of Array.isArray(project.tags) ? project.tags : []) {
        const chip = document.createElement("span");
        chip.className = "project-tag-chip";
        chip.textContent = tag;
        tags.appendChild(chip);
      }
      body.append(title, meta, actions, tags);
      card.append(thumb, body);
      refs.projectGrid.appendChild(card);
    }
  }

  return {
    renderProjects,
    refreshProjects,
    applyProjectUiState,
    saveCurrentProject,
    saveImportedWorkspaceToProject,
    createProject,
    saveOpenProjectUiState,
    openProject,
    openProjectEditor,
    openProjectTagManager,
    forkProject,
    deleteProject,
    cleanupTmpNow,
  };
}
