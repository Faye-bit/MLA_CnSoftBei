"""
动态配置服务
从数据库读取用户配置, 为空时回退到 .env 默认值
内存缓存 + 数据库持久化, 运行时修改即时生效

可配置项通过反射从 Settings 类自动生成, 无需手动维护列表。
新增 Settings 字段会自动成为可配置项 (除非加入 _CONFIG_EXCLUDE_FIELDS 排除)。
"""

from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.config import SystemConfig
from app.core.config import Settings, settings
from loguru import logger

# ============================================================================
# 自动从 Settings 生成配置项列表
# ============================================================================

# 排除非用户可配置的字段: 应用元数据、路径、JWT、SMTP、验证码等
_CONFIG_EXCLUDE_FIELDS: set[str] = {
    "app_name", "app_version", "debug",
    "database_url", "chroma_persist_dir",
    "upload_dir", "max_upload_size_mb",
    "chunk_size", "chunk_overlap",
    "jwt_secret", "jwt_algorithm", "jwt_expire_minutes",
    "smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from", "smtp_from_name",
    "cors_origins", "tts_api_url", "poppler_path",
    "verification_code_expire_minutes", "verification_code_cooldown_seconds",
}

# 通过反射从 Settings 类获取所有字段名，排除非可配置字段
CONFIG_KEYS: list[str] = [
    name for name in Settings.model_fields
    if name not in _CONFIG_EXCLUDE_FIELDS
]

# 标签: 从 snake_case 字段名自动生成人类可读标签
def _field_label(name: str) -> str:
    """将 snake_case 字段名转为人类可读标签 (如 llm_api_key → LLM API Key)"""
    parts = name.split("_")
    # 首字母大写的缩写和大写片段保持原样, 其余首字母大写
    result: list[str] = []
    for i, p in enumerate(parts):
        if p in ():  # 预留特殊处理
            result.append(p.upper())
        elif len(p) <= 3 and p.isalpha():
            # 短片段保持大写 (如 api, tts, id, key)
            result.append(p.upper() if i > 0 else p.capitalize())
        else:
            result.append(p.capitalize())
    return " ".join(result)

CONFIG_LABELS: dict[str, str] = {
    key: _field_label(key) for key in CONFIG_KEYS
}

# 手动覆盖部分标签以提高可读性
_LABEL_OVERRIDES: dict[str, str] = {
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
CONFIG_LABELS.update(_LABEL_OVERRIDES)

# .env 静态默认值: 从 Settings 实例读取各字段值并转为字符串
ENV_DEFAULTS: dict[str, str] = {}
for _key in CONFIG_KEYS:
    _val = getattr(settings, _key, "")
    ENV_DEFAULTS[_key] = str(_val) if not isinstance(_val, str) else _val

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
