"""工作区路径与角色常量。

从 dataset_workspace.py 提取的常量和无状态路径/解析函数。
"""

from __future__ import annotations

import re

__all__ = [
    "IMAGE_EXTS",
    "IMAGE_ROLES",
    "CONTROL_ROLES",
    "INVALID_BASENAME_CHARS",
    "WINDOWS_RESERVED_NAMES",
    "ROLE_STRIP_PATTERNS",
    "natural_key",
    "parse_ignore_tokens",
    "parse_rename_tokens",
    "looks_like_image_file",
    "infer_image_suffix",
    # Backward-compatible aliases
    "_natural_key",
    "_parse_ignore_tokens",
    "_parse_rename_tokens",
    "_looks_like_image_file",
    "_infer_image_suffix",
]


IMAGE_EXTS = {".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".avif", ".heic", ".heif"}
IMAGE_ROLES = ("control1", "control2", "control3", "result")
CONTROL_ROLES = ("control1", "control2", "control3")
INVALID_BASENAME_CHARS = set('<>:"/\\|?*')

WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}

ROLE_STRIP_PATTERNS = (
    r"(?:control|ctrl|guide|cond|conditioning|source|input)[\s._-]*1",
    r"(?:control|ctrl|guide|cond|conditioning|source|input)[\s._-]*2",
    r"(?:control|ctrl|guide|cond|conditioning|source|input)[\s._-]*3",
    r"(?:ref|reference)",
    r"(?:result|output|target|final|edited|edit|after|render|gt)",
    r"(?:控制图[\s._-]*1|控制1|控制图一)",
    r"(?:控制图[\s._-]*2|控制2|控制图二)",
    r"(?:控制图[\s._-]*3|控制3|控制图三)",
    r"(?:结果图|结果|输出图|输出)",
)


def natural_key(value: str):
    return [int(chunk) if chunk.isdigit() else chunk.lower() for chunk in re.split(r"(\d+)", value)]


_natural_key = natural_key


def parse_ignore_tokens(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        source = value
    else:
        source = " ".join(str(item or "") for item in value)
    return [token.strip().lower() for token in re.split(r"[,;\n，\s]+", source) if token.strip()]


_parse_ignore_tokens = parse_ignore_tokens


def parse_rename_tokens(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        source = value
    else:
        source = " ".join(str(item or "") for item in value)
    return [token.strip() for token in re.split(r"[,;\n，]+", source) if token.strip()]


_parse_rename_tokens = parse_rename_tokens


def looks_like_image_file(path) -> bool:
    from pathlib import Path

    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTS:
        return True
    try:
        from PIL import Image

        with Image.open(path) as img:
            img.verify()
        return True
    except Exception:
        return False


_looks_like_image_file = looks_like_image_file


def infer_image_suffix(filename: str, mime_type: str = "") -> str:
    from pathlib import Path

    suffix = Path(str(filename or "")).suffix.lower()
    if suffix in IMAGE_EXTS:
        return suffix
    mime = str(mime_type or "").lower()
    mime_suffixes = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/tiff": ".tiff",
        "image/avif": ".avif",
        "image/heic": ".heic",
        "image/heif": ".heif",
        "image/x-icon": ".ico",
        "image/vnd.microsoft.icon": ".ico",
    }
    return mime_suffixes.get(mime, ".png")


_infer_image_suffix = infer_image_suffix
