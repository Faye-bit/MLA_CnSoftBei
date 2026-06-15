"""
课程相关 Schema
包含课程(Course)、章节(Chapter)、知识点(KnowledgePoint)的请求和响应模型
"""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ==================== 课程 (Course) ====================

class CourseCreate(BaseModel):
    """ 创建课程请求 """
    name: str = Field(..., min_length=1, max_length=200, description="课程名称")
    description: Optional[str] = Field(default=None, description="课程描述")
    cover_image: Optional[str] = Field(default=None, max_length=500, description="封面图 URL")


class CourseUpdate(BaseModel):
    """ 更新课程请求 """
    name: Optional[str] = Field(default=None, min_length=1, max_length=200, description="课程名称")
    description: Optional[str] = Field(default=None, description="课程描述")
    cover_image: Optional[str] = Field(default=None, max_length=500, description="封面图 URL")


class CourseResponse(BaseModel):
    """ 课程响应 """
    id: uuid.UUID
    name: str
    description: Optional[str]
    cover_image: Optional[str]
    created_by: Optional[uuid.UUID]
    chapter_count: int = Field(default=0, description="章节数量")
    document_count: int = Field(default=0, description="文档数量")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CourseDetailResponse(CourseResponse):
    """ 课程详情响应 (含章节列表) """
    chapters: list["ChapterResponse"] = Field(default_factory=list, description="章节列表")


# ==================== 章节 (Chapter) ====================

class ChapterCreate(BaseModel):
    """ 创建章节请求 """
    title: str = Field(..., min_length=1, max_length=200, description="章节标题")
    description: Optional[str] = Field(default=None, description="章节描述")
    order_index: int = Field(default=0, ge=0, description="排序序号")


class ChapterUpdate(BaseModel):
    """ 更新章节请求 """
    title: Optional[str] = Field(default=None, min_length=1, max_length=200, description="章节标题")
    description: Optional[str] = Field(default=None, description="章节描述")
    order_index: Optional[int] = Field(default=None, ge=0, description="排序序号")


class ChapterResponse(BaseModel):
    """ 章节响应 """
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    description: Optional[str]
    order_index: int
    knowledge_point_count: int = Field(default=0, description="知识点数量")
    created_at: datetime

    model_config = {"from_attributes": True}


# ==================== 知识点 (KnowledgePoint) ====================

class KnowledgePointCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    content: Optional[str] = None
    prerequisite_kp_id: Optional[uuid.UUID] = None
    parent_kp_id: Optional[uuid.UUID] = None
    kp_type: str = Field(default="item", pattern="^(category|item)$")
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$")


class KnowledgePointUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    content: Optional[str] = None
    prerequisite_kp_id: Optional[uuid.UUID] = None
    parent_kp_id: Optional[uuid.UUID] = None
    kp_type: Optional[str] = Field(default=None, pattern="^(category|item)$")
    difficulty: Optional[str] = Field(default=None, pattern="^(easy|medium|hard)$")


class KnowledgePointResponse(BaseModel):
    id: uuid.UUID; chapter_id: uuid.UUID; title: str
    description: Optional[str] = None; content: Optional[str] = None
    prerequisite_kp_id: Optional[uuid.UUID] = None
    parent_kp_id: Optional[uuid.UUID] = None
    kp_type: str = "item"; difficulty: str; created_at: datetime
    model_config = {"from_attributes": True}


class LinkedPageInfo(BaseModel):
    """ 知识点关联的文档页面信息 (用于在知识点详情弹窗中展示) """
    page_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    page_number: int
    image_url: str
    summary: Optional[str] = None


class KnowledgePointTreeNode(BaseModel):
    """ 树节点: category 为根, item 为子 """
    id: uuid.UUID; chapter_id: uuid.UUID; title: str
    description: Optional[str] = None; content: Optional[str] = None
    prerequisite_kp_id: Optional[uuid.UUID] = None
    parent_kp_id: Optional[uuid.UUID] = None
    kp_type: str = "item"; difficulty: str; created_at: datetime
    children: list["KnowledgePointTreeNode"] = Field(default_factory=list)
    linked_pages: list[LinkedPageInfo] = Field(default_factory=list)
    model_config = {"from_attributes": True}
