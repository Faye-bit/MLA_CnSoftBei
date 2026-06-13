"""
对话模型
包含对话(Conversation)和消息(Message)两张表
用于管理 AI 对话会话及其消息历史
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Conversation(Base):
    """
    对话表
    记录用户与 AI 的对话会话, 支持知识库对话和画像收集两种模式
    """
    __tablename__ = "conversations"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属用户 ID: 每个用户的对话互相隔离
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # 关联课程 ID: 可选, 知识库对话模式下关联到具体课程以限定 RAG 检索范围
    course_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )

    # 对话标题: 默认"新对话", 用户可修改
    title: Mapped[str] = mapped_column(
        String(200), nullable=False, default="新对话"
    )

    # 对话类型: chat (知识库对话) / profile_collection (画像收集)
    conversation_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="chat"
    )

    # 画像收集当前阶段: 仅在 conversation_type=profile_collection 时有意义
    # 阶段名: academic_background / knowledge_basis / learning_goals / cognitive_style /
    #         learning_rhythm / weak_areas / interests / resource_preferences / done
    profile_collection_stage: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # 关联关系: 对话下的所有消息, 按创建时间升序
    messages: Mapped[List["Message"]] = relationship(
        "Message", back_populates="conversation", cascade="all, delete-orphan",
        order_by="Message.created_at"
    )

    def __repr__(self) -> str:
        return f"<Conversation(id={self.id}, title={self.title}, type={self.conversation_type})>"


class Message(Base):
    """
    消息表
    记录对话中的每条消息, 包括用户消息、AI 回复和系统提示
    """
    __tablename__ = "messages"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属对话 ID
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )

    # 消息角色: user (用户) / assistant (AI 助手) / system (系统提示)
    role: Mapped[str] = mapped_column(
        String(20), nullable=False
    )

    # 消息正文: 支持 Markdown 格式
    content: Mapped[str] = mapped_column(
        Text, nullable=False
    )

    # 引用来源: JSONB 数组, AI 消息特有, 记录引用的知识库切片
    # 格式: [{"chunk_id": "...", "document_id": "...", "document_filename": "...", "content": "...", "score": 0.92}]
    sources: Mapped[Optional[List[dict]]] = mapped_column(
        JSONB, nullable=True, default=None
    )

    # 消息元数据: JSONB, 存储 token 消耗、模型名称等额外信息
    # 格式: {"token_count": 150, "model": "deepseek-chat", "latency_ms": 1200}
    message_metadata: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=None
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 关联关系: 所属对话
    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="messages"
    )

    def __repr__(self) -> str:
        return f"<Message(id={self.id}, role={self.role}, conversation_id={self.conversation_id})>"
