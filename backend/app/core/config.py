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

    # Poppler 工具路径 (PDF 渲染为图片的底层依赖, pdf2image 需要)
    # macOS: 通常通过 homebrew 安装后不需要单独配置
    # Windows: 需手动下载并指定 bin 目录, 如 D:/Poppler/poppler-24.08.0/Library/bin
    poppler_path: str = ""

    # 文件上传配置
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50

    # 文本切片参数
    chunk_size: int = 512
    chunk_overlap: int = 50

    # ============ JWT 认证配置 ============
    jwt_secret: str = "change-me-to-a-random-secret-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080  # 7天 = 60 * 24 * 7

    # ============ 邮箱 SMTP 配置 (QQ邮箱) ============
    smtp_host: str = "smtp.qq.com"
    smtp_port: int = 465
    smtp_user: str = "744585348@qq.com"
    smtp_password: str = ""
    smtp_from: str = "744585348@qq.com"
    smtp_from_name: str = "MLA 智小学"

    # ============ CORS 跨域配置 ============
    # 允许的前端来源 (开发环境)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:4173"

    # ============ TTS 语音合成配置 (火山引擎 seed-tts-2.0) ============
    # API 端点地址
    tts_api_url: str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
    # 新版 API Key (推荐): 在 https://console.volcengine.com/speech/new/setting/apikeys 获取
    tts_api_key: str = ""
    # 旧版 App ID + Access Token (兼容): 在语音控制台获取
    tts_app_id: str = ""
    tts_access_token: str = ""
    # 公共配置
    tts_voice: str = "zh-female-warm"  # 支持别名 (zh-female-warm) 或原生 ID (zh_female_vv_uranus_bigtts)
    tts_speed: float = 1.0

    # ============ 搜索 API 配置 (采风 Agent 网络调研) ============
    # 博查 Search API 或其他兼容搜索引擎, 用于采风 Agent 搜索外部学习资源
    # 留空则采风跳过网络搜索 (优雅降级)
    search_api_base: str = ""
    search_api_key: str = ""

    # 是否启用采风 Agent (资源采集师蔡丰)
    # 用户可在前端设置页关闭, 关闭后所有会话的采风均跳过网络搜索
    scouting_enabled: bool = True

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
