/** 项目管理域类型定义。 */

export interface ProjectSummary {
  id: string;
  name: string;
  item_count: number;
  captioned_count: number;
  control_count: number;
  updated_at: string;
  [key: string]: unknown;
}
