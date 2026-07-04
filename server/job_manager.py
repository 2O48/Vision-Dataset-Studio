"""后台任务管理器基类。

BatchCaptionManager / ExportManager / ImageProcessManager 三个 Manager 原本
各自维护高度雷同的线程生命周期、日志、快照逻辑（_lock / _thread / running /
total / done / current / status / logs / _log），现抽取到 BaseJobManager。

子类只需：
- 设置 log_tag / log_max_entries 类属性
- 在 __init__ 中调用 super().__init__() 后追加自己的业务字段
- 在 start() 中调用 _reset_common() 并设置 running=True / 业务字段
- 在 _run() 的 finally 块中调用 _finish()
- 在 snapshot() 中调用 base_snapshot() 并追加业务字段
"""

from __future__ import annotations

import threading
import time
from typing import Optional


class BaseJobManager:
    """后台任务管理器基类，封装通用的线程/日志/快照逻辑。"""

    log_tag: str = "job"
    log_max_entries: int = 300

    def __init__(self):
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self.running = False
        self.total = 0
        self.done = 0
        self.current = ""
        self.status = "idle"
        self.logs: list[dict] = []

    def _log(self, message: str, level: str = "info") -> None:
        ts = time.strftime("%H:%M:%S")
        self.logs.append({"ts": ts, "level": level, "message": message})
        self.logs = self.logs[-self.log_max_entries :]
        try:
            print(f"[{ts}] [{self.log_tag}] [{level}] {message}", flush=True)
        except OSError:
            pass

    def _reset_common(self) -> None:
        """重置通用字段到 running 初始状态。子类 start() 应在持锁时调用。"""
        self.total = 0
        self.done = 0
        self.current = ""
        self.status = "running"
        self.logs = []

    def _finish(self) -> None:
        """标记任务不再运行。子类 _run() 的 finally 块应在持锁时调用。"""
        self.running = False
        self.current = ""

    def base_snapshot(self) -> dict:
        """返回通用快照字段。子类 snapshot() 应调用并追加业务字段。"""
        return {
            "running": self.running,
            "total": self.total,
            "done": self.done,
            "current": self.current,
            "status": self.status,
            "logs": list(self.logs),
        }
