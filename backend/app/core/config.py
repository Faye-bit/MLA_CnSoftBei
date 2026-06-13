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

    # ============ 文档解析多模态 LLM 配置 ============
    # 用于 PDF/PPTX 的视觉理解解析 (Phase 2 升级)
    # 将文档逐页渲染为图片后发送给多模态大模型, 输出结构化 Markdown
    # 注意: 需要支持视觉/多模态的模型, DeepSeek 目前不支持 image_url 输入
    # 推荐: gpt-4o-mini (便宜), gpt-4o (最强), qwen-vl-plus (中文优)
    # 留空则降级到 PyMuPDF/python-pptx 传统解析 (与当前行为完全一致)
    doc_parser_api_key: str = ""
    doc_parser_api_base: str = "https://api.openai.com/v1"
    doc_parser_model: str = "gpt-4o-mini"

    # 文件上传配置
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50

    # 文本切片参数
    chunk_size: int = 512
    chunk_overlap: int = 50

    # ============ JWT 认证配置 ============
    jwt_secret: str = "change-me-to-a-random-secret-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # ============ 邮箱 SMTP 配置 (QQ邮箱) ============
    smtp_host: str = "smtp.qq.com"
    smtp_port: int = 465
    smtp_user: str = "744585348@qq.com"
    smtp_password: str = ""
    smtp_from: str = "744585348@qq.com"
    smtp_from_name: str = "MLA 多学助手"

    # ============ 验证码配置 ============
    verification_code_expire_minutes: int = 5
    verification_code_cooldown_seconds: int = 60

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
