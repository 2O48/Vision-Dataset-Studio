/** 工作区域类型定义。 */

export interface WorkspaceSummary {
  workspace_key: string;
  dirs: Record<string, string>;
  settings: {
    control_count: number;
    ignore_tokens: string[];
  };
  counts: {
    control1: number;
    control2: number;
    control3: number;
    result: number;
    txt: number;
    all: number;
    resolution_mismatch: number;
    edited: number;
    excluded: number;
  };
  folders: string[];
}

export interface DatasetItem {
  name: string;
  text: string;
  exists?: Record<string, boolean>;
  paths?: Record<string, string>;
  segments?: string[];
  tags?: string[];
  size?: unknown;
  caption_source?: string;
  [key: string]: unknown;
}
