"""
学习会话 API 端点
提供学习会话的 CRUD、SSE 流式进度推送、阶段管理和资源获取接口
Phase 3 多智能体协同与个性化资源生成功能的核心 API
"""

import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.learning import (
    LearningSessionCreate, LearningSessionResponse, LearningSessionDetailResponse,
    LearningSessionListItem, LearningStageResponse, LearningStageDetailResponse,
    StageCompleteRequest, GeneratedResourceResponse, GeneratedResourceDetailResponse,
    RegenerateResourceRequest, ExerciseProgressRequest,
    AgentTaskResponse, FavoriteToggleResponse,
    ExerciseScoreRequest, ExerciseScoreResponse,
)
from app.api.deps import get_current_user
from app.services.learning import session_service
from app.services.learning import agent_orchestrator
from loguru import logger

router = APIRouter(prefix="/learning", tags=["AI 助学"])


# ============================================================================
# 辅助函数: 所有权验证
# ============================================================================

async def _get_owned_session(
    session_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> session_service.LearningSession:
    """
    获取会话并验证所有权, 不存在或无权限时抛出 404

    :param session_id: 会话 ID
    :param user: 当前用户
    :param db: 数据库会话
    :return: 会话对象
    """
    from app.models.learning import LearningSession
    session = await db.get(LearningSession, session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="学习会话不存在")
    return session


async def _get_owned_stage(
    stage_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> session_service.LearningStage:
    """
    获取阶段并验证所有权

    :param stage_id: 阶段 ID
    :param user: 当前用户
    :param db: 数据库会话
    :return: 阶段对象
    """
    stage = await session_service.get_stage_detail(stage_id, user.id, db)
    if not stage:
        raise HTTPException(status_code=404, detail="学习阶段不存在")
    return stage


# ============================================================================
# 会话 CRUD 端点
# ============================================================================

@router.post("/sessions", response_model=ApiResponse[LearningSessionResponse], summary="创建或恢复学习会话")
async def create_or_resume_session(
    body: LearningSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    在指定课程下创建新的学习会话, 或恢复已有的活跃会话
    如果用户在该课程下已有 active/paused 状态的会话, 则直接返回 (恢复)
    否则创建新会话并快照当前画像状态
    """
    from app.models.learning import LearningSession
    session, is_new = await session_service.get_or_create_session(
        user_id=current_user.id,
        course_id=body.course_id,
        db=db,
    )
    return ApiResponse(
        data=LearningSessionResponse.model_validate(session),
        message="已恢复学习进度" if not is_new else "已创建学习会话",
    )


@router.get("/sessions", response_model=ApiResponse[PaginatedResponse[LearningSessionListItem]], summary="获取学习会话列表")
async def list_sessions(
    course_id: Optional[uuid.UUID] = Query(default=None, description="按课程过滤"),
    status: Optional[str] = Query(default=None, description="按状态过滤 (active/completed/paused)"),
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    分页列出当前用户的学习会话
    支持按课程和状态过滤
    """
    items, total = await session_service.list_user_sessions(
        user_id=current_user.id,
        db=db,
        course_id=course_id,
        status=status,
        page=page,
        page_size=page_size,
    )
    total_pages = (total + page_size - 1) // page_size
    return ApiResponse(data=PaginatedResponse(
        items=items, total=total, page=page, page_size=page_size, total_pages=total_pages,
    ))


@router.get("/sessions/{session_id}", response_model=ApiResponse[LearningSessionDetailResponse], summary="获取学习会话详情")
async def get_session_detail(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取会话完整详情, 包含所有阶段和资源列表
    """
    detail = await session_service.get_session_detail(session_id, current_user.id, db)
    if not detail:
        raise HTTPException(status_code=404, detail="学习会话不存在")
    return ApiResponse(data=detail)


@router.delete("/sessions/{session_id}", response_model=ApiResponse, summary="删除学习会话")
async def delete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    删除学习会话 (级联删除阶段、资源和任务)
    """
    success = await session_service.delete_session(session_id, current_user.id, db)
    if not success:
        raise HTTPException(status_code=404, detail="学习会话不存在")
    return ApiResponse(message="学习会话已删除")


@router.put("/sessions/{session_id}/favorite", response_model=ApiResponse[FavoriteToggleResponse], summary="切换学习会话收藏状态")
async def toggle_favorite(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    切换学习会话的收藏/取消收藏状态
    """
    success, is_favorited = await session_service.toggle_favorite(
        session_id, current_user.id, db,
    )
    if not success:
        raise HTTPException(status_code=404, detail="学习会话不存在")
    return ApiResponse(
        data=FavoriteToggleResponse(is_favorited=is_favorited),
        message="已收藏" if is_favorited else "已取消收藏",
    )


@router.get("/sessions/{session_id}/download", summary="下载学习资源 (Markdown 文件)")
async def download_session_resources(
    session_id: uuid.UUID,
    stage_index: Optional[int] = Query(default=None, description="指定阶段序号, 不传则下载全部阶段"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    将会话中已生成的资源合并为一个 Markdown 文件供下载
    支持下载单个阶段 (stage_index) 或全部阶段 (不传 stage_index)
    """
    result = await session_service.build_download_content(
        session_id, current_user.id, db, stage_index,
    )
    if not result:
        raise HTTPException(status_code=404, detail="学习会话不存在或无生成资源")

    filename, content = result
    from urllib.parse import quote
    safe_filename = quote(filename, safe='')

    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
        },
    )


# ============================================================================
# SSE 流式端点 (占位, Phase 3b 实现)
# ============================================================================

@router.get("/sessions/{session_id}/stream", summary="学习会话 SSE 流式进度")
async def stream_session_progress(
    session_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    SSE 流式端点: 实时推送 LangGraph 智能体编排进度
    事件类型: session_init / stage_start / agent_start / agent_progress /
              agent_done / resource_ready / path_update / stage_complete /
              session_complete / error
    """
    # 验证会话所有权
    session = await _get_owned_session(session_id, current_user, db)

    return StreamingResponse(
        agent_orchestrator.generate_learning_path_stream(
            user_id=current_user.id,
            course_id=session.course_id,
            session_id=session_id,
            db=db,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================================
# 阶段管理端点
# ============================================================================

@router.get("/sessions/{session_id}/stages/{stage_id}", response_model=ApiResponse[LearningStageDetailResponse], summary="获取阶段详情")
async def get_stage_detail(
    session_id: uuid.UUID,
    stage_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取阶段详情, 包含该阶段下所有资源
    """
    # 验证会话所有权
    await _get_owned_session(session_id, current_user, db)

    stage = await session_service.get_stage_detail(stage_id, current_user.id, db)
    if not stage:
        raise HTTPException(status_code=404, detail="学习阶段不存在")
    return ApiResponse(data=LearningStageDetailResponse.model_validate(stage))


@router.post("/sessions/{session_id}/stages/{stage_index}/complete", summary="完成学习阶段 (SSE 流式生成下一阶段)")
async def complete_stage(
    session_id: uuid.UUID,
    stage_index: int,
    body: StageCompleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    标记当前阶段为已完成, 并 SSE 流式生成下一阶段
    事件类型: stage_start / agent_start / agent_done / resource_ready /
              path_update / stage_complete / session_complete / error
    """
    # 先完成当前阶段
    session = await session_service.complete_stage(
        session_id=session_id,
        stage_index=stage_index,
        user_id=current_user.id,
        db=db,
    )
    if not session:
        raise HTTPException(status_code=404, detail="学习会话或阶段不存在")

    # SSE 流式生成下一阶段
    return StreamingResponse(
        agent_orchestrator.generate_next_stage_stream(
            session_id=session_id,
            user_id=current_user.id,
            db=db,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================================
# 资源管理端点
# ============================================================================

@router.get("/resources/{resource_id}", response_model=ApiResponse[GeneratedResourceDetailResponse], summary="获取资源详情")
async def get_resource(
    resource_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取生成资源的完整内容 (含 content 字段)
    用于前端打开资源查看器时加载完整资源
    """
    resource = await session_service.get_resource(resource_id, current_user.id, db)
    if not resource:
        raise HTTPException(status_code=404, detail="资源不存在")
    return ApiResponse(data=GeneratedResourceDetailResponse.model_validate(resource))


@router.put("/resources/{resource_id}", summary="重新生成资源 (SSE)")
async def regenerate_resource(
    resource_id: uuid.UUID,
    body: RegenerateResourceRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    重新生成单个资源 (SSE 流式)
    事件类型: agent_start / resource_ready / error
    """
    return StreamingResponse(
        agent_orchestrator.regenerate_single_resource_stream(
            resource_id=resource_id,
            user_id=current_user.id,
            db=db,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.put("/resources/{resource_id}/progress", response_model=ApiResponse, summary="保存练习题作答进度")
async def save_exercise_progress(
    resource_id: uuid.UUID,
    body: ExerciseProgressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    保存用户在某个练习题资源中的作答进度
    进度存储在资源的 resource_metadata.exercise_progress 中
    前端应在用户提交答案或切换题目时调用此接口自动保存
    """
    success = await session_service.save_exercise_progress(
        resource_id=resource_id,
        user_id=current_user.id,
        answers=body.answers,
        submitted=body.submitted,
        current_index=body.current_index,
        db=db,
        scores=body.scores,
    )
    if not success:
        logger.warning(f"练习题进度保存失败: resource_id={resource_id} 不存在或无权访问, user_id={current_user.id}")
        raise HTTPException(status_code=404, detail="资源不存在")
    return ApiResponse(message="进度已保存")


@router.post("/resources/{resource_id}/score", response_model=ApiResponse[ExerciseScoreResponse], summary="AI 打分主观题答案")
async def score_exercise_answer(
    resource_id: uuid.UUID,
    body: ExerciseScoreRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    对填空题或简答题的用户答案进行 AI 智能评分 (满分 10 分)
    返回评分和评语, 前端可显示在题目反馈区域
    """
    # 验证资源存在和所有权 (通过 resource_id 关联验证)
    resource = await session_service.get_resource(resource_id, current_user.id, db)
    if not resource:
        raise HTTPException(status_code=404, detail="资源不存在")

    result = await agent_orchestrator.score_exercise_answer(
        question_id=body.question_id,
        question_type=body.question_type,
        question_text=body.question_text,
        user_answer=body.user_answer,
        reference_answer=body.reference_answer,
        explanation=body.explanation,
    )

    return ApiResponse(data=ExerciseScoreResponse(
        question_id=result["question_id"],
        score=result["score"],
        feedback=result["feedback"],
    ))
