"""
系统配置 API 路由
提供 API 配置的读取和修改接口, 用户可通过前端页面自定义 API Key
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.schemas.common import ApiResponse
from app.services.config_service import (
    get_all_config, set_configs, CONFIG_KEYS, CONFIG_LABELS, ENV_DEFAULTS,
)

router = APIRouter(prefix="/config", tags=["系统配置"])


@router.get("/", response_model=ApiResponse[dict], summary="获取当前配置")
async def get_config(db: AsyncSession = Depends(get_db)):
    """
    获取所有可配置项的当前值
    返回值包含: 当前值、标签、默认值、键名列表
    """
    values = await get_all_config(db)
    items = []
    for key in CONFIG_KEYS:
        items.append({
            "key": key,
            "label": CONFIG_LABELS.get(key, key),
            "value": values.get(key, ""),
            "default_value": ENV_DEFAULTS.get(key, ""),
        })
    return ApiResponse(data={"items": items})


@router.put("/", response_model=ApiResponse, summary="更新配置")
async def update_config(
    configs: dict[str, str],
    db: AsyncSession = Depends(get_db),
):
    """
    批量更新配置项
    Body: {"embedding_api_key": "sk-xxx", "llm_api_key": "sk-yyy", ...}
    修改后即时生效, 无需重启服务
    """
    await set_configs(db, configs)
    return ApiResponse(message="配置已更新, 即时生效")
