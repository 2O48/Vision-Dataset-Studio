"""导出相关端点。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from core.dataset_exporter import export_dataset
from core.dataset_workspace import DatasetWorkspace
from server.dependencies import get_export_manager, get_workspace
from server.export_jobs import ExportManager

router = APIRouter()


class ExportStartRequest(BaseModel):
    names: list[str] | None = None
    format: str = "zip"
    output_dir: str = ""
    project_name: str = ""
    target_megapixels: float = 4.0
    multiple: int = 16
    process_images: bool = True
    include_controls: bool = True
    preserve_subfolders: bool = False


@router.get("/export/status")
def export_status(mgr: ExportManager = Depends(get_export_manager)):
    return {"ok": True, "export": mgr.snapshot()}


@router.get("/export/download")
def export_download(mgr: ExportManager = Depends(get_export_manager)):
    path = mgr.download_path()
    return Response(content=path.read_bytes(), media_type="application/zip")


@router.post("/export/start")
def export_start(req: ExportStartRequest, mgr: ExportManager = Depends(get_export_manager)):
    mgr.start(options={
        "names": req.names,
        "format": req.format,
        "output_dir": req.output_dir,
        "project_name": req.project_name,
        "target_megapixels": req.target_megapixels,
        "multiple": req.multiple,
        "process_images": req.process_images,
        "include_controls": req.include_controls,
        "preserve_subfolders": req.preserve_subfolders,
    })
    return {"ok": True, "export": mgr.snapshot()}


@router.post("/export/stop")
def export_stop(mgr: ExportManager = Depends(get_export_manager)):
    mgr.stop()
    return {"ok": True, "export": mgr.snapshot()}


@router.post("/export/dataset")
def export_dataset_sync(req: ExportStartRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = export_dataset(
        items=ws.get_export_items(req.names),
        output_format=req.format,
        output_dir=req.output_dir,
        project_name=req.project_name,
        target_megapixels=req.target_megapixels,
        multiple=req.multiple,
        process_images=req.process_images,
        include_controls=req.include_controls,
        control_count=ws.control_count,
        preserve_subfolders=req.preserve_subfolders,
    )
    if result["format"] == "zip":
        return Response(content=result["bytes"], media_type="application/zip")
    return {"ok": True, "export": result}
