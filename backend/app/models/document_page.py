"""
文档页面模型
包含 DocumentPage (文档页面) 和 PageKnowledgePoint (页面-知识点关联) 两张表
用于 PDF/PPTX 文件的页面级知识点索引, 替代 DocumentChunk 作为检索最小单元
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, Float, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class DocumentPage(Base):
    """
    文档页面表
    存储每页的渲染图片、LLM 摘要和提取到的知识点
    替代 DocumentChunk 作为 PDF/PPTX 文件的最小检索单元
    """
    __tablename__ = "document_pages"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属文档 ID
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )

    # 页码 (从 1 开始)
    page_number: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    # 页面预览图路径
    # 相对路径: uploads/{doc_id}/pages/page_{N}.png
    image_path: Mapped[str] = mapped_column(
        String(500), nullable=False
    )

    # LLM 生成的页面内容摘要 (一句话概括本页内容)
    summary: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # LLM 提取的知识点原始数据 (JSONB)
    # 格式: [{"title": "...", "description": "...", "difficulty": "medium"}, ...]
    # 作为中间结果保留, 供用户审核后正式创建 KnowledgePoint
    extracted_kps: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=list
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # ===== 关联关系 =====

    # 所属文档
    document: Mapped["Document"] = relationship(
        "Document", back_populates="pages"
    )

    # 多对多: 页面关联的正式知识点
    knowledge_points: Mapped[List["KnowledgePoint"]] = relationship(
        "KnowledgePoint",
        secondary="page_knowledge_points",
        back_populates="pages",
    )

    def __repr__(self) -> str:
        return f"<DocumentPage(id={self.id}, doc={self.document_id}, page={self.page_number})>"


class PageKnowledgePoint(Base):
    """
    页面-知识点关联表 (多对多)
    一个页面可以包含多个知识点
    一个知识点可以跨多个页面 (如"线性回归"跨 3-5 页)
    """
    __tablename__ = "page_knowledge_points"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 关联页面 ID
    document_page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_pages.id", ondelete="CASCADE"), nullable=False
    )

    # 关联知识点 ID
    knowledge_point_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )

    # 该知识点在此页面中的相关性权重
    # 如果一个知识点跨多页, 每页的 relevance 可以不同
    relevance: Mapped[float] = mapped_column(
        Float, nullable=False, default=1.0
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 唯一约束: 同一页面不能重复关联同一知识点
    __table_args__ = (
        UniqueConstraint("document_page_id", "knowledge_point_id", name="uq_page_kp"),
    )

    def __repr__(self) -> str:
        return f"<PageKnowledgePoint(page={self.document_page_id}, kp={self.knowledge_point_id})>"
