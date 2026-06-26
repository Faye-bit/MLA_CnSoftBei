"""
LLM 共享工具模块
提供项目中多处复用的 LLM 客户端创建、JSON 解析和 SSE 格式化函数
避免在各 service 文件中重复定义相同逻辑
"""

import json
from openai import AsyncOpenAI
from app.services.config_service import get_config_value
from loguru import logger


# ============================================================================
# LLM 客户端创建
# ============================================================================

def create_llm_client() -> AsyncOpenAI:
    """
    根据运行时配置创建 OpenAI 兼容的异步 LLM 客户端

    使用 config_service 中存储的 API key 和 base URL，
    支持任意 OpenAI 兼容接口（DeepSeek、Qwen 等）

    :return: 配置好的 AsyncOpenAI 客户端实例
    """
    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    return AsyncOpenAI(api_key=api_key, base_url=api_base)


def get_llm_model() -> str:
    """
    从运行时配置获取当前 LLM 模型名称

    :return: 模型名称字符串（如 deepseek-chat、qwen-plus 等）
    """
    return get_config_value("llm_model")


# ============================================================================
# SSE 事件格式化
# ============================================================================

def sse_event(event_type: str, data: dict) -> str:
    """
    将事件数据格式化为 SSE (Server-Sent Events) 标准格式

    :param event_type: 事件类型标识（如 content、sources、done、error、agent_update）
    :param data:     事件携带的数据字典
    :return:         格式化后的 SSE 字符串（以 \\n\\n 结尾）
    """
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


# ============================================================================
# JSON 解析
# ============================================================================

def parse_json_output(raw: str) -> dict | list:
    """
    鲁棒的 JSON 解析器，处理 LLM 输出的常见格式问题

    处理策略:
    1. 去除 markdown 代码块包裹 (```json ... ```)
    2. 尝试直接 json.loads 解析
    3. 失败时查找 JSON 数组 [ ... ] 或对象 { ... } 边界后重试
    4. 仍失败时返回空 {} 并记录警告

    :param raw: LLM 原始输出字符串
    :return:    解析后的 dict 或 list，失败时返回 {}
    """
    raw = raw.strip()

    # 去除 markdown 代码块包裹
    if raw.startswith("```json"):
        raw = raw[7:]
    elif raw.startswith("```"):
        raw = raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    # 尝试直接解析
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON 数组或对象边界
    for boundary in [("[", "]"), ("{", "}")]:
        start = raw.find(boundary[0])
        end = raw.rfind(boundary[1])
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                pass

    logger.warning(f"JSON 解析失败: {raw[:200]}")
    return {}
