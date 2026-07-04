/** AI 标注域类型定义。 */

export interface AiStatus {
  service?: unknown;
  api_service?: unknown;
  ollama_service?: unknown;
  installer?: unknown;
  batch?: unknown;
  image_process?: unknown;
  export?: unknown;
}

export interface AiOptions {
  local_models: unknown[];
  default_local_model: string;
  default_ollama_url: string;
}

export interface PromptTemplate {
  id?: string;
  name: string;
  text: string;
  [key: string]: unknown;
}
