"""
自定义待办 API 端点
提供待办的创建、查询、更新和删除接口
所有端点均需要用户认证, 数据 user-scoped 隔离
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.models.todo import Todo
from app.schemas.common import ApiResponse
from app.schemas.todo import TodoCreate, TodoUpdate, TodoResponse
from app.api.deps import get_current_user

router = APIRouter(prefix="/todos", tags=["自定义待办"])


# ============================================================================
# 辅助函数: 所有权验证
# ============================================================================

async def _get_owned_todo(
    todo_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Todo:
    """
    获取待办并验证所有权, 不存在或无权限时抛出 404

    :param todo_id: 待办 ID
    :param user: 当前用户
    :param db: 数据库会话
    :return: 待办对象
    """
    todo = await db.get(Todo, todo_id)
    if not todo or todo.user_id != user.id:
        raise HTTPException(status_code=404, detail="待办不存在")
    return todo


# ============================================================================
# 待办 CRUD 端点
# ============================================================================

@router.post("/", response_model=ApiResponse[TodoResponse], summary="创建自定义待办")
async def create_todo(
    data: TodoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    创建一个新的自定义待办
    待办默认为未完成状态, 属于当前登录用户
    """
    todo = Todo(
        user_id=current_user.id,
        title=data.title.strip(),
        is_completed=False,
    )
    db.add(todo)
    await db.commit()
    await db.refresh(todo)

    return ApiResponse(data=_serialize_todo(todo))


@router.get("/", response_model=ApiResponse[list[TodoResponse]], summary="获取自定义待办列表")
async def get_todos(
    is_completed: bool | None = Query(None, description="过滤完成状态: true=已完成, false=未完成, 不传=全部"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取当前用户的自定义待办列表
    默认按创建时间升序排列, 支持按完成状态过滤
    """
    query = select(Todo).where(Todo.user_id == current_user.id)

    if is_completed is not None:
        # 已完成: 按完成时间倒序; 未完成: 按创建时间升序
        if is_completed:
            query = query.where(Todo.is_completed == True).order_by(Todo.completed_at.desc().nullslast())
        else:
            query = query.where(Todo.is_completed == False).order_by(Todo.created_at.asc())
    else:
        # 全部: 未完成的在前, 已完成的在后
        query = query.order_by(Todo.is_completed.asc(), Todo.created_at.asc())

    result = await db.execute(query)
    todos = result.scalars().all()

    return ApiResponse(data=[_serialize_todo(t) for t in todos])


@router.put("/{todo_id}", response_model=ApiResponse[TodoResponse], summary="更新自定义待办")
async def update_todo(
    todo_id: uuid.UUID,
    data: TodoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    更新待办标题或切换完成状态
    仅传入的字段会被更新, 未传入的保持不变
    切换完成/未完成时自动更新 completed_at 时间戳
    """
    todo = await _get_owned_todo(todo_id, current_user, db)

    # 更新标题
    if data.title is not None:
        todo.title = data.title.strip()

    # 切换完成状态
    if data.is_completed is not None:
        todo.is_completed = data.is_completed
        if data.is_completed:
            # 标记完成: 记录完成时间
            todo.completed_at = datetime.now(timezone.utc)
        else:
            # 取消完成: 清空完成时间
            todo.completed_at = None

    await db.commit()
    await db.refresh(todo)

    return ApiResponse(data=_serialize_todo(todo))


@router.delete("/{todo_id}", response_model=ApiResponse[None], summary="删除自定义待办")
async def delete_todo(
    todo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    删除指定的自定义待办
    """
    todo = await _get_owned_todo(todo_id, current_user, db)
    await db.delete(todo)
    await db.commit()

    return ApiResponse(message="待办已删除")


# ============================================================================
# 序列化辅助函数
# ============================================================================

def _serialize_todo(todo: Todo) -> TodoResponse:
    """
    将 ORM 待办对象序列化为响应的 Pydantic 模型

    :param todo: SQLAlchemy Todo 实例
    :return: TodoResponse 实例
    """
    return TodoResponse(
        id=str(todo.id),
        title=todo.title,
        is_completed=todo.is_completed,
        completed_at=todo.completed_at.isoformat() if todo.completed_at else None,
        created_at=todo.created_at.isoformat() if todo.created_at else None,
        updated_at=todo.updated_at.isoformat() if todo.updated_at else None,
    )
