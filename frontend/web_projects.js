export function createProjectsModule({
  state,
  refs,
  apiGet,
  apiPost,
  runWithStatus,
  showError,
  applyWorkspaceSummary,
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
      secondary_filter: state.secondaryFilter || "all",
      secondary_item_folder_filter: state.secondaryItemFolderFilter || "",
      secondary_segment_query: refs.secondaryTagSearch?.value.trim() || state.secondarySegmentQuery || "",
      secondary_list_search_mode: state.secondaryListSearchMode === "name" ? "name" : "phrase",
      secondary_list_search_match_mode: state.secondaryListSearchMatchMode === "exact" ? "exact" : "contains",
      secondary_list_thumb_mode: state.secondaryListThumbMode === "combined" ? "combined" : "result",
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
        local_prompt: refs.customPrompt?.value || "",
        api_base_url: refs.apiBaseUrl?.value || "",
        api_key: refs.apiKey?.value || "",
        api_model_name: refs.apiModelName?.value || "",
        api_overwrite_mode: refs.apiOverwriteMode?.value || "",
        api_caption_mode: refs.apiCaptionMode?.value || "",
        api_max_tokens: refs.apiMaxTokens?.value || "",
        api_prompt: refs.apiPrompt?.value || "",
        ollama_base_url: refs.ollamaBaseUrl?.value || "",
        ollama_model_name: refs.ollamaModelName?.value || "",
        ollama_overwrite_mode: refs.ollamaOverwriteMode?.value || "",
        ollama_caption_mode: refs.ollamaCaptionMode?.value || "",
        ollama_max_tokens: refs.ollamaMaxTokens?.value || "",
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
    saveStored(STORAGE_KEYS.lastWorkspaceDirs, JSON.stringify({
      project_id: state.currentProjectId || workspace?.project_id || "",
      project_name: state.currentProjectName || workspace?.project_name || "",
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
    setValue(refs.customPrompt, captionSettings.local_prompt, STORAGE_KEYS.localPrompt);
    setValue(refs.apiBaseUrl, captionSettings.api_base_url, STORAGE_KEYS.apiBaseUrl);
    setValue(refs.apiKey, captionSettings.api_key, STORAGE_KEYS.apiKey);
    setValue(refs.apiModelName, captionSettings.api_model_name, STORAGE_KEYS.apiModelName);
    setValue(refs.apiOverwriteMode, captionSettings.api_overwrite_mode, STORAGE_KEYS.apiOverwriteMode);
    setValue(refs.apiCaptionMode, captionSettings.api_caption_mode, STORAGE_KEYS.apiCaptionMode);
    setValue(refs.apiMaxTokens, captionSettings.api_max_tokens, STORAGE_KEYS.apiMaxTokens);
    setValue(refs.apiPrompt, captionSettings.api_prompt, STORAGE_KEYS.apiPrompt);
    setValue(refs.ollamaBaseUrl, captionSettings.ollama_base_url, STORAGE_KEYS.ollamaBaseUrl);
    setValue(refs.ollamaModelName, captionSettings.ollama_model_name, STORAGE_KEYS.ollamaModelName);
    setValue(refs.ollamaOverwriteMode, captionSettings.ollama_overwrite_mode, STORAGE_KEYS.ollamaOverwriteMode);
    setValue(refs.ollamaCaptionMode, captionSettings.ollama_caption_mode, STORAGE_KEYS.ollamaCaptionMode);
    setValue(refs.ollamaMaxTokens, captionSettings.ollama_max_tokens, STORAGE_KEYS.ollamaMaxTokens);
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
    state.secondaryFilter = uiState.secondary_filter || "all";
    state.secondaryItemFolderFilter = uiState.secondary_item_folder_filter || "";
    state.secondarySegmentQuery = uiState.secondary_segment_query || "";
    if (refs.secondaryTagSearch) refs.secondaryTagSearch.value = state.secondarySegmentQuery;
    state.secondaryListSearchMode = uiState.secondary_list_search_mode === "name" ? "name" : "phrase";
    saveStored(STORAGE_KEYS.secondaryListSearchMode, state.secondaryListSearchMode);
    state.secondaryListSearchMatchMode = uiState.secondary_list_search_match_mode === "exact" ? "exact" : "contains";
    saveStored(STORAGE_KEYS.secondaryListSearchMatchMode, state.secondaryListSearchMatchMode);
    state.secondaryListThumbMode = uiState.secondary_list_thumb_mode === "combined" ? "combined" : "result";
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
    let rows = state.projects.filter((project) => {
      if (!query) return true;
      return `${project.name || ""} ${project.id || ""}`.toLowerCase().includes(query);
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

  async function refreshProjects() {
    const data = await apiGet("/api/projects");
    state.projects = data.projects || [];
    if (!state.currentProjectId && !state.currentProjectName && state.projects.length === 1 && state.workspace?.counts?.all) {
      const project = state.projects[0];
      state.currentProjectId = project.id || "";
      state.currentProjectName = project.name || project.id || "";
      if (refs.projectNameInput && state.currentProjectName) refs.projectNameInput.value = state.currentProjectName;
      rememberOpenedWorkspace(state.workspace);
      renderWorkspaceSummary();
    }
    renderProjects();
    if (refs.projectStatus) {
      refs.projectStatus.textContent = state.currentProjectName
        ? `当前项目：${state.currentProjectName} · 已载入 ${state.projects.length} 个项目`
        : `已载入 ${state.projects.length} 个项目`;
    }
  }

  function projectNameFromInput() {
    return refs.projectNameInput.value.trim() || "未命名项目";
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
    } catch (_) {
      saveStored(STORAGE_KEYS.lastWorkspaceDirs, "");
    }
  }

  async function saveProject({ asNew = false } = {}) {
    if (state.captionDirty && state.selectedName) {
      await saveCurrentCaption();
    }
    const name = projectNameFromInput();
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
    refs.projectNameInput.value = data.project?.name || name;
    renderWorkspaceSummary();
    if (data.workspace) {
      applyWorkspaceSummary(data.workspace);
      rememberOpenedWorkspace(data.workspace);
      await refreshItems({ skipDirtyCheck: true });
    }
    refs.projectStatus.textContent = `${asNew || !payload.overwrite_id ? "已保存项目" : "已保存当前项目"}：${data.project?.name || name}`;
    await refreshProjects();
  }

  async function saveCurrentProject() {
    await saveProject({ asNew: false });
  }

  async function createProject() {
    const defaultName = refs.projectNameInput?.value.trim() || "新项目";
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
      refs.projectStatus.textContent = `已新建项目：${data.project?.name || cleanName}`;
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
        ui_state: collectProjectUiState(state.currentProjectName || refs.projectNameInput?.value || ""),
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
      ui_state: collectProjectUiState(state.currentProjectName || refs.projectNameInput?.value || ""),
    };
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/projects/ui-state", new Blob([body], { type: "application/json" }));
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
    refs.projectNameInput.value = data.project?.name || projectId;
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
    refs.projectStatus.textContent = `已打开项目：${data.project?.name || projectId}`;
    closeUtilityPanel();
  }

  async function renameProject(project) {
    const name = await window.appPrompt("输入新的项目名称", project.name || project.id);
    if (!name || !name.trim()) return;
    await runWithStatus("正在重命名项目...", async () => {
      const data = await apiPost("/api/projects/rename", { id: project.id, name: name.trim() });
      if (state.currentProjectId === project.id) {
        state.currentProjectId = data.project?.id || project.id;
        state.currentProjectName = data.project?.name || name.trim();
        refs.projectNameInput.value = state.currentProjectName;
        renderWorkspaceSummary();
      }
      refs.projectStatus.textContent = `已重命名项目：${data.project?.name || name.trim()}`;
      await refreshProjects();
    }).catch(showError);
  }

  async function cloneProject(project) {
    const defaultName = `${project.name || project.id} 副本`;
    const name = await window.appPrompt("输入克隆后的项目名称", defaultName);
    if (!name || !name.trim()) return;
    await runWithStatus("正在克隆项目...", async () => {
      const data = await apiPost("/api/projects/clone", { id: project.id, name: name.trim() });
      refs.projectStatus.textContent = `已克隆项目：${data.project?.name || name.trim()}`;
      await refreshProjects();
    }).catch(showError);
  }

  async function deleteProject(project) {
    if (!(await window.appConfirm(`删除项目「${project.name || project.id}」？项目会移动到用户目录 .vision_dataset_studio/trash。`))) return;
    await runWithStatus("正在删除项目...", async () => {
      await apiPost("/api/projects/delete", { id: project.id });
      if (state.currentProjectId === project.id) {
        state.currentProjectId = "";
        state.currentProjectName = "";
        renderWorkspaceSummary();
      }
      refs.projectStatus.textContent = `已删除项目：${project.name || project.id}`;
      await refreshProjects();
    }).catch(showError);
  }

  async function cleanupTmpNow() {
    if (!(await window.appConfirm("清空用户目录 .vision_dataset_studio/trash 中的回收项目？此操作无法撤销。"))) return;
    const data = await apiPost("/api/trash/cleanup", {});
    const cleanup = data.cleanup || {};
    const errors = cleanup.errors?.length ? `，失败 ${cleanup.errors.length} 项` : "";
    refs.projectStatus.textContent = `回收项目清理完成：删除 ${cleanup.removed?.length || 0} 项${errors}`;
  }

  function renderProjects() {
    if (!refs.projectGrid) return;
    refs.projectGrid.textContent = "";
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
        img.src = `/api/projects/thumbnail?id=${encodeURIComponent(project.id)}&width=520&height=320`;
        img.alt = project.name || project.id;
        thumb.appendChild(img);
      } else {
        thumb.textContent = "No Preview";
      }

      const body = document.createElement("div");
      body.className = "project-card-body";
      const title = document.createElement("h3");
      title.textContent = project.name || project.id;
      const meta = document.createElement("p");
      meta.textContent = `${projectProgressText(project)} · ${project.updated_at || "未记录时间"}`;
      const actions = document.createElement("div");
      actions.className = "project-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "button-primary";
      openBtn.type = "button";
      openBtn.textContent = "打开";
      openBtn.addEventListener("click", () => runWithStatus("正在打开项目...", () => openProject(project.id)).catch(showError));

      const renameBtn = document.createElement("button");
      renameBtn.className = "button-ghost";
      renameBtn.type = "button";
      renameBtn.textContent = "重命名";
      renameBtn.addEventListener("click", () => renameProject(project));

      const cloneBtn = document.createElement("button");
      cloneBtn.className = "button-ghost";
      cloneBtn.type = "button";
      cloneBtn.textContent = "克隆";
      cloneBtn.addEventListener("click", () => cloneProject(project));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "button-ghost danger";
      deleteBtn.type = "button";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", () => deleteProject(project));

      actions.append(openBtn, renameBtn, cloneBtn, deleteBtn);
      body.append(title, meta, actions);
      card.append(thumb, body);
      refs.projectGrid.appendChild(card);
    }
  }

  return {
    renderProjects,
    refreshProjects,
    applyProjectUiState,
    saveCurrentProject,
    createProject,
    saveOpenProjectUiState,
    openProject,
    renameProject,
    cloneProject,
    deleteProject,
    cleanupTmpNow,
  };
}
