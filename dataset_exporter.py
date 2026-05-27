from __future__ import annotations

import json
import math
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

from dataset_paths import DATASETS_DIR, EXPORTS_DIR
from dataset_workspace import CONTROL_ROLES, _resolve_user_path


APP_STATE_DIR = DATASETS_DIR


class ExportCancelled(RuntimeError):
    pass


def _clean_name(value: str, fallback: str = "untitled") -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "_", value or fallback).strip()
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name or fallback


def _unique_name(name: str, used: set[str]) -> str:
    base = _clean_name(Path(name).stem)
    if base not in used:
        used.add(base)
        return base
    index = 2
    while True:
        candidate = f"{base}_{index}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        index += 1


def _clean_relative_export_name(value: str, fallback: str = "untitled") -> str:
    raw = str(value or "").strip().replace("\\", "/")
    parts = [_clean_name(part, fallback if index == 0 else "folder") for index, part in enumerate(raw.split("/")) if part.strip()]
    if not parts:
        parts = [_clean_name(fallback)]
    return "/".join(parts)


def _unique_export_name(name: str, used: set[str], *, preserve_subfolders: bool) -> str:
    if not preserve_subfolders:
        return _unique_name(name, used)

    clean_name = _clean_relative_export_name(name)
    path = Path(clean_name)
    parent = path.parent.as_posix()
    base = path.name
    candidate = base if parent in {"", "."} else f"{parent}/{base}"
    if candidate not in used:
        used.add(candidate)
        return candidate

    index = 2
    while True:
        next_base = f"{base}_{index}"
        candidate = next_base if parent in {"", "."} else f"{parent}/{next_base}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        index += 1


def _target_size_for(source_size: tuple[int, int], target_pixels: int, multiple: int) -> tuple[int, int]:
    width, height = source_size
    if width <= 0 or height <= 0:
        raise ValueError("Invalid image size.")
    multiple = max(1, int(multiple or 1))
    target_pixels = max(1, int(target_pixels or 1_000_000))
    aspect = width / height
    raw_width = math.sqrt(target_pixels * aspect)
    raw_height = raw_width / aspect
    target_width = max(multiple, int(round(raw_width / multiple)) * multiple)
    target_height = max(multiple, int(round(raw_height / multiple)) * multiple)
    while target_width * target_height > target_pixels and (target_width > multiple or target_height > multiple):
        if target_width / target_height > aspect and target_width > multiple:
            target_width -= multiple
        elif target_height > multiple:
            target_height -= multiple
        else:
            target_width -= multiple
    return target_width, target_height


def _resample_lanczos() -> int:
    try:
        return Image.Resampling.LANCZOS
    except AttributeError:
        return Image.LANCZOS


