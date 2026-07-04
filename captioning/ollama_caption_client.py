from __future__ import annotations

import base64
import json
import mimetypes
import tempfile
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path
from threading import RLock

from PIL import Image

from captioning.caption_image_preprocess import prepare_caption_images
from captioning.prompt_common import (
    compact_text as _compact_text,
)
from captioning.prompt_common import (
    prompt_for_mode as _prompt_for_mode,
)
from captioning.prompt_common import (
    prompt_with_image_name_context as _prompt_with_image_name_context,
)


def _normalize_base_url(base_url: str) -> str:
    value = (base_url or "").strip() or "http://127.0.0.1:11434"
    if not value.startswith(("http://", "https://")):
        value = f"http://{value}"
    return value.rstrip("/")


def _normalize_ollama_endpoint(base_url: str) -> str:
    value = _normalize_base_url(base_url)
    if value.endswith("/api/chat"):
        return value
    if value.endswith("/api"):
        return f"{value}/chat"
    return f"{value}/api/chat"


def _tags_endpoint(base_url: str) -> str:
    value = _normalize_base_url(base_url)
    if value.endswith("/api/chat"):
        value = value[: -len("/chat")]
    if value.endswith("/api"):
        return f"{value}/tags"
    return f"{value}/api/tags"


def _image_base64(image_path: str) -> str:
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    if mime_type.startswith("image/"):
        return encoded
    return encoded


class OllamaCaptionClient:
    def __init__(self):
        self._lock = RLock()
        self._logs: deque[dict] = deque(maxlen=300)
        self.status = "idle"
        self.progress_msg = ""
        self.last_model = ""
        self.last_endpoint = ""
        self.last_backend = "Ollama"

    def _append_log(self, message: str, level: str = "info"):
        ts = time.strftime("%H:%M:%S")
        self._logs.append(
            {
                "ts": ts,
                "level": level,
                "message": message,
            }
        )
        print(f"[{ts}] [ollama] [{level}] {message}", flush=True)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "ready": self.status not in {"error"},
                "status": self.status,
                "progress_msg": self.progress_msg,
                "last_model": self.last_model,
                "last_endpoint": self.last_endpoint,
                "last_backend": self.last_backend,
                "logs": list(self._logs),
            }

    def _post_json(self, endpoint: str, payload: dict, timeout: float) -> dict:
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": "VisionDatasetStudio/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def caption(
        self,
        *,
        image_path: str,
        image_paths: list[str] | None = None,
        image_name: str = "",
        image_file_names: list[str] | None = None,
        base_url: str,
        model: str,
        mode: str = "natural",
        prompt: str = "",
        max_tokens: int = 512,
        thinking: bool = False,
        timeout: float = 180.0,
    ) -> str:
        if not (model or "").strip():
            raise RuntimeError("Ollama model is required.")

        endpoint = _normalize_ollama_endpoint(base_url)
        all_image_paths = list(image_paths or ([image_path] if image_path else []))
        if not all_image_paths:
            raise RuntimeError("At least one image is required.")
        resolved_prompt = _prompt_with_image_name_context(
            _prompt_for_mode(mode, prompt),
            image_name=image_name,
            image_file_names=image_file_names or [Path(path).name for path in all_image_paths if path],
        )
        with prepare_caption_images(all_image_paths) as prepared_paths:
            payload = {
                "model": model.strip(),
                "stream": False,
                "think": bool(thinking),
                "options": {
                    "num_predict": int(max_tokens or 512),
                },
                "messages": [
                    {
                        "role": "user",
                        "content": resolved_prompt,
                        "images": [_image_base64(path) for path in prepared_paths],
                    }
                ],
            }

            with self._lock:
                self.status = "requesting"
                self.progress_msg = f"Calling Ollama model {model.strip()}"
                self.last_model = model.strip()
                self.last_endpoint = endpoint
                self._append_log(f"Calling Ollama backend {endpoint}", "warn")

            try:
                data = self._post_json(endpoint, payload, timeout)
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="ignore")
                message = body.strip() or str(exc)
                with self._lock:
                    self.status = "error"
                    self.progress_msg = "Ollama request failed"
                    self._append_log(f"Ollama request failed: {message[-500:]}", "error")
                raise RuntimeError(message[-500:] or "Ollama request failed.") from exc
            except Exception as exc:
                with self._lock:
                    self.status = "error"
                    self.progress_msg = "Ollama request failed"
                    self._append_log(f"Ollama request failed: {exc}", "error")
                raise RuntimeError(f"Ollama request failed: {exc}") from exc

            text = _compact_text(((data.get("message") or {}).get("content") or "").strip())
            if not text:
                with self._lock:
                    self.status = "error"
                    self.progress_msg = "Empty Ollama response"
                    self._append_log("Ollama returned no caption text.", "error")
                raise RuntimeError("Ollama returned no caption text.")

            with self._lock:
                self.status = "ready"
                self.progress_msg = f"Ollama caption ready: {self.last_model}"
                self._append_log(f"Ollama caption ready: {self.last_model}", "ok")
            return text

    def validate(
        self,
        *,
        base_url: str,
        model: str,
        mode: str = "natural",
        prompt: str = "",
        max_tokens: int = 128,
        thinking: bool = False,
    ) -> dict:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            image_path = tmp.name
        try:
            Image.new("RGB", (96, 96), (64, 126, 214)).save(image_path)
            result = self.caption(
                image_path=image_path,
                base_url=base_url,
                model=model,
                mode=mode,
                prompt=prompt or "Describe this simple blue square image in one short sentence.",
                max_tokens=max_tokens,
                thinking=thinking,
            )
            return {
                "ok": True,
                "result": result,
                "backend": self.last_backend,
                "model": self.last_model,
                "endpoint": self.last_endpoint,
            }
        finally:
            try:
                Path(image_path).unlink(missing_ok=True)
            except Exception:
                pass

    def list_models(self, base_url: str, timeout: float = 30.0) -> list[str]:
        endpoint = _tags_endpoint(base_url)
        request = urllib.request.Request(
            endpoint,
            headers={"Accept": "application/json", "User-Agent": "VisionDatasetStudio/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        models = [
            item
            for item in data.get("models", [])
            if isinstance(item, dict) and item.get("name")
        ]
        models.sort(key=lambda item: (int(item.get("size") or 0) or 10**18, str(item.get("name", "")).lower()))
        return [item["name"] for item in models]
