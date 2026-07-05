"""
仪表盘统计 API
提供首页仪表盘所需的汇总数据和个性化统计
"""

import uuid
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo  # Python 3.9+ 标准库, 用于北京时间处理

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger
from app.core.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.document import Document, DocumentChunk
from app.models.conversation import Conversation, Message
from app.models.learning import LearningSession, LearningStage
from app.models.todo import Todo
from app.schemas.common import ApiResponse
from app.schemas.stats import (
    TodoItem, TodayStatsResponse, DailyActivity, WeeklyStatsResponse,
    FavoriteItem, FavoritesResponse,
)
from app.api.deps import get_current_user

router = APIRouter(prefix="/stats", tags=["仪表盘统计"])

# 北京时间时区
CST = ZoneInfo("Asia/Shanghai")


# ============================================================================
# 公共端点: 常规仪表盘统计 (无需认证, 系统级数据)
# ============================================================================

@router.get("/", response_model=ApiResponse[dict], summary="仪表盘统计数据")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    返回仪表盘首页需要的汇总统计数据:
    - course_count: 课程总数
    - document_count: 文档总数
    - chunk_count: 切片总数 (从 document_chunks 表直接聚合)
    """
    # 课程总数
    course_count_result = await db.execute(select(func.count(Course.id)))
    course_count = course_count_result.scalar() or 0

    # 文档总数
    doc_count_result = await db.execute(select(func.count(Document.id)))
    document_count = doc_count_result.scalar() or 0

    # 切片总数: 从 document_chunks 表直接 COUNT, 避免用 documents.chunk_count 求和
    chunk_count_result = await db.execute(select(func.count(DocumentChunk.id)))
    chunk_count = chunk_count_result.scalar() or 0

    return ApiResponse(
        data={
            "course_count": course_count,
            "document_count": document_count,
            "chunk_count": chunk_count,
        }
    )


# ============================================================================
# 个性化端点: 需要用户认证
# ============================================================================

def _get_today_range_cst() -> tuple[datetime, datetime]:
    """
    获取今日北京时间 00:00:00 到 23:59:59.999999 的 UTC 时间范围

    :return: (today_start_utc, today_end_utc)
    """
    now_cst = datetime.now(CST)
    today_start_cst = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end_cst = today_start_cst + timedelta(days=1)
    return today_start_cst, today_end_cst


def _get_week_range_cst() -> tuple[datetime, datetime, datetime]:
    """
    获取本周一 00:00:00 至下周一 00:00:00 (北京时间) 的 UTC 时间范围

    :return: (week_start_utc, week_end_utc, now_cst)
    """
    now_cst = datetime.now(CST)
    # 本周一 (weekday: 0=周一, 6=周日)
    monday_cst = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
    monday_cst -= timedelta(days=monday_cst.weekday())
    sunday_end_cst = monday_cst + timedelta(days=7)  # 下周一 00:00
    return monday_cst, sunday_end_cst, now_cst


@router.get("/today", response_model=ApiResponse[TodayStatsResponse], summary="今日待办")
async def get_today_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取今日待办数据, 双源合并:
    1. 自动待办: 活跃学习会话中未完成的阶段 (从 learning_path JSONB 中解析)
       如果阶段尚无 LearningStage DB 行, 自动创建 status='pending' 的记录
    2. 自定义待办: 用户手动创建的未完成待办
    同时统计今日活动 (消息数、完成阶段数)
    """
    today_start, today_end = _get_today_range_cst()

    # 1. 统计今日消息数
    msg_result = await db.execute(
        select(func.count(Message.id))
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(
            Conversation.user_id == current_user.id,
            Message.role == "user",
            Message.created_at >= today_start,
            Message.created_at < today_end,
        )
    )
    today_messages = msg_result.scalar() or 0

    # 2. 统计今日完成阶段数 (从 DB LearningStage 表, 按完成时间)
    stage_result = await db.execute(
        select(func.count(LearningStage.id))
        .join(LearningSession, LearningStage.session_id == LearningSession.id)
        .where(
            LearningSession.user_id == current_user.id,
            LearningStage.status == "completed",
            LearningStage.updated_at >= today_start,
            LearningStage.updated_at < today_end,
        )
    )
    today_completed_stages = stage_result.scalar() or 0

    # 3. 自动待办: 从活跃会话的 learning_path JSONB 中提取未完成阶段
    todo_items: list[TodoItem] = []

    # 查询活跃的会话
    session_query = await db.execute(
        select(LearningSession)
        .where(
            LearningSession.user_id == current_user.id,
            LearningSession.status == "active",
        )
        .order_by(LearningSession.updated_at.desc())
    )
    active_sessions = session_query.scalars().all()

    for session in active_sessions:
        # 获取课程名称
        course = await db.get(Course, session.course_id)
        course_name = course.name if course else "未命名课程"

        # 从 learning_path JSONB 中获取阶段规划
        stages = session.learning_path.get("stages", [])
        current_index = session.current_stage_index

        # 只显示当前所处阶段 (用户正在学习的阶段)
        if current_index >= len(stages):
            continue

        stage_plan = stages[current_index]
        stage_status = stage_plan.get("status", None)

        # 当前阶段已完成 → 跳过 (该课程没有待办)
        if stage_status == "completed":
            continue

        # 懒加载确保阶段在 DB 中有记录 (用于关联导航)
        stage_obj = await _ensure_stage_row(
            db, session.id, current_index,
            title=stage_plan.get("title", f"阶段 {current_index + 1}"),
            description=stage_plan.get("description", ""),
            knowledge_point_ids=stage_plan.get("knowledge_points", []),
        )

        todo_items.append(TodoItem(
            source="learning_stage",
            stage_id=str(stage_obj.id),
            session_id=str(session.id),
            course_name=course_name,
            title=stage_plan.get("title", f"阶段 {current_index + 1}"),
            description=stage_plan.get("description", ""),
            order_index=current_index,
            is_completed=False,
        ))

    # 4. 自定义待办: 查询未完成的 todo
    custom_query = await db.execute(
        select(Todo)
        .where(
            Todo.user_id == current_user.id,
            Todo.is_completed == False,
        )
        .order_by(Todo.created_at.asc())
    )
    for todo in custom_query.scalars().all():
        todo_items.append(TodoItem(
            source="custom",
            todo_id=str(todo.id),
            title=todo.title,
            is_completed=False,
        ))

    return ApiResponse(data=TodayStatsResponse(
        today_messages=today_messages,
        today_completed_stages=today_completed_stages,
        items=todo_items,
    ))