def _resize_center_crop(image: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGB")
    target_width, target_height = target_size
    width, height = image.size
    scale = max(target_width / width, target_height / height)
    resized_size = (max(target_width, math.ceil(width * scale)), max(target_height, math.ceil(height * scale)))
    resized = image.resize(resized_size, _resample_lanczos())
    left = max(0, (resized.width - target_width) // 2)
    top = max(0, (resized.height - target_height) // 2)
    return resized.crop((left, top, left + target_width, top + target_height))


def _write_processed_image(source: Path, target: Path, target_size: tuple[int, int]):
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        processed = _resize_center_crop(image, target_size)
        if processed.mode == "RGBA":
            processed.save(target, format="PNG", optimize=True)
        else:
            processed.convert("RGB").save(target, format="PNG", optimize=True)


def _copy_original_image(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _active_control_roles(control_count: int) -> tuple[str, ...]:
    count = max(1, min(3, int(control_count or 1)))
    return CONTROL_ROLES[:count]


def _role_folder_name(export_prefix: str, role: str) -> str:
    return f"{export_prefix}_{role}"


def _role_folder(root: Path, export_prefix: str, role: str) -> Path:
    return root / _role_folder_name(export_prefix, role)


def _image_target_path(
    root: Path,
    export_prefix: str,
    export_name: str,
    source: Path,
    *,
    process_images: bool,
    role: str,
) -> Path:
    ext = ".png" if process_images else source.suffix.lower() or ".png"
    folder = _role_folder(root, export_prefix, role)
    parts = [part for part in str(export_name or "").replace("\\", "/").split("/") if part]
    if not parts:
        parts = ["untitled"]
    return folder.joinpath(*parts).with_suffix(ext)


def _resolve_output_parent(value: str) -> Path:
    if (value or "").strip():
        return _resolve_user_path(value)
    return EXPORTS_DIR


def _build_export_root(output_parent: Path, export_name: str) -> Path:
    root = output_parent / export_name
    if not root.exists():
        return root
    index = 2
    while True:
        candidate = output_parent / f"{export_name}_{index}"
        if not candidate.exists():
            return candidate
        index += 1


def export_dataset(
    *,
    items: list[dict],
    output_format: str = "zip",
    output_dir: str = "",
    project_name: str = "",
    target_megapixels: float = 4.0,
    multiple: int = 16,
    process_images: bool = True,
    include_controls: bool = True,
    control_count: int = 1,
    preserve_subfolders: bool = False,
    progress_callback=None,
    should_stop=None,
    include_bytes: bool = True,
) -> dict:
    output_format = "folder" if output_format == "folder" else "zip"
    target_megapixels = max(1.0, min(4.0, float(target_megapixels or 4.0)))
    target_pixels = int(target_megapixels * 1_000_000)
    multiple = max(1, int(multiple or 16))
    if multiple not in {16, 32, 64}:
        raise ValueError("Size multiple must be 16, 32, or 64.")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    clean_project_name = _clean_name(project_name, "dataset")
    export_prefix = f"{timestamp}_{clean_project_name}"
    export_name = export_prefix
    output_parent = _resolve_output_parent(output_dir)
    output_parent.mkdir(parents=True, exist_ok=True)
    export_root = _build_export_root(output_parent, export_name)
    export_root.mkdir(parents=True, exist_ok=True)

    control_roles = _active_control_roles(control_count) if include_controls else ()
    for role in (*control_roles, "result"):
        _role_folder(export_root, export_prefix, role).mkdir(parents=True, exist_ok=True)

    used_names: set[str] = set()
    exported = 0
    skipped: list[dict] = []
    manifest_items: list[dict] = []
    done_steps = 0
    total_steps = 1

    planned_items: list[tuple[dict, Path, tuple[str, Path]]] = []
    for item in items:
        paths = item.get("paths", {})
        source_value = paths.get("result", "")
        source = Path(source_value) if source_value else None
        if not source or not source.exists():
            continue
        role_sources: list[tuple[str, Path]] = []
        if include_controls:
            for role in control_roles:
                value = paths.get(role, "")
                role_source = Path(value) if value else None
                if role_source and role_source.exists():
                    role_sources.append((role, role_source))
        planned_items.append((item, source, tuple(role_sources)))
        total_steps += 2 + len(role_sources)
    if output_format == "zip":
        total_steps *= 2

    def stopped() -> bool:
        return bool(should_stop and should_stop())

    def report(current: str = "", message: str = ""):
        if progress_callback:
            progress_callback({
                "total": total_steps,
                "done": done_steps,
                "processed": exported,
                "skipped": len(skipped),
                "current": current,
                "message": message,
            })

    def step(current: str = "", message: str = ""):
        nonlocal done_steps
        if stopped():
            raise ExportCancelled("Export cancelled.")
        done_steps += 1
        report(current, message)

    report(message="Export started.")

    try:
        for item in items:
            if stopped():
                raise ExportCancelled("Export cancelled.")
            if not any(planned_item is item for planned_item, _, _ in planned_items):
                skipped.append({"name": item.get("name", ""), "reason": "no result image"})
                continue

        for item, source, role_sources in planned_items:
            if stopped():
                raise ExportCancelled("Export cancelled.")

            export_name_for_item = _unique_export_name(
                str(item.get("name") or source.stem),
                used_names,
                preserve_subfolders=preserve_subfolders,
            )
            target_size: Optional[tuple[int, int]] = None
            if process_images:
                with Image.open(source) as image:
                    target_size = _target_size_for(image.size, target_pixels, multiple)
                image_target = _image_target_path(export_root, export_prefix, export_name_for_item, source, process_images=True, role="result")
                _write_processed_image(source, image_target, target_size)
            else:
                image_target = _image_target_path(export_root, export_prefix, export_name_for_item, source, process_images=False, role="result")
                _copy_original_image(source, image_target)
            step(str(image_target), f"Exported result image: {export_name_for_item}")

            text_target = _role_folder(export_root, export_prefix, "result").joinpath(
                *[part for part in export_name_for_item.split("/") if part]
            ).with_suffix(".txt")
            text_target.parent.mkdir(parents=True, exist_ok=True)
            text_target.write_text(str(item.get("text") or "").strip(), encoding="utf-8")
            step(str(text_target), f"Exported caption: {export_name_for_item}")

            exported_roles = {"result": str(image_target.relative_to(export_root))}
            if include_controls:
                for role, role_source in role_sources:
                    if stopped():
                        raise ExportCancelled("Export cancelled.")
                    role_target = _image_target_path(
                        export_root,
                        export_prefix,
                        export_name_for_item,
                        role_source,
                        process_images=process_images,
                        role=role,
                    )
                    if process_images and target_size:
                        _write_processed_image(role_source, role_target, target_size)
                    else:
                        _copy_original_image(role_source, role_target)
                    exported_roles[role] = str(role_target.relative_to(export_root))
                    step(str(role_target), f"Exported {role}: {export_name_for_item}")

            exported += 1
            manifest_items.append(
                {
                    "name": item.get("name", ""),
                    "export_name": export_name_for_item,
                    "caption_source": item.get("caption_source", ""),
                    "files": exported_roles,
                    "caption": str(text_target.relative_to(export_root)),
                    "target_size": list(target_size) if target_size else None,
                }
            )

        manifest = {
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "project_name": clean_project_name,
            "export_prefix": export_prefix,
            "exported": exported,
            "skipped": skipped,
            "options": {
                "format": output_format,
                "process_images": process_images,
                "target_megapixels": target_megapixels,
                "multiple": multiple,
                "include_controls": include_controls,
                "control_count": control_count,
                "preserve_subfolders": preserve_subfolders,
            },
            "items": manifest_items,
        }
        (export_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        step(str(export_root / "manifest.json"), "Exported manifest.")

        if output_format == "folder":
            return {
                "format": "folder",
                "path": str(export_root),
                "exported": exported,
                "skipped": skipped,
            }

        zip_path = export_root.with_suffix(".zip")
        zip_files = [path for path in export_root.rglob("*") if path.is_file()]
        report(message="Creating ZIP archive.")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for directory in sorted((path for path in export_root.rglob("*") if path.is_dir()), key=lambda path: str(path)):
                archive.write(directory, directory.relative_to(export_root))
            for file in sorted(zip_files):
                if stopped():
                    raise ExportCancelled("Export cancelled.")
                archive.write(file, file.relative_to(export_root))
                step(str(file), f"Added to ZIP: {file.name}")
        return {
            "format": "zip",
            "path": str(zip_path),
            "filename": zip_path.name,
            **({"bytes": zip_path.read_bytes()} if include_bytes else {}),
            "exported": exported,
            "skipped": skipped,
        }
    except ExportCancelled:
        shutil.rmtree(export_root, ignore_errors=True)
        try:
            export_root.with_suffix(".zip").unlink(missing_ok=True)
        except Exception:
            pass
        raise
