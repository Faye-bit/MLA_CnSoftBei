"""
审计日志 Schema
包含操作日志的 Pydantic 响应模型
"""

from typing import Optional
import uuid
from datetime import datetime
from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    """
    操作日志响应
    包含操作者邮箱、操作类型、IP 等完整信息
    """
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    user_email: Optional[str] = None
    action: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    details: Optional[dict] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
