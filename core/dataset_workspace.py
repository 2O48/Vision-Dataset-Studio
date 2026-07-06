from __future__ import annotations

import base64  # noqa: F401  # re-export for tests/external callers (dataset_workspace.base64)
import json
import logging
import threading
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Optional

from core.caption_text_utils import (  # noqa: F401
    _delete_caption_segments,
    _join_caption_parts,
    _merge_text_with_segments,
    _normalize_caption_spacing,
    _normalize_segment_inputs,
    _parse_caption_segments,
    _parse_tags,
    _replace_caption_segment,
    _split_caption_parts,
    delete_caption_segments,
    join_caption_parts,
    merge_text_with_segments,
    normalize_caption_spacing,
    normalize_segment_inputs,
    parse_caption_segments,
    parse_tags,
    replace_caption_segment,
    split_caption_parts,
)
from core.dataset_paths import DATASETS_DIR, WORKSPACES_DIR, resolve_user_path
from core.workspace_paths import (  # noqa: F401
    CONTROL_ROLES,
    IMAGE_EXTS,
    IMAGE_ROLES,
    INVALID_BASENAME_CHARS,
    ROLE_STRIP_PATTERNS,
    WINDOWS_RESERVED_NAMES,
    _infer_image_suffix,
    _looks_like_image_file,
    _natural_key,
    _parse_ignore_tokens,
    _parse_rename_tokens,
    infer_image_suffix,
    looks_like_image_file,
    natural_key,
    parse_ignore_tokens,
    parse_rename_tokens,
)
from core.workspace_state import WorkspaceState, WorkspaceStateStore, clean_relative_folder

try:
    import send2trash
except Exception:
    send2trash = None

logger = logging.getLogger(__name__)


# Backward-compatible alias: _resolve_user_path 已迁移至 core.dataset_paths.resolve_user_path。
# 保留此别名供既有 `from core.dataset_workspace import _resolve_user_path` 形式的导入继续可用。
_resolve_user_path = resolve_user_path

APP_STATE_DIR = DATASETS_DIR
WORKSPACE_STATE_DIR = WORKSPACES_DIR


def _send_to_trash(path: Path):
    if send2trash is not None:
        send2trash.send2trash(str(path))
    else:
        raise RuntimeError("send2trash is not available; refusing to permanently delete files.")


