"""条目 CRUD 端点。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from core.dataset_workspace import DatasetWorkspace
from server.dependencies import get_workspace, touch_active_project_content

router = APIRouter()


class ItemSaveRequest(BaseModel):
    name: str = ""
    text: str = ""
    segments: list[str] = []
    tags: list[str] = []


class ItemRenameRequest(BaseModel):
    name: str = ""
    new_name: str = ""


class ItemCloneRequest(BaseModel):
    name: str = ""


class ItemSwapRolesRequest(BaseModel):
    name: str = ""
    source_role: str = ""
    target_role: str = ""


class ItemAssignControlImageRequest(BaseModel):
    source_name: str = ""
    target_name: str = ""
    target_role: str = ""
    source_role: str = ""


class ItemUploadControlImageRequest(BaseModel):
    target_name: str = ""
    target_role: str = ""
    filename: str = ""
    data: str = ""


class ItemUploadResultImageRequest(BaseModel):
    filename: str = ""
    data: str = ""


class ItemUploadRoleImageRequest(BaseModel):
    role: str = ""
    filename: str = ""
    data: str = ""
    mime_type: str = ""
    folder: str = ""


class ItemMoveFolderRequest(BaseModel):
    name: str = ""
    folder: str = ""
    names: list[str] = []


class ItemCreateFolderRequest(BaseModel):
    folder: str = ""


class ItemRenameFolderRequest(BaseModel):
    folder: str = ""
    new_folder: str = ""


class ItemDeleteFolderRequest(BaseModel):
    folder: str = ""


class ItemRevealRequest(BaseModel):
    name: str = ""


class ItemTrashRequest(BaseModel):
    name: str = ""


class ItemDeleteRequest(BaseModel):
    name: str = ""


@router.get("/items")
def list_items(
    ws: DatasetWorkspace = Depends(get_workspace),
    filter: str = Query("all"),
    tag: str = Query(""),
    search_mode: str = Query("all"),
    match_mode: str = Query("contains"),
    detail: str = Query("0"),
    global_segments: str = Query("1"),
):
    data = ws.list_items(
        filter_mode=filter,
        tag_query=tag,
        search_mode=search_mode,
        match_mode=match_mode,
        detail=detail in {"1", "true", "yes"},
        include_global_segments=global_segments not in {"0", "false", "no"},
    )
    return {"ok": True, "workspace": ws.get_workspace_summary(), **data}


@router.get("/item")
def get_item(name: str = Query(""), ws: DatasetWorkspace = Depends(get_workspace)):
    if not name:
        return {"ok": False, "error": "Missing item name."}
    return {"ok": True, "item": ws.get_item(name)}


@router.get("/image")
def get_image(
    ws: DatasetWorkspace = Depends(get_workspace),
    role: str = Query("result"),
    name: str = Query(""),
    thumb: str = Query("0"),
    width: int = Query(320),
    height: int = Query(220),
):
    if not name:
        return {"ok": False, "error": "Missing item name."}
    path = ws.resolve_image_path(role, name)
    if not path or not path.exists():
        return {"ok": False, "error": "Image not found."}
    suffix = path.suffix.lower()
    content_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".tiff": "image/tiff", ".avif": "image/avif"}
    ct = content_types.get(suffix, "application/octet-stream")
    if thumb != "1":
        return Response(content=path.read_bytes(), media_type=ct)
    # Thumbnail rendering
    import io

    from PIL import Image
    w, h = max(width, 32), max(height, 32)
    with Image.open(path) as img:
        if img.mode not in {"RGB", "RGBA"}:
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        img.thumbnail((w, h))
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return Response(content=buf.getvalue(), media_type="image/png")


@router.post("/item/save")
def item_save(req: ItemSaveRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    name = req.name
    if "text" in req.model_dump() and req.text:
        item = ws.save_text(name, req.text)
    else:
        segments = req.segments or req.tags
        if not isinstance(segments, list):
            return {"ok": False, "error": "segments must be a list."}
        item = ws.save_segments(name, segments)
    touch_active_project_content()
    return {"ok": True, "item": item}


@router.post("/item/rename")
def item_rename(req: ItemRenameRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.rename_item(req.name, req.new_name)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/clone")
def item_clone(req: ItemCloneRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.clone_item(req.name)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/swap-roles")
def item_swap_roles(req: ItemSwapRolesRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.swap_item_roles(req.name, req.source_role, req.target_role)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/assign-control-image")
def item_assign_control_image(req: ItemAssignControlImageRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.assign_control_image(req.source_name, req.target_name, req.target_role, req.source_role)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/upload-control-image")
def item_upload_control_image(req: ItemUploadControlImageRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.upload_control_image(req.target_name, req.target_role, req.filename, req.data)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/upload-result-image")
def item_upload_result_image(req: ItemUploadResultImageRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.upload_result_image(req.filename, req.data)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/upload-role-image")
def item_upload_role_image(req: ItemUploadRoleImageRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.upload_role_image(req.role, req.filename, req.data, req.mime_type, req.folder)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/move-folder")
def item_move_folder(req: ItemMoveFolderRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    folder = req.folder
    names = req.names
    if isinstance(names, list) and names:
        result = ws.move_items_to_folder(names, folder)
        touch_active_project_content()
        return {"ok": True, **result}
    result = ws.move_item_to_folder(req.name, folder)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/create-folder")
def item_create_folder(req: ItemCreateFolderRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.create_folder(req.folder)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/rename-folder")
def item_rename_folder(req: ItemRenameFolderRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.rename_folder(req.folder, req.new_folder)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/delete-folder")
def item_delete_folder(req: ItemDeleteFolderRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.delete_folder(req.folder)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/reveal")
def item_reveal(req: ItemRevealRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    name = req.name
    item_path = ws.primary_item_path(name)
    return {"ok": True, "path": str(item_path)}


@router.post("/item/trash")
def item_trash(req: ItemTrashRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.trash_item_files(req.name)
    touch_active_project_content()
    return {"ok": True, **result}


@router.post("/item/delete")
def item_delete(req: ItemDeleteRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    result = ws.delete_item(req.name)
    touch_active_project_content()
    return {"ok": True, **result}
