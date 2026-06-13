"""
文档相关 Schema
包含文档(Document)和文档切片(DocumentChunk)的请求和响应模型
"""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class DocumentResponse(BaseModel):
    """ 文档响应 (列表和详情共用) """
    id: uuid.UUID
    course_id: uuid.UUID
    filename: str
    file_type: str
    file_size: int
    file_path: str
    parse_status: str
    chunk_count: int
    page_count: int = 0
    kp_count: int = 0
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentChunkResponse(BaseModel):
    """ 文档切片响应 """
    id: uuid.UUID
    document_id: uuid.UUID
    knowledge_point_id: Optional[uuid.UUID]
    chunk_index: int
    content: str
    chunk_metadata: Optional[dict]
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentDetailResponse(DocumentResponse):
    """ 文档详情响应 (含切片列表) """
    chunks: list[DocumentChunkResponse] = Field(default_factory=list, description="切片列表")


class DocumentUploadResponse(BaseModel):
    """ 文档上传响应 """
    document_id: uuid.UUID = Field(..., description="文档 ID")
    filename: str = Field(..., description="原始文件名")
    file_type: str = Field(..., description="文件类型")
    file_size: int = Field(..., description="文件大小 (字节)")
    parse_status: str = Field(..., description="解析状态")
    message: str = Field(default="文件上传成功，正在解析中...", description="提示信息")


class DocumentPageResponse(BaseModel):
    """ 文档页面响应 (用于 PDF/PPTX 文档的页面级展示) """
    id: uuid.UUID = Field(..., description="页面 ID")
    page_number: int = Field(..., description="页码 (从 1 开始)")
    image_url: str = Field(..., description="页面图片访问 URL")
    summary: Optional[str] = Field(default=None, description="LLM 生成的页面内容摘要")
    extracted_kps: list[dict] = Field(
        default_factory=list,
        description="LLM 提取的知识点原始数据 [{title, description, difficulty}, ...]"
    )
    linked_kp_ids: list[str] = Field(
        default_factory=list,
        description="已关联的正式知识点 ID 列表"
    )
    created_at: datetime = Field(..., description="创建时间")

    model_config = {"from_attributes": True}


class PageKnowledgePointLinkRequest(BaseModel):
    """ 页面关联知识点请求 """
    knowledge_point_ids: list[uuid.UUID] = Field(
        ..., min_length=1, description="要关联的知识点 ID 列表"
    )


class DocumentDetailResponse(DocumentResponse):
    """ 文档详情响应 (根据 file_type 返回 pages 或 chunks) """
    chunks: list[DocumentChunkResponse] = Field(default_factory=list, description="切片列表 (DOCX/MD/TXT)")
    pages: list[DocumentPageResponse] = Field(default_factory=list, description="页面列表 (PDF/PPTX)")
