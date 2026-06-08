"""
认证路由
处理注册、登录、邮箱验证码、密码重置等认证相关接口
路由前缀: /api/v1/auth
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.models.user import User
from app.schemas.common import ApiResponse
from app.schemas.auth import (
    SendCodeRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.schemas.user import UserResponse
from app.services.email_service import generate_and_send_code, verify_code
from app.services.audit_service import create_audit_log
from app.api.deps import get_current_user, get_client_info
from loguru import logger

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/send-code", response_model=ApiResponse[None])
async def send_code(
    body: SendCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    发送邮箱验证码
    用于注册和密码重置前的身份验证
    """
    success, message = await generate_and_send_code(db, body.email, body.purpose)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return ApiResponse(message=message)


@router.post("/register", response_model=ApiResponse[UserResponse])
async def register(
    body: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    用户注册
    先校验邮箱验证码, 然后检查邮箱和用户名唯一性, 最后创建用户
    """
    # 1. 校验验证码
    valid, msg = await verify_code(db, body.email, body.verification_code, "register")
    if not valid:
        raise HTTPException(status_code=400, detail=msg)

    # 2. 检查邮箱是否已被注册
    stmt = select(User).where(User.email == body.email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    # 3. 检查用户名是否已被使用
    stmt = select(User).where(User.username == body.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="该用户名已被使用")

    # 4. 创建用户
    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        nickname=body.full_name,  # 默认昵称为真实姓名
        school=body.school,
        major=body.major,
        grade=body.grade,
        education_level=body.education_level,
        role=body.role,
        email_verified=True,  # 已验证通过验证码, 直接标记为已验证
        avatar=None,
    )
    db.add(user)
    await db.commit()

    # 5. 记录操作日志
    ip, ua = get_client_info(request)
    await create_audit_log(
        db, user.id, "register",
        ip_address=ip, user_agent=ua,
        details={"email": body.email, "role": body.role},
    )

    logger.info(f"新用户注册: {body.email}, 角色: {body.role}")
    return ApiResponse(data=UserResponse.model_validate(user), message="注册成功")


@router.post("/login", response_model=ApiResponse[TokenResponse])
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    用户登录
    验证邮箱和密码后返回 JWT Token 和用户信息
    """
    # 1. 查找用户
    stmt = select(User).where(User.email == body.email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    # 2. 验证密码
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    # 3. 生成 JWT Token
    token = create_access_token(
        data={"sub": str(user.id), "role": user.role}
    )

    # 4. 记录操作日志
    ip, ua = get_client_info(request)
    await create_audit_log(
        db, user.id, "login",
        ip_address=ip, user_agent=ua,
    )

    logger.info(f"用户登录: {body.email}")
    return ApiResponse(
        data=TokenResponse(
            access_token=token,
            token_type="bearer",
            user=UserResponse.model_validate(user),
        ),
        message="登录成功",
    )


@router.post("/logout", response_model=ApiResponse[None])
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    用户登出
    记录操作日志, 客户端负责清除本地 Token
    """
    ip, ua = get_client_info(request)
    await create_audit_log(
        db, current_user.id, "logout",
        ip_address=ip, user_agent=ua,
    )
    logger.info(f"用户登出: {current_user.email}")
    return ApiResponse(message="已退出登录")


@router.post("/reset-password", response_model=ApiResponse[None])
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    重置密码
    通过邮箱验证码验证身份后, 修改密码
    """
    # 1. 校验验证码
    valid, msg = await verify_code(db, body.email, body.verification_code, "reset_password")
    if not valid:
        raise HTTPException(status_code=400, detail=msg)

    # 2. 查找用户
    stmt = select(User).where(User.email == body.email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="该邮箱未注册")

    # 3. 更新密码
    user.password_hash = hash_password(body.new_password)
    await db.commit()

    # 4. 记录操作日志
    ip, ua = get_client_info(request)
    await create_audit_log(
        db, user.id, "reset_password",
        ip_address=ip, user_agent=ua,
    )

    logger.info(f"用户密码已重置: {body.email}")
    return ApiResponse(message="密码重置成功, 请使用新密码登录")
