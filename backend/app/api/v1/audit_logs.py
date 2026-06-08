"""
操作日志查询路由
管理员可查看全部操作日志, 支持分页和过滤
路由前缀: /api/v1/audit-logs
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.audit_log import AuditLogResponse
from app.api.deps import get_current_admin_user

router = APIRouter(prefix="/audit-logs", tags=["操作日志"])


@router.get("/", response_model=ApiResponse[PaginatedResponse[AuditLogResponse]])
async def get_audit_logs(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    action: str = Query("", description="操作类型过滤 (login/register/update_profile 等)"),
    user_id: str = Query("", description="用户 ID 过滤"),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    """
    管理员: 获取操作日志列表
    支持按操作类型和用户ID过滤, 按时间倒序排列
    """
    # 构建查询 - 使用 LEFT JOIN 获取用户邮箱
    # 注意: 当前使用两次查询来获取 user_email, 以保持简单
    base_stmt = select(AuditLog)
    count_stmt = select(func.count(AuditLog.id))

    if action:
        base_stmt = base_stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)

    if user_id:
        base_stmt = base_stmt.where(AuditLog.user_id == user_id)
        count_stmt = count_stmt.where(AuditLog.user_id == user_id)

    # 总数
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # 分页查询
    offset = (page - 1) * page_size
    stmt = base_stmt.offset(offset).limit(page_size).order_by(AuditLog.created_at.desc())
    result = await db.execute(stmt)
    logs = result.scalars().all()

    # 收集所有 user_id 并批量查询邮箱
    user_ids = {log.user_id for log in logs if log.user_id is not None}
    user_email_map: dict = {}
    if user_ids:
        user_stmt = select(User.id, User.email).where(User.id.in_(user_ids))
        user_result = await db.execute(user_stmt)
        for row in user_result:
            user_email_map[row[0]] = row[1]

    # 构建响应
    items = []
    for log in logs:
        response = AuditLogResponse(
            id=log.id,
            user_id=log.user_id,
            user_email=user_email_map.get(log.user_id) if log.user_id else None,
            action=log.action,
            ip_address=log.ip_address,
            user_agent=log.user_agent,
            details=log.details,
            created_at=log.created_at,
        )
        items.append(response)

    total_pages = (total + page_size - 1) // page_size
    return ApiResponse(
        data=PaginatedResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )
    )
