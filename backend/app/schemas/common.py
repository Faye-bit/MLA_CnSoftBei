"""
通用 Schema
提供分页、统一响应格式等可复用的数据结构
"""

from typing import Generic, TypeVar, Optional
from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    """
    分页请求参数
    所有列表接口复用此分页模型
    """
    page: int = Field(default=1, ge=1, description="页码，从 1 开始")
    page_size: int = Field(default=20, ge=1, le=100, description="每页数量，最大 100")


class PaginatedResponse(BaseModel, Generic[T]):
    """
    统一分页响应格式
    items: 当前页数据列表
    total: 符合查询条件的总记录数
    page: 当前页码
    page_size: 每页数量
    total_pages: 总页数
    """
    items: list[T] = Field(default_factory=list, description="数据列表")
    total: int = Field(default=0, description="总记录数")
    page: int = Field(default=1, description="当前页码")
    page_size: int = Field(default=20, description="每页数量")
    total_pages: int = Field(default=0, description="总页数")


class ApiResponse(BaseModel, Generic[T]):
    """
    统一 API 响应格式
    code: 业务状态码, 0 表示成功
    message: 提示信息
    data: 响应数据
    """
    code: int = Field(default=0, description="状态码，0 表示成功")
    message: str = Field(default="success", description="提示信息")
    data: Optional[T] = Field(default=None, description="响应数据")

    model_config = {"from_attributes": True}
