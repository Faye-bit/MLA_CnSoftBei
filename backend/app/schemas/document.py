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
