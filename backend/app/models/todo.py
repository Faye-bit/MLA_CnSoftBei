"""
用户自定义待办模型
存储用户手动创建的文本待办, 支持勾选完成和删除
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Todo(Base):
    """
    用户自定义待办表
    记录用户手动创建的文本待办事项, 与学习阶段自动待办分离
    支持标记完成和软删除
    """
    __tablename__ = "todos"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属用户 ID: 每个用户的待办互相隔离
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 待办标题: 纯文本内容
    title: Mapped[str] = mapped_column(
        Text, nullable=False
    )

    # 是否已完成: True 表示已勾选完成
    is_completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # 完成时间: 用户勾选完成时记录, 取消完成时置空
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间: 修改标题或切换完成状态时更新
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return (
            f"<Todo(id={self.id}, title={self.title[:30]}, "
            f"is_completed={self.is_completed})>"
        )
