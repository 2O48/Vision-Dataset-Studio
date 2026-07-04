"""集中配置项，消除 web_server.py 中的硬编码。"""

from __future__ import annotations

DEFAULT_LOCAL_MODEL = "qwen3.5-4b"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8100
THUMB_CACHE_MAX_ITEMS = 256
THUMB_CACHE_MIME = "image/png"
