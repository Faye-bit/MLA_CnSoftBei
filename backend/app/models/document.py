"""
文档模型
包含文档(Document)和文档切片(DocumentChunk)两张表
用于管理上传的课程资料及其解析后的文本切片
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Document(Base):
    """
    文档表
    记录用户上传的课程资料文件及其解析状态
    """
    __tablename__ = "documents"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属课程 ID
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )

    # 所属章节 ID (可选, 用于将文档绑定到特定章节, 上传时可指定)
    chapter_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )

    # 原始文件名
    filename: Mapped[str] = mapped_column(
        String(255), nullable=False
    )

    # 文件类型: pdf / docx / pptx / md / txt
    file_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )

    # 文件大小 (字节)
    file_size: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 文件存储路径 (相对于 upload_dir)
    file_path: Mapped[str] = mapped_column(
        String(500), nullable=False
    )

    # 解析状态: pending / processing / done / failed
    parse_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )

    # 切片数量 (解析完成后填充, 仅用于 DOCX/MD/TXT 等文本文件)
    chunk_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 页面数量 (解析完成后填充, 用于 PDF/PPTX 文件)
    page_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 提取到的知识点数量 (解析完成后填充)
    kp_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 错误信息 (解析失败时记录)
    error_message: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # 关联关系: 所属课程
    course: Mapped["Course"] = relationship(
        "Course", back_populates="documents"
    )

    # 关联关系: 所属章节 (可选)
    chapter: Mapped[Optional["Chapter"]] = relationship(
        "Chapter", back_populates="documents"
    )

    # 关联关系: 文档下的所有切片 (仅用于 DOCX/MD/TXT 等文本文件)
    chunks: Mapped[List["DocumentChunk"]] = relationship(
        "DocumentChunk", back_populates="document", cascade="all, delete-orphan",
        order_by="DocumentChunk.chunk_index"
    )

    # 关联关系: 文档下的所有页面 (用于 PDF/PPTX 文件)
    pages: Mapped[List["DocumentPage"]] = relationship(
        "DocumentPage", back_populates="document", cascade="all, delete-orphan",
        order_by="DocumentPage.page_number"
    )

    def __repr__(self) -> str:
        return f"<Document(id={self.id}, filename={self.filename}, status={self.parse_status})>"


class DocumentChunk(Base):
    """
    文档切片表
    存储文档解析后切分的文本片段, 用于向量检索
    """
    __tablename__ = "document_chunks"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属文档 ID
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )

    # 关联知识点 ID (可选, 后续可通过语义匹配自动关联)
    knowledge_point_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True
    )

    # 切片序号: 在文档中的顺序
    chunk_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 切片文本内容
    content: Mapped[str] = mapped_column(
        Text, nullable=False
    )

    # 元数据: JSONB 格式, 存储页码、章节标题、段落标题等
    chunk_metadata: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=dict
    )

    # Token 数量估算
    token_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 关联关系: 所属文档
    document: Mapped["Document"] = relationship(
        "Document", back_populates="chunks"
    )

    def __repr__(self) -> str:
        return f"<DocumentChunk(id={self.id}, document_id={self.document_id}, index={self.chunk_index})>"
