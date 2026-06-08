"""
用户管理路由
处理个人资料、头像上传和管理员用户管理接口
路由前缀: /api/v1/users
"""

import uuid
import os
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Request
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.config import settings
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.user import (
    UserResponse,
    UserProfileUpdate,
    AvatarUploadResponse,
    UserAdminUpdate,
)
from app.services.audit_service import create_audit_log
from app.api.deps import get_current_user, get_current_admin_user, get_client_info
from loguru import logger

router = APIRouter(prefix="/users", tags=["用户管理"])


# ==================== 个人资料接口 ====================

@router.get("/me", response_model=ApiResponse[UserResponse])
async def get_my_profile(
    current_user: User = Depends(get_current_user),
):
    """ 获取当前登录用户的个人信息 """
    return ApiResponse(data=UserResponse.model_validate(current_user))


@router.put("/me", response_model=ApiResponse[UserResponse])
async def update_my_profile(
    body: UserProfileUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    更新当前用户的个人资料
    仅可修改姓名、昵称、学校等非敏感字段
    """
    # 只更新传入的非 None 字段
    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    for field, value in update_data.items():
        setattr(current_user, field, value)

    await db.commit()

    # 记录操作日志
    ip, ua = get_client_info(request)
    await create_audit_log(
        db, current_user.id, "update_profile",
        ip_address=ip, user_agent=ua,
        details={"updated_fields": list(update_data.keys())},
    )

    logger.info(f"用户资料已更新: {current_user.email}")
    return ApiResponse(data=UserResponse.model_validate(current_user), message="资料更新成功")


@router.post("/me/avatar", response_model=ApiResponse[AvatarUploadResponse])
async def upload_avatar(
    file: UploadFile = File(..., description="头像图片文件"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    上传用户头像
    支持 jpg/png/gif/webp 格式, 最大 2MB
    """
    # 校验文件类型
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="仅支持 JPG/PNG/GIF/WebP 格式的图片")

    # 创建头像存储目录
    avatars_dir = Path(settings.upload_dir) / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    # 生成唯一文件名: user_id_timestamp.ext
    ext = file.filename.split(".")[-1].lower() if file.filename and "." in file.filename else "png"
    safe_ext = ext if ext in ("jpg", "jpeg", "png", "gif", "webp") else "png"
    filename = f"{current_user.id}_{int(time.time() * 1000)}.{safe_ext}"
    file_path = avatars_dir / filename

    # 保存文件
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:  # 2MB 限制
        raise HTTPException(status_code=400, detail="头像文件不能超过 2MB")
    with open(file_path, "wb") as f:
        f.write(content)

    # 更新用户头像路径
    avatar_url = f"/uploads/avatars/{filename}"
    current_user.avatar = avatar_url
    await db.commit()

    # 记录操作日志
    await create_audit_log(
        db, current_user.id, "upload_avatar",
    )

    logger.info(f"用户头像已更新: {current_user.email}")
    return ApiResponse(
        data=AvatarUploadResponse(avatar_url=avatar_url, message="头像上传成功")
    )


# ==================== 管理员接口 ====================

@router.get("/", response_model=ApiResponse[PaginatedResponse[UserResponse]])
async def get_user_list(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    keyword: str = Query("", description="搜索关键词 (邮箱/用户名/姓名)"),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    """
    管理员: 获取所有用户列表 (分页+搜索)
    """
    # 构建查询
    base_stmt = select(User)
    count_stmt = select(func.count(User.id))

    if keyword:
        like_pattern = f"%{keyword}%"
        filter_condition = or_(
            User.email.ilike(like_pattern),
            User.username.ilike(like_pattern),
            User.full_name.ilike(like_pattern),
        )
        base_stmt = base_stmt.where(filter_condition)
        count_stmt = count_stmt.where(filter_condition)

    # 总数
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # 分页
    offset = (page - 1) * page_size
    stmt = base_stmt.offset(offset).limit(page_size).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()

    total_pages = (total + page_size - 1) // page_size
    return ApiResponse(
        data=PaginatedResponse(
            items=[UserResponse.model_validate(u) for u in users],
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )
    )


@router.get("/{user_id}", response_model=ApiResponse[UserResponse])
async def get_user_detail(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    """
    管理员: 查看单个用户详情
    """
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return ApiResponse(data=UserResponse.model_validate(user))


@router.put("/{user_id}", response_model=ApiResponse[UserResponse])
async def admin_update_user(
    user_id: uuid.UUID,
    body: UserAdminUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    """
    管理员: 更新用户信息 (包括角色和邮箱验证状态)
    """
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    for field, value in update_data.items():
        setattr(user, field, value)
    await db.commit()

    ip, ua = get_client_info(request)
    await create_audit_log(
        db, current_admin.id, "admin_update_user",
        ip_address=ip, user_agent=ua,
        details={"target_user_id": str(user_id), "updated_fields": list(update_data.keys())},
    )

    logger.info(f"管理员 {current_admin.email} 更新了用户 {user.email}")
    return ApiResponse(data=UserResponse.model_validate(user), message="用户信息更新成功")


@router.delete("/{user_id}", response_model=ApiResponse[None])
async def admin_delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    """
    管理员: 删除用户
    """
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 防止管理员删除自己
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")

    await db.delete(user)
    await db.commit()

    ip, ua = get_client_info(request)
    await create_audit_log(
        db, current_admin.id, "admin_delete_user",
        ip_address=ip, user_agent=ua,
        details={"target_user_id": str(user_id), "target_email": user.email},
    )

    logger.info(f"管理员 {current_admin.email} 删除了用户 {user.email}")
    return ApiResponse(message="用户已删除")
