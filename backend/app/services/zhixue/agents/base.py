"""
Agent 基类 — AgentHandler Protocol 定义
所有 Agent 必须遵循此接口: async def run(state: ZhiXueState, **kwargs) -> dict
"""

from typing import Protocol, runtime_checkable

from app.services.zhixue.state import ZhiXueState


@runtime_checkable
class AgentHandler(Protocol):
    """
    Agent 处理器协议

    所有 Agent 的入口函数遵循此签名:
        async def run(state: ZhiXueState, **kwargs) -> dict

    参数:
        state: 完整的 LangGraph State (只读所需字段)
        **kwargs: 额外参数 (如 Send API 传递的 material_type)

    返回:
        dict: 仅包含该 Agent 负责更新的 State 字段, LangGraph 自动合并

    异常:
        AgentError: 可恢复错误 (触发重试)
        AgentFatalError: 不可恢复错误 (触发向南兜底)
    """

    async def __call__(self, state: ZhiXueState, **kwargs) -> dict:
        ...


# ============================================================================
# Agent 异常层次
# ============================================================================

class AgentError(Exception):
    """Agent 基类异常 — 可恢复"""
    def __init__(self, message: str, agent_code: str = ""):
        super().__init__(message)
        self.agent_code = agent_code
        self.retryable = True


class AgentTimeoutError(AgentError):
    """Agent 执行超时"""


class AgentFatalError(AgentError):
    """不可恢复错误 — 触发向南兜底"""
    def __init__(self, message: str, agent_code: str = ""):
        super().__init__(message, agent_code)
        self.retryable = False


class AgentUnavailableError(AgentFatalError):
    """Agent 不可用 (Registry 中 status != active)"""
