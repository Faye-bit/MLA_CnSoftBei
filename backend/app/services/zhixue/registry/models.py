"""
Agent Registry 数据模型
定义 AgentRecord 和 AgentStatus, 用于 Python 代码注册 (Phase 1-2) 和 YAML 加载 (Phase 3)
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RetryPolicy(BaseModel):
    """Agent 重试策略"""
    max_retries: int = Field(default=1, ge=0, le=3)
    backoff: Literal["fixed", "exponential", "none"] = "fixed"
    backoff_seconds: int = Field(default=5)


class AgentRecord(BaseModel):
    """Agent 注册记录 — 描述一个 Agent 的完整信息"""

    # 核心标识
    agent_code: str = Field(
        ..., description="唯一代号, 如 'profile_analyst'"
    )
    agent_name: str = Field(
        ..., description="正式名称, 如 '学情诊断师俞知'"
    )
    version: str = Field(default="1.0.0")

    # 功能描述
    description: str = ""

    # 状态
    status: Literal["active", "inactive", "degraded"] = "active"

    # 依赖
    dependencies: list[str] = Field(default_factory=list)

    # 超时与重试
    timeout_seconds: int = Field(default=120, ge=10, le=600)
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)

    # 分类标签
    tags: list[str] = Field(default_factory=list)

    # 元信息
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
