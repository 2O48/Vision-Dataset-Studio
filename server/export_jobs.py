from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Optional

from dataset_exporter import ExportCancelled, export_dataset
from dataset_workspace import DatasetWorkspace


class ExportManager:
    def __init__(self, workspace: DatasetWorkspace):
        self.workspace = workspace
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self.running = False
        self.total = 0
        self.done = 0
        self.exported = 0
        self.skipped = 0
        self.current = ""
        self.status = "idle"
        self.result: dict = {}
        self.logs: list[dict] = []

    def _log(self, message: str, level: str = "info"):
        ts = time.strftime("%H:%M:%S")
        self.logs.append({"ts": ts, "level": level, "message": message})
        self.logs = self.logs[-300:]
        try:
            print(f"[{ts}] [export] [{level}] {message}", flush=True)
        except OSError:
            pass

    def snapshot(self) -> dict:
        with self._lock:
            pct = int((self.done / self.total) * 100) if self.total else (100 if self.status == "done" else 0)
            return {
                "running": self.running,
                "total": self.total,
                "done": self.done,
                "exported": self.exported,
                "skipped": self.skipped,
                "current": self.current,
                "status": self.status,
                "progress_pct": max(0, min(pct, 100)),
                "result": dict(self.result),
                "logs": list(self.logs),
            }

    def start(self, *, options: dict):
        with self._lock:
            if self.running:
                raise RuntimeError("Export job is already running.")
            names = options.get("names")
            items = self.workspace.get_export_items(names if isinstance(names, list) and names else None)
            if not items:
                raise ValueError("No exportable items.")
            self._stop.clear()
            self.running = True
            self.total = len(items)
            self.done = 0
            self.exported = 0
            self.skipped = 0
            self.current = ""
            self.status = "running"
            self.result = {}
            self.logs = []
            self._log(f"Export started. total={len(items)}", "info")
            self._thread = threading.Thread(target=self._run, args=(items, dict(options)), daemon=True)
            self._thread.start()

    def stop(self):
        with self._lock:
            if self.running:
                self.status = "stopping"
                self._stop.set()
                self._log("Export stop requested.", "warn")

    def download_path(self) -> Path:
        with self._lock:
            path = Path(str(self.result.get("path", "") or ""))
            if self.status != "done" or self.result.get("format") != "zip" or not path.is_file():
                raise FileNotFoundError("Export ZIP is not ready.")
            return path

    def _progress(self, row: dict):
        with self._lock:
            self.total = int(row.get("total", self.total) or self.total)
            self.done = int(row.get("done", self.done) or 0)
            self.exported = int(row.get("processed", self.exported) or 0)
            self.skipped = int(row.get("skipped", self.skipped) or 0)
            self.current = str(row.get("current", "") or "")
            message = str(row.get("message", "") or "")
            if message:
                self._log(message, str(row.get("level", "info") or "info"))

    def _run(self, items: list[dict], options: dict):
        try:
            result = export_dataset(
                items=items,
                output_format=str(options.get("format", "zip") or "zip"),
                output_dir=str(options.get("output_dir", "") or ""),
                project_name=str(options.get("project_name", "") or ""),
                target_megapixels=float(options.get("target_megapixels", 4.0) or 4.0),
                multiple=int(options.get("multiple", 16) or 16),
                process_images=bool(options.get("process_images", True)),
                include_controls=bool(options.get("include_controls", True)),
                control_count=self.workspace.control_count,
                preserve_subfolders=bool(options.get("preserve_subfolders", False)),
                progress_callback=self._progress,
                should_stop=self._stop.is_set,
                include_bytes=False,
            )
            with self._lock:
                self.result = result
                self.exported = int(result.get("exported", self.exported) or 0)
                self.skipped = len(result.get("skipped", []) or [])
                self.done = self.total
                self.current = ""
                self.status = "done"
                self._log(f"Export done. exported={self.exported} skipped={self.skipped}", "ok")
        except ExportCancelled:
            with self._lock:
                self.current = ""
                self.status = "stopped"
                self.result = {}
                self._log("Export stopped.", "warn")
        except Exception as exc:
            with self._lock:
                self.current = ""
                self.status = "error"
                self._log(str(exc), "error")
        finally:
            with self._lock:
                self.running = False
