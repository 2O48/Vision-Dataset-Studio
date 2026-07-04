"""Caption 相关端点（Prompt 模板 + 翻译）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.dataset_workspace import DatasetWorkspace
from core.prompt_templates import PromptTemplateStore
from server.dependencies import get_prompt_templates, get_workspace

router = APIRouter()


class SaveTemplateRequest(BaseModel):
    name: str = ""
    content: str = ""


class DeleteTemplateRequest(BaseModel):
    id: str = ""


class TranslateRequest(BaseModel):
    text: str = ""


@router.get("/prompt-templates")
def list_templates(templates: PromptTemplateStore = Depends(get_prompt_templates)):
    return {"ok": True, "templates": templates.load()}


@router.post("/prompt-templates/save")
def save_template(req: SaveTemplateRequest, templates: PromptTemplateStore = Depends(get_prompt_templates)):
    result = templates.save_template(name=req.name, content=req.content)
    return {"ok": True, "templates": result}


@router.post("/prompt-templates/delete")
def delete_template(req: DeleteTemplateRequest, templates: PromptTemplateStore = Depends(get_prompt_templates)):
    result = templates.delete_template(req.id)
    return {"ok": True, "templates": result}


@router.post("/translate")
def translate_text(req: TranslateRequest, ws: DatasetWorkspace = Depends(get_workspace)):
    translated = ws.translate_text(req.text)
    return {"ok": True, "translated": translated}
