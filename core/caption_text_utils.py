"""Caption 文本处理纯函数。

从 dataset_workspace.py 提取的无状态文本工具，被 ItemRepository、BatchOperations
和外部测试共用。所有函数不依赖任何运行时状态。
"""

from __future__ import annotations

import re

__all__ = [
    "parse_caption_segments",
    "parse_tags",
    "normalize_segment_inputs",
    "merge_text_with_segments",
    "split_caption_parts",
    "join_caption_parts",
    "normalize_caption_spacing",
    "delete_caption_segments",
    "replace_caption_segment",
    # Backward-compatible aliases (underscore-prefixed)
    "_parse_caption_segments",
    "_parse_tags",
    "_normalize_segment_inputs",
    "_merge_text_with_segments",
    "_split_caption_parts",
    "_join_caption_parts",
    "_normalize_caption_spacing",
    "_delete_caption_segments",
    "_replace_caption_segment",
]


def parse_caption_segments(content: str) -> list[str]:
    return [segment.strip() for segment in re.split(r"[,，;\n；。]+", content or "") if segment.strip()]


# Backward-compatible alias
_parse_caption_segments = parse_caption_segments


def parse_tags(content: str) -> list[str]:
    # Backward-compatible alias for previous tag-based data flow.
    return parse_caption_segments(content)


_parse_tags = parse_tags


def normalize_segment_inputs(values: list[str]) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for raw in values:
        for segment in parse_caption_segments(str(raw or "")):
            key = segment.lower()
            if key in seen:
                continue
            seen.add(key)
            items.append(segment)
    return items


_normalize_segment_inputs = normalize_segment_inputs


def merge_text_with_segments(existing: str, segments: list[str], position: str = "after") -> str:
    clean_segments = normalize_segment_inputs(segments)
    if not clean_segments:
        return existing
    current_text = (existing or "").strip()
    if not current_text:
        return ", ".join(clean_segments)
    current_segments = parse_caption_segments(current_text)
    current_index = {segment.lower() for segment in current_segments}
    additions = [segment for segment in clean_segments if segment.lower() not in current_index]
    if not additions:
        return current_text
    if position == "before":
        return ", ".join(additions) + f", {current_text.lstrip(',，;；。 ')}"
    return f"{current_text.rstrip(',，;；。 ')}, " + ", ".join(additions)


_merge_text_with_segments = merge_text_with_segments


def split_caption_parts(content: str) -> list[tuple[str, str]]:
    tokens = re.split(r"([,，;\n；。]+)", content or "")
    parts: list[tuple[str, str]] = []
    index = 0
    while index < len(tokens):
        segment = tokens[index] if index < len(tokens) else ""
        separator = tokens[index + 1] if index + 1 < len(tokens) else ""
        index += 2
        if not segment or not segment.strip():
            if separator and parts:
                prev_segment, prev_separator = parts[-1]
                parts[-1] = (prev_segment, prev_separator + separator)
            continue
        parts.append((segment, separator))
    return parts


_split_caption_parts = split_caption_parts


def join_caption_parts(parts: list[tuple[str, str]]) -> str:
    return "".join(segment + separator for segment, separator in parts)


_join_caption_parts = join_caption_parts


def normalize_caption_spacing(content: str) -> str:
    compact = re.sub(r"\n[ \t]+", "\n", content or "")
    return compact.strip()


_normalize_caption_spacing = normalize_caption_spacing


def delete_caption_segments(content: str, needles: list[str]) -> str:
    if not needles:
        return content
    parts = split_caption_parts(content)
    filtered = [
        (segment, separator)
        for segment, separator in parts
        if not any(needle in segment.strip().lower() for needle in needles)
    ]
    return normalize_caption_spacing(join_caption_parts(filtered))


_delete_caption_segments = delete_caption_segments


def replace_caption_segment(content: str, old_segment: str, new_segment: str) -> str:
    target = (old_segment or "").strip()
    if not target:
        return content
    replacement = (new_segment or "").strip()
    changed = False
    updated_parts: list[tuple[str, str]] = []
    for segment, separator in split_caption_parts(content):
        updated_segment = re.sub(re.escape(target), lambda _: replacement, segment, flags=re.IGNORECASE)
        if updated_segment == segment:
            updated_parts.append((segment, separator))
            continue
        changed = True
        if updated_segment.strip():
            updated_parts.append((updated_segment, separator))
    if not changed:
        return content
    return normalize_caption_spacing(join_caption_parts(updated_parts))


_replace_caption_segment = replace_caption_segment
