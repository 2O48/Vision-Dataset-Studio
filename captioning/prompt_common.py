"""Prompt 相关公共逻辑。

将原本分散在 caption_service.py / api_caption_client.py / ollama_caption_client.py
三处重复的 prompt 构建与文本清理逻辑收敛到此处（阶段 1 去重）。

向后兼容：各原模块通过 ``from captioning.prompt_common import ... as _xxx``
重新导出私有别名，保证既有 ``from captioning.xxx import _prompt_with_image_name_context``
形式的导入继续可用。
"""

from __future__ import annotations

DEFAULT_PROMPTS: dict[str, str] = {
    "natural": (
        "Write one clean English caption for this image for vision model training. "
        "Focus on subject, material, texture, color, lighting, pose, camera angle, and scene. "
        "Keep it under 60 words."
    ),
    "detail": (
        "Write a detailed English caption for this image for vision model training. "
        "Cover subject, clothing or material, texture, color palette, lighting, composition, "
        "camera angle, background, and mood."
    ),
    "tag": (
        "Describe this image as comma-separated English tags for vision model training. "
        "Use concise tags only. No numbering. No full sentences."
    ),
    "short": (
        "Write a very short English caption for this image for vision model training. "
        "One sentence, under 24 words."
    ),
}


def prompt_for_mode(mode: str, prompt: str) -> str:
    """根据模式返回最终 prompt。优先使用用户自定义 prompt，否则回退到默认模板。"""
    custom = (prompt or "").strip()
    if custom:
        return custom
    return DEFAULT_PROMPTS.get(mode or "natural", DEFAULT_PROMPTS["natural"])


def compact_text(text: str) -> str:
    """将任意空白（含换行）压缩为单空格，用于清理模型输出。"""
    return " ".join((text or "").split())


def prompt_with_image_name_context(
    prompt: str,
    *,
    image_name: str = "",
    image_file_names: list[str] | None = None,
) -> str:
    """在 prompt 末尾追加数据集条目名与图像文件名上下文。

    三条标注链路（本地 Qwen / OpenAI 兼容 API / Ollama）原本各自维护一份
    完全相同的实现，现统一到此处。
    """
    lines: list[str] = []
    clean_name = (image_name or "").strip()
    if clean_name:
        lines.append(f"Dataset item name: {clean_name}")
    clean_files = [str(name).strip() for name in (image_file_names or []) if str(name).strip()]
    if clean_files:
        label = "Image file names" if len(clean_files) > 1 else "Image file name"
        lines.append(f"{label}: {', '.join(clean_files)}")
    if not lines:
        return prompt
    return f"{prompt.rstrip()}\n\nFile name context:\n" + "\n".join(lines)
