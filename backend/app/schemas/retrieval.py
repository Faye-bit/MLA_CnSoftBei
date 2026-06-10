"""
检索相关 Schema
RAG 语义检索的请求和响应模型
Phase 2 增强: 支持 LLM 二次加工、阈值过滤、章节/知识点关联、关键词高亮
"""

import uuid
from typing import Optional
from pydantic import BaseModel, Field


class RetrievalRequest(BaseModel):
    """ RAG 检索请求 """
    query: str = Field(..., min_length=1, max_length=1000, description="检索查询文本")
    course_id: uuid.UUID = Field(..., description="课程 ID，限定检索范围")
    top_k: int = Field(default=5, ge=1, le=20, description="返回结果数量")

    # Phase 2 新增字段
    enhance: bool = Field(
        default=False,
        description="是否启用 LLM 增强处理。开启后将对检索结果进行二次加工: 提取核心观点、标注关键词、合并去重。会增加 2-5 秒处理时间"
    )
    similarity_threshold: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="相似度阈值 (0.0-1.0)。低于此分数的检索结果将被过滤隐藏。默认 0.0 表示不过滤"
    )


class RetrievalResultItem(BaseModel):
    """ 单条检索结果 (Phase 2 扩展版本) """
    # 基础字段
    chunk_id: uuid.UUID = Field(..., description="切片 ID")
    document_id: uuid.UUID = Field(..., description="来源文档 ID")
    document_filename: str = Field(..., description="来源文件名")
    content: str = Field(..., description="切片文本内容 (已清洗)")
    score: float = Field(..., description="相似度分数 (0.0-1.0)")
    chunk_index: int = Field(..., description="切片序号")
    metadata: Optional[dict] = Field(default=None, description="切片元数据(页码、章节标题等)")

    # Phase 2 新增: 来源结构化上下文
    chapter_title: Optional[str] = Field(default=None, description="来源章节标题")
    chapter_id: Optional[uuid.UUID] = Field(default=None, description="来源章节 ID")
    knowledge_point_title: Optional[str] = Field(default=None, description="关联知识点标题")
    knowledge_point_id: Optional[uuid.UUID] = Field(default=None, description="关联知识点 ID")

    # Phase 2 新增: LLM 增强结果
    enhanced_summary: Optional[str] = Field(default=None, description="LLM 增强摘要 (核心观点, 一句话概括)")
    keywords: list[str] = Field(default_factory=list, description="LLM 提取的关键词列表 (2-4个)")
    highlights: list[dict] = Field(
        default_factory=list,
        description="查询关键词高亮位置列表 [{keyword, positions: [[start,end], ...]}]"
    )


class RetrievalResponse(BaseModel):
    """ RAG 检索响应 (Phase 2 扩展版本) """
    query: str = Field(..., description="原始查询文本")
    course_id: uuid.UUID = Field(..., description="检索课程 ID")
    results: list[RetrievalResultItem] = Field(default_factory=list, description="检索结果列表")
    total: int = Field(default=0, description="返回结果数量")

    # Phase 2 新增
    enhanced: bool = Field(default=False, description="是否使用了 LLM 增强处理")
    deduplicated_count: int = Field(default=0, description="被 AI 自动去重合并的结果数量")
