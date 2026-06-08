"""
操作审计日志模型
记录注册、登录、资料修改、密码重置等关键操作
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AuditLog(Base):
    """
    操作审计日志表
    记录所有关键用户操作, 用于安全审计和追踪
    """
    __tablename__ = "audit_logs"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 用户 ID: 关联的用户, 可为空 (如未登录的注册操作)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )

    # 操作类型: register / login / logout / update_profile /
    #           reset_password / upload_avatar / admin_update_user 等
    action: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )

    # 客户端 IP 地址: 用于安全审计
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )

    # 客户端 User-Agent: 浏览器标识
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )

    # 操作详情: JSON 格式存储额外信息 (如被操作的用户ID、修改的字段等)
    details: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=dict
    )

    # 创建时间: 操作发生时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<AuditLog(user_id={self.user_id}, action={self.action})>"
