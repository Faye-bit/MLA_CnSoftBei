"""
对话相关 Schema
对话和消息的请求与响应模型
"""

import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ConversationCreate(BaseModel):
    """ 创建对话请求 """
    course_id: Optional[uuid.UUID] = Field(default=None, description="关联课程 ID, 知识库对话模式必选")
    title: str = Field(default="新对话", max_length=200, description="对话标题")
    conversation_type: str = Field(default="chat", pattern="^(chat|profile_collection)$", description="对话类型: chat=知识库对话 / profile_collection=画像收集")


class ConversationUpdate(BaseModel):
    """ 更新对话请求 """
    title: Optional[str] = Field(default=None, max_length=200, description="新标题")


class ConversationResponse(BaseModel):
    """ 对话响应 (列表项) """
    id: uuid.UUID
    user_id: uuid.UUID
    course_id: Optional[uuid.UUID] = None
    title: str
    conversation_type: str
    profile_collection_stage: Optional[str] = None
    message_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ConversationDetailResponse(BaseModel):
    """ 对话详情 (含消息列表) """
    id: uuid.UUID
    user_id: uuid.UUID
    course_id: Optional[uuid.UUID] = None
    title: str
    conversation_type: str
    profile_collection_stage: Optional[str] = None
    messages: list["MessageResponse"] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    """ 消息响应 """
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    sources: Optional[list[dict]] = None
    message_metadata: Optional[dict] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SendMessageRequest(BaseModel):
    """ 发送消息请求 (普通 HTTP) """
    content: str = Field(..., min_length=1, max_length=10000, description="消息内容")
    course_id: Optional[uuid.UUID] = Field(default=None, description="关联课程 ID (知识库对话), 优先使用对话级课程")
