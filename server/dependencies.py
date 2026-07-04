"""FastAPI 依赖注入容器。

将 web_server.py 的模块级全局单例封装为 FastAPI Depends 可注入的依赖项。
"""

from __future__ import annotations

from pathlib import Path

from captioning.api_caption_client import APICaptionClient
from captioning.caption_client import CaptionServiceClient, DependencyInstaller
from captioning.ollama_caption_client import OllamaCaptionClient
from core.dataset_projects import ProjectStore
from core.dataset_workspace import DatasetWorkspace
from core.prompt_templates import PromptTemplateStore
from server.caption_workflow import BatchCaptionManager
from server.export_jobs import ExportManager
from server.image_process_jobs import ImageProcessManager

BASE_DIR = Path(__file__).resolve().parent.parent
PROMPT_TEMPLATES_FILE = BASE_DIR / "prompt_templates.json"

# 单例对象（与 web_server.py 保持一致）
WORKSPACE = DatasetWorkspace()
CAPTION_CLIENT = CaptionServiceClient()
API_CAPTION_CLIENT = APICaptionClient()
OLLAMA_CAPTION_CLIENT = OllamaCaptionClient()
DEPENDENCY_INSTALLER = DependencyInstaller()
PROMPT_TEMPLATES = PromptTemplateStore(PROMPT_TEMPLATES_FILE)
PROJECT_STORE = ProjectStore()
BATCH_MANAGER = BatchCaptionManager(WORKSPACE, CAPTION_CLIENT, API_CAPTION_CLIENT, OLLAMA_CAPTION_CLIENT)
IMAGE_PROCESS_MANAGER = ImageProcessManager(WORKSPACE)
EXPORT_MANAGER = ExportManager(WORKSPACE)

# 活跃项目状态
ACTIVE_PROJECT_ID = ""
_active_project_lock = __import__("threading").RLock()


def get_active_project_id() -> str:
    with _active_project_lock:
        return ACTIVE_PROJECT_ID


def set_active_project(project_id: str = "") -> None:
    global ACTIVE_PROJECT_ID
    with _active_project_lock:
        ACTIVE_PROJECT_ID = str(project_id or "")


def touch_active_project_content(project_id: str = "") -> None:
    """标记活跃项目内容已变更。从 web_server.py 提取。"""
    pid = str(project_id or "") or get_active_project_id()
    if not pid:
        return
    try:
        PROJECT_STORE.touch_project_content(pid)
    except FileNotFoundError:
        set_active_project("")


# FastAPI 依赖函数
def get_workspace() -> DatasetWorkspace:
    return WORKSPACE


def get_caption_client() -> CaptionServiceClient:
    return CAPTION_CLIENT


def get_api_caption_client() -> APICaptionClient:
    return API_CAPTION_CLIENT


def get_ollama_caption_client() -> OllamaCaptionClient:
    return OLLAMA_CAPTION_CLIENT


def get_dependency_installer() -> DependencyInstaller:
    return DEPENDENCY_INSTALLER


def get_prompt_templates() -> PromptTemplateStore:
    return PROMPT_TEMPLATES


def get_project_store() -> ProjectStore:
    return PROJECT_STORE


def get_batch_manager() -> BatchCaptionManager:
    return BATCH_MANAGER


def get_image_process_manager() -> ImageProcessManager:
    return IMAGE_PROCESS_MANAGER


def get_export_manager() -> ExportManager:
    return EXPORT_MANAGER