async def _ensure_stage_row(
    db: AsyncSession,
    session_id: uuid.UUID,
    order_index: int,
    title: str,
    description: str,
    knowledge_point_ids: list,
) -> "LearningStage":
    """
    确保指定序号的学习阶段在 DB 中有对应的 LearningStage 行
    若不存在则创建 status='pending' 的记录; 若已存在则直接返回

    容忍 SSE 重连可能导致的重复行问题 (使用 ORDER BY + LIMIT 1)

    :param db: 数据库会话
    :param session_id: 会话 ID
    :param order_index: 阶段序号
    :param title: 阶段标题
    :param description: 阶段描述
    :param knowledge_point_ids: 知识点 ID 列表
    :return: LearningStage 实例
    """
    from app.models.learning import LearningStage as LS
    from sqlalchemy import select as _select

    # 查询是否有已存在的 LearningStage 行 (按 session_id + order_index)
    stmt = (
        _select(LS)
        .where(LS.session_id == session_id, LS.order_index == order_index)
        .order_by(LS.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    stage_obj = result.scalars().first()

    if not stage_obj:
        # 阶段尚未在 DB 中记录, 创建 pending 状态的占位行
        stage_obj = LS(
            session_id=session_id,
            title=title,
            description=description,
            order_index=order_index,
            status="pending",  # 待生成: 用户尚未开始此阶段
            knowledge_point_ids=knowledge_point_ids or [],
            stage_metadata={},
        )
        db.add(stage_obj)
        await db.flush()
        logger.info(f"[今日待办] 创建 pending 阶段: session={session_id}, "
                     f"order={order_index}, title={title}")

    return stage_obj


@router.get("/weekly", response_model=ApiResponse[WeeklyStatsResponse], summary="本周学习情况")
async def get_weekly_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取本周每日学习活动统计
    按天汇总用户的消息数和完成阶段数, 用于柱状图展示
    """
    monday_cst, sunday_end_cst, _ = _get_week_range_cst()

    # 自定义星期名称映射
    day_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

    # 查询本周内每日消息数 (按日期 GROUP BY)
    msg_query = await db.execute(
        select(
            func.date(Message.created_at).label("day"),
            func.count(Message.id).label("count"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(
            Conversation.user_id == current_user.id,
            Message.role == "user",
            Message.created_at >= monday_cst,
            Message.created_at < sunday_end_cst,
        )
        .group_by("day")
        .order_by("day")
    )
    msg_by_day = {str(row.day): row.count for row in msg_query.all()}

    # 查询本周内每日完成阶段数 (按日期 GROUP BY)
    stage_query = await db.execute(
        select(
            func.date(LearningStage.updated_at).label("day"),
            func.count(LearningStage.id).label("count"),
        )
        .join(LearningSession, LearningStage.session_id == LearningSession.id)
        .where(
            LearningSession.user_id == current_user.id,
            LearningStage.status == "completed",
            LearningStage.updated_at >= monday_cst,
            LearningStage.updated_at < sunday_end_cst,
        )
        .group_by("day")
        .order_by("day")
    )
    stage_by_day = {str(row.day): row.count for row in stage_query.all()}

    # 构建 7 天数组, 缺失的日期填 0
    days: list[DailyActivity] = []
    week_total_messages = 0
    week_total_stages = 0

    for i in range(7):
        day_date = monday_cst.date() + timedelta(days=i)
        date_str = day_date.isoformat()
        msg_count = msg_by_day.get(date_str, 0)
        stage_count = stage_by_day.get(date_str, 0)
        week_total_messages += msg_count
        week_total_stages += stage_count

        days.append(DailyActivity(
            date=date_str,
            day_name=day_names[i],
            message_count=msg_count,
            stage_count=stage_count,
            activity_score=msg_count + stage_count,
        ))

    return ApiResponse(data=WeeklyStatsResponse(
        days=days,
        week_total_messages=week_total_messages,
        week_total_stages=week_total_stages,
    ))


@router.get("/favorites", response_model=ApiResponse[FavoritesResponse], summary="我的收藏")
async def get_favorites(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取用户已收藏的会话列表 (AI助学 + AI智学)
    按最后更新时间降序排列
    """
    favorites: list[FavoriteItem] = []

    # ── AI助学 (v1 LearningSession) 收藏 ──
    session_query = await db.execute(
        select(LearningSession, Course.name)
        .outerjoin(Course, LearningSession.course_id == Course.id)
        .where(
            LearningSession.user_id == current_user.id,
            LearningSession.is_favorited == True,
        )
        .order_by(LearningSession.updated_at.desc())
    )
    rows = session_query.all()

    for session, course_name in rows:
        completed_result = await db.execute(
            select(func.count(LearningStage.id))
            .where(
                LearningStage.session_id == session.id,
                LearningStage.status == "completed",
            )
        )
        completed_stages = completed_result.scalar() or 0
        total_stages = len(session.learning_path.get("stages", []))
        progress_percent = int(completed_stages / total_stages * 100) if total_stages > 0 else 0

        favorites.append(FavoriteItem(
            session_id=str(session.id),
            course_id=str(session.course_id),
            course_name=course_name or "未命名课程",
            status=session.status,
            current_stage_index=session.current_stage_index,
            total_stages=total_stages,
            completed_stages=completed_stages,
            progress_percent=progress_percent,
            updated_at=session.updated_at.isoformat() if session.updated_at else None,
        ))

    # ── AI智学 (v2 ZhiXueSession) 收藏 ──
    from app.models.zhixue import ZhiXueSession as ZXS
    zx_query = await db.execute(
        select(ZXS, Course.name)
        .outerjoin(Course, ZXS.course_id == Course.id)
        .where(
            ZXS.user_id == current_user.id,
            ZXS.is_favorited == True,
        )
        .order_by(ZXS.updated_at.desc())
    )
    zx_rows = zx_query.all()

    for zx_session, course_name in zx_rows:
        plan = zx_session.learning_path or {}
        total_stages = len(plan.get("stages", []))
        current_stage = zx_session.current_stage_index or 0
        # 进度计算: 已完成阶段 / 总阶段数
        progress_percent = (
            int(current_stage / total_stages * 100) if total_stages > 0
            else (100 if zx_session.status == "completed" else 0)
        )

        # 状态映射: ZhiXue status -> FavoriteItem status
        zx_status_map = {
            "completed": "completed",
            "failed": "paused",
            "interrupted": "paused",
        }
        status = zx_status_map.get(zx_session.status or "", "active")

        favorites.append(FavoriteItem(
            session_id=str(zx_session.id),
            course_id=str(zx_session.course_id),
            course_name=course_name or "未命名课程",
            status=status,
            current_stage_index=zx_session.current_stage_index,
            total_stages=total_stages,
            completed_stages=current_stage if status == "completed" else 0,
            progress_percent=progress_percent,
            updated_at=zx_session.updated_at.isoformat() if zx_session.updated_at else None,
        ))

    # 按 updated_at 降序重排 (合并两种来源后)
    favorites.sort(
        key=lambda f: f.updated_at or "",
        reverse=True,
    )

    return ApiResponse(data=FavoritesResponse(favorites=favorites))
