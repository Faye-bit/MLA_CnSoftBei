"""
应用配置模块
通过 pydantic-settings 从 .env 文件和环境变量加载配置
"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    全局应用配置
    所有配置项均可通过环境变量或 .env 文件覆盖
    LLM 和 Embedding 拆分为独立配置, 可分别接入不同服务商
    """

    # 应用基础配置
    app_name: str = "MLA"
    app_version: str = "0.1.0"
    debug: bool = True

    # 数据库连接 (异步)
    database_url: str = "postgresql+asyncpg://mla:mla123@localhost:5432/mla_db"

    # Chroma 向量数据库持久化目录
    chroma_persist_dir: str = "./chroma_data"

    # ============ LLM 大语言模型配置 ============
    # 用于对话、资源生成、画像抽取等 (Phase 2+)
    llm_api_key: str = "sk-your-llm-key-here"
    llm_api_base: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"

    # ============ Embedding 嵌入模型配置 ============
    # 用于知识库向量化和语义检索 (Phase 1 即需要)
    embedding_api_key: str = "sk-your-embedding-key-here"
    embedding_api_base: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"

    # 文件上传配置
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50

    # 文本切片参数
    chunk_size: int = 512
    chunk_overlap: int = 50

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


# 全局单例配置实例
settings = Settings()

# 确保上传目录和 Chroma 数据目录存在
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
Path(settings.chroma_persist_dir).mkdir(parents=True, exist_ok=True)
