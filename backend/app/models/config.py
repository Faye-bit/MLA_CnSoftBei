"""
系统配置模型
存储用户自定义的 API Key 等配置, 运行时可通过前端修改, 无需重启
"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class SystemConfig(Base):
    """
    系统配置表 (Key-Value 结构)
    存储 LLM API Key、Embedding API Key、模型名称等可运行时修改的配置
    优先级: 数据库值 > .env 默认值
    """
    __tablename__ = "system_configs"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 配置键名: 如 llm_api_key, embedding_api_key, embedding_model 等
    config_key: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False, index=True
    )

    # 配置值
    config_value: Mapped[str] = mapped_column(
        Text, nullable=False, default=""
    )

    # 最后更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<SystemConfig(key={self.config_key}, value={self.config_value[:20]}...)>"
