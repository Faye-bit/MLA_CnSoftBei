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
    web_links: Optional[list[dict]] = Field(default=None, description="联网搜索结果链接列表")

    model_config = {"from_attributes": True}

    @classmethod
    def model_validate_message(cls, msg) -> "MessageResponse":
        """
        从 ORM Message 对象构建响应，自动从 message_metadata 中提取 web_links 到顶层。

        这样前端 msg.web_links 可直接使用，无需手动解析 message_metadata。
        """
        import json

        # 处理 message_metadata: 可能是 dict 或 JSON 字符串
        metadata = msg.message_metadata
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                metadata = None

        # 从 metadata 中提取 web_links 和 image_urls（若存在则提升至顶层）
        web_links = None
        image_urls = None
        if isinstance(metadata, dict):
            web_links = metadata.get("web_links")
            image_urls = metadata.get("image_urls")

        return cls(
            id=msg.id,
            conversation_id=msg.conversation_id,
            role=msg.role,
            content=msg.content,
            sources=msg.sources,
            message_metadata=metadata,
            created_at=msg.created_at,
            web_links=web_links,
            image_urls=image_urls,
        )


class SendMessageRequest(BaseModel):
    """ 发送消息请求 (普通 HTTP) """
    content: str = Field(..., min_length=1, max_length=10000, description="消息内容")
    course_id: Optional[uuid.UUID] = Field(default=None, description="关联课程 ID (知识库对话), 优先使用对话级课程")
    system_prompt: Optional[str] = Field(default=None, description="自定义 System Prompt (如 Live2D 伙伴聊天), 传入则覆盖默认")
    quick_ask_context: Optional[dict] = Field(default=None, description="快问AI上下文: {source_type, kp_id, course_id, chapter_id, document_id, context_text}")
    web_search_enabled: bool = Field(default=False, description="是否开启联网搜索, 搜索知乎/B站/小红书等中文知识平台")
    image_urls: Optional[list[str]] = Field(default=None, description="图片 URL 列表 (多模态模型), 如 ['/api/v1/chat/images/.../abc.png']")
