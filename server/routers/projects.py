"""项目管理端点。"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from core.dataset_paths import cleanup_tmp, is_relative_to
from core.dataset_projects import ProjectStore
from core.dataset_workspace import DatasetWorkspace
from server.dependencies import (
    get_active_project_id,
    get_project_store,
    get_workspace,
    set_active_project,
)

router = APIRouter()


class ProjectSaveRequest(BaseModel):
    name: str = ""
    overwrite_id: str = ""
    control_count: int | None = None
    ui_state: dict = {}


class ProjectCreateRequest(BaseModel):
    name: str = ""
    control_count: int | None = None
    ui_state: dict = {}


class ProjectOpenRequest(BaseModel):
    id: str = ""


class ProjectRenameRequest(BaseModel):
    id: str = ""
    name: str = ""


class ProjectDeleteRequest(BaseModel):
    id: str = ""


class ProjectUiStateRequest(BaseModel):
    id: str = ""
    ui_state: dict = {}


class TmpCleanupRequest(BaseModel):
    max_age_hours: int = 48


@router.get("/projects")
def list_projects(store: ProjectStore = Depends(get_project_store)):
    return {"ok": True, "projects": store.list_projects()}


@router.get("/projects/detail")
def project_detail(id: str = "", store: ProjectStore = Depends(get_project_store)):
    return {"ok": True, **store.get_project(id)}


@router.get("/projects/thumbnail")
def project_thumbnail(id: str = "", store: ProjectStore = Depends(get_project_store)):
    detail = store.get_project(id)
    project_dir = Path(detail["path"]).resolve()
    thumb = str(detail["project"].get("thumbnail", "") or "")
    if not thumb:
        raise FileNotFoundError("Project has no thumbnail.")
    path = (project_dir / thumb).resolve()
    if not is_relative_to(path, project_dir) or not path.is_file():
        raise FileNotFoundError("Project thumbnail not found.")
    return Response(content=path.read_bytes(), media_type="image/png")


@router.post("/projects/save")
def save_project(req: ProjectSaveRequest, ws: DatasetWorkspace = Depends(get_workspace), store: ProjectStore = Depends(get_project_store)):
    result = store.save_project(
        name=req.name, workspace=ws, overwrite_id=req.overwrite_id,
        control_count=req.control_count, ui_state=req.ui_state,
    )
    workspace_info = result.get("workspace", {}) if isinstance(result.get("workspace"), dict) else {}
    dirs = workspace_info.get("dirs", {}) if isinstance(workspace_info.get("dirs"), dict) else {}
    settings = workspace_info.get("settings", {}) if isinstance(workspace_info.get("settings"), dict) else {}
    summary = ws.open_dirs(
        control1_dir=dirs.get("control1") or "",
        control2_dir=dirs.get("control2") or "",
        control3_dir=dirs.get("control3") or "",
        result_dir=dirs.get("result") or "",
        control_count=settings.get("control_count", result.get("project", {}).get("control_count", 1)),
        ignore_tokens=settings.get("ignore_tokens", []),
    )
    items = workspace_info.get("items", []) if isinstance(workspace_info.get("items"), list) else []
    aliases = {
        str(item.get("name", "") or ""): str(item.get("source_name", "") or "")
        for item in items if isinstance(item, dict) and item.get("name") and item.get("source_name")
    }
    if aliases:
        summary = ws.apply_name_aliases(aliases)
    result["workspace"] = summary
    set_active_project(result.get("project", {}).get("id", ""))
    return {"ok": True, **result}


@router.post("/projects/create")
def create_project(req: ProjectCreateRequest, store: ProjectStore = Depends(get_project_store)):
    result = store.create_project(name=req.name, control_count=req.control_count, ui_state=req.ui_state)
    return {"ok": True, **result}


@router.post("/projects/open")
def open_project(req: ProjectOpenRequest, ws: DatasetWorkspace = Depends(get_workspace), store: ProjectStore = Depends(get_project_store)):
    detail = store.get_project(req.id)
    workspace_info = detail.get("workspace", {})
    dirs = workspace_info.get("dirs", {}) if isinstance(workspace_info.get("dirs"), dict) else {}
    settings = workspace_info.get("settings", {}) if isinstance(workspace_info.get("settings"), dict) else {}
    summary = ws.open_dirs(
        control1_dir=dirs.get("control1") or "",
        control2_dir=dirs.get("control2") or "",
        control3_dir=dirs.get("control3") or "",
        result_dir=dirs.get("result") or "",
        control_count=settings.get("control_count", detail.get("project", {}).get("control_count", 1)),
        ignore_tokens=settings.get("ignore_tokens", []),
    )
    items = workspace_info.get("items", []) if isinstance(workspace_info.get("items"), list) else []
    aliases = {
        str(item.get("name", "") or ""): str(item.get("source_name", "") or "")
        for item in items if isinstance(item, dict) and item.get("name") and item.get("source_name")
    }
    if aliases:
        summary = ws.apply_name_aliases(aliases)
    set_active_project(detail.get("project", {}).get("id", req.id))
    return {
        "ok": True, "workspace": summary,
        "project": detail.get("project", {}),
        "ui_state": workspace_info.get("ui_state", {}) if isinstance(workspace_info.get("ui_state"), dict) else {},
    }


@router.post("/projects/rename")
def rename_project(req: ProjectRenameRequest, store: ProjectStore = Depends(get_project_store)):
    old_id = req.id
    project = store.rename_project(old_id, req.name)
    if get_active_project_id() == old_id:
        set_active_project(project.get("id", old_id))
    return {"ok": True, "project": project}


@router.post("/projects/clone")
def clone_project(req: ProjectRenameRequest, store: ProjectStore = Depends(get_project_store)):
    result = store.clone_project(req.id, req.name)
    return {"ok": True, **result}


@router.post("/projects/ui-state")
def update_ui_state(req: ProjectUiStateRequest, store: ProjectStore = Depends(get_project_store)):
    result = store.update_ui_state(req.id, req.ui_state)
    return {"ok": True, **result}


@router.post("/projects/delete")
def delete_project(req: ProjectDeleteRequest, store: ProjectStore = Depends(get_project_store)):
    deleted_id = req.id
    result = store.delete_project(deleted_id)
    if get_active_project_id() == deleted_id:
        set_active_project("")
    return {"ok": True, **result}


@router.post("/tmp/cleanup")
def tmp_cleanup(req: TmpCleanupRequest):
    result = cleanup_tmp(max_age_hours=req.max_age_hours)
    return {"ok": True, "cleanup": result}


@router.post("/trash/cleanup")
def trash_cleanup(store: ProjectStore = Depends(get_project_store)):
    result = store.cleanup_trash()
    return {"ok": True, "cleanup": result}
