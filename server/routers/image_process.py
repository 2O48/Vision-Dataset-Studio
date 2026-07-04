"""图像处理端点。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.dataset_workspace import DatasetWorkspace
from server.dependencies import get_image_process_manager, get_workspace
from server.image_process_jobs import ImageProcessManager

router = APIRouter()


class ImageProcessStartRequest(BaseModel):
    output_dir: str = ""
    project_name: str = ""
    target_megapixels: float = 4.0
    multiple: int = 16
    include_controls: bool = True
    load_workspace: bool = True


class MatchResultStartRequest(BaseModel):
    output_dir: str = ""
    project_name: str = ""
    include_controls: bool = True
    load_workspace: bool = True
    only_mismatched: bool = True


@router.get("/images/process/status")
def process_status(mgr: ImageProcessManager = Depends(get_image_process_manager)):
    return {"ok": True, "image_process": mgr.snapshot()}


@router.post("/images/process/start")
def process_start(req: ImageProcessStartRequest, mgr: ImageProcessManager = Depends(get_image_process_manager)):
    mgr.start(options={
        "mode": "process",
        "output_dir": req.output_dir,
        "project_name": req.project_name,
        "target_megapixels": req.target_megapixels,
        "multiple": req.multiple,
        "include_controls": req.include_controls,
        "load_workspace": req.load_workspace,
    })
    return {"ok": True, "image_process": mgr.snapshot()}


@router.post("/images/match-result/start")
def match_result_start(req: MatchResultStartRequest, mgr: ImageProcessManager = Depends(get_image_process_manager)):
    mgr.start(options={
        "mode": "match_result",
        "output_dir": req.output_dir,
        "project_name": req.project_name,
        "include_controls": req.include_controls,
        "load_workspace": req.load_workspace,
        "only_mismatched": req.only_mismatched,
    })
    return {"ok": True, "image_process": mgr.snapshot()}


@router.post("/images/item/scale")
def item_scale(req: dict, ws: DatasetWorkspace = Depends(get_workspace)):
    from core.dataset_image_processor import process_viewer_item_scale
    name = str(req.get("name", "") or "")
    if not name:
        return {"ok": False, "error": "Missing item name."}
    item = ws.get_item(name)
    result = process_viewer_item_scale(
        item=item,
        target_megapixels=float(req.get("target_megapixels", 4.0) or 4.0),
        control_count=ws.control_count,
    )
    updated = ws.replace_item_paths(name, result.get("paths", {}))
    return {"ok": True, "process": result, "item": updated}


@router.post("/images/item/match-result")
def item_match_result(req: dict, ws: DatasetWorkspace = Depends(get_workspace)):
    from core.dataset_image_processor import process_viewer_item_match_result
    name = str(req.get("name", "") or "")
    if not name:
        return {"ok": False, "error": "Missing item name."}
    item = ws.get_item(name)
    result = process_viewer_item_match_result(item=item, control_count=ws.control_count)
    updated = ws.replace_item_paths(name, result.get("paths", {}))
    return {"ok": True, "process": result, "item": updated}
