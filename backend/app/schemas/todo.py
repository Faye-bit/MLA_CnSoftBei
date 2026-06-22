"""
自定义待办 Schema
定义待办创建/更新/响应的 Pydantic 模型
"""

from typing import Optional
from pydantic import BaseModel, Field


class TodoCreate(BaseModel):
    """
    创建待办请求
    只需要标题, 其余字段由后端自动填充
    """
    title: str = Field(..., min_length=1, max_length=500, description="待办标题")


class TodoUpdate(BaseModel):
    """
    更新待办请求
    所有字段均为可选, 仅更新传入的字段
    """
    title: Optional[str] = Field(None, min_length=1, max_length=500, description="待办标题")
    is_completed: Optional[bool] = Field(None, description="是否已完成")


class TodoResponse(BaseModel):
    """
    待办响应
    包含完整的待办信息, 用于列表和详情展示
    """
    id: str = Field(..., description="待办 UUID")
    title: str = Field(..., description="待办标题")
    is_completed: bool = Field(..., description="是否已完成")
    completed_at: Optional[str] = Field(None, description="完成时间 ISO 格式")
    created_at: Optional[str] = Field(None, description="创建时间 ISO 格式")
    updated_at: Optional[str] = Field(None, description="更新时间 ISO 格式")

    model_config = {"from_attributes": True}
