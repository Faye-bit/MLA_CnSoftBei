"""
学生画像相关 Schema
画像的请求与响应模型
"""

import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    """
    画像更新请求
    前端可以只传入需要更新的维度数据, 后端做增量合并
    """
    profile_data: Optional[dict] = Field(default=None, description="要更新的画像维度数据 (部分更新)")
    summary: Optional[str] = Field(default=None, description="画像摘要")


class ProfileExtractionRequest(BaseModel):
    """ 从对话中提取画像请求 """
    conversation_id: uuid.UUID = Field(..., description="用于提取画像的对话 ID")


class ProfileResponse(BaseModel):
    """ 画像响应 """
    id: uuid.UUID
    user_id: uuid.UUID
    profile_data: dict = Field(default_factory=dict, description="描述式画像数据 (6个维度, 每维度为自然语言字符串)")
    missing_fields: list[str] = Field(default_factory=list, description="尚未收集的维度")
    summary: Optional[str] = Field(default=None, description="画像摘要文本")
    memories: list[str] = Field(default_factory=list, description="后台自动提取的记忆片段")
    version: int = Field(default=1, description="画像版本号")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ProfileVersionResponse(BaseModel):
    """ 画像版本历史项 """
    version: int
    created_at: Optional[datetime] = None
    summary: Optional[str] = None
