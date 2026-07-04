"""工作区共享状态数据容器与状态持久化。

承载 DatasetWorkspace 的所有运行时状态，使各职责组件（Scanner/ItemRepository/
BatchOperations/StateStore）可共享同一份状态而无需互相持有引用。
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

from core.workspace_paths import IMAGE_ROLES, INVALID_BASENAME_CHARS, _natural_key

logger = logging.getLogger(__name__)

# 模块级常量，供 WorkspaceStateStore 使用；dataset_workspace.py re-export 保持兼容
WORKSPACE_STATE_DIR_PLACEHOLDER = Path()  # 实际值由 dataset_workspace.py 的 WORKSPACE_STATE_DIR 提供


def clean_relative_folder(value: str) -> str:
    """清理相对文件夹路径，拒绝绝对路径和非法字符。纯函数，无实例依赖。"""
    raw = str(value or "").strip().replace("\\", "/")
    if not raw:
        raise ValueError("Target folder is required.")
    if raw.startswith("/") or re.match(r"^[a-zA-Z]:", raw):
        raise ValueError("Target folder must be relative.")
    parts = [part.strip() for part in raw.split("/") if part.strip()]
    if not parts:
        raise ValueError("Target folder is required.")
    clean_parts: list[str] = []
    for part in parts:
        if part in {".", ".."} or any(char in INVALID_BASENAME_CHARS for char in part):
            raise ValueError("Target folder contains invalid characters.")
        if part.rstrip(" .") != part or any(ord(char) < 32 for char in part):
            raise ValueError("Target folder contains invalid characters.")
        if part.upper() in {"CON", "PRN", "AUX", "NUL",
                             "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
                             "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}:
            raise ValueError("Target folder contains a reserved name.")
        clean_parts.append(part)
    return "/".join(clean_parts)


class _StateProxy:
    """Mixin: 透明代理 WorkspaceState 属性到 self._state。

    组件类（WorkspaceScanner/ItemRepository/BatchOperations）继承此基类后，
    所有列在 _STATE_ATTRS 中的 state 属性访问会自动代理到 self._state，
    使原 DatasetWorkspace 内的 self.xxx 方法代码可以原样复制。
    """

    _STATE_ATTRS = frozenset({
        "dirs", "files", "txt_files", "txt_content", "caption_overrides",
        "caption_deleted", "excluded_names", "file_names", "_image_sizes",
        "_resolution_mismatch", "_resolution_index_ready", "_global_segments_cache",
        "_global_segments_dirty", "_workspace_folders", "control_count",
        "ignore_tokens", "workspace_key",
    })

    def __getattr__(self, name):
        # 仅在常规属性查找失败时调用，代理到 self._state
        if name in self._STATE_ATTRS:
            return getattr(self._state, name)
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name in self._STATE_ATTRS:
            setattr(self._state, name, value)
        else:
            object.__setattr__(self, name, value)


class WorkspaceState:
    """工作区共享状态。

    所有属性原本直接挂在 DatasetWorkspace 上（阶段 2 拆分时提取）。
    DatasetWorkspace 通过 __getattr__/__setattr__ 透明代理这些属性。
    """

    def __init__(self):
        self.dirs: dict[str, Optional[Path]] = {role: None for role in IMAGE_ROLES}
        self.files: dict[str, dict[str, Path]] = {role: {} for role in IMAGE_ROLES}
        self.txt_files: dict[str, Path] = {}
        self.txt_content: dict[str, str] = {}
        self.caption_overrides: dict[str, str] = {}
        self.caption_deleted: set[str] = set()
        self.excluded_names: set[str] = set()
        self.file_names: list[str] = []
        self._image_sizes: dict[tuple[str, str], Optional[tuple[int, int]]] = {}
        self._resolution_mismatch: set[str] = set()
        self._resolution_index_ready = False
        self._global_segments_cache: list[dict] = []
        self._global_segments_dirty = True
        self._workspace_folders: set[str] = set()
        self.control_count = 1
        self.ignore_tokens: list[str] = []
        self.workspace_key = ""

    def reset_scan_state(self) -> None:
        """重置扫描相关状态（open_dirs/merge_dirs 调用前清空）。"""
        self.txt_files = {}
        self.txt_content = {}
        self.caption_overrides = {}
        self.caption_deleted = set()
        self.excluded_names = set()
        self._image_sizes = {}
        self._resolution_mismatch = set()
        self._resolution_index_ready = False
        self._global_segments_cache = []
        self._global_segments_dirty = True
        self._workspace_folders = set()

    def reset_resolution_index(self) -> None:
        """标记分辨率索引需要重建（写操作后调用）。"""
        self._resolution_index_ready = False

    def mark_global_segments_dirty(self) -> None:
        """标记全局 segments 缓存需要重建。"""
        self._global_segments_dirty = True


class WorkspaceStateStore:
    """工作区状态持久化（加载/保存/应用）。

    从 DatasetWorkspace 提取的 _compute_workspace_key / _load / _save / _apply 逻辑。
    通过 state: WorkspaceState 访问共享状态。

    state_dir_getter 是一个返回当前 WORKSPACE_STATE_DIR 的 callable，
    支持测试时 monkey-patch 模块级常量。
    """

    def __init__(self, state: WorkspaceState, state_dir_getter):
        self._state = state
        self._state_dir_getter = state_dir_getter

    @property
    def _state_dir(self) -> Path:
        return self._state_dir_getter()

    def _compute_workspace_key(self) -> str:
        s = self._state
        payload = {
            "dirs": {key: str(value) if value else "" for key, value in s.dirs.items()},
            "control_count": s.control_count,
            "ignore_tokens": list(s.ignore_tokens),
        }
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    def _workspace_state_path(self) -> Path:
        key = self._state.workspace_key or self._compute_workspace_key()
        return self._state_dir / f"{key}.json"

    def _load_workspace_state(self) -> None:
        s = self._state
        s.caption_overrides = {}
        s.caption_deleted = set()
        s.excluded_names = set()
        s._workspace_folders = set()
        state_path = self._workspace_state_path()
        if not state_path.exists():
            return
        try:
            data = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to load workspace state from %s", state_path, exc_info=True)
            return
        captions = data.get("captions", {})
        if isinstance(captions, dict):
            s.caption_overrides = {
                str(name): str(content or "")
                for name, content in captions.items()
            }
        deleted = data.get("caption_deleted", data.get("deleted_captions", []))
        if isinstance(deleted, list):
            s.caption_deleted = {str(name) for name in deleted}
        excluded = data.get("excluded", [])
        if isinstance(excluded, list):
            s.excluded_names = {str(name) for name in excluded}
        folders = data.get("folders", [])
        if isinstance(folders, list):
            s._workspace_folders = {clean_relative_folder(folder) for folder in folders if str(folder or "").strip()}

    def _save_workspace_state(self) -> None:
        s = self._state
        if not s.workspace_key:
            s.workspace_key = self._compute_workspace_key()
        self._state_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "workspace_key": s.workspace_key,
            "dirs": {key: str(value) if value else "" for key, value in s.dirs.items()},
            "captions": dict(sorted(s.caption_overrides.items())),
            "caption_deleted": sorted(s.caption_deleted, key=_natural_key),
            "excluded": sorted(s.excluded_names, key=_natural_key),
            "folders": sorted(s._workspace_folders, key=_natural_key),
        }
        self._workspace_state_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _apply_workspace_state(self) -> None:
        s = self._state
        valid_names = set(s.file_names)
        s.caption_overrides = {
            name: content
            for name, content in s.caption_overrides.items()
            if name in valid_names
        }
        s.caption_deleted = {name for name in s.caption_deleted if name in valid_names}
        s.caption_overrides = {
            name: content
            for name, content in s.caption_overrides.items()
            if name not in s.caption_deleted
        }
        s.excluded_names = {name for name in s.excluded_names if name in valid_names}
        for name, content in s.caption_overrides.items():
            s.txt_content[name] = content
        for name in s.caption_deleted:
            s.txt_content.pop(name, None)
        if s.excluded_names:
            s.file_names = [name for name in s.file_names if name not in s.excluded_names]

