/**
 * 前端 state 类型声明（阶段 4 完整版）。
 *
 * 按业务域分组，映射 frontend/app.js 的 state 对象所有字段。
 */

// ===== workspace 域 =====
import type { WorkspaceSummary, DatasetItem } from "../state/workspace";

export type { WorkspaceSummary, DatasetItem };

// ===== caption 域 =====
import type { CaptionSegment } from "../state/caption";

export type { CaptionSegment };

// ===== ai 域 =====
import type { AiStatus, AiOptions, PromptTemplate } from "../state/ai";

export type { AiStatus, AiOptions, PromptTemplate };

// ===== projects 域 =====
import type { ProjectSummary } from "../state/projects";

export type { ProjectSummary };

// ===== ui 域 =====
export type { UiState } from "../state/ui";

/**
 * 全局应用 state。
 */
export interface AppState {
  // ===== workspace 域 =====
  workspace: WorkspaceSummary | null;
  itemStats: unknown | null;
  items: DatasetItem[];
  globalSegments: unknown[];
  globalTagQuery: string;
  visibleItems: DatasetItem[];
  filter: string;
  itemFolderFilter: string;
  selectedName: string;
  primarySelectedName: string;
  selectedPanel: "primary" | "secondary";
  currentItem: DatasetItem | null;
  segmentQuery: string;
  listSearchMode: string;
  listSearchMatchMode: string;

  // ===== secondary 面板域 =====
  secondaryFilter: string;
  secondaryItemFolderFilter: string;
  secondaryItems: DatasetItem[];
  secondaryVisibleItems: DatasetItem[];
  secondarySelectedName: string;
  secondarySegmentQuery: string;
  secondaryListSearchMode: string;
  secondaryListSearchMatchMode: string;

  // ===== batch 选择域 =====
  batchSelectedNames: Set<string>;
  batchSelectionPanel: "primary" | "secondary";
  batchSelectionAnchor: string;

  // ===== caption 编辑域 =====
  currentText: string;
  captionSavedText: string;
  captionDirty: boolean;
  captionAutoSaveTimer: number;
  captionAutoSavePromise: Promise<unknown> | null;
  currentSegments: unknown[];

  // ===== quickTags 域 =====
  quickTags: unknown[];
  quickTagsCollapsed: boolean;
  quickTagClickTimer: number | null;
  quickTagDragIndex: number | null;
  quickTagSortTimer: number;
  quickTagHoverTimer: number;
  quickTagHoverRow: unknown | null;
  quickTagCaptionDragEndTimer: number;
  captionTagDragIndex: number | null;
  captionTagDragging: unknown | null;
  captionTagSortTimer: number;
  captionTagHoverTimer: number;
  captionTagHoverRow: unknown | null;
  globalTagDragging: string;
  globalTagPointerDrag: unknown | null;
  globalTagSuppressClick: boolean;

  // ===== ai 域 =====
  aiStatus: AiStatus | null;
  promptTemplates: PromptTemplate[];
  aiOptions: AiOptions;
  apiModels: string[];
  apiModelMenuOpen: boolean;
  apiModelQuery: string;
  ollamaModels: string[];
  ollamaModelMenuOpen: boolean;
  ollamaModelQuery: string;
  aiPollTimer: number | null;
  aiPollInFlight: boolean;
  lastBatchSignature: string;
  followCaptionCurrent: boolean;
  lastFollowedCaptionName: string;
  lastImageProcessSignature: string;
  lastExportSignature: string;
  exportDownloadRequested: boolean;

  // ===== projects 域 =====
  projects: ProjectSummary[];
  currentProjectId: string;
  currentProjectName: string;
  projectQuery: string;
  projectSortMode: string;
  projectTagFilters: string[];

  // ===== browser 域 =====
  browserPath: string;
  browserParent: string;
  browserRoot: string;
  browserTarget: string;
  browserItems: unknown[];
  browserMessage: string;

  // ===== ui 域 =====
  utilityPanel: string;
  utilityOpen: boolean;
  captionSettingsOpen: boolean;
  viewMode: string;
  listThumbMode: string;
  secondaryListThumbMode: string;
  splitListOpen: boolean;
  themeMode: string;
  wallpaper: string;
}
