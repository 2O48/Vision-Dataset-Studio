/**
 * createBootstrapModule 的依赖参数类型。
 *
 * 替代原有的 92 个独立参数，提供类型安全的单对象注入。
 * 阶段 5 拆分时将进一步按域拆解。
 */

export interface BootstrapDeps {
  // --- 来自 web_shared ---
  STORAGE_KEYS: Record<string, string>;
  DEFAULT_OLLAMA_URL: string;
  FILTER_LABELS: Record<string, string>;
  ROLE_LABELS: Record<string, string>;
  UTILITY_PANEL_LABELS: Record<string, string>;
  readStored: (key: string, fallback: unknown) => unknown;
  saveStored: (key: string, value: unknown) => void;
  apiGet: (url: string) => Promise<unknown>;
  apiPost: (url: string, body: unknown) => Promise<unknown>;
  splitSegmentInput: (value: string) => string[];
  parseSegments: (value: string) => string[];

  // --- 业务模块 ---
  createProjectsModule: (deps: Record<string, unknown>) => Record<string, unknown>;
  createWorkspaceBrowserModule: (deps: Record<string, unknown>) => Record<string, unknown>;
  createImageOpsModule: (deps: Record<string, unknown>) => Record<string, unknown>;
  createCaptionModule: (deps: Record<string, unknown>) => Record<string, unknown>;
  createEditorModule: (deps: Record<string, unknown>) => Record<string, unknown>;
  createBrowserModule: (deps: Record<string, unknown>) => Record<string, unknown>;
  createShellModule: (deps: Record<string, unknown>) => Record<string, unknown>;

  // --- DOM refs ---
  refs: Record<string, HTMLElement | null>;
  state: Record<string, unknown>;
  wallpaperImageCache: Map<number, HTMLImageElement>;

  // --- render callbacks ---
  renderTags: () => void;
  renderGlobalTags: () => void;
  flushCaptionAutosave: () => Promise<boolean>;
}

/** createBootstrapModule 的返回值类型 */
export interface BootstrapModule {
  render: () => void;
  restoreSettings: () => Promise<void>;
  bindEvents: () => void;
  focusSelected: () => void;
  reportUiReady: () => void;
  teardown: () => void;
}
