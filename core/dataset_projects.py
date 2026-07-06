from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import threading
from datetime import datetime
from pathlib import Path

from core.dataset_paths import is_relative_to
from core.dataset_workspace import CONTROL_ROLES, IMAGE_EXTS

APP_DATA_DIR = Path.home() / ".vision_dataset_studio"
LEGACY_APP_DATA_DIR = Path.home() / ".lora_dataset_edit"
PROJECTS_DIR = APP_DATA_DIR / "projects"
TRASH_DIR = APP_DATA_DIR / "trash"
PROJECT_INDEX_FILE = APP_DATA_DIR / "projects_index.json"
LEGACY_PROJECTS_DIR = LEGACY_APP_DATA_DIR / "projects"
LEGACY_MIGRATION_MARKER = ".legacy_lora_dataset_edit_migrated.json"
SCHEMA_VERSION = 2


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _now_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _clean_name(value: str, fallback: str = "未命名项目") -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "_", value or fallback).strip()
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name or fallback


def _slug(value: str, fallback: str = "project") -> str:
    slug = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", _clean_name(value, fallback), flags=re.UNICODE)
    slug = re.sub(r"-+", "-", slug).strip("-._ ")
    return slug or fallback


def _project_id(name: str) -> str:
    return f"{_now_id()}-{_slug(name, 'project')}"


def _renamed_project_id(old_id: str, name: str) -> str:
    prefix_match = re.match(r"^(\d{8}-\d{6})[-_]", old_id or "")
    prefix = prefix_match.group(1) if prefix_match else _now_id()
    return f"{prefix}-{_slug(name, 'project')}"


def _safe_project_dir(project_id: str, *, root: Path = PROJECTS_DIR) -> Path:
    raw = (project_id or "").strip()
    if not raw:
        raise ValueError("Missing project id.")
    path = (root / raw).resolve()
    if not is_relative_to(path, root):
        raise ValueError("Invalid project id.")
    return path


def _read_json(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {} if fallback is None else fallback


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f"{path.suffix}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _remove_tree(path: Path) -> None:
    if not path.exists():
        return

    def onerror(func, value, _exc_info):
        try:
            os.chmod(value, stat.S_IWRITE)
            func(value)
        except Exception:
            pass

    try:
        shutil.rmtree(path, ignore_errors=False, onerror=onerror)
    except Exception:
        for root, dirs, files in os.walk(path, topdown=False):
            for name in files:
                try:
                    os.chmod(Path(root) / name, stat.S_IWRITE)
                except Exception:
                    pass
            for name in dirs:
                try:
                    os.chmod(Path(root) / name, stat.S_IWRITE)
                except Exception:
                    pass
        shutil.rmtree(path, ignore_errors=True)


def _item_target_stem(name: str, used: set[str]) -> str:
    raw = str(name or "item").replace("\\", "/")
    parts = [part for part in raw.split("/") if part]
    if not parts:
        parts = ["item"]
    parts[-1] = Path(parts[-1]).stem
    clean_parts = [_clean_name(part, "item") for part in parts]
    base = "/".join(clean_parts) or "item"
    candidate = base
    index = 2
    while candidate.lower() in used:
        candidate = f"{base}_{index}"
        index += 1
    used.add(candidate.lower())
    return candidate


def _relative(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def _project_paths(project_dir: Path) -> dict[str, Path]:
    return {
        "project": project_dir / "project.json",
        "manifest": project_dir / "manifest.json",
        "workspace": project_dir / "workspace.json",
        "assets": project_dir / "assets",
        "captions": project_dir / "captions",
        "state": project_dir / "state",
        "thumbnails": project_dir / "thumbnails",
    }


def _captioned_count(items: list[dict]) -> int:
    return sum(1 for item in items if str(item.get("caption", "") or "").strip())


def _active_roles(control_count: int) -> list[str]:
    count = 1 if control_count is None else int(control_count)
    return list(CONTROL_ROLES[: max(0, min(3, count))]) + ["result"]


def _workspace_dirs(project_dir: Path, control_count: int) -> dict[str, str]:
    assets_dir = project_dir / "assets"
    return {
        role: str((assets_dir / role).resolve())
        for role in _active_roles(control_count)
        if (assets_dir / role).exists()
    }


def _old_asset_maps(project_dir: Path) -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], str]]:
    manifest = _read_json(project_dir / "manifest.json", {})
    by_name: dict[tuple[str, str], str] = {}
    by_source: dict[tuple[str, str], str] = {}
    for item in manifest.get("items", []) if isinstance(manifest.get("items"), list) else []:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id", "") or item.get("name", "") or "")
        source_name = str(item.get("source_name", "") or "")
        assets = item.get("assets", {}) if isinstance(item.get("assets"), dict) else {}
        for role, rel in assets.items():
            if item_id and rel:
                by_name[(item_id, role)] = str(rel)
            if source_name and rel:
                by_source[(source_name, role)] = str(rel)
    workspace = _read_json(project_dir / "workspace.json", {})
    for item in workspace.get("items", []) if isinstance(workspace.get("items"), list) else []:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("name", "") or "")
        source_name = str(item.get("source_name", "") or "")
        roles = item.get("roles", {}) if isinstance(item.get("roles"), dict) else {}
        for role, rel in roles.items():
            normalized = str(rel).replace("\\", "/")
            if item_id and normalized:
                by_name.setdefault((item_id, role), normalized)
            if source_name and normalized:
                by_source.setdefault((source_name, role), normalized)
    return by_name, by_source


