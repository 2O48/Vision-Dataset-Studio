"""工作区单 item 读写操作组件。

从 DatasetWorkspace 提取的 get/save/rename/clone/swap/delete 等单 item 操作。
跨组件调用通过 self._workspace.xxx_method() 委托回门面。
"""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path
from typing import Optional

from core.caption_text_utils import _normalize_segment_inputs
from core.workspace_paths import (
    IMAGE_EXTS,
    IMAGE_ROLES,
    INVALID_BASENAME_CHARS,
    WINDOWS_RESERVED_NAMES,
    _natural_key,
)
from core.workspace_state import WorkspaceState, _StateProxy


class ItemRepository(_StateProxy):
    """单 item 读写操作组件。

    承载 get/save/rename/clone/swap/delete 等单 item 操作。state 属性访问通过
    _StateProxy 代理到 self._state；跨组件调用通过 self._workspace.xxx_method()。
    """

    def __init__(self, state: WorkspaceState, workspace):
        object.__setattr__(self, "_state", state)
        object.__setattr__(self, "_workspace", workspace)

    # ------------------------------------------------------------------
    # 读操作
    # ------------------------------------------------------------------
    def get_item(self, name: str) -> dict:
        if name not in self.file_names:
            raise KeyError(name)
        return self._workspace._serialize_item(name)

    def get_global_segments(self) -> list[dict]:
        if not self._global_segments_dirty:
            return [dict(row) for row in self._global_segments_cache]
        from collections import Counter

        from core.caption_text_utils import _parse_caption_segments

        counter = Counter()
        for name in self.file_names:
            content = self.txt_content.get(name, "")
            counter.update(_parse_caption_segments(content))
        self._global_segments_cache = [
            {"segment": segment, "tag": segment, "count": count}
            for segment, count in sorted(counter.items(), key=lambda item: (-item[1], item[0].lower()))
        ]
        self._global_segments_dirty = False
        return [dict(row) for row in self._global_segments_cache]

    def get_global_tags(self) -> list[dict]:
        return self.get_global_segments()

    # ------------------------------------------------------------------
    # 写操作
    # ------------------------------------------------------------------
    def save_segments(self, name: str, segments: list[str]) -> dict:
        if name not in self.file_names:
            raise KeyError(name)

        content = ", ".join(_normalize_segment_inputs(segments))
        return self.save_text(name, content)

    def save_tags(self, name: str, tags: list[str]) -> dict:
        return self.save_segments(name, tags)

    def save_text(self, name: str, content: str) -> dict:
        if name not in self.file_names:
            raise KeyError(name)

        content = str(content or "")
        if content.strip():
            self.txt_content[name] = content
            self.caption_overrides[name] = content
            self.caption_deleted.discard(name)
        else:
            self.txt_content.pop(name, None)
            self.caption_overrides.pop(name, None)
            self.caption_deleted.add(name)
        self.excluded_names.discard(name)
        self._workspace._save_workspace_state()
        self._state.mark_global_segments_dirty()
        return self._workspace._serialize_item(name)

    # ------------------------------------------------------------------
    # 重命名
    # ------------------------------------------------------------------
    def _clean_rename_basename(self, value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            raise ValueError("New file name is required.")
        if raw != Path(raw).name or any(char in INVALID_BASENAME_CHARS for char in raw):
            raise ValueError("New file name must not include a folder path.")
        suffix = Path(raw).suffix.lower()
        if suffix in IMAGE_EXTS or suffix == ".txt":
            raw = Path(raw).stem.strip()
        if not raw or raw in {".", ".."}:
            raise ValueError("New file name is invalid.")
        if raw.rstrip(" .") != raw:
            raise ValueError("New file name must not end with a space or dot.")
        if any(ord(char) < 32 for char in raw):
            raise ValueError("New file name contains invalid characters.")
        if raw.upper() in WINDOWS_RESERVED_NAMES:
            raise ValueError("New file name is reserved by Windows.")
        return raw

    def _increment_clone_basename(self, basename: str) -> str:
        raw = self._clean_rename_basename(basename)
        matches = list(re.finditer(r"\d+", raw))
        if not matches:
            return f"{raw}_1"
        match = matches[-1]
        number = match.group(0)
        incremented = str(int(number) + 1).zfill(len(number))
        return f"{raw[:match.start()]}{incremented}{raw[match.end():]}"

    def _clone_basename(self, basename: str, index: int = 1) -> str:
        raw = self._clean_rename_basename(basename)
        return f"{raw}_clone" if index <= 1 else f"{raw}_clone_{index}"

    def _clone_name_candidate(self, name: str, basename: str) -> str:
        old_name_path = Path(str(name).replace("\\", "/"))
        parent = old_name_path.parent.as_posix()
        return basename if parent in {"", "."} else f"{parent}/{basename}"

    def _clone_txt_target(self, name: str, basename: str) -> Optional[Path]:
        txt_source = self.txt_files.get(name)
        if txt_source:
            return txt_source.with_name(f"{basename}{txt_source.suffix}")

        content = self.txt_content.get(name, "")
        result_root = self.dirs.get("result")
        if not content.strip() or not result_root:
            return None

        old_name_path = Path(str(name).replace("\\", "/"))
        parent = old_name_path.parent.as_posix()
        target_dir = result_root if parent in {"", "."} else result_root.joinpath(*parent.split("/"))
        return target_dir / f"{basename}.txt"

    def _clone_targets_available(self, name: str, basename: str) -> bool:
        candidate_name = self._clone_name_candidate(name, basename)
        if candidate_name in self.file_names:
            return False
        for role in IMAGE_ROLES:
            source = self.files[role].get(name)
            if source and source.with_name(f"{basename}{source.suffix}").exists():
                return False
        txt_target = self._clone_txt_target(name, basename)
        return not (txt_target and txt_target.exists())

    def _clone_caption_state(self, source_name: str, target_name: str, txt_target: Optional[Path], txt_content: str):
        """复制 caption 状态到克隆 item。"""
        if txt_target and txt_content.strip():
            self.txt_files[target_name] = txt_target
            self.txt_content[target_name] = txt_content
        elif source_name in self.caption_deleted:
            self.caption_deleted.add(target_name)
        if source_name in self.caption_overrides and txt_content.strip():
            self.caption_overrides[target_name] = txt_content
        self.excluded_names.discard(target_name)

    def _clone_image_files(self, source_name: str, target_basename: str) -> list[tuple[Path, Path]]:
        """返回 (source, target) 图像复制对列表（不含 txt）。"""
        pairs: list[tuple[Path, Path]] = []
        for role in IMAGE_ROLES:
            source = self.files[role].get(source_name)
            if not source:
                continue
            pairs.append((source, source.with_name(f"{target_basename}{source.suffix}")))
        return pairs

    def _clone_txt_file(self, source_name: str, target_basename: str, txt_target: Optional[Path], txt_content: str) -> Optional[tuple[Path, Path]]:
        """返回 txt 复制对 (source_or_target, target)，无则 None。"""
        if not (txt_target and txt_content.strip()):
            return None
        txt_source = self.txt_files.get(source_name)
        return (txt_source, txt_target) if txt_source else (txt_target, txt_target)

    # ------------------------------------------------------------------
    # 文件 I/O
    # ------------------------------------------------------------------
    def _read_text_file(self, path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except Exception:
            return path.read_text(encoding="gbk", errors="replace")

    def _write_text_file(self, path: Path, content: str):
        path.write_text(content, encoding="utf-8")

    def _get_save_dir(self) -> Optional[Path]:
        return self.dirs["result"] or self.dirs["control1"]

    # ------------------------------------------------------------------
    # 重命名 / 克隆 / 角色交换 / 别名 / 删除
    # ------------------------------------------------------------------
    def rename_item(self, name: str, new_basename: str) -> dict:
        if name not in self.file_names:
            raise KeyError(name)

        clean_basename = self._clean_rename_basename(new_basename)
        old_name_path = Path(str(name).replace("\\", "/"))
        parent = old_name_path.parent.as_posix()
        new_name = clean_basename if parent in {"", "."} else f"{parent}/{clean_basename}"
        if new_name != name and new_name in self.file_names:
            raise FileExistsError(f"Item already exists: {new_name}")

        rename_pairs: list[tuple[Path, Path]] = []
        for role in IMAGE_ROLES:
            source = self.files[role].get(name)
            if not source:
                continue
            target = source.with_name(f"{clean_basename}{source.suffix}")
            if target != source:
                if target.exists():
                    raise FileExistsError(f"Target file already exists: {target}")
                rename_pairs.append((source, target))

        txt_source = self.txt_files.get(name)
        if txt_source:
            txt_target = txt_source.with_name(f"{clean_basename}{txt_source.suffix}")
            if txt_target != txt_source:
                if txt_target.exists():
                    raise FileExistsError(f"Target file already exists: {txt_target}")
                rename_pairs.append((txt_source, txt_target))

        renamed: list[tuple[Path, Path]] = []
        try:
            for source, target in rename_pairs:
                if not source.exists():
                    raise FileNotFoundError(f"Source file does not exist: {source}")
                source.rename(target)
                renamed.append((source, target))
        except Exception:
            for source, target in reversed(renamed):
                try:
                    if target.exists() and not source.exists():
                        target.rename(source)
                except Exception:
                    pass
            raise

        moved_paths = {source: target for source, target in rename_pairs}
        self.file_names = [new_name if item == name else item for item in self.file_names]
        for role in IMAGE_ROLES:
            if name in self.files[role]:
                source = self.files[role].pop(name)
                self.files[role][new_name] = moved_paths.get(source, source)
        if name in self.txt_files:
            source = self.txt_files.pop(name)
            self.txt_files[new_name] = moved_paths.get(source, source)
        if name in self.txt_content:
            self.txt_content[new_name] = self.txt_content.pop(name)
        if name in self.caption_overrides:
            self.caption_overrides[new_name] = self.caption_overrides.pop(name)
        if name in self.caption_deleted:
            self.caption_deleted.discard(name)
            self.caption_deleted.add(new_name)
        if name in self.excluded_names:
            self.excluded_names.discard(name)
            self.excluded_names.add(new_name)

        self._image_sizes.clear()
        self._resolution_mismatch.clear()
        self._resolution_index_ready = False
        self._state.mark_global_segments_dirty()
        self.file_names = sorted(self.file_names, key=_natural_key)
        self._workspace._save_workspace_state()
        self._workspace._ensure_resolution_index()
        return {
            "old_name": name,
            "new_name": new_name,
            "renamed": [{"from": str(source), "to": str(target)} for source, target in rename_pairs],
            "item": self._workspace._serialize_item(new_name),
            "workspace": self._workspace.get_workspace_summary(),
        }

    def clone_item(self, name: str) -> dict:
        if name not in self.file_names:
            raise KeyError(name)

        old_name_path = Path(str(name).replace("\\", "/"))
        clone_index = 1
        candidate_basename = self._clone_basename(old_name_path.name, clone_index)
        while not self._clone_targets_available(name, candidate_basename):
            clone_index += 1
            candidate_basename = self._clone_basename(old_name_path.name, clone_index)
        new_name = self._clone_name_candidate(name, candidate_basename)

        copy_pairs: list[tuple[Path, Path]] = self._clone_image_files(name, candidate_basename)

        txt_target = self._clone_txt_target(name, candidate_basename)
        txt_content = self.txt_content.get(name, "")
        txt_pair = self._clone_txt_file(name, candidate_basename, txt_target, txt_content)
        if txt_pair:
            copy_pairs.append(txt_pair)

        copied: list[Path] = []
        try:
            for source, target in copy_pairs:
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    raise FileExistsError(f"Target file already exists: {target}")
                if source == target:
                    self._write_text_file(target, txt_content)
                else:
                    if not source.exists():
                        raise FileNotFoundError(f"Source file does not exist: {source}")
                    shutil.copy2(source, target)
                    if target == txt_target and txt_content != self._read_text_file(target):
                        self._write_text_file(target, txt_content)
                copied.append(target)
        except Exception:
            for path in reversed(copied):
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
            raise

        self.file_names.append(new_name)
        for role in IMAGE_ROLES:
            source = self.files[role].get(name)
            if source:
                self.files[role][new_name] = source.with_name(f"{candidate_basename}{source.suffix}")
        self._clone_caption_state(name, new_name, txt_target, txt_content)

        self._image_sizes.clear()
        self._resolution_mismatch.clear()
        self._resolution_index_ready = False
        self._state.mark_global_segments_dirty()
        self.file_names = sorted(self.file_names, key=_natural_key)
        self._workspace._save_workspace_state()
        self._workspace._ensure_resolution_index()
        return {
            "old_name": name,
            "new_name": new_name,
            "copied": [{"from": str(source), "to": str(target)} for source, target in copy_pairs],
            "item": self._workspace._serialize_item(new_name),
            "workspace": self._workspace.get_workspace_summary(),
        }

    def swap_item_roles(self, name: str, source_role: str, target_role: str) -> dict:
        if name not in self.file_names:
            raise KeyError(name)
        if source_role not in IMAGE_ROLES or target_role not in IMAGE_ROLES:
            raise ValueError("Unsupported image role.")
        if source_role == target_role:
            return {
                "name": name,
                "source_role": source_role,
                "target_role": target_role,
                "swapped": [],
                "item": self._workspace._serialize_item(name),
                "workspace": self._workspace.get_workspace_summary(),
            }

        source_path = self.files[source_role].get(name)
        target_path = self.files[target_role].get(name)
        if not source_path or not source_path.exists():
            raise FileNotFoundError(f"Source role image does not exist: {source_role}")
        if not target_path or not target_path.exists():
            raise FileNotFoundError(f"Target role image does not exist: {target_role}")
        if source_path == target_path:
            raise ValueError("Source and target roles point to the same file.")

        next_source_path = source_path.with_suffix(target_path.suffix)
        next_target_path = target_path.with_suffix(source_path.suffix)
        occupied = {source_path, target_path}
        for path in {next_source_path, next_target_path}:
            if path not in occupied and path.exists():
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

        self.files[source_role][name] = next_source_path
        self.files[target_role][name] = next_target_path
        for key in list(self._image_sizes.keys()):
            if key[1] == name:
                self._image_sizes.pop(key, None)
        self._resolution_mismatch.discard(name)
        self._resolution_index_ready = False
        self._workspace._save_workspace_state()
        self._workspace._ensure_resolution_index()
        return {
            "name": name,
            "source_role": source_role,
            "target_role": target_role,
            "swapped": [
                {"role": source_role, "path": str(next_source_path)},
                {"role": target_role, "path": str(next_target_path)},
            ],
            "item": self._workspace._serialize_item(name),
            "workspace": self._workspace.get_workspace_summary(),
        }

    def apply_name_aliases(self, aliases: dict[str, str]) -> dict:
        if not isinstance(aliases, dict) or not aliases:
            return self._workspace.get_workspace_summary()

        used_names: set[str] = set()
        rename_map: dict[str, str] = {}
        for name in self.file_names:
            alias = str(aliases.get(name, "") or "").strip().replace("\\", "/")
            next_name = alias or name
            next_name = self._workspace._ensure_unique_name(next_name, used_names)
            used_names.add(next_name)
            rename_map[name] = next_name

        if all(old == new for old, new in rename_map.items()):
            return self._workspace.get_workspace_summary()

        self.file_names = [rename_map[name] for name in self.file_names]
        for role in IMAGE_ROLES:
            self.files[role] = {
                rename_map.get(name, name): path
                for name, path in self.files[role].items()
            }
        self.txt_files = {
            rename_map.get(name, name): path
            for name, path in self.txt_files.items()
        }
        self.txt_content = {
            rename_map.get(name, name): content
            for name, content in self.txt_content.items()
        }
        self.caption_overrides = {
            rename_map.get(name, name): content
            for name, content in self.caption_overrides.items()
        }
        self.caption_deleted = {rename_map.get(name, name) for name in self.caption_deleted}
        self.excluded_names = {rename_map.get(name, name) for name in self.excluded_names}
        self._image_sizes.clear()
        self._resolution_mismatch.clear()
        self._resolution_index_ready = False
        self._state.mark_global_segments_dirty()
        self.file_names = sorted(self.file_names, key=_natural_key)
        return self._workspace.get_workspace_summary()

    def delete_item(self, name: str) -> dict:
        if name not in self.file_names:
            raise KeyError(name)

        self.excluded_names.add(name)
        self.caption_overrides.pop(name, None)
        self.caption_deleted.discard(name)
        self._state.mark_global_segments_dirty()
        self.file_names = [item for item in self.file_names if item != name]
        self._resolution_mismatch.discard(name)
        for key in list(self._image_sizes.keys()):
            if key[1] == name:
                self._image_sizes.pop(key, None)
        self._workspace._save_workspace_state()

        return {
            "removed": [],
            "errors": [],
            "excluded": [name],
            "message": "Item excluded from export set. Source files were not changed.",
        }

    # ------------------------------------------------------------------
    # 路径解析 / 替换
    # ------------------------------------------------------------------
    def primary_item_path(self, name: str) -> Path:
        if name not in self.file_names:
            raise KeyError(name)
        for role in ("result", "control1", "control2", "control3"):
            path = self.files.get(role, {}).get(name)
            if path and path.exists():
                return path
        txt_path = self.txt_files.get(name)
        if txt_path and txt_path.exists():
            return txt_path
        raise FileNotFoundError(f"No source file found for item: {name}")

    def resolve_image_path(self, role: str, name: str) -> Optional[Path]:
        return self.files.get(role, {}).get(name)

    def replace_item_paths(self, name: str, paths: dict[str, str]) -> dict:
        if name not in self.file_names:
            raise KeyError(name)
        for role, value in (paths or {}).items():
            if role not in IMAGE_ROLES:
                continue
            path = Path(str(value or ""))
            if not path.is_file():
                continue
            self.files[role][name] = path
        for key in list(self._image_sizes.keys()):
            if key[1] == name:
                self._image_sizes.pop(key, None)
        self._resolution_mismatch.discard(name)
        self._resolution_index_ready = False
        self._workspace._ensure_resolution_index()
        return self._workspace._serialize_item(name)
