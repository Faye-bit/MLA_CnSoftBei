"""
操作审计日志服务
提供统一的日志记录接口, 供各个路由调用
"""

import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit_log import AuditLog
from loguru import logger


async def create_audit_log(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    action: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    details: dict | None = None,
) -> AuditLog:
    """
    创建一条操作审计日志
    :param db: 数据库会话
    :param user_id: 操作用户 ID (可为 None)
    :param action: 操作类型 (如 register / login / logout 等)
    :param ip_address: 客户端 IP 地址
    :param user_agent: 客户端 User-Agent
    :param details: 额外详情 (JSON 格式)
    :return: 创建的 AuditLog 实例
    """
    log_entry = AuditLog(
        user_id=user_id,
        action=action,
        ip_address=ip_address,
        user_agent=user_agent,
        details=details or {},
    )
    db.add(log_entry)
    await db.flush()

    logger.info(f"审计日志: user_id={user_id}, action={action}, ip={ip_address}")
    return log_entry
