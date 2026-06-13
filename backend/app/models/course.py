"""
课程模型
包含课程(Course)、章节(Chapter)、知识点(KnowledgePoint) 三张核心表
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Course(Base):
    """
    课程表
    一门完整的高校课程, 如"人工智能导论"
    """
    __tablename__ = "courses"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 课程名称
    name: Mapped[str] = mapped_column(
        String(200), nullable=False, index=True
    )

    # 课程描述
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 封面图 URL
    cover_image: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )

    # 创建者 ID (外键关联用户表)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # 关联关系: 课程下的所有章节
    chapters: Mapped[List["Chapter"]] = relationship(
        "Chapter", back_populates="course", cascade="all, delete-orphan",
        order_by="Chapter.order_index"
    )

    # 关联关系: 课程下的所有文档
    documents: Mapped[List["Document"]] = relationship(
        "Document", back_populates="course", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Course(id={self.id}, name={self.name})>"


class Chapter(Base):
    """
    章节表
    课程下的章节结构, 支持排序
    """
    __tablename__ = "chapters"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属课程 ID
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )

    # 章节标题
    title: Mapped[str] = mapped_column(
        String(200), nullable=False
    )

    # 章节描述
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 排序序号: 控制章节展示顺序
    order_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 关联关系: 所属课程
    course: Mapped["Course"] = relationship(
        "Course", back_populates="chapters"
    )

    # 关联关系: 章节下的知识点
    knowledge_points: Mapped[List["KnowledgePoint"]] = relationship(
        "KnowledgePoint", back_populates="chapter", cascade="all, delete-orphan"
    )

    # 关联关系: 章节下的文档
    documents: Mapped[List["Document"]] = relationship(
        "Document", back_populates="chapter"
    )

    def __repr__(self) -> str:
        return f"<Chapter(id={self.id}, title={self.title})>"


class KnowledgePoint(Base):
    """
    知识点表
    每个章节下的具体知识点, 支持前置依赖关系
    """
    __tablename__ = "knowledge_points"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属章节 ID
    chapter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False
    )

    # 知识点名称
    title: Mapped[str] = mapped_column(
        String(200), nullable=False
    )

    # 知识点描述
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 知识点正文内容
    content: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 前置依赖知识点 ID: 指向另一个知识点(自引用), 表示学 A 之前需要先掌握 B
    prerequisite_kp_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True
    )

    # 难度等级: easy / medium / hard
    difficulty: Mapped[str] = mapped_column(
        String(20), nullable=False, default="medium"
    )

    # 来源类型: 标记知识点是手动创建还是 LLM 自动提取
    source_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="manual"
    )  # "manual" | "auto"

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 关联关系: 所属章节
    chapter: Mapped["Chapter"] = relationship(
        "Chapter", back_populates="knowledge_points"
    )

    # 关联关系: 前置依赖知识点
    prerequisite_kp: Mapped[Optional["KnowledgePoint"]] = relationship(
        "KnowledgePoint", remote_side=[id], backref="dependent_kps"
    )

    # 关联关系: 知识点关联的页面 (多对多)
    pages: Mapped[List["DocumentPage"]] = relationship(
        "DocumentPage",
        secondary="page_knowledge_points",
        back_populates="knowledge_points",
    )

    def __repr__(self) -> str:
        return f"<KnowledgePoint(id={self.id}, title={self.title})>"
