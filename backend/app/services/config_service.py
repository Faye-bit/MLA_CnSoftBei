"""
动态配置服务
从数据库读取用户配置, 为空时回退到 .env 默认值
内存缓存 + 数据库持久化, 运行时修改即时生效
"""

from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.config import SystemConfig
from app.core.config import settings
from loguru import logger


# 可配置的键名
CONFIG_KEYS = [
    "llm_api_key",
    "llm_api_base",
    "llm_model",
    "embedding_api_key",
    "embedding_api_base",
    "embedding_model",
    "doc_parser_api_key",
    "doc_parser_api_base",
    "doc_parser_model",
    "tts_api_key",
    "tts_app_id",
    "tts_access_token",
    "tts_voice",
    "tts_speed",
]

# 各配置项的标签 (前端展示用)
CONFIG_LABELS: dict[str, str] = {
    "llm_api_key": "LLM API Key",
    "llm_api_base": "LLM API 地址",
    "llm_model": "LLM 模型名称",
    "embedding_api_key": "Embedding API Key",
    "embedding_api_base": "Embedding API 地址",
    "embedding_model": "Embedding 模型名称",
    "doc_parser_api_key": "文档解析 API Key",
    "doc_parser_api_base": "文档解析 API 地址",
    "doc_parser_model": "文档解析 模型名称",
    "tts_api_key": "TTS API Key (新版)",
    "tts_app_id": "TTS App ID (旧版)",
    "tts_access_token": "TTS Access Token (旧版)",
    "tts_voice": "TTS 音色",
    "tts_speed": "TTS 语速",
}

# .env 静态默认值 (启动时加载, 不会变)
ENV_DEFAULTS: dict[str, str] = {
    "llm_api_key": settings.llm_api_key,
    "llm_api_base": settings.llm_api_base,
    "llm_model": settings.llm_model,
    "embedding_api_key": settings.embedding_api_key,
    "embedding_api_base": settings.embedding_api_base,
    "embedding_model": settings.embedding_model,
    "doc_parser_api_key": settings.doc_parser_api_key,
    "doc_parser_api_base": settings.doc_parser_api_base,
    "doc_parser_model": settings.doc_parser_model,
    "tts_api_key": settings.tts_api_key,
    "tts_app_id": settings.tts_app_id,
    "tts_access_token": settings.tts_access_token,
    "tts_voice": settings.tts_voice,
    "tts_speed": str(settings.tts_speed),
}

# 内存缓存: 用户通过前端修改后立即更新
_cache: dict[str, str] = {}


def get_config_value(key: str) -> str:
    """
    获取单个配置值 (缓存 > .env)
    不依赖数据库会话, 可在任何地方调用
    :param key: 配置键名
    :return: 配置值
    """
    if key in _cache and _cache[key]:
        return _cache[key]
    return ENV_DEFAULTS.get(key, "")


async def load_config_from_db(db: AsyncSession):
    """
    从数据库加载所有配置到内存缓存 (应用启动时调用)
    :param db: 数据库会话
    """
    stmt = select(SystemConfig)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    for row in rows:
        if row.config_value:
            _cache[row.config_key] = row.config_value
    logger.info(f"已从数据库加载 {len(rows)} 条配置到缓存")


async def get_all_config(db: AsyncSession) -> dict[str, str]:
    """
    获取所有可配置项的当前值 (供前端展示)
    :param db: 数据库会话
    :return: {config_key: config_value}
    """
    result: dict[str, str] = {}
    for key in CONFIG_KEYS:
        result[key] = get_config_value(key)
    return result


async def set_config(db: AsyncSession, key: str, value: str):
    """
    设置配置值: 写入数据库 + 更新内存缓存
    :param db: 数据库会话
    :param key: 配置键名
    :param value: 配置值
    """
    if key not in CONFIG_KEYS:
        raise ValueError(f"不支持的配置项: {key}")

    # 写入数据库
    stmt = select(SystemConfig).where(SystemConfig.config_key == key)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row:
        row.config_value = value
    else:
        row = SystemConfig(config_key=key, config_value=value)
        db.add(row)
    await db.commit()

    # 更新内存缓存, 即时生效
    _cache[key] = value
    display = value[:20] + "..." if "key" in key and len(value) > 20 else value
    logger.info(f"配置已更新: {key} = {display}")


async def set_configs(db: AsyncSession, configs: dict[str, str]):
    """
    批量设置配置值
    :param db: 数据库会话
    :param configs: {config_key: config_value}
    """
    for key, value in configs.items():
        if key in CONFIG_KEYS and value:
            await set_config(db, key, value)