def _cleanup_project_assets(project_dir: Path, active_roles: list[str], keep_files: set[Path]) -> None:
    assets_dir = project_dir / "assets"
    active = set(active_roles)
    if not assets_dir.is_dir():
        return

    for role_dir in assets_dir.iterdir():
        if not role_dir.is_dir():
            continue
        if role_dir.name not in active:
            shutil.rmtree(role_dir, ignore_errors=True)
            continue
        for path in sorted(role_dir.rglob("*"), reverse=True):
            if path.is_file() and path.resolve() not in keep_files and path.suffix.lower() in IMAGE_EXTS | {".txt"}:
                path.unlink(missing_ok=True)
            elif path.is_dir():
                try:
                    path.rmdir()
                except OSError:
                    pass


def _sync_directory_contents(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    wanted: set[Path] = {target.resolve()}

    for source_path in sorted(source.rglob("*")):
        if ".git" in source_path.relative_to(source).parts:
            continue
        relative = source_path.relative_to(source)
        target_path = target / relative
        wanted.add(target_path.resolve())
        if source_path.is_dir():
            target_path.mkdir(parents=True, exist_ok=True)
        elif source_path.is_file():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)

    if not target.exists():
        return
    for target_path in sorted(target.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if ".git" in target_path.relative_to(target).parts:
            continue
        resolved = target_path.resolve()
        if resolved in wanted:
            continue
        if target_path.is_file() or target_path.is_symlink():
            target_path.unlink(missing_ok=True)
        elif target_path.is_dir():
            try:
                target_path.rmdir()
            except OSError:
                pass


def _copy_missing_file(source: Path, target: Path) -> None:
    if not source.is_file() or target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _merge_legacy_project_tree(source_root: Path, target_root: Path) -> None:
    if not source_root.is_dir():
        return
    target_root.mkdir(parents=True, exist_ok=True)
    for source_path in sorted(source_root.iterdir()):
        target_path = target_root / source_path.name
        if target_path.exists():
            continue
        if source_path.is_dir():
            shutil.copytree(source_path, target_path)
        elif source_path.is_file():
            _copy_missing_file(source_path, target_path)


def _normalize_workspace_payload(project_dir: Path, meta: dict, workspace: dict) -> dict:
    current = dict(workspace) if isinstance(workspace, dict) else {}
    settings = current.get("settings", {}) if isinstance(current.get("settings"), dict) else {}
    control_count = int(settings.get("control_count", meta.get("control_count", 1)))
    current["project_id"] = str(meta.get("id") or current.get("project_id") or project_dir.name)
    current["project_name"] = str(meta.get("name") or current.get("project_name") or project_dir.name)
    current["dirs"] = _workspace_dirs(project_dir, control_count)
    return current


class ProjectStore:
    def __init__(self, projects_dir: Path = PROJECTS_DIR, legacy_projects_dir: Path | None = None):
        self.projects_dir = projects_dir
        self.app_dir = self.projects_dir.parent
        self.trash_dir = self.app_dir / "trash"
        self.index_file = self.app_dir / "projects_index.json"
        self.legacy_migration_marker = self.app_dir / LEGACY_MIGRATION_MARKER
        if legacy_projects_dir is not None:
            self.legacy_projects_dir: Path | None = legacy_projects_dir
            self.legacy_app_dir: Path | None = legacy_projects_dir.parent
        elif self.projects_dir == PROJECTS_DIR:
            self.legacy_projects_dir = LEGACY_PROJECTS_DIR
            self.legacy_app_dir = LEGACY_APP_DATA_DIR
        else:
            self.legacy_projects_dir = None
            self.legacy_app_dir = None
        self._git_lock = threading.RLock()

    def _write_legacy_migration_marker(self, legacy_app_dir: Path) -> None:
        _write_json(
            self.legacy_migration_marker,
            {
                "source": str(legacy_app_dir),
                "migrated_at": _now(),
            },
        )

    def _migrate_legacy_app_dir(self) -> None:
        legacy_app_dir = self.legacy_app_dir
        if (
            not legacy_app_dir
            or legacy_app_dir == self.app_dir
            or not legacy_app_dir.exists()
            or self.legacy_migration_marker.exists()
        ):
            return
        if not self.app_dir.exists():
            self.app_dir.parent.mkdir(parents=True, exist_ok=True)
            try:
                legacy_app_dir.replace(self.app_dir)
                self._write_legacy_migration_marker(legacy_app_dir)
                return
            except OSError:
                pass
        self.app_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.trash_dir.mkdir(parents=True, exist_ok=True)
        _merge_legacy_project_tree(legacy_app_dir / "projects", self.projects_dir)
        _merge_legacy_project_tree(legacy_app_dir / "trash", self.trash_dir)
        if not self.index_file.exists():
            _copy_missing_file(legacy_app_dir / "projects_index.json", self.index_file)
        self._write_legacy_migration_marker(legacy_app_dir)

    def ensure(self) -> None:
        self._migrate_legacy_app_dir()
        self.app_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.trash_dir.mkdir(parents=True, exist_ok=True)

    def _project_dir(self, project_id: str) -> Path:
        return _safe_project_dir(project_id, root=self.projects_dir)

    def _write_index(self, rows: list[dict]) -> None:
        _write_json(self.index_file, {"schema_version": SCHEMA_VERSION, "projects": rows})

    def _cleanup_tmp_projects(self, project_id: str) -> None:
        prefix = f".tmp-{project_id}-"
        if not self.projects_dir.is_dir():
            return
        for path in self.projects_dir.iterdir():
            if not path.is_dir() or not path.name.startswith(prefix):
                continue
            _remove_tree(path)

    def _unique_tmp_project_dir(self, project_id: str) -> Path:
        prefix = f".tmp-{project_id}-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
        for index in range(100):
            suffix = "" if index == 0 else f"-{index + 1}"
            candidate = self._project_dir(f"{prefix}{suffix}")
            if not candidate.exists():
                return candidate
        raise FileExistsError(f"Could not allocate a temporary project directory for {project_id}.")

    def _git(self, project_dir: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        with self._git_lock:
            try:
                result = subprocess.run(
                    ["git", "-C", str(project_dir), *args],
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
            except FileNotFoundError as exc:
                raise RuntimeError("Git is not installed or not available on PATH.") from exc
        if check and result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(detail or f"Git command failed: {' '.join(args)}")
        return result

    def _ensure_git_repo(self, project_dir: Path) -> None:
        project_dir.mkdir(parents=True, exist_ok=True)
        created = False
        if not (project_dir / ".git").is_dir():
            init = self._git(project_dir, "init", "--initial-branch=main", check=False)
            if init.returncode != 0:
                self._git(project_dir, "init")
            created = True
        if created or self._git(project_dir, "config", "--get", "user.name", check=False).returncode != 0:
            self._git(project_dir, "config", "user.name", "LoRA Dataset Edit")
        if created or self._git(project_dir, "config", "--get", "user.email", check=False).returncode != 0:
            self._git(project_dir, "config", "user.email", "local@lora-dataset-edit.invalid")
        if created or self._git(project_dir, "config", "--get", "commit.gpgsign", check=False).returncode != 0:
            self._git(project_dir, "config", "commit.gpgsign", "false")

    def _git_has_head(self, project_dir: Path) -> bool:
        return self._git(project_dir, "rev-parse", "--verify", "HEAD", check=False).returncode == 0

    def _git_has_changes(self, project_dir: Path) -> bool:
        result = self._git(project_dir, "status", "--porcelain", check=True)
        return bool(result.stdout.strip())

    def _git_commit(self, project_dir: Path, message: str, *, allow_empty: bool = False) -> dict:
        with self._git_lock:
            self._ensure_git_repo(project_dir)
            self._git(project_dir, "add", "-A")
            has_changes = self._git_has_changes(project_dir)
            if not has_changes and not allow_empty:
                head = self._git(project_dir, "rev-parse", "HEAD", check=False)
                return {
                    "committed": False,
                    "hash": head.stdout.strip() if head.returncode == 0 else "",
                    "message": "没有检测到文件变更。",
                }
            args = ["commit", "-m", message]
            if allow_empty:
                args.insert(1, "--allow-empty")
            self._git(project_dir, *args)
            head = self._git(project_dir, "rev-parse", "HEAD")
            return {"committed": True, "hash": head.stdout.strip(), "message": message}

    def _ensure_initial_commit(self, project_dir: Path, project_name: str = "") -> None:
        self._ensure_git_repo(project_dir)
        if self._git_has_head(project_dir):
            return
        self._git_commit(project_dir, self._commit_message("初始化项目版本库", project_name or project_dir.name))

    def _verify_commit(self, project_dir: Path, commit: str) -> str:
        value = str(commit or "").strip()
        if not re.fullmatch(r"[0-9a-fA-F]{7,40}", value):
            raise ValueError("Invalid commit id.")
        self._ensure_git_repo(project_dir)
        self._git(project_dir, "cat-file", "-e", f"{value}^{{commit}}")
        full = self._git(project_dir, "rev-parse", value)
        return full.stdout.strip()

    def _remove_paths_added_after(self, project_dir: Path, target: str, head: str) -> None:
        result = self._git(project_dir, "diff", "--name-only", "--diff-filter=A", f"{target}..{head}")
        for raw in result.stdout.splitlines():
            rel = raw.strip()
            if not rel:
                continue
            path = (project_dir / rel).resolve()
            if not is_relative_to(path, project_dir) or path == project_dir:
                continue
            if path.is_dir():
                _remove_tree(path)
            elif path.exists() or path.is_symlink():
                path.unlink(missing_ok=True)

    def _version_item_key(self, rel: str) -> str:
        normalized = str(rel or "").replace("\\", "/")
        path = Path(normalized)
        parts = normalized.split("/")
        if len(parts) >= 3 and parts[0] == "assets":
            suffix = path.suffix.lower()
            if suffix in IMAGE_EXTS or suffix == ".txt":
                return Path("/".join(parts[2:])).with_suffix("").as_posix()
        if len(parts) >= 2 and parts[0] == "captions" and path.suffix.lower() == ".txt":
            return Path("/".join(parts[1:])).with_suffix("").as_posix()
        return ""

    def _commit_first_parent(self, project_dir: Path, commit: str) -> str:
        result = self._git(project_dir, "rev-list", "--parents", "-n", "1", commit, check=False)
        if result.returncode != 0:
            return ""
        parts = result.stdout.strip().split()
        return parts[1] if len(parts) > 1 else ""

    def _version_change_summary(self, project_dir: Path, commit: str, subject: str) -> str:
        subject = subject or ""
        rollback = re.search(r"回退(?:到)?版本\s*([0-9a-fA-F]{7,40})", subject)
        if rollback:
            return f"回退到版本 {rollback.group(1)[:7]}"
        if "回退" in subject:
            parent = self._commit_first_parent(project_dir, commit)
            return f"回退到版本 {parent[:7]}" if parent else "回退到历史版本"
        fork = re.search(r"分叉(?:自)?版本\s*([0-9a-fA-F]{7,40})", subject)
        if fork:
            return f"分叉自版本 {fork.group(1)[:7]}"
        if "分叉" in subject:
            parent = self._commit_first_parent(project_dir, commit)
            return f"分叉自版本 {parent[:7]}" if parent else "分叉自历史版本"

        result = self._git(project_dir, "diff-tree", "--root", "--no-commit-id", "--name-status", "-r", commit)
        item_changes: dict[str, set[str]] = {}
        for raw in result.stdout.splitlines():
            if not raw.strip():
                continue
            parts = raw.split("\t")
            status = parts[0][:1]
            paths = parts[1:] if len(parts) > 1 else []
            if status == "R" and len(paths) >= 2:
                paths = paths[-1:]
                status = "M"
            for rel in paths:
                key = self._version_item_key(rel)
                if key:
                    item_changes.setdefault(key, set()).add(status)

        added = modified = deleted = 0
        for statuses in item_changes.values():
            if statuses and statuses <= {"A"}:
                added += 1
            elif statuses and statuses <= {"D"}:
                deleted += 1
            else:
                modified += 1

        pieces = [f"添加{added}张图片", f"修改{modified}张图片", f"删除{deleted}张图片"]
        return "，".join(pieces)

    def _commit_message(self, action: str, project_name: str = "") -> str:
        name = _clean_name(project_name or "未命名项目")
        return f"{action}: {name} @ {_now()}"

    def _refresh_index(self) -> list[dict]:
        rows = self.list_projects(write_index=False)
        self._write_index(rows)
        return rows

    def list_projects(self, *, write_index: bool = True) -> list[dict]:
        self.ensure()
        rows: list[dict] = []
        for path in self.projects_dir.iterdir():
            if not path.is_dir() or path.name.startswith("."):
                continue
            meta = _read_json(path / "project.json", {})
            if not meta:
                continue
            if str(meta.get("id") or "") != path.name:
                meta["id"] = path.name
                workspace = _read_json(path / "workspace.json", {})
                if isinstance(workspace, dict):
                    workspace["project_id"] = path.name
                    workspace["dirs"] = _workspace_dirs(path, int(meta.get("control_count", 1)))
                    _write_json(path / "workspace.json", workspace)
                _write_json(path / "project.json", meta)
            stat = path.stat()
            rows.append(
                {
                    "id": path.name,
                    "name": meta.get("name") or path.name,
                    "created_at": meta.get("created_at", ""),
                    "updated_at": meta.get("updated_at", datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")),
                    "item_count": int(meta.get("item_count", 0) or 0),
                    "captioned_count": int(meta.get("captioned_count", 0) or 0),
                    "control_count": int(meta.get("control_count", 1)),
                    "thumbnail": meta.get("thumbnail", ""),
                    "path": str(path),
                }
            )
        rows = sorted(rows, key=lambda row: row.get("updated_at", ""), reverse=True)
        if write_index:
            self._write_index(rows)
        return rows

    def get_project(self, project_id: str) -> dict:
        path = self._project_dir(project_id)
        if not path.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        meta = _read_json(path / "project.json", {})
        workspace = _normalize_workspace_payload(path, meta, _read_json(path / "workspace.json", {}))
        _write_json(path / "workspace.json", workspace)
        manifest = _read_json(path / "manifest.json", {"items": []})
        return {"project": meta, "workspace": workspace, "manifest": manifest, "path": str(path)}

    def _unique_project_dir(self, name: str) -> tuple[str, Path]:
        project_id = _project_id(name)
        project_dir = self._project_dir(project_id)
        index = 2
        while project_dir.exists():
            project_id = f"{_project_id(name)}-{index}"
            project_dir = self._project_dir(project_id)
            index += 1
        return project_id, project_dir

    def save_project(
        self,
        *,
        name: str,
        workspace,
        overwrite_id: str = "",
        control_count: int | None = None,
        ui_state: dict | None = None,
    ) -> dict:
        self.ensure()
        items = workspace.get_export_items()
        if not items:
            raise ValueError("当前工作区没有可保存的条目。")

        staging_dir: Path | None = None
        if overwrite_id:
            project_id = overwrite_id
            final_project_dir = self._project_dir(project_id)
            if not final_project_dir.is_dir():
                raise FileNotFoundError(f"Project not found: {project_id}")
            existing_meta = _read_json(final_project_dir / "project.json", {})
            staging_dir = self._unique_tmp_project_dir(project_id)
            shutil.copytree(final_project_dir, staging_dir, ignore=shutil.ignore_patterns(".git"))
            project_dir = staging_dir
        else:
            project_id, final_project_dir = self._unique_project_dir(name)
            project_dir = final_project_dir
            existing_meta = {}

        paths = _project_paths(project_dir)
        public_paths = _project_paths(final_project_dir)
        for key in ("assets", "captions", "state", "thumbnails"):
            paths[key].mkdir(parents=True, exist_ok=True)

        summary = workspace.get_workspace_summary()
        saved_control_count = int(summary.get("settings", {}).get("control_count", 1) if control_count is None else control_count)
        saved_control_count = max(0, min(3, saved_control_count))
        active_roles = _active_roles(saved_control_count)
        old_by_name, old_by_source = _old_asset_maps(project_dir)
        used: set[str] = set()
        keep_files: set[Path] = set()
        manifest_items: list[dict] = []
        workspace_items: list[dict] = []
        label_items: dict[str, list[str]] = {}
        cover = ""

        for item in items:
            source_name = str(item.get("name", "item") or "item")
            item_id = _item_target_stem(source_name, used)
            item_assets: dict[str, str] = {}
            row_roles: dict[str, str] = {}
            item_paths = item.get("paths", {}) if isinstance(item.get("paths"), dict) else {}

            for role in active_roles:
                source_value = str(item_paths.get(role, "") or "")
                source = Path(source_value) if source_value else None
                target_rel = ""
                if source and source.is_file():
                    suffix = source.suffix.lower()
                    target = paths["assets"] / role / f"{item_id}{suffix}"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if source.resolve() != target.resolve():
                        shutil.copy2(source, target)
                    target_rel = _relative(target, project_dir)
                else:
                    previous_rel = old_by_name.get((item_id, role)) or old_by_source.get((source_name, role))
                    previous_path = (project_dir / previous_rel).resolve() if previous_rel else None
                    if previous_path and previous_path.is_file() and is_relative_to(previous_path, project_dir):
                        target_rel = previous_rel
                    elif item.get("exists", {}).get(role):
                        raise FileNotFoundError(f"Project item source image missing: {source_name} ({role})")

                if target_rel:
                    keep_files.add((project_dir / target_rel).resolve())
                    item_assets[role] = target_rel
                    row_roles[role] = target_rel
                    if not cover and role == "result":
                        cover = target_rel
                    elif not cover:
                        cover = target_rel

            caption = str(item.get("text", "") or "")
            caption_rel = f"captions/{item_id}.txt"
            caption_path = project_dir / caption_rel
            caption_path.parent.mkdir(parents=True, exist_ok=True)
            if caption:
                caption_path.write_text(caption, encoding="utf-8")
                keep_files.add(caption_path.resolve())
                result_caption = paths["assets"] / "result" / f"{item_id}.txt"
                result_caption.parent.mkdir(parents=True, exist_ok=True)
                result_caption.write_text(caption, encoding="utf-8")
                keep_files.add(result_caption.resolve())
            else:
                if caption_path.exists():
                    caption_path.unlink()
                result_caption = paths["assets"] / "result" / f"{item_id}.txt"
                if result_caption.exists():
                    result_caption.unlink()

            status = "captioned" if caption.strip() else "pending"
            manifest_items.append(
                {
                    "id": item_id,
                    "display_name": item_id,
                    "source_name": source_name,
                    "assets": item_assets,
                    "caption_path": caption_rel,
                    "status": status,
                    "updated_at": _now(),
                }
            )
            if isinstance(item.get("tags", []), list):
                label_items[item_id] = item.get("tags", [])
            workspace_items.append(
                {
                    "name": item_id,
                    "source_name": source_name,
                    "roles": row_roles,
                    "caption": caption,
                }
            )

        _cleanup_project_assets(project_dir, active_roles, keep_files)
        if paths["captions"].is_dir():
            for path in sorted(paths["captions"].rglob("*"), reverse=True):
                if path.is_file() and path.resolve() not in keep_files:
                    path.unlink(missing_ok=True)
                elif path.is_dir():
                    try:
                        path.rmdir()
                    except OSError:
                        pass

        now = _now()
        project_name = _clean_name(name or existing_meta.get("name") or project_id)
        project_meta = {
            "schema_version": SCHEMA_VERSION,
            "id": project_id,
            "name": project_name,
            "created_at": existing_meta.get("created_at") or now,
            "updated_at": now,
            "source_dirs": summary.get("dirs", {}),
            "item_count": len(manifest_items),
            "captioned_count": _captioned_count(workspace_items),
            "control_count": saved_control_count,
            "thumbnail": cover,
        }
        manifest = {"schema_version": SCHEMA_VERSION, "items": manifest_items}
        dirs = {
            role: str((public_paths["assets"] / role).resolve())
            for role in active_roles
            if (paths["assets"] / role).exists()
        }
        workspace_settings = dict(summary.get("settings", {}))
        workspace_settings["control_count"] = saved_control_count
        workspace_state = {
            "schema_version": SCHEMA_VERSION,
            "project_id": project_id,
            "project_name": project_name,
            "settings": workspace_settings,
            "dirs": dirs,
            "items": workspace_items,
            "ui_state": ui_state if isinstance(ui_state, dict) else {},
        }
        progress = {
            "schema_version": SCHEMA_VERSION,
            "total": len(manifest_items),
            "captioned": _captioned_count(workspace_items),
            "items": {
                item["id"]: {"status": item["status"], "updated_at": item["updated_at"]}
                for item in manifest_items
            },
        }
        labels = {
            "schema_version": SCHEMA_VERSION,
            "items": label_items,
        }

        _write_json(paths["project"], project_meta)
        _write_json(paths["manifest"], manifest)
        _write_json(paths["workspace"], workspace_state)
        _write_json(paths["state"] / "progress.json", progress)
        _write_json(paths["state"] / "labels.json", labels)
        _write_json(paths["state"] / "caption_config.json", workspace_state["ui_state"].get("caption_settings", {}))
        _write_json(paths["state"] / "ui_state.json", workspace_state["ui_state"])
        if staging_dir is not None:
            _sync_directory_contents(staging_dir, final_project_dir)
            _remove_tree(staging_dir)
            self._cleanup_tmp_projects(project_id)
        version = self._git_commit(
            final_project_dir,
            self._commit_message("提交项目版本", project_name),
            allow_empty=True,
        )
        self._refresh_index()
        return {"project": project_meta, "workspace": workspace_state, "version": version}

    def create_project(self, *, name: str, control_count: int | None = None, ui_state: dict | None = None) -> dict:
        self.ensure()
        project_name = _clean_name(name)
        project_id, project_dir = self._unique_project_dir(project_name)
        paths = _project_paths(project_dir)
        saved_control_count = 1 if control_count is None else int(control_count)
        saved_control_count = max(0, min(3, saved_control_count))
        active_roles = _active_roles(saved_control_count)

        for key in ("assets", "captions", "state", "thumbnails"):
            paths[key].mkdir(parents=True, exist_ok=True)
        for role in active_roles:
            (paths["assets"] / role).mkdir(parents=True, exist_ok=True)

        now = _now()
        project_meta = {
            "schema_version": SCHEMA_VERSION,
            "id": project_id,
            "name": project_name,
            "created_at": now,
            "updated_at": now,
            "source_dirs": {},
            "item_count": 0,
            "captioned_count": 0,
            "control_count": saved_control_count,
            "thumbnail": "",
        }
        workspace_state = {
            "schema_version": SCHEMA_VERSION,
            "project_id": project_id,
            "project_name": project_name,
            "settings": {"control_count": saved_control_count},
            "dirs": _workspace_dirs(project_dir, saved_control_count),
            "items": [],
            "ui_state": ui_state if isinstance(ui_state, dict) else {},
        }
        progress = {
            "schema_version": SCHEMA_VERSION,
            "total": 0,
            "captioned": 0,
            "items": {},
        }
        labels = {
            "schema_version": SCHEMA_VERSION,
            "items": {},
        }

        _write_json(paths["project"], project_meta)
        _write_json(paths["manifest"], {"schema_version": SCHEMA_VERSION, "items": []})
        _write_json(paths["workspace"], workspace_state)
        _write_json(paths["state"] / "progress.json", progress)
        _write_json(paths["state"] / "labels.json", labels)
        _write_json(paths["state"] / "caption_config.json", workspace_state["ui_state"].get("caption_settings", {}))
        _write_json(paths["state"] / "ui_state.json", workspace_state["ui_state"])
        version = self._git_commit(project_dir, self._commit_message("创建项目", project_name))
        self._refresh_index()
        return {"project": project_meta, "workspace": workspace_state, "version": version}

    def rename_project(self, project_id: str, name: str) -> dict:
        path = self._project_dir(project_id)
        if not path.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        next_id = _renamed_project_id(project_id, name)
        next_path = self._project_dir(next_id)
        index = 2
        while next_path.exists() and next_path != path:
            next_id = f"{_renamed_project_id(project_id, name)}-{index}"
            next_path = self._project_dir(next_id)
            index += 1
        if next_path != path:
            path.replace(next_path)
            path = next_path

        meta = _read_json(path / "project.json", {})
        meta["id"] = next_id
        meta["name"] = _clean_name(name)
        meta["updated_at"] = _now()
        _write_json(path / "project.json", meta)
        workspace = _read_json(path / "workspace.json", {})
        workspace["project_id"] = next_id
        workspace["project_name"] = meta["name"]
        workspace["dirs"] = _workspace_dirs(path, int(meta.get("control_count", 1)))
        _write_json(path / "workspace.json", workspace)
        self._refresh_index()
        return meta

    def fork_project(self, project_id: str, name: str = "") -> dict:
        self.ensure()
        source = self._project_dir(project_id)
        if not source.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        source_meta = _read_json(source / "project.json", {})
        self._ensure_initial_commit(source, source_meta.get("name") or project_id)
        source_head = self._git(source, "rev-parse", "HEAD").stdout.strip()
        clone_name = _clean_name(name or f"{source_meta.get('name') or project_id} 分叉")
        clone_id, clone_dir = self._unique_project_dir(clone_name)
        shutil.copytree(source, clone_dir)
        now = _now()
        meta = _read_json(clone_dir / "project.json", {})
        meta.update({"id": clone_id, "name": clone_name, "created_at": now, "updated_at": now})
        _write_json(clone_dir / "project.json", meta)
        workspace = _read_json(clone_dir / "workspace.json", {})
        workspace["project_id"] = clone_id
        workspace["project_name"] = clone_name
        workspace["dirs"] = _workspace_dirs(clone_dir, int(meta.get("control_count", 1)))
        _write_json(clone_dir / "workspace.json", workspace)
        version = self._git_commit(clone_dir, self._commit_message(f"分叉自版本 {source_head[:7]}", clone_name))
        self._refresh_index()
        return {"project": meta, "workspace": workspace, "version": version, "source_head": source_head}

    def list_versions(self, project_id: str, *, limit: int = 200) -> dict:
        self.ensure()
        path = self._project_dir(project_id)
        if not path.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        meta = _read_json(path / "project.json", {})
        self._ensure_initial_commit(path, meta.get("name") or project_id)
        result = self._git(
            path,
            "log",
            f"--max-count={max(1, min(500, int(limit or 200)))}",
            "--date=iso-strict",
            "--format=%H%x1f%h%x1f%cI%x1f%s",
        )
        versions: list[dict] = []
        for line in result.stdout.splitlines():
            parts = line.split("\x1f")
            if len(parts) < 4:
                continue
            display_message = self._version_change_summary(path, parts[0], parts[3])
            versions.append(
                {
                    "hash": parts[0],
                    "short_hash": parts[1],
                    "created_at": parts[2],
                    "message": display_message,
                    "raw_message": parts[3],
                    "display_message": display_message,
                }
            )
        head = self._git(path, "rev-parse", "HEAD", check=False)
        return {"project": meta, "versions": versions, "head": head.stdout.strip() if head.returncode == 0 else ""}

    def rollback_to_version(self, project_id: str, commit: str) -> dict:
        with self._git_lock:
            self.ensure()
            path = self._project_dir(project_id)
            if not path.is_dir():
                raise FileNotFoundError(f"Project not found: {project_id}")
            target = self._verify_commit(path, commit)
            head = self._git(path, "rev-parse", "HEAD").stdout.strip()
            self._git(path, "checkout", target, "--", ".")
            self._remove_paths_added_after(path, target, head)
            self._git(path, "clean", "-fd")
            meta = _read_json(path / "project.json", {})
            version = self._git_commit(
                path,
                self._commit_message(f"回退到版本 {target[:7]}", meta.get("name") or project_id),
            )
        detail = self.get_project(project_id)
        self._refresh_index()
        return {
            "project": detail.get("project", {}),
            "workspace": detail.get("workspace", {}),
            "head": version.get("hash") or head,
            "target": target,
            "version": version,
        }

    def fork_project_version(self, project_id: str, commit: str, name: str = "") -> dict:
        self.ensure()
        source = self._project_dir(project_id)
        if not source.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        source_meta = _read_json(source / "project.json", {})
        self._ensure_initial_commit(source, source_meta.get("name") or project_id)
        target = self._verify_commit(source, commit)
        fork_name = _clean_name(name or f"{source_meta.get('name') or project_id} 分叉")
        fork_id, fork_dir = self._unique_project_dir(fork_name)
        shutil.copytree(source, fork_dir)
        self._git(fork_dir, "reset", "--hard", target)
        self._git(fork_dir, "clean", "-fd")

        now = _now()
        meta = _read_json(fork_dir / "project.json", {})
        meta.update({"id": fork_id, "name": fork_name, "created_at": now, "updated_at": now})
        _write_json(fork_dir / "project.json", meta)
        workspace = _read_json(fork_dir / "workspace.json", {})
        workspace["project_id"] = fork_id
        workspace["project_name"] = fork_name
        workspace["dirs"] = _workspace_dirs(fork_dir, int(meta.get("control_count", 1)))
        _write_json(fork_dir / "workspace.json", workspace)
        version = self._git_commit(fork_dir, self._commit_message(f"分叉自版本 {target[:7]}", fork_name))
        self._refresh_index()
        return {"project": meta, "workspace": workspace, "version": version, "source_head": target}

    def update_ui_state(self, project_id: str, ui_state: dict) -> dict:
        path = self._project_dir(project_id)
        if not path.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        workspace = _read_json(path / "workspace.json", {})
        workspace["ui_state"] = ui_state if isinstance(ui_state, dict) else {}
        _write_json(path / "workspace.json", workspace)
        _write_json(path / "state" / "caption_config.json", workspace["ui_state"].get("caption_settings", {}))
        _write_json(path / "state" / "ui_state.json", workspace["ui_state"])
        meta = _read_json(path / "project.json", {})
        self._refresh_index()
        return {"project": meta, "workspace": workspace}

    def touch_project_content(self, project_id: str) -> dict:
        path = self._project_dir(project_id)
        if not path.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        meta = _read_json(path / "project.json", {})
        meta["id"] = path.name
        meta["updated_at"] = _now()
        _write_json(path / "project.json", meta)
        self._refresh_index()
        return meta

    def delete_project(self, project_id: str) -> dict:
        path = self._project_dir(project_id)
        if not path.is_dir():
            raise FileNotFoundError(f"Project not found: {project_id}")
        target = (self.trash_dir / f"{project_id}-{_now_id()}").resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        path.replace(target)
        self._refresh_index()
        return {"deleted": project_id, "trashed_to": str(target)}

    def cleanup_trash(self) -> dict:
        self.ensure()
        removed: list[str] = []
        errors: list[str] = []
        for child in sorted(self.trash_dir.iterdir(), key=lambda item: item.name.lower()):
            try:
                if child.is_dir():
                    _remove_tree(child)
                else:
                    child.unlink(missing_ok=True)
                removed.append(child.name)
            except Exception as exc:
                errors.append(f"{child.name}: {exc}")
        return {"removed": removed, "errors": errors, "path": str(self.trash_dir)}
