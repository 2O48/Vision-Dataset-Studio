/**
 * WebSocket 客户端：替代轮询，实时接收 AI 状态快照。
 *
 * 使用方式（在 app.js 或其他入口文件中）：
 *   import { connectAiStatus } from "./shared/wsClient.js";
 *   connectAiStatus({
 *     onStatus: (data) => { state.aiStatus = data; },
 *     onError: () => { /* fallback to polling */ },
 *   });
 */

let _ws: WebSocket | null = null;
let _reconnectTimer: number | null = null;
let _intentionalClose = false;

interface WsClientOptions {
  onStatus: (data: Record<string, unknown>) => void;
  onError?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function connectAiStatus(opts: WsClientOptions): () => void {
  _intentionalClose = false;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const url = `${protocol}//${host}/api/v1/ws/ai-status`;

  function connect() {
    if (_intentionalClose) return;
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

    _ws = new WebSocket(url);
    _ws.onopen = () => {
      opts.onConnect?.();
    };
    _ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.ok && msg.status) {
          opts.onStatus(msg.status);
        }
      } catch {
        // ignore parse errors
      }
    };
    _ws.onclose = () => {
      opts.onDisconnect?.();
      if (!_intentionalClose) {
        scheduleReconnect();
      }
    };
    _ws.onerror = () => {
      opts.onError?.();
      // onclose will fire after onerror
    };
  }

  function scheduleReconnect() {
    if (_intentionalClose) return;
    if (_reconnectTimer !== null) return;
    _reconnectTimer = window.setTimeout(() => {
      _reconnectTimer = null;
      connect();
    }, 3000);
  }

  connect();

  // Start keepalive ping
  const pingInterval = window.setInterval(() => {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send("ping");
    }
  }, 25000);

  return () => {
    _intentionalClose = true;
    if (_reconnectTimer !== null) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    clearInterval(pingInterval);
    if (_ws) {
      _ws.close();
      _ws = null;
    }
  };
}
