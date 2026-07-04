"""AI 标注端点。"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from captioning.api_caption_client import APICaptionClient
from captioning.caption_client import CaptionServiceClient, DependencyInstaller
from captioning.ollama_caption_client import OllamaCaptionClient
from config.settings import DEFAULT_LOCAL_MODEL, DEFAULT_OLLAMA_URL
from core.dataset_workspace import DatasetWorkspace
from core.qwen_models import list_qwen_model_configs
from server.caption_workflow import (
    VALIDATION_EXISTING_CAPTION,
    BatchCaptionManager,
    apply_caption_result,
    caption_with_backend,
    collect_item_images,
    create_validation_images,
    normalize_overwrite_mode,
    remove_validation_images,
    resolve_caption_request,
)
from server.dependencies import (
    get_active_project_id,
    get_api_caption_client,
    get_batch_manager,
    get_caption_client,
    get_dependency_installer,
    get_export_manager,
    get_image_process_manager,
    get_ollama_caption_client,
    get_workspace,
    touch_active_project_content,
)

router = APIRouter()


class AiCaptionRequest(BaseModel):
    name: str = ""
    backend: str = "local"
    model: str = DEFAULT_LOCAL_MODEL
    mode: str = "natural"
    prompt: str = ""
    overwrite_mode: str = "overwrite"
    max_tokens: int = 512
    thinking: bool = False
    api_base_url: str = ""
    api_key: str = ""
    ollama_base_url: str = DEFAULT_OLLAMA_URL


class AiValidateRequest(BaseModel):
    backend: str = "local"
    model: str = DEFAULT_LOCAL_MODEL
    mode: str = "natural"
    prompt: str = ""
    overwrite_mode: str = "overwrite"
    max_tokens: int = 128
    thinking: bool = False
    api_base_url: str = ""
    api_key: str = ""
    ollama_base_url: str = DEFAULT_OLLAMA_URL


class AiBatchStartRequest(BaseModel):
    names: list[str] = []
    backend: str = "local"
    model: str = DEFAULT_LOCAL_MODEL
    mode: str = "natural"
    prompt: str = ""
    overwrite_mode: str = "skip"
    max_tokens: int = 512
    thinking: bool = False
    api_base_url: str = ""
    api_key: str = ""
    ollama_base_url: str = DEFAULT_OLLAMA_URL


class ApiModelsRequest(BaseModel):
    api_base_url: str = ""
    api_key: str = ""


class AiLoadRequest(BaseModel):
    model: str = DEFAULT_LOCAL_MODEL


@router.get("/ai/options")
def ai_options():
    return {
        "ok": True,
        "local_models": list_qwen_model_configs(),
        "default_local_model": DEFAULT_LOCAL_MODEL,
        "default_ollama_url": DEFAULT_OLLAMA_URL,
    }


@router.get("/ollama/models")
def ollama_models(base_url: str = Query(DEFAULT_OLLAMA_URL), client: OllamaCaptionClient = Depends(get_ollama_caption_client)):
    models = client.list_models(base_url)
    return {"ok": True, "models": models}


@router.get("/ai/status")
def ai_status(
    local: CaptionServiceClient = Depends(get_caption_client),
    api: APICaptionClient = Depends(get_api_caption_client),
    ollama: OllamaCaptionClient = Depends(get_ollama_caption_client),
    installer: DependencyInstaller = Depends(get_dependency_installer),
    batch: BatchCaptionManager = Depends(get_batch_manager),
    img_mgr=Depends(get_image_process_manager),
    export_mgr=Depends(get_export_manager),
):
    return {
        "ok": True,
        "service": local.snapshot(),
        "api_service": api.snapshot(),
        "ollama_service": ollama.snapshot(),
        "installer": installer.snapshot(),
        "batch": batch.snapshot(),
        "image_process": img_mgr.snapshot(),
        "export": export_mgr.snapshot(),
    }


@router.post("/ai/install")
def ai_install(installer: DependencyInstaller = Depends(get_dependency_installer)):
    started = installer.start()
    return {"ok": True, "started": started, "installer": installer.snapshot()}


@router.post("/ai/load")
def ai_load(req: AiLoadRequest, client: CaptionServiceClient = Depends(get_caption_client)):
    client.load_model(req.model)
    return {"ok": True, "service": client.snapshot()}


@router.post("/ai/caption")
def ai_caption(
    req: AiCaptionRequest,
    ws: DatasetWorkspace = Depends(get_workspace),
    local: CaptionServiceClient = Depends(get_caption_client),
    api: APICaptionClient = Depends(get_api_caption_client),
    ollama: OllamaCaptionClient = Depends(get_ollama_caption_client),
):
    name = req.name
    if not name:
        return {"ok": False, "error": "Missing item name."}
    item = ws.get_item(name)
    overwrite_mode = normalize_overwrite_mode(req.overwrite_mode)
    if item["exists"]["txt"] and overwrite_mode == "skip":
        return {"ok": True, "result": item["text"], "item": item, "skipped": True}
    image_paths = collect_item_images(item, control_count=ws.control_count)
    if not image_paths:
        return {"ok": False, "error": "No image found for this item."}
    request = resolve_caption_request(item["text"], req.prompt, overwrite_mode=overwrite_mode)
    result = caption_with_backend(
        backend=req.backend, image_paths=image_paths, image_name=name,
        model=req.model, mode=req.mode, prompt=request["prompt"],
        max_tokens=req.max_tokens, thinking=req.thinking,
        api_base_url=req.api_base_url, api_key=req.api_key,
        ollama_base_url=req.ollama_base_url,
        local_client=local, api_client=api, ollama_client=ollama,
    )
    output_text = apply_caption_result(item["text"], result, request["write_mode"])
    updated = ws.save_text(name, output_text)
    touch_active_project_content()
    return {
        "ok": True, "result": result, "item": updated,
        "used_modify": request["used_modify"],
        "fallback_to_overwrite": request["fallback_to_overwrite"],
    }


@router.post("/ai/validate")
def ai_validate(
    req: AiValidateRequest,
    local: CaptionServiceClient = Depends(get_caption_client),
    api: APICaptionClient = Depends(get_api_caption_client),
    ollama: OllamaCaptionClient = Depends(get_ollama_caption_client),
):
    backend = req.backend
    model = req.model
    overwrite_mode = normalize_overwrite_mode(req.overwrite_mode)
    validation_request = resolve_caption_request(
        VALIDATION_EXISTING_CAPTION, req.prompt, overwrite_mode=overwrite_mode,
    )
    if backend == "api":
        validation = api.validate(
            api_base_url=req.api_base_url, api_key=req.api_key,
            model=model, mode=req.mode, prompt=validation_request["prompt"],
            max_tokens=req.max_tokens, thinking=req.thinking,
        )
    elif backend == "ollama":
        validation = ollama.validate(
            base_url=req.ollama_base_url, model=model, mode=req.mode,
            prompt=validation_request["prompt"], max_tokens=req.max_tokens,
            thinking=req.thinking,
        )
    else:
        validation_images = create_validation_images()
        try:
            result = caption_with_backend(
                backend="local", image_paths=validation_images,
                model=model, mode=req.mode, prompt=validation_request["prompt"] or "Describe the visual change from the first image to the second image in one short sentence.",
                max_tokens=req.max_tokens, thinking=req.thinking,
                api_base_url="", api_key="", ollama_base_url="",
                local_client=local, api_client=api, ollama_client=ollama,
            )
            validation = {"ok": True, "result": result, "backend": "local", "model": model}
        finally:
            remove_validation_images(validation_images)
    if overwrite_mode == "modify":
        validation["existing_text"] = VALIDATION_EXISTING_CAPTION
        validation["used_modify"] = True
    return {"ok": True, "validation": validation}


@router.post("/ai/batch/start")
def ai_batch_start(req: AiBatchStartRequest, batch: BatchCaptionManager = Depends(get_batch_manager)):
    if not isinstance(req.names, list) or not req.names:
        return {"ok": False, "error": "Batch requires a non-empty names list."}
    batch.start(names=req.names, options={
        "backend": req.backend, "model": req.model,
        "overwrite_mode": req.overwrite_mode, "mode": req.mode,
        "prompt": req.prompt, "max_tokens": req.max_tokens,
        "thinking": req.thinking, "api_base_url": req.api_base_url,
        "api_key": req.api_key, "ollama_base_url": req.ollama_base_url,
        "project_id": get_active_project_id(),
    })
    return {"ok": True, "batch": batch.snapshot()}


@router.post("/ai/batch/stop")
def ai_batch_stop(batch: BatchCaptionManager = Depends(get_batch_manager)):
    batch.stop()
    return {"ok": True, "batch": batch.snapshot()}


@router.post("/api/models")
def api_list_models(req: ApiModelsRequest, api: APICaptionClient = Depends(get_api_caption_client)):
    models = api.list_models(api_base_url=req.api_base_url, api_key=req.api_key)
    return {"ok": True, "models": models}


# === WebSocket 实时状态推送 ===

_ws_clients: set[WebSocket] = set()


async def _collect_snapshot() -> dict:
    """收集所有服务快照（与 /api/v1/ai/status 一致）。"""
    from server.dependencies import (
        API_CAPTION_CLIENT,
        CAPTION_CLIENT,
        DEPENDENCY_INSTALLER,
        EXPORT_MANAGER,
        IMAGE_PROCESS_MANAGER,
        OLLAMA_CAPTION_CLIENT,
    )
    from server.dependencies import (
        BATCH_MANAGER as BM,
    )
    return {
        "service": CAPTION_CLIENT.snapshot(),
        "api_service": API_CAPTION_CLIENT.snapshot(),
        "ollama_service": OLLAMA_CAPTION_CLIENT.snapshot(),
        "installer": DEPENDENCY_INSTALLER.snapshot(),
        "batch": BM.snapshot(),
        "image_process": IMAGE_PROCESS_MANAGER.snapshot(),
        "export": EXPORT_MANAGER.snapshot(),
    }


async def _broadcast_snapshots():
    """后台任务：每秒推送一次快照给所有连接的客户端。"""
    while True:
        await asyncio.sleep(1)
        if not _ws_clients:
            continue
        try:
            snapshot = await _collect_snapshot()
            payload = json.dumps({"ok": True, "status": snapshot}, ensure_ascii=False)
            dead: list[WebSocket] = []
            for ws in _ws_clients:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                _ws_clients.discard(ws)
        except Exception:
            pass


@router.websocket("/ws/ai-status")
async def ws_ai_status(websocket: WebSocket):
    """WebSocket 端点：实时推送 AI 任务状态快照，替代前端轮询。"""
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        # 立即发送一次当前状态
        snapshot = await _collect_snapshot()
        await websocket.send_text(json.dumps({"ok": True, "status": snapshot}, ensure_ascii=False))
        # 保持连接，被动接收心跳 ping，等待客户端断开
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)
