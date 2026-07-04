"""工作区端点。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from core.dataset_paths import resolve_user_path
from core.dataset_workspace import DatasetWorkspace
from server.dependencies import (
    get_image_process_manager,
    get_workspace,
)
from server.image_process_jobs import ImageProcessManager

router = APIRouter()


class WorkspaceOpenRequest(BaseModel):
    control1_dir: str | None = None
    control2_dir: str | None = None
    control3_dir: str | None = None
    result_dir: str | None = None
    control_count: int | None = None
    ignore_tokens: list[str] | None = None


class WorkspaceMergeRequest(BaseModel):
    control1_dir: str | None = None
    control2_dir: str | None = None
    control3_dir: str | None = None
    result_dir: str | None = None
    control_count: int | None = None


@router.get("/workspace")
def workspace_summary(ws: DatasetWorkspace = Depends(get_workspace)):
    return {"ok": True, "workspace": ws.get_workspace_summary()}


@router.get("/workspace/browse")
def workspace_browse(path: str = Query(""), ws: DatasetWorkspace = Depends(get_workspace)):
    if not path.strip():
        return {"ok": False, "error": "Missing directory path."}
    root = resolve_user_path(path)
    if not root.exists():
        raise FileNotFoundError(f"Directory does not exist: {path}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {path}")

    items = []
    child_dirs = (p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name != "__pycache__")
    for child in sorted(child_dirs, key=lambda p: p.name.lower()):
        try:
            img_count = sum(1 for f in child.iterdir() if f.is_file() and f.suffix.lower() in {
                ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".avif", ".heic", ".heif",
            })
        except Exception:
            img_count = 0
        items.append({"name": child.name, "path": str(child), "image_count": img_count})

    return {"ok": True, "browser": {"path": str(root), "parent": str(root.parent) if root.parent != root else "", "items": items}}


@router.post("/workspace/open")
def workspace_open(req: WorkspaceOpenRequest, ws: DatasetWorkspace = Depends(get_workspace), img_mgr: ImageProcessManager = Depends(get_image_process_manager)):
    summary = ws.open_dirs(
        control1_dir=req.control1_dir,
        control2_dir=req.control2_dir,
        control3_dir=req.control3_dir,
        result_dir=req.result_dir,
        control_count=req.control_count,
        ignore_tokens=req.ignore_tokens,
    )
    img_mgr.reset_if_idle()
    return {"ok": True, "workspace": summary}


@router.post("/workspace/rescan")
def workspace_rescan(ws: DatasetWorkspace = Depends(get_workspace)):
    summary = ws.open_dirs()
    return {"ok": True, "workspace": summary}


@router.post("/workspace/merge")
def workspace_merge(req: WorkspaceMergeRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.merge_dirs(
        control1_dir=req.control1_dir,
        control2_dir=req.control2_dir,
        control3_dir=req.control3_dir,
        result_dir=req.result_dir,
        control_count=req.control_count,
    )
    return {"ok": True, **result}
