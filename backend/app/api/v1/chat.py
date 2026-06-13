"""
AI 对话 API 路由
提供对话会话管理 (CRUD) 和 SSE 流式对话接口
"""

import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.conversation import Conversation, Message
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.conversation import (
    ConversationCreate,
    ConversationUpdate,
    ConversationResponse,
    ConversationDetailResponse,
    MessageResponse,
    SendMessageRequest,
)
from app.services.chat_service import chat_stream
from app.api.deps import get_current_user

router = APIRouter(prefix="/chat", tags=["AI 对话"])


@router.post("/conversations", response_model=ApiResponse[ConversationResponse], summary="创建对话")
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    创建新的对话会话
    - chat 模式: 可选关联课程以启用知识库 RAG
    - profile_collection 模式: 用于画像收集
    """
    # 如果关联了课程, 验证课程属于当前用户
    if body.course_id:
        course = await db.get(Course, body.course_id)
        if not course or course.created_by != current_user.id:
            raise HTTPException(status_code=404, detail="课程不存在")

    conversation = Conversation(
        user_id=current_user.id,
        course_id=body.course_id,
        title=body.title,
        conversation_type=body.conversation_type,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

    return ApiResponse(
        data=ConversationResponse(
            id=conversation.id,
            user_id=conversation.user_id,
            course_id=conversation.course_id,
            title=conversation.title,
            conversation_type=conversation.conversation_type,
            profile_collection_stage=conversation.profile_collection_stage,
            message_count=0,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        ),
        message="对话创建成功",
    )


@router.get("/conversations", response_model=ApiResponse[PaginatedResponse[ConversationResponse]], summary="对话列表")
async def list_conversations(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize", description="每页数量"),
    conversation_type: Optional[str] = Query(default=None, pattern="^(chat|profile_collection)$", alias="type", description="按类型筛选"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取当前用户的对话列表, 按更新时间降序排列, 支持按类型筛选
    """
    # 构建查询: 统计每个对话的消息数
    base_stmt = select(Conversation).where(Conversation.user_id == current_user.id)
    if conversation_type:
        base_stmt = base_stmt.where(Conversation.conversation_type == conversation_type)

    # 计数
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # 分页查询
    query_stmt = base_stmt.order_by(Conversation.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query_stmt)
    conversations = result.scalars().all()

    # 构建响应 (含消息计数)
    items: list[ConversationResponse] = []
    for conv in conversations:
        msg_count_stmt = select(func.count()).select_from(
            select(Message).where(Message.conversation_id == conv.id).subquery()
        )
        msg_count_result = await db.execute(msg_count_stmt)
        msg_count = msg_count_result.scalar() or 0

        items.append(ConversationResponse(
            id=conv.id,
            user_id=conv.user_id,
            course_id=conv.course_id,
            title=conv.title,
            conversation_type=conv.conversation_type,
            profile_collection_stage=conv.profile_collection_stage,
            message_count=msg_count,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
        ))

    total_pages = (total + page_size - 1) // page_size

    return ApiResponse(
        data=PaginatedResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        ),
        message="获取成功",
    )


@router.get("/conversations/{conversation_id}", response_model=ApiResponse[ConversationDetailResponse], summary="对话详情")
async def get_conversation_detail(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取对话详情, 包含所有消息列表
    """
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    # 获取消息列表
    msg_stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    msg_result = await db.execute(msg_stmt)
    messages = msg_result.scalars().all()

    return ApiResponse(
        data=ConversationDetailResponse(
            id=conversation.id,
            user_id=conversation.user_id,
            course_id=conversation.course_id,
            title=conversation.title,
            conversation_type=conversation.conversation_type,
            profile_collection_stage=conversation.profile_collection_stage,
            messages=[
                MessageResponse(
                    id=m.id,
                    conversation_id=m.conversation_id,
                    role=m.role,
                    content=m.content,
                    sources=m.sources,
                    message_metadata=m.message_metadata,
                    created_at=m.created_at,
                )
                for m in messages
            ],
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        ),
        message="获取成功",
    )


@router.put("/conversations/{conversation_id}", response_model=ApiResponse[ConversationResponse], summary="更新对话")
async def update_conversation(
    conversation_id: uuid.UUID,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    更新对话标题等信息
    """
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    if body.title is not None:
        conversation.title = body.title

    await db.commit()
    await db.refresh(conversation)

    return ApiResponse(
        data=ConversationResponse(
            id=conversation.id,
            user_id=conversation.user_id,
            course_id=conversation.course_id,
            title=conversation.title,
            conversation_type=conversation.conversation_type,
            profile_collection_stage=conversation.profile_collection_stage,
            message_count=0,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        ),
        message="更新成功",
    )


@router.delete("/conversations/{conversation_id}", response_model=ApiResponse[None], summary="删除对话")
async def delete_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    删除对话及其所有消息 (级联删除)
    """
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    await db.delete(conversation)
    await db.commit()

    return ApiResponse(data=None, message="对话已删除")


@router.post("/conversations/{conversation_id}/messages", summary="发送消息 (SSE 流式)")
async def send_message_stream(
    conversation_id: uuid.UUID,
    body: SendMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    发送用户消息并获取 AI 流式回复 (SSE)

    返回 Server-Sent Events 流:
    - data: {"type":"sources","sources":[...]}  — 知识库引用来源
    - data: {"type":"content","content":"..."}   — AI 回复文本片段
    - data: {"type":"done","message_id":"..."}   — 生成完成
    - data: {"type":"error","message":"..."}      — 发生错误

    前端使用 EventSource 或 fetch + ReadableStream 消费此接口
    """
    # 验证对话归属
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    # 返回 SSE 流式响应
    return StreamingResponse(
        chat_stream(
            conversation_id=conversation_id,
            user_message=body.content,
            course_id=body.course_id,
            db=db,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲
        },
    )


@router.get("/conversations/{conversation_id}/messages", response_model=ApiResponse[list[MessageResponse]], summary="消息历史")
async def get_conversation_messages(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取对话的所有消息历史 (按时间升序)
    """
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()

    return ApiResponse(
        data=[
            MessageResponse(
                id=m.id,
                conversation_id=m.conversation_id,
                role=m.role,
                content=m.content,
                sources=m.sources,
                message_metadata=m.message_metadata,
                created_at=m.created_at,
            )
            for m in messages
        ],
        message="获取成功",
    )
