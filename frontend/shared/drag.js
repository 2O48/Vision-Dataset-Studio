/**
 * 共享的拖拽反馈函数。
 *
 * 原本在 web_browser.js 和 web_editor.js 中各定义一份，
 * 阶段 5 提取为共享模块。
 */

export function setNativeDragFeedbackActive(active) {
  document.documentElement.classList.toggle("html5-dragging", Boolean(active));
  document.body?.classList.toggle("html5-dragging", Boolean(active));
}
