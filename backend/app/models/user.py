"""
用户模型
存储学生、教师、管理员的基础信息
"""

import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class User(Base):
    """
    用户表
    支持学生(student)、教师(teacher)、管理员(admin)三种角色
    """
    __tablename__ = "users"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 用户名: 登录凭证, 唯一
    username: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )

    # 邮箱: 唯一, 可用于找回密码和通知
    email: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False
    )

    # 密码哈希: 使用 bcrypt 哈希后的密码
    password_hash: Mapped[str] = mapped_column(
        String(255), nullable=False
    )

    # 姓名: 用户真实姓名
    full_name: Mapped[str] = mapped_column(
        String(50), nullable=True
    )

    # 学校/学院
    school: Mapped[str] = mapped_column(
        String(100), nullable=True
    )

    # 专业
    major: Mapped[str] = mapped_column(
        String(100), nullable=True
    )

    # 年级
    grade: Mapped[str] = mapped_column(
        String(20), nullable=True
    )

    # 学历层次: 本科 / 硕士 / 博士
    education_level: Mapped[str] = mapped_column(
        String(20), nullable=True
    )

    # 角色: student / teacher / admin
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="student"
    )

    # 头像 URL: 上传到 uploads/avatars/ 后的相对路径
    avatar: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )

    # 昵称: 显示名称, 默认使用 username
    nickname: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )

    # 邮箱是否已验证 (通过验证码注册后为 True)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username}, role={self.role})>"
