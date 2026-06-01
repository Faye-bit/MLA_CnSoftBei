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
    """ 创建知识点请求 """
    title: str = Field(..., min_length=1, max_length=200, description="知识点名称")
    description: Optional[str] = Field(default=None, description="知识点描述")
    content: Optional[str] = Field(default=None, description="知识点正文内容")
    prerequisite_kp_id: Optional[uuid.UUID] = Field(default=None, description="前置依赖知识点 ID")
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$", description="难度等级")


class KnowledgePointUpdate(BaseModel):
    """ 更新知识点请求 """
    title: Optional[str] = Field(default=None, min_length=1, max_length=200, description="知识点名称")
    description: Optional[str] = Field(default=None, description="知识点描述")
    content: Optional[str] = Field(default=None, description="知识点正文内容")
    prerequisite_kp_id: Optional[uuid.UUID] = Field(default=None, description="前置依赖知识点 ID")
    difficulty: Optional[str] = Field(default=None, pattern="^(easy|medium|hard)$", description="难度等级")


class KnowledgePointResponse(BaseModel):
    """ 知识点响应 """
    id: uuid.UUID
    chapter_id: uuid.UUID
    title: str
    description: Optional[str]
    content: Optional[str]
    prerequisite_kp_id: Optional[uuid.UUID]
    difficulty: str
    created_at: datetime

    model_config = {"from_attributes": True}
