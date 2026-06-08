"""
FastAPI 依赖注入模块
提供认证和权限校验的 Depends 函数
"""

import uuid
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User


# HTTP Bearer Token 认证方案
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    从请求的 Authorization Header 中解析 JWT Token 并返回当前登录用户
    未认证或 Token 无效时返回 401
    :param credentials: HTTP Bearer Token 凭据
    :param db: 数据库会话
    :return: 当前登录的 User 实例
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(status_code=401, detail="Token 无效: 缺少用户标识")
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Token 无效或已过期, 请重新登录")

    # 查询用户
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在或已被删除")

    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    获取当前活跃用户 (当前阶段不做额外校验, 直接返回)
    :param current_user: 当前登录用户
    :return: 当前用户
    """
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    确保当前用户是管理员, 否则返回 403
    :param current_user: 当前登录用户
    :return: 管理员用户
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return current_user


def get_client_info(request: Request) -> tuple[str | None, str | None]:
    """
    从 FastAPI Request 对象提取客户端 IP 和 User-Agent
    :param request: FastAPI Request 实例
    :return: (ip_address, user_agent) 元组
    """
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return ip, ua
