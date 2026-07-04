"""批量操作端点。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.dataset_workspace import DatasetWorkspace
from server.dependencies import get_workspace

router = APIRouter()


class BatchSegmentsRequest(BaseModel):
    names: list[str] = []
    segments: list[str] = []
    tags: list[str] = []
    position: str = "after"


class BatchReplaceRequest(BaseModel):
    names: list[str] = []
    old_segment: str = ""
    old_tag: str = ""
    new_segment: str = ""
    new_tag: str = ""


class BatchRenameRequest(BaseModel):
    names: list[str] = []
    operation: str = ""
    value: str = ""
    old_value: str = ""
    new_value: str = ""


class SwapControlResultRequest(BaseModel):
    control_dir: str | None = None
    result_dir: str | None = None
    suffix: str = "_swap"


@router.post("/batch/add-segments")
def batch_add_segments(req: BatchSegmentsRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    segs = req.segments or req.tags
    result = ws.batch_add_segments(req.names, segs, position=req.position)
    return {"ok": True, **result}


@router.post("/batch/delete-segments")
def batch_delete_segments(req: BatchSegmentsRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    segs = req.segments or req.tags
    result = ws.batch_delete_segments(req.names, segs)
    return {"ok": True, **result}


@router.post("/batch/replace-segment")
def batch_replace_segment(req: BatchReplaceRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    old = req.old_segment or req.old_tag
    new = req.new_segment or req.new_tag
    result = ws.batch_replace_segment(req.names, old, new)
    return {"ok": True, **result}


@router.post("/batch/rename")
def batch_rename(req: BatchRenameRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.batch_rename_items(
        req.names, operation=req.operation, value=req.value,
        old_value=req.old_value, new_value=req.new_value,
    )
    return {"ok": True, **result}


@router.post("/batch/swap-control-result")
def batch_swap(req: SwapControlResultRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.swap_control_result_pairs(
        control_dir=req.control_dir, result_dir=req.result_dir, suffix=req.suffix,
    )
    return {"ok": True, **result}
