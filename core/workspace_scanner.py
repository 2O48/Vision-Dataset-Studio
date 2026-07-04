"""工作区扫描与只读查询组件。

从 DatasetWorkspace 提取的扫描/序列化/统计逻辑。所有方法都是读操作，
只访问 state 和互相调用，不涉及跨组件写操作。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from PIL import Image

from core.caption_text_utils import _parse_caption_segments
from core.workspace_paths import (
    CONTROL_ROLES,
    IMAGE_EXTS,
    IMAGE_ROLES,
    ROLE_STRIP_PATTERNS,
    _natural_key,
)
from core.workspace_state import WorkspaceState, _StateProxy


class WorkspaceScanner(_StateProxy):
    """工作区扫描与只读查询组件。

    承载扫描图片/文本、序列化 item 摘要/详情、构建统计、导出列表等只读逻辑。
    所有 state 属性访问通过 _StateProxy 代理到 self._state。
    """

    def __init__(self, state: WorkspaceState, workspace):
        object.__setattr__(self, "_state", state)
        object.__setattr__(self, "_workspace", workspace)

    # ------------------------------------------------------------------
    # Caption / 名称归一化
    # ------------------------------------------------------------------
    def _has_caption(self, name: str) -> bool:
        if name in self.caption_deleted:
            return False
        if name in self.caption_overrides:
            return bool(str(self.caption_overrides.get(name, "") or "").strip())
        if name in self.txt_files:
            return bool(str(self.txt_content.get(name, "") or "").strip())
        return False

    def _normalize_match_part(self, value: str, *, strip_role_patterns: bool) -> str:
        value = (value or "").strip().lower()
        for token in self.ignore_tokens:
            if token:
                value = value.replace(token, " ")

        if strip_role_patterns:
            previous = None
            while previous != value:
                previous = value
                for pattern in ROLE_STRIP_PATTERNS:
                    value = re.sub(rf"^(?:{pattern})(?:[\s._-]+|$)", "", value)
                    value = re.sub(rf"(?:^|[\s._-]+)(?:{pattern})$", "", value)

        value = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)
        return value

    def _normalize_match_key(self, stem: str) -> str:
        raw = (stem or "").strip().replace("\\", "/")
        parts = [part for part in raw.split("/") if part]
        if not parts:
            return raw.lower()

        normalized_parts: list[str] = []
        last_index = len(parts) - 1
        for index, part in enumerate(parts):
            normalized = self._normalize_match_part(part, strip_role_patterns=index == last_index)
            normalized_parts.append(normalized or part.strip().lower())
        return "/".join(normalized_parts)

    def _pick_display_name(self, group: dict, fallback: str) -> str:
        for role in ("result", "control1", "control2", "control3"):
            raw_name = group["raw_names"].get(role)
            if raw_name:
                return raw_name
        if group.get("txt_raw_name"):
            return str(group["txt_raw_name"])
        return fallback or "untitled"

    def _ensure_unique_name(self, name: str, used_names: set[str]) -> str:
        candidate = name or "untitled"
        if candidate not in used_names:
            return candidate
        index = 2
        while True:
            next_name = f"{candidate} [{index}]"
            if next_name not in used_names:
                return next_name
            index += 1

    def _relative_stem(self, root: Path, file: Path) -> str:
        try:
            relative = file.relative_to(root)
        except ValueError:
            relative = Path(file.name)
        return relative.with_suffix("").as_posix()

    # ------------------------------------------------------------------
    # 扫描
    # ------------------------------------------------------------------
    def _scan_images(self, path: Optional[Path]) -> dict[str, Path]:
        if not path or not path.is_dir():
            return {}
        return {
            self._relative_stem(path, file): file
            for file in path.rglob("*")
            if file.is_file() and file.suffix.lower() in IMAGE_EXTS
        }

    def _workspace_roots(self) -> list[Path]:
        roots = []
        for path in self.dirs.values():
            if path and path.exists():
                roots.append(path)
        return roots

    def _folder_item_names(self, folder: str) -> list[str]:
        clean_folder = self._workspace._clean_relative_folder(folder)
        prefix = f"{clean_folder}/"
        return [name for name in self.file_names if name == clean_folder or name.startswith(prefix)]

    def _refresh_workspace_folders(self):
        folders = set(self._workspace_folders)
        for name in self.file_names:
            folder = Path(str(name).replace("\\", "/")).parent.as_posix()
            if folder and folder != ".":
                folders.add(folder)
        visible: set[str] = set()
        roots = self._workspace_roots()
        for folder in folders:
            folder_path = Path(folder)
            if any((root / folder_path).is_dir() for root in roots):
                visible.add(folder)
        self._workspace_folders = visible
        return visible

    def _folder_exists_on_disk(self, folder: str) -> bool:
        clean_folder = self._workspace._clean_relative_folder(folder)
        folder_path = Path(clean_folder)
        return any((root / folder_path).is_dir() for root in self._workspace_roots())

    def _rewrite_workspace_folder_prefix(self, source_folder: str, target_folder: str):
        source = self._workspace._clean_relative_folder(source_folder)
        target = self._workspace._clean_relative_folder(target_folder) if str(target_folder or "").strip() else ""
        source_prefix = f"{source}/"
        updated: set[str] = set()
        for folder in self._workspace_folders:
            if folder == source:
                if target:
                    updated.add(target)
                continue
            if folder.startswith(source_prefix):
                suffix = folder[len(source_prefix):]
                new_folder = f"{target}/{suffix}" if target else suffix
                if new_folder:
                    updated.add(new_folder)
                continue
            updated.add(folder)
        self._workspace_folders = updated

    def _prune_empty_dir(self, directory: Path, root: Path):
        current = directory
        while current != root and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _group_images_by_match_key(self, images: dict[str, Path]) -> dict[str, dict]:
        groups: dict[str, dict] = {}
        for raw_name, path in images.items():
            match_key = self._normalize_match_key(raw_name)
            current = groups.get(match_key)
            if current is None or _natural_key(raw_name) < _natural_key(current["raw_name"]):
                groups[match_key] = {"raw_name": raw_name, "path": path}
        return groups

    def _image_path_for_raw_name(self, root: Path, raw_name: str, suffix: str) -> Path:
        parts = [part for part in str(raw_name or "").replace("\\", "/").split("/") if part]
        if not parts:
            parts = ["untitled"]
        parts[-1] = f"{parts[-1]}{suffix}"
        return root.joinpath(*parts)

    # ------------------------------------------------------------------
    # 分辨率索引
    # ------------------------------------------------------------------
    def _ensure_resolution_index(self):
        if self._resolution_index_ready:
            return
        for name in self.file_names:
            result_size = self._get_image_size("result", name)
            if not result_size:
                continue
            for role in CONTROL_ROLES[: self.control_count]:
                control_size = self._get_image_size(role, name)
                if control_size and control_size != result_size:
                    self._resolution_mismatch.add(name)
                    break
        self._resolution_index_ready = True

    def _get_image_size(self, role: str, name: str) -> Optional[tuple[int, int]]:
        cache_key = (role, name)
        if cache_key in self._image_sizes:
            return self._image_sizes[cache_key]

        path = self.files.get(role, {}).get(name)
        if not path or not path.exists():
            self._image_sizes[cache_key] = None
            return None

        try:
            with Image.open(path) as img:
                size = img.size
        except Exception:
            size = None
        self._image_sizes[cache_key] = size
        return size

    def _refresh_item_resolution_flag(self, name: str):
        if not self._resolution_index_ready:
            return
        for role in IMAGE_ROLES:
            self._image_sizes.pop((role, name), None)
        result_size = self._get_image_size("result", name)
        mismatch = bool(
            result_size
            and any(
                self._get_image_size(role, name) and self._get_image_size(role, name) != result_size
                for role in CONTROL_ROLES[: self.control_count]
            )
        )
        if mismatch:
            self._resolution_mismatch.add(name)
        else:
            self._resolution_mismatch.discard(name)

    # ------------------------------------------------------------------
    # 工作区摘要 / 列表
    # ------------------------------------------------------------------
    def get_workspace_summary(self) -> dict:
        self._refresh_workspace_folders()
        visible_names = set(self.file_names)
        return {
            "workspace_key": self.workspace_key or self._workspace._compute_workspace_key(),
            "dirs": {key: str(value) if value else "" for key, value in self.dirs.items()},
            "settings": {
                "control_count": self.control_count,
                "ignore_tokens": list(self.ignore_tokens),
            },
            "counts": {
                "control1": sum(1 for name in visible_names if name in self.files["control1"]),
                "control2": sum(1 for name in visible_names if name in self.files["control2"]),
                "control3": sum(1 for name in visible_names if name in self.files["control3"]),
                "result": sum(1 for name in visible_names if name in self.files["result"]),
                "txt": sum(1 for name in self.file_names if self._has_caption(name)),
                "all": len(self.file_names),
                "resolution_mismatch": len(self._resolution_mismatch) if self._resolution_index_ready else 0,
                "edited": sum(1 for name in self.file_names if name in self.caption_overrides),
                "excluded": len(self.excluded_names),
            },
            "folders": sorted(self._workspace_folders, key=_natural_key),
        }

    def list_items(
        self,
        *,
        filter_mode: str = "all",
        tag_query: str = "",
        search_mode: str = "all",
        match_mode: str = "contains",
        detail: bool = False,
        include_global_segments: bool = True,
    ) -> dict:
        names = list(self.file_names)
        control1_files = self.files["control1"]
        control2_files = self.files["control2"]
        control3_files = self.files["control3"]
        result_files = self.files["result"]

        if filter_mode == "no_control1" and self.control_count >= 1:
            names = [name for name in names if name not in control1_files]
        elif filter_mode == "no_control2" and self.control_count >= 2:
            names = [name for name in names if name not in control2_files]
        elif filter_mode == "no_control3" and self.control_count >= 3:
            names = [name for name in names if name not in control3_files]
        elif filter_mode == "no_result":
            names = [name for name in names if name not in result_files]
        elif filter_mode == "no_txt":
            names = [name for name in names if not self._has_caption(name)]
        elif filter_mode == "res_mismatch":
            self._ensure_resolution_index()
            names = [name for name in names if name in self._resolution_mismatch]

        tag_query = (tag_query or "").strip().lower()
        search_mode = (search_mode or "all").strip().lower()
        if search_mode not in {"all", "phrase", "name"}:
            search_mode = "all"
        match_mode = (match_mode or "contains").strip().lower()
        if match_mode not in {"contains", "exact"}:
            match_mode = "contains"

        def matches_search(value: str) -> bool:
            normalized = str(value or "").replace("\\", "/").strip().lower()
            if match_mode == "exact":
                parts = [part for part in normalized.split("/") if part]
                basename = parts[-1] if parts else normalized
                return normalized == tag_query or basename == tag_query
            return tag_query in normalized

        def matches_phrase(text: str) -> bool:
            content = str(text or "").strip().lower()
            segments = [segment.strip().lower() for segment in _parse_caption_segments(text)]
            if match_mode == "exact":
                return content == tag_query or any(segment == tag_query for segment in segments)
            return tag_query in content or any(tag_query in segment for segment in segments)

        if tag_query:
            names = [
                name
                for name in names
                if (
                    search_mode in {"all", "name"}
                    and matches_search(name)
                )
                or (
                    search_mode in {"all", "phrase"}
                    and matches_phrase(self.txt_content.get(name, ""))
                )
            ]

        items = [
            self._workspace._serialize_item(name) if detail else self._serialize_item_summary(name, search_query=tag_query, search_mode=search_mode, match_mode=match_mode)
            for name in names
        ]
        global_segments = self._workspace.get_global_segments() if include_global_segments and not tag_query else []
        return {
            "items": items,
            "stats": self._build_stats(filtered_count=len(items)),
            "global_segments": global_segments,
            "global_tags": global_segments,
        }

    def _item_search_matches(self, name: str, search_query: str, search_mode: str = "all", match_mode: str = "contains") -> dict:
        query = (search_query or "").strip().lower()
        if not query:
            return {}
        search_mode = (search_mode or "all").strip().lower()
        if search_mode not in {"all", "phrase", "name"}:
            search_mode = "all"
        match_mode = (match_mode or "contains").strip().lower()
        if match_mode not in {"contains", "exact"}:
            match_mode = "contains"
        text = self.txt_content.get(name, "")
        normalized_name = str(name).replace("\\", "/").strip().lower()
        name_parts = [part for part in normalized_name.split("/") if part]
        basename = name_parts[-1] if name_parts else normalized_name
        segments = [
            segment
            for segment in _parse_caption_segments(text)
            if (segment.strip().lower() == query if match_mode == "exact" else query in segment.lower())
        ]
        matches = {}
        if search_mode in {"all", "name"}:
            matches["name"] = normalized_name == query or basename == query if match_mode == "exact" else query in normalized_name
        if search_mode in {"all", "phrase"}:
            matches["segments"] = segments
        return matches

    def _serialize_item_summary(self, name: str, search_query: str = "", search_mode: str = "all", match_mode: str = "contains") -> dict:
        control1_path = self.files["control1"].get(name)
        control2_path = self.files["control2"].get(name)
        control3_path = self.files["control3"].get(name)
        result_path = self.files["result"].get(name)
        item = {
            "name": name,
            "exists": {
                "control1": bool(control1_path),
                "control2": bool(control2_path),
                "control3": bool(control3_path),
                "result": bool(result_path),
                "txt": self._has_caption(name),
            },
            "flags": {
                "resolution_mismatch": name in self._resolution_mismatch,
            },
        }
        matches = self._item_search_matches(name, search_query, search_mode=search_mode, match_mode=match_mode)
        if matches:
            item["search_matches"] = matches
        return item

    def _build_stats(self, *, filtered_count: int) -> dict:
        control1_files = self.files["control1"]
        control2_files = self.files["control2"]
        control3_files = self.files["control3"]
        result_files = self.files["result"]
        return {
            "all": len(self.file_names),
            "filtered": filtered_count,
            "no_control1": sum(1 for name in self.file_names if name not in control1_files) if self.control_count >= 1 else 0,
            "no_control2": sum(1 for name in self.file_names if name not in control2_files) if self.control_count >= 2 else 0,
            "no_control3": sum(1 for name in self.file_names if name not in control3_files) if self.control_count >= 3 else 0,
            "no_result": sum(1 for name in self.file_names if name not in result_files),
            "no_txt": sum(1 for name in self.file_names if not self._has_caption(name)),
            "resolution_mismatch": len(self._resolution_mismatch) if self._resolution_index_ready else 0,
            "edited": sum(1 for name in self.file_names if name in self.caption_overrides),
            "excluded": len(self.excluded_names),
        }

    def _serialize_item(self, name: str) -> dict:
        text = self.txt_content.get(name, "")
        segments = _parse_caption_segments(text)
        control1_path = self.files["control1"].get(name)
        control2_path = self.files["control2"].get(name)
        control3_path = self.files["control3"].get(name)
        result_path = self.files["result"].get(name)
        resolution = {
            "control1": self._get_image_size("control1", name),
            "control2": self._get_image_size("control2", name),
            "control3": self._get_image_size("control3", name),
            "result": self._get_image_size("result", name),
        }
        result_size = resolution["result"]
        item_resolution_mismatch = bool(
            result_size
            and any(
                resolution[role] and resolution[role] != result_size
                for role in CONTROL_ROLES[: self.control_count]
            )
        )
        if item_resolution_mismatch:
            self._resolution_mismatch.add(name)
        else:
            self._resolution_mismatch.discard(name)
        return {
            "name": name,
            "paths": {
                "control1": str(control1_path) if control1_path else "",
                "control2": str(control2_path) if control2_path else "",
                "control3": str(control3_path) if control3_path else "",
                "result": str(result_path) if result_path else "",
                "txt": str(self.txt_files.get(name, "")) if self._has_caption(name) and name in self.txt_files else "",
            },
            "exists": {
                "control1": bool(control1_path),
                "control2": bool(control2_path),
                "control3": bool(control3_path),
                "result": bool(result_path),
                "txt": self._has_caption(name),
            },
            "caption_source": "edited" if name in self.caption_overrides else "source" if self._has_caption(name) and name in self.txt_files else "",
            "tags": segments,
            "segments": segments,
            "text": text,
            "resolution": resolution,
            "flags": {
                "resolution_mismatch": item_resolution_mismatch,
            },
        }

    def get_export_items(self, names: Optional[list[str]] = None) -> list[dict]:
        self._ensure_resolution_index()
        export_names = list(names) if names else list(self.file_names)
        return [
            self._serialize_item(name)
            for name in export_names
            if name in self.file_names and name not in self.excluded_names
        ]
