/**
 * 全局键盘快捷键管理器。
 *
 * 阶段 6 #8：统一管理键盘驱动工作流，防止输入框内误触发。
 *
 * 默认快捷键：
 *   j / ArrowDown    下一条
 *   k / ArrowUp      上一条
 *   e                编辑当前 caption
 *   s                保存（触发自动保存）
 *   a                单张 AI 标注当前条目
 *   b                打开批量标注（聚焦批量面板）
 *   x                标记/取消标记当前条目排除
 *   /               聚焦搜索输入框
 *
 * 用法:
 *   import { registerShortcuts } from "./shared/keyboard.js";
 *   registerShortcuts({ j: () => nextItem(), k: () => prevItem(), ... });
 */

const IGNORE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

let _handlers: Record<string, () => void> = {};
const _descriptionListeners: Array<(desc: string) => void> = [];
let _currentDescription = "";

function shouldIgnore(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (!el) return false;
  if (IGNORE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest("[contenteditable]")) return true;
  return false;
}

function setDescription(desc: string) {
  _currentDescription = desc;
  for (const listener of _descriptionListeners) {
    listener(desc);
  }
}

/**
 * 注册全局快捷键。传入 key→handler 映射。
 * Ctrl/Meta/Alt 修饰键不会被触发（保留给浏览器默认行为）。
 * 返回清理函数。
 */
export function registerShortcuts(handlers: Record<string, () => void>): () => void {
  _handlers = { ...handlers };

  function onKeyDown(event: KeyboardEvent) {
    if (shouldIgnore(event)) return;
    // 跳过修饰键组合
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const handler = _handlers[event.key];
    if (handler) {
      event.preventDefault();
      event.stopPropagation();
      handler();
    }
  }

  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
    _handlers = {};
  };
}

/** 注册状态栏快捷键提示更新回调。 */
export function onShortcutDescription(listener: (desc: string) => void): () => void {
  _descriptionListeners.push(listener);
  return () => {
    const idx = _descriptionListeners.indexOf(listener);
    if (idx >= 0) _descriptionListeners.splice(idx, 1);
  };
}

/** 更新底部状态栏快捷键提示。 */
export function updateShortcutHint(desc: string): void {
  setDescription(desc);
}
