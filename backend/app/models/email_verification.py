"""
邮箱验证码模型
存储注册和重置密码时发送的验证码记录
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class EmailVerification(Base):
    """
    邮箱验证码表
    每条记录代表一次发送的验证码, 验证后标记为已使用
    """
    __tablename__ = "email_verifications"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 邮箱地址: 接收验证码的邮箱
    email: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )

    # 验证码: 6位数字字符串
    code: Mapped[str] = mapped_column(
        String(6), nullable=False
    )

    # 用途: "register" 注册 / "reset_password" 重置密码
    purpose: Mapped[str] = mapped_column(
        String(20), nullable=False
    )

    # 过期时间: 超过此时间验证码失效
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # 是否已使用: 防止重复使用同一验证码
    used: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )

    # 创建时间: 记录发送时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<EmailVerification(email={self.email}, purpose={self.purpose})>"