class DatasetWorkspace:
    """工作区门面（facade）。

    通过组合三个组件提供完整 API：
      - WorkspaceScanner: 扫描 / 序列化 / 只读查询
      - ItemRepository: 单 item 读写操作
      - BatchOperations: 批量操作

    state 属性（dirs/files/txt_files/...）通过 __getattr__/__setattr__ 代理到 self._state。
    大多数公共方法委托到组件，并保持 with self._lock 串行化。
    """

    # 这些属性名由 _state (WorkspaceState) 承载，DatasetWorkspace 通过
    # __getattr__/__setattr__ 透明代理，使现有 self.xxx 代码零改动。
    _STATE_ATTRS = frozenset({
        "dirs", "files", "txt_files", "txt_content", "caption_overrides",
        "caption_deleted", "excluded_names", "file_names", "_image_sizes",
        "_resolution_mismatch", "_resolution_index_ready", "_global_segments_cache",
        "_global_segments_dirty", "_workspace_folders", "control_count",
        "ignore_tokens", "workspace_key",
    })

    def __init__(self):
        self._lock = threading.RLock()
        # 先设置 _state 和 _state_store（绕过 __setattr__ 的代理逻辑）
        state = WorkspaceState()
        object.__setattr__(self, "_state", state)
        # state_dir_getter 动态读取模块级 WORKSPACE_STATE_DIR，支持测试 monkey-patch
        import sys as _sys

        _mod = _sys.modules[__name__]
        object.__setattr__(
            self,
            "_state_store",
            WorkspaceStateStore(state, lambda: _mod.WORKSPACE_STATE_DIR),
        )
        # 延迟 import 以避免循环依赖；创建三个组件并绕过 __setattr__ 代理
        from core.workspace_batch import BatchOperations
        from core.workspace_items import ItemRepository
        from core.workspace_scanner import WorkspaceScanner

        object.__setattr__(self, "_scanner", WorkspaceScanner(state, self))
        object.__setattr__(self, "_items", ItemRepository(state, self))
        object.__setattr__(self, "_batch", BatchOperations(state, self))

    def __getattr__(self, name: str):
        # 仅在常规属性查找失败时调用，代理到 _state
        if name in self._STATE_ATTRS:
            return getattr(self._state, name)
        raise AttributeError(name)

    def __setattr__(self, name: str, value):
        if name in self._STATE_ATTRS:
            setattr(self._state, name, value)
        else:
            object.__setattr__(self, name, value)

    # ------------------------------------------------------------------
    # 打开 / 合并目录（保留协调逻辑：扫描 + state_store 加载/应用）
    # ------------------------------------------------------------------
    def open_dirs(
        self,
        *,
        control1_dir: Optional[str] = None,
        control2_dir: Optional[str] = None,
        control3_dir: Optional[str] = None,
        result_dir: Optional[str] = None,
        control_count: Optional[int] = None,
        ignore_tokens=None,
    ) -> dict:
        with self._lock:
            if control_count is not None:
                self.control_count = max(0, min(3, int(control_count)))
            if ignore_tokens is not None:
                self.ignore_tokens = _parse_ignore_tokens(ignore_tokens)

            for key, value in (
                ("control1", control1_dir),
                ("control2", control2_dir),
                ("control3", control3_dir),
                ("result", result_dir),
            ):
                if value is None:
                    continue
                raw_value = str(value or "").strip()
                if not raw_value:
                    self.dirs[key] = None
                    continue
                path = _resolve_user_path(raw_value)
                if not path.is_dir():
                    raise FileNotFoundError(f"{key} directory does not exist: {value}")
                self.dirs[key] = path

            scanned_images = {key: self._scanner._scan_images(self.dirs[key]) for key in IMAGE_ROLES}
            groups: dict[str, dict] = {}
            for role in IMAGE_ROLES:
                for raw_name, path in scanned_images[role].items():
                    match_key = self._scanner._normalize_match_key(raw_name)
                    group = groups.setdefault(match_key, {"paths": {}, "raw_names": {}, "txt_path": None, "txt_raw_name": ""})
                    current_name = group["raw_names"].get(role)
                    if current_name is None or _natural_key(raw_name) < _natural_key(current_name):
                        group["paths"][role] = path
                        group["raw_names"][role] = raw_name

            self.txt_files = {}
            self.txt_content = {}
            self.caption_overrides = {}
            self.caption_deleted = set()
            self.excluded_names = set()
            result_path = self.dirs["result"]
            if result_path and result_path.is_dir():
                for file in result_path.rglob("*.txt"):
                    if not file.is_file() or file.suffix.lower() != ".txt":
                        continue
                    raw_name = self._scanner._relative_stem(result_path, file)
                    match_key = self._scanner._normalize_match_key(raw_name)
                    group = groups.get(match_key)
                    if group is None:
                        continue
                    current_name = group["txt_raw_name"]
                    if not current_name or _natural_key(raw_name) < _natural_key(current_name):
                        group["txt_path"] = file
                        group["txt_raw_name"] = raw_name

            self.files = {role: {} for role in IMAGE_ROLES}
            self.file_names = []
            used_names: set[str] = set()
            for _, group in sorted(groups.items(), key=lambda item: _natural_key(self._scanner._pick_display_name(item[1], item[0]))):
                display_name = self._scanner._ensure_unique_name(self._scanner._pick_display_name(group, ""), used_names)
                used_names.add(display_name)
                self.file_names.append(display_name)
                for role in IMAGE_ROLES:
                    path = group["paths"].get(role)
                    if path is not None:
                        self.files[role][display_name] = path
                txt_path = group.get("txt_path")
                if txt_path is not None:
                    self.txt_files[display_name] = txt_path
                    self.txt_content[display_name] = self._items._read_text_file(txt_path)

            self._image_sizes.clear()
            self._resolution_mismatch.clear()
            self._resolution_index_ready = False
            self.workspace_key = self._compute_workspace_key()
            self._load_workspace_state()
            self._apply_workspace_state()
            self._refresh_caption_search_cache()
            self._mark_global_segments_dirty()
            self.file_names = sorted(self.file_names, key=_natural_key)
            return self._scanner.get_workspace_summary()

    def merge_dirs(
        self,
        *,
        control1_dir: Optional[str] = None,
        control2_dir: Optional[str] = None,
        control3_dir: Optional[str] = None,
        result_dir: Optional[str] = None,
        control_count: Optional[int] = None,
    ) -> dict:
        with self._lock:
            if control_count is not None:
                self.control_count = max(0, min(3, int(control_count)))

            incoming_dirs: dict[str, Optional[Path]] = {role: None for role in IMAGE_ROLES}
            for key, value in (
                ("control1", control1_dir),
                ("control2", control2_dir),
                ("control3", control3_dir),
                ("result", result_dir),
            ):
                raw_value = str(value or "").strip()
                if not raw_value:
                    continue
                path = _resolve_user_path(raw_value)
                if not path.is_dir():
                    raise FileNotFoundError(f"{key} directory does not exist: {value}")
                incoming_dirs[key] = path

            if not any(incoming_dirs.values()):
                raise ValueError("Merge requires at least one image directory.")

            scanned_images = {key: self._scanner._scan_images(incoming_dirs[key]) for key in IMAGE_ROLES}
            groups: dict[str, dict] = {}
            for role in IMAGE_ROLES:
                for raw_name, path in scanned_images[role].items():
                    match_key = self._scanner._normalize_match_key(raw_name)
                    group = groups.setdefault(match_key, {"paths": {}, "raw_names": {}, "txt_path": None, "txt_raw_name": ""})
                    current_name = group["raw_names"].get(role)
                    if current_name is None or _natural_key(raw_name) < _natural_key(current_name):
                        group["paths"][role] = path
                        group["raw_names"][role] = raw_name

            result_path = incoming_dirs["result"]
            if result_path and result_path.is_dir():
                for file in result_path.rglob("*.txt"):
                    if not file.is_file() or file.suffix.lower() != ".txt":
                        continue
                    raw_name = self._scanner._relative_stem(result_path, file)
                    match_key = self._scanner._normalize_match_key(raw_name)
                    group = groups.get(match_key)
                    if group is None:
                        continue
                    current_name = group["txt_raw_name"]
                    if not current_name or _natural_key(raw_name) < _natural_key(current_name):
                        group["txt_path"] = file
                        group["txt_raw_name"] = raw_name

            used_names = set(self.file_names) | set(self.excluded_names)
            merged_names: list[str] = []
            for _, group in sorted(groups.items(), key=lambda item: _natural_key(self._scanner._pick_display_name(item[1], item[0]))):
                display_name = self._scanner._ensure_unique_name(self._scanner._pick_display_name(group, ""), used_names)
                used_names.add(display_name)
                self.file_names.append(display_name)
                merged_names.append(display_name)
                for role in IMAGE_ROLES:
                    path = group["paths"].get(role)
                    if path is not None:
                        self.files[role][display_name] = path
                txt_path = group.get("txt_path")
                if txt_path is not None:
                    self.txt_files[display_name] = txt_path
                    self.txt_content[display_name] = self._items._read_text_file(txt_path)

            self._image_sizes.clear()
            self._resolution_mismatch.clear()
            self._resolution_index_ready = False
            self.file_names = sorted(self.file_names, key=_natural_key)
            self._refresh_caption_search_cache()
            self._mark_global_segments_dirty()
            summary = self._scanner.get_workspace_summary()
            return {
                "merged": len(merged_names),
                "names": merged_names,
                "workspace": summary,
            }

    # ------------------------------------------------------------------
    # StateStore 委托（步骤 3 已完成）
    # ------------------------------------------------------------------
    def _mark_global_segments_dirty(self):
        self._state.mark_global_segments_dirty()

    def _refresh_caption_search_cache(self) -> None:
        """Refresh searchable caption text for the current visible items."""
        valid_names = set(self.file_names)
        changed = False

        for name in list(self.txt_content):
            if name not in valid_names:
                self.txt_content.pop(name, None)
                changed = True
        for name in list(self.txt_files):
            if name not in valid_names:
                self.txt_files.pop(name, None)
                changed = True

        for name in self.file_names:
            if name in self.caption_deleted:
                if name in self.txt_content:
                    self.txt_content.pop(name, None)
                    changed = True
                continue

            if name in self.caption_overrides:
                content = str(self.caption_overrides.get(name, "") or "")
                if self.txt_content.get(name) != content:
                    self.txt_content[name] = content
                    changed = True
                continue

            txt_path = self.txt_files.get(name)
            if txt_path is None:
                result_path = self.files.get("result", {}).get(name)
                if result_path is not None:
                    candidate = result_path.with_suffix(".txt")
                    if candidate.is_file():
                        txt_path = candidate
                        self.txt_files[name] = candidate
                        changed = True

            if txt_path is not None and txt_path.is_file():
                content = self._items._read_text_file(txt_path)
                if self.txt_content.get(name) != content:
                    self.txt_content[name] = content
                    changed = True
            else:
                if name in self.txt_content:
                    self.txt_content.pop(name, None)
                    changed = True
                if txt_path is not None and self.txt_files.get(name) == txt_path:
                    self.txt_files.pop(name, None)
                    changed = True

        if changed:
            self._mark_global_segments_dirty()

    def _compute_workspace_key(self) -> str:
        return self._state_store._compute_workspace_key()

    def _workspace_state_path(self) -> Path:
        return self._state_store._workspace_state_path()

    def _load_workspace_state(self):
        self._state_store._load_workspace_state()

    def _save_workspace_state(self):
        self._state_store._save_workspace_state()

    def _apply_workspace_state(self):
        self._state_store._apply_workspace_state()

    # ------------------------------------------------------------------
    # Scanner 委托（保留为门面方法，因为 Items/Batch 通过 self._workspace 调用）
    # ------------------------------------------------------------------
    def _has_caption(self, name: str) -> bool:
        return self._scanner._has_caption(name)

    def _scan_images(self, path: Optional[Path]) -> dict[str, Path]:
        return self._scanner._scan_images(path)

    def _normalize_match_key(self, stem: str) -> str:
        return self._scanner._normalize_match_key(stem)

    def _pick_display_name(self, group: dict, fallback: str) -> str:
        return self._scanner._pick_display_name(group, fallback)

    def _ensure_unique_name(self, name: str, used_names: set[str]) -> str:
        return self._scanner._ensure_unique_name(name, used_names)

    def _relative_stem(self, root: Path, file: Path) -> str:
        return self._scanner._relative_stem(root, file)

    def _workspace_roots(self) -> list[Path]:
        return self._scanner._workspace_roots()

    def _folder_exists_on_disk(self, folder: str) -> bool:
        return self._scanner._folder_exists_on_disk(folder)

    def _rewrite_workspace_folder_prefix(self, source_folder: str, target_folder: str):
        return self._scanner._rewrite_workspace_folder_prefix(source_folder, target_folder)

    def _prune_empty_dir(self, directory: Path, root: Path):
        return self._scanner._prune_empty_dir(directory, root)

    def _group_images_by_match_key(self, images: dict[str, Path]) -> dict[str, dict]:
        return self._scanner._group_images_by_match_key(images)

    def _image_path_for_raw_name(self, root: Path, raw_name: str, suffix: str) -> Path:
        return self._scanner._image_path_for_raw_name(root, raw_name, suffix)

    def _ensure_resolution_index(self):
        return self._scanner._ensure_resolution_index()

    def _get_image_size(self, role: str, name: str):
        return self._scanner._get_image_size(role, name)

    def _image_version(self, role: str, name: str) -> str:
        path = self.files.get(role, {}).get(name)
        if not path or not path.exists():
            return ""
        try:
            stat = path.stat()
        except OSError:
            return ""
        return f"{stat.st_mtime_ns}-{stat.st_size}"

    def _item_image_versions(self, name: str) -> dict[str, str]:
        return {role: version for role in IMAGE_ROLES if (version := self._image_version(role, name))}

    def _refresh_item_resolution_flag(self, name: str):
        return self._scanner._refresh_item_resolution_flag(name)

    def _refresh_workspace_folders(self):
        return self._scanner._refresh_workspace_folders()

    def _clean_relative_folder(self, value: str) -> str:
        return clean_relative_folder(value)

    def _serialize_item(self, name: str) -> dict:
        return self._scanner._serialize_item(name)

    def _serialize_item_summary(self, name: str, search_query: str = "", search_mode: str = "all", match_mode: str = "contains") -> dict:
        return self._scanner._serialize_item_summary(name, search_query, search_mode, match_mode)

    def get_workspace_summary(self) -> dict:
        with self._lock:
            self._refresh_caption_search_cache()
            return self._scanner.get_workspace_summary()

    def list_items(self, **kwargs) -> dict:
        with self._lock:
            self._refresh_caption_search_cache()
            return self._scanner.list_items(**kwargs)

    def get_export_items(self, names: Optional[list[str]] = None) -> list[dict]:
        with self._lock:
            self._refresh_caption_search_cache()
            return self._scanner.get_export_items(names)

    # ------------------------------------------------------------------
    # Items 委托
    # ------------------------------------------------------------------
    def get_item(self, name: str) -> dict:
        with self._lock:
            self._refresh_caption_search_cache()
            return self._items.get_item(name)

    def get_global_segments(self) -> list[dict]:
        with self._lock:
            self._refresh_caption_search_cache()
            return self._items.get_global_segments()

    def get_global_tags(self) -> list[dict]:
        with self._lock:
            self._refresh_caption_search_cache()
            return self._items.get_global_tags()

    def save_segments(self, name: str, segments: list[str]) -> dict:
        with self._lock:
            return self._items.save_segments(name, segments)

    def save_tags(self, name: str, tags: list[str]) -> dict:
        with self._lock:
            return self._items.save_tags(name, tags)

    def save_text(self, name: str, content: str) -> dict:
        with self._lock:
            return self._items.save_text(name, content)

    def rename_item(self, name: str, new_basename: str) -> dict:
        with self._lock:
            return self._items.rename_item(name, new_basename)

    def clone_item(self, name: str) -> dict:
        with self._lock:
            return self._items.clone_item(name)

    def swap_item_roles(self, name: str, source_role: str, target_role: str) -> dict:
        with self._lock:
            return self._items.swap_item_roles(name, source_role, target_role)

    def apply_name_aliases(self, aliases: dict[str, str]) -> dict:
        with self._lock:
            return self._items.apply_name_aliases(aliases)

    def delete_item(self, name: str) -> dict:
        with self._lock:
            return self._items.delete_item(name)

    def primary_item_path(self, name: str) -> Path:
        with self._lock:
            return self._items.primary_item_path(name)

    def resolve_image_path(self, role: str, name: str) -> Optional[Path]:
        with self._lock:
            return self._items.resolve_image_path(role, name)

    def replace_item_paths(self, name: str, paths: dict[str, str]) -> dict:
        with self._lock:
            return self._items.replace_item_paths(name, paths)

    def _read_text_file(self, path: Path) -> str:
        return self._items._read_text_file(path)

    def _write_text_file(self, path: Path, content: str):
        return self._items._write_text_file(path, content)

    def _get_save_dir(self) -> Optional[Path]:
        return self._items._get_save_dir()

    def _clean_rename_basename(self, value: str) -> str:
        return self._items._clean_rename_basename(value)

    # ------------------------------------------------------------------
    # Batch 委托
    # ------------------------------------------------------------------
    def batch_add_segments(self, names: list[str], segments: list[str], position: str = "after") -> dict:
        with self._lock:
            return self._batch.batch_add_segments(names, segments, position)

    def batch_add_tags(self, names: list[str], tags: list[str], position: str = "after") -> dict:
        with self._lock:
            return self._batch.batch_add_tags(names, tags, position)

    def batch_delete_segments(self, names: list[str], segments: list[str]) -> dict:
        with self._lock:
            return self._batch.batch_delete_segments(names, segments)

    def batch_delete_tags(self, names: list[str], tags: list[str]) -> dict:
        with self._lock:
            return self._batch.batch_delete_tags(names, tags)

    def batch_replace_segment(self, names: list[str], old_segment: str, new_segment: str) -> dict:
        with self._lock:
            return self._batch.batch_replace_segment(names, old_segment, new_segment)

    def batch_replace_tag(self, names: list[str], old_tag: str, new_tag: str) -> dict:
        with self._lock:
            return self._batch.batch_replace_tag(names, old_tag, new_tag)

    def batch_rename_items(self, names: list[str], **kwargs) -> dict:
        with self._lock:
            return self._batch.batch_rename_items(names, **kwargs)

    def swap_control_result_pairs(self, **kwargs) -> dict:
        with self._lock:
            return self._batch.swap_control_result_pairs(**kwargs)

    def assign_control_image(self, source_name: str, target_name: str, target_role: str, source_role: str = "") -> dict:
        with self._lock:
            return self._batch.assign_control_image(source_name, target_name, target_role, source_role)

    def upload_control_image(self, target_name: str, target_role: str, filename: str, image_data: str, mime_type: str = "") -> dict:
        with self._lock:
            return self._batch.upload_control_image(target_name, target_role, filename, image_data, mime_type)

    def upload_result_image(self, filename: str, image_data: str) -> dict:
        with self._lock:
            return self._batch.upload_result_image(filename, image_data)

    def upload_role_image(self, role: str, filename: str, image_data: str, mime_type: str = "", folder: str = "") -> dict:
        with self._lock:
            return self._batch.upload_role_image(role, filename, image_data, mime_type, folder)

    def move_item_to_folder(self, name: str, target_folder: str) -> dict:
        with self._lock:
            return self._batch.move_item_to_folder(name, target_folder)

    def move_items_to_folder(self, names: list[str], target_folder: str) -> dict:
        with self._lock:
            return self._batch.move_items_to_folder(names, target_folder)

    def create_folder(self, folder: str) -> dict:
        with self._lock:
            return self._batch.create_folder(folder)

    def rename_folder(self, folder: str, new_folder: str) -> dict:
        with self._lock:
            return self._batch.rename_folder(folder, new_folder)

    def delete_folder(self, folder: str) -> dict:
        with self._lock:
            return self._batch.delete_folder(folder)

    def trash_item_files(self, name: str) -> dict:
        with self._lock:
            return self._batch.trash_item_files(name)

    # ------------------------------------------------------------------
    # 无状态依赖方法（保留在门面）
    # ------------------------------------------------------------------
    def translate_text(self, text: str) -> str:
        query = (text or "").strip()
        if not query:
            return ""
        url = (
            "https://translate.googleapis.com/translate_a/single"
            "?client=gtx&sl=auto&tl=zh-CN&dt=t&q="
            + urllib.parse.quote(query)
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        return "".join(item[0] for item in data[0] if item[0])

    # ------------------------------------------------------------------
    # PR #19 新增方法（swap_item_images + 辅助）
    # ------------------------------------------------------------------

    def _swap_existing_image_paths(self, source_path: Path, target_path: Path) -> tuple[Path, Path]:
        if not source_path.exists():
            raise FileNotFoundError(f"Source image does not exist: {source_path}")
        if not target_path.exists():
            raise FileNotFoundError(f"Target image does not exist: {target_path}")
        if source_path.resolve() == target_path.resolve():
            raise ValueError("Source and target roles point to the same file.")
        next_source_path = source_path.with_suffix(target_path.suffix)
        next_target_path = target_path.with_suffix(source_path.suffix)
        occupied = {source_path.resolve(), target_path.resolve()}
        for path in {next_source_path, next_target_path}:
            if path.exists() and path.resolve() not in occupied:
                raise FileExistsError(f"Target file already exists: {path}")
        temp_path = source_path.with_name(f".vds_role_swap_{uuid.uuid4().hex}{source_path.suffix}")
        moved: list[tuple[Path, Path]] = []
        try:
            source_path.rename(temp_path)
            moved.append((source_path, temp_path))
            if target_path != next_source_path:
                next_source_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.rename(next_source_path)
                moved.append((target_path, next_source_path))
            next_target_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path.rename(next_target_path)
            moved.append((temp_path, next_target_path))
        except Exception:
            for original, current in reversed(moved):
                try:
                    if current.exists() and not original.exists():
                        original.parent.mkdir(parents=True, exist_ok=True)
                        current.rename(original)
                except Exception:
                    pass
            raise
        return next_source_path, next_target_path

    def _touch_image_versions(self, *paths: Path):
        for path in paths:
            try:
                if path.exists():
                    path.touch()
            except OSError:
                pass

    def _invalidate_image_state(self, *names: str):
        dirty_names = {name for name in names if name}
        for key in list(self._image_sizes.keys()):
            if key[1] in dirty_names:
                self._image_sizes.pop(key, None)
        for name in dirty_names:
            self._resolution_mismatch.discard(name)
        self._resolution_index_ready = False

    def _validate_role_replace_target(self, target_name: str, target_role: str, allow_replace: bool = True):
        if target_role not in IMAGE_ROLES:
            raise ValueError("Target role must be an image role.")
        if target_role in CONTROL_ROLES:
            role_index = CONTROL_ROLES.index(target_role) + 1
            if self.control_count < role_index:
                raise ValueError(f"{target_role} is not enabled in the current workspace.")
        if target_name not in self.file_names:
            raise KeyError(target_name)
        if not allow_replace and target_name in self.files[target_role]:
            raise ValueError(f"{target_role} already exists for {target_name}.")

    def swap_item_images(self, source_name: str, source_role: str, target_name: str, target_role: str) -> dict:
        with self._lock:
            source_name = str(source_name or "").strip()
            target_name = str(target_name or "").strip()
            source_role = str(source_role or "").strip()
            target_role = str(target_role or "").strip()
            self._validate_role_replace_target(source_name, source_role, allow_replace=True)
            self._validate_role_replace_target(target_name, target_role, allow_replace=True)
            if source_name == target_name and source_role == target_role:
                item = self._serialize_item(source_name)
                return {
                    "source_name": source_name, "source_role": source_role,
                    "target_name": target_name, "target_role": target_role,
                    "swapped": [], "source_item": item, "target_item": item,
                    "item": item, "workspace": self.get_workspace_summary(),
                }
            source_path = self.files[source_role].get(source_name)
            target_path = self.files[target_role].get(target_name)
            if not source_path or not source_path.exists():
                raise FileNotFoundError(f"Source role image does not exist: {source_role}")
            if not target_path or not target_path.exists():
                raise FileNotFoundError(f"Target role image does not exist: {target_role}")
            next_source_path, next_target_path = self._swap_existing_image_paths(source_path, target_path)
            self.files[source_role][source_name] = next_source_path
            self.files[target_role][target_name] = next_target_path
            self._touch_image_versions(next_source_path, next_target_path)
            self._invalidate_image_state(source_name, target_name)
            self._save_workspace_state()
            self._ensure_resolution_index()
            source_item = self._serialize_item(source_name)
            target_item = source_item if source_name == target_name else self._serialize_item(target_name)
            return {
                "source_name": source_name, "source_role": source_role,
                "target_name": target_name, "target_role": target_role,
                "swapped": [
                    {"name": source_name, "role": source_role, "path": str(next_source_path)},
                    {"name": target_name, "role": target_role, "path": str(next_target_path)},
                ],
                "source_item": source_item, "target_item": target_item,
                "item": target_item, "workspace": self.get_workspace_summary(),
            }
