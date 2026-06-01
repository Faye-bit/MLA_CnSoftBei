"""
检索相关 Schema
RAG 语义检索的请求和响应模型
"""

import uuid
from typing import Optional
from pydantic import BaseModel, Field


class RetrievalRequest(BaseModel):
    """ RAG 检索请求 """
    query: str = Field(..., min_length=1, max_length=1000, description="检索查询文本")
    course_id: uuid.UUID = Field(..., description="课程 ID，限定检索范围")
    top_k: int = Field(default=5, ge=1, le=20, description="返回结果数量")


class RetrievalResultItem(BaseModel):
    """ 单条检索结果 """
    chunk_id: uuid.UUID = Field(..., description="切片 ID")
    document_id: uuid.UUID = Field(..., description="来源文档 ID")
    document_filename: str = Field(..., description="来源文件名")
    content: str = Field(..., description="切片文本内容")
    score: float = Field(..., description="相似度分数")
    chunk_index: int = Field(..., description="切片序号")
    metadata: Optional[dict] = Field(default=None, description="切片元数据(页码、章节标题等)")


class RetrievalResponse(BaseModel):
    """ RAG 检索响应 """
    query: str = Field(..., description="原始查询文本")
    course_id: uuid.UUID = Field(..., description="检索课程 ID")
    results: list[RetrievalResultItem] = Field(default_factory=list, description="检索结果列表")
    total: int = Field(default=0, description="返回结果数量")
