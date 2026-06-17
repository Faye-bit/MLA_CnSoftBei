"""
学习会话管理服务
提供学习会话的 CRUD 操作, 包括会话创建/恢复、阶段管理、资源管理等
支持学习状态自动保存和断点恢复
"""

import uuid
from typing import Optional, Tuple, List
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.models.learning import (
    LearningSession, LearningStage, GeneratedResource, AgentTask,
)
from app.models.course import Course
from app.models.profile import StudentProfile
from loguru import logger

# ============================================================================
# 画像快照
# ============================================================================

PROFILE_DIMENSIONS = [
    "academic_background", "knowledge_basis", "learning_goals",
    "learning_preferences", "weak_areas", "interests",
]


async def _snapshot_profile(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> dict:
    """
    获取用户画像快照
    用于会话创建时保存画像状态, 保证本次学习过程中画像一致性

    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 画像快照 dict
    """
    stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    if not profile:
        return {"profile_data": {}, "summary": "", "memories": []}

    return {
        "profile_data": profile.profile_data or {},
        "summary": profile.summary or "",
        "memories": (profile.memories or [])[:30],
        "version": profile.version or 1,
    }


# ============================================================================
# 会话创建与恢复
# ============================================================================

async def get_or_create_session(
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    db: AsyncSession,
) -> Tuple[LearningSession, bool]:
    """
    获取用户在该课程下的活跃会话, 不存在则创建新会话
    活跃会话定义: status = "active" 或 "paused"

    :param user_id: 用户 ID
    :param course_id: 课程 ID
    :param db: 数据库会话
    :return: (会话对象, 是否为新创建)
    """
    # 查找现有活跃会话
    stmt = (
        select(LearningSession)
        .where(
            and_(
                LearningSession.user_id == user_id,
                LearningSession.course_id == course_id,
                LearningSession.status.in_(["active", "paused"]),
            )
        )
        .order_by(LearningSession.updated_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        # 如果会话是 paused 状态, 恢复为 active
        if existing.status == "paused":
            existing.status = "active"
            await db.commit()
            await db.refresh(existing)
        logger.info(f"恢复已有学习会话: {existing.id}, course_id={course_id}")
        return existing, False

    # 创建新会话
    profile_snapshot = await _snapshot_profile(user_id, db)
    session = LearningSession(
        user_id=user_id,
        course_id=course_id,
        status="active",
        learning_path={"stages": []},
        current_stage_index=0,
        profile_snapshot=profile_snapshot,
        session_metadata={
            "total_agent_tasks": 0,
            "total_resources": 0,
            "total_token_usage": 0,
        },
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    logger.info(f"创建新学习会话: {session.id}, course_id={course_id}")
    return session, True


# ============================================================================
# 会话查询
# ============================================================================

async def get_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[LearningSession]:
    """
    获取会话 (带所有权检查)

    :param session_id: 会话 ID
    :param user_id: 用户 ID (用于所有权验证)
    :param db: 数据库会话
    :return: 会话对象, 不存在或无权限时返回 None
    """
    stmt = (
        select(LearningSession)
        .where(
            and_(
                LearningSession.id == session_id,
                LearningSession.user_id == user_id,
            )
        )
        .options(
            selectinload(LearningSession.stages).selectinload(LearningStage.resources),
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_session_detail(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[dict]:
    """
    获取会话详情 (含课程名称, 用于 API 响应)

    :param session_id: 会话 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 包含课程名称的会话详情 dict
    """
    session = await get_session(session_id, user_id, db)
    if not session:
        return None

    # 获取课程名称
    course = await db.get(Course, session.course_id)
    course_name = course.name if course else None

    result = {
        "id": session.id,
        "user_id": session.user_id,
        "course_id": session.course_id,
        "course_name": course_name,
        "status": session.status,
        "learning_path": session.learning_path,
        "current_stage_index": session.current_stage_index,
        "profile_snapshot": session.profile_snapshot,
        "session_metadata": session.session_metadata,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "stages": [],
    }

    for stage in (session.stages or []):
        stage_dict = {
            "id": stage.id,
            "session_id": stage.session_id,
            "title": stage.title,
            "description": stage.description,
            "order_index": stage.order_index,
            "status": stage.status,
            "knowledge_point_ids": stage.knowledge_point_ids,
            "stage_metadata": stage.stage_metadata,
            "created_at": stage.created_at,
            "updated_at": stage.updated_at,
            "resources": [],
        }
        for resource in (stage.resources or []):
            stage_dict["resources"].append({
                "id": resource.id,
                "stage_id": resource.stage_id,
                "resource_type": resource.resource_type,
                "title": resource.title,
                "description": resource.description,
                "order_index": resource.order_index,
                "resource_metadata": resource.resource_metadata,
                "created_at": resource.created_at,
            })
        result["stages"].append(stage_dict)

    return result


async def list_user_sessions(
    user_id: uuid.UUID,
    db: AsyncSession,
    course_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[dict], int]:
    """
    分页列出用户的学习会话

    :param user_id: 用户 ID
    :param db: 数据库会话
    :param course_id: 可选, 按课程过滤
    :param status: 可选, 按状态过滤
    :param page: 页码, 从 1 开始
    :param page_size: 每页数量
    :return: (会话列表, 总数)
    """
    conditions = [LearningSession.user_id == user_id]
    if course_id:
        conditions.append(LearningSession.course_id == course_id)
    if status:
        conditions.append(LearningSession.status == status)

    # 计数
    count_stmt = select(func.count()).select_from(LearningSession).where(and_(*conditions))
    result = await db.execute(count_stmt)
    total = result.scalar() or 0

    # 分页查询
    offset = (page - 1) * page_size
    stmt = (
        select(LearningSession)
        .where(and_(*conditions))
        .order_by(LearningSession.updated_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    items = []
    for session in sessions:
        # 计算进度
        stages = session.learning_path.get("stages", [])
        total_stages = len(stages)
        completed_stages = sum(
            1 for s in stages
            if s.get("status") == "completed"
        )
        progress = int(completed_stages / total_stages * 100) if total_stages > 0 else 0

        # 获取课程名称
        course = await db.get(Course, session.course_id)
        course_name = course.name if course else None

        items.append({
            "id": session.id,
            "course_id": session.course_id,
            "course_name": course_name,
            "status": session.status,
            "learning_path": session.learning_path,
            "current_stage_index": session.current_stage_index,
            "progress_percent": progress,
            "total_stages": total_stages,
            "completed_stages": completed_stages,
            "is_favorited": session.is_favorited,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
        })

    return items, total


# ============================================================================
# 阶段管理
# ============================================================================

async def get_stage_detail(
    stage_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[LearningStage]:
    """
    获取阶段详情 (带所有权检查)

    :param stage_id: 阶段 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 阶段对象, 无权限时返回 None
    """
    stmt = (
        select(LearningStage)
        .join(LearningSession)
        .where(
            and_(
                LearningStage.id == stage_id,
                LearningSession.user_id == user_id,
            )
        )
        .options(
            selectinload(LearningStage.resources),
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def complete_stage(
    session_id: uuid.UUID,
    stage_index: int,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[LearningSession]:
    """
    完成当前阶段, 将会话推进到下一阶段

    :param session_id: 会话 ID
    :param stage_index: 要完成的阶段序号
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 更新后的会话, 无权限时返回 None
    """
    session = await get_session(session_id, user_id, db)
    if not session:
        return None

    # 更新 learning_path 中对应阶段的状态
    stages = session.learning_path.get("stages", [])
    if stage_index < len(stages):
        stages[stage_index]["status"] = "completed"

    # 更新数据库中的阶段状态 (安全查询: ORDER BY + LIMIT 1 容忍重复行)
    stmt = (
        select(LearningStage)
        .where(
            and_(
                LearningStage.session_id == session_id,
                LearningStage.order_index == stage_index,
            )
        )
        .order_by(LearningStage.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    stage = result.scalars().first()
    if stage:
        stage.status = "completed"

    # 推进到下一阶段
    next_index = stage_index + 1
    if next_index < len(stages):
        stages[next_index]["status"] = "active"
        session.current_stage_index = next_index

        # 更新数据库中下一阶段的状态 (安全查询: ORDER BY + LIMIT 1 容忍重复行)
        stmt2 = (
            select(LearningStage)
            .where(
                and_(
                    LearningStage.session_id == session_id,
                    LearningStage.order_index == next_index,
                )
            )
            .order_by(LearningStage.created_at.desc())
            .limit(1)
        )
        result2 = await db.execute(stmt2)
        next_stage = result2.scalars().first()
        if next_stage:
            next_stage.status = "active"
    else:
        # 所有阶段已完成
        session.status = "completed"

    session.learning_path["stages"] = stages
    await db.commit()
    await db.refresh(session)

    logger.info(
        f"阶段完成: session_id={session_id}, stage_index={stage_index}, "
        f"next_index={session.current_stage_index}"
    )
    return session


# ============================================================================
# 资源管理
# ============================================================================

async def get_resource(
    resource_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[GeneratedResource]:
    """
    获取资源详情 (带所有权检查)

    :param resource_id: 资源 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 资源对象, 无权限时返回 None
    """
    stmt = (
        select(GeneratedResource)
        .join(LearningStage)
        .join(LearningSession)
        .where(
            and_(
                GeneratedResource.id == resource_id,
                LearningSession.user_id == user_id,
            )
        )
    )
    result = await db.execute(stmt)
    # 使用 scalars().first() 而非 scalar_one_or_none():
    #   JOIN 路径 GeneratedResource → LearningStage → LearningSession,
    #   若存在重复 LearningStage 行 (SSE 重连导致), JOIN 可能产生多行,
    #   scalar_one_or_none() 会因此抛出 MultipleRows 错误
    return result.scalars().first()


# ============================================================================
# 练习题进度保存
# ============================================================================

async def save_exercise_progress(
    resource_id: uuid.UUID,
    user_id: uuid.UUID,
    answers: dict,
    submitted: dict,
    current_index: int,
    db: AsyncSession,
    scores: dict | None = None,
) -> bool:
    """
    保存用户在练习题资源中的作答进度
    进度存储在 resource_metadata.exercise_progress 字段中

    :param resource_id: 资源 ID
    :param user_id: 用户 ID (用于所有权验证)
    :param answers: 用户答案映射 {"q1": 0, "q2": [0,2], ...}
    :param submitted: 已提交标记 {"q1": true, ...}
    :param current_index: 当前题目序号
    :param db: 数据库会话
    :param scores: AI 评分映射 {"q3": {"score": 8, "feedback": "..."}}
    :return: 是否成功
    """
    resource = await get_resource(resource_id, user_id, db)
    if not resource:
        return False

    # 将进度写入 resource_metadata
    metadata = dict(resource.resource_metadata or {})
    metadata["exercise_progress"] = {
        "answers": answers,
        "submitted": submitted,
        "current_index": current_index,
    }
    # 如果提供了 scores, 合并写入 (可能包含 AI 评分)
    if scores:
        metadata["exercise_progress"]["scores"] = scores

    resource.resource_metadata = metadata
    # 显式标记 JSONB 字段已修改, 确保 SQLAlchemy async 模式正确检测变更
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(resource, "resource_metadata")
    await db.commit()
    logger.info(f"练习题进度已保存: resource_id={resource_id}, {len(answers)} 题已作答")
    return True


# ============================================================================
# 会话删除
# ============================================================================

async def delete_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> bool:
    """
    删除学习会话 (级联删除阶段、资源和任务)

    :param session_id: 会话 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 是否成功删除
    """
    session = await get_session(session_id, user_id, db)
    if not session:
        return False

    await db.delete(session)
    await db.commit()
    logger.info(f"学习会话已删除: {session_id}")
    return True


# ============================================================================
# 学习状态保存 (自动保存)
# ============================================================================

async def save_learning_state(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> bool:
    """
    保存学习状态 (更新 updated_at 时间戳)
    学习路径的变更直接通过 session.learning_path 更新, 此函数用于主动触发持久化

    :param session_id: 会话 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 是否成功
    """
    session = await get_session(session_id, user_id, db)
    if not session:
        return False

    # 触发 updated_at 更新
    session.session_metadata = {
        **(session.session_metadata or {}),
        "last_saved_at": None,  # 将由 onupdate 自动更新
    }
    await db.commit()
    return True


# ============================================================================
# 智能体任务管理
# ============================================================================

async def create_agent_task(
    session_id: uuid.UUID,
    agent_name: str,
    resource_id: Optional[uuid.UUID] = None,
    input_summary: Optional[str] = None,
    db: AsyncSession = None,
) -> AgentTask:
    """
    创建智能体任务追踪记录

    :param session_id: 会话 ID
    :param agent_name: Agent 角色名称
    :param resource_id: 关联资源 ID (可选)
    :param input_summary: 输入摘要
    :param db: 数据库会话
    :return: 创建的任务对象
    """
    task = AgentTask(
        session_id=session_id,
        agent_name=agent_name,
        resource_id=resource_id,
        status="running",
        input_summary=input_summary,
    )
    db.add(task)
    await db.flush()
    return task


# ============================================================================
# 收藏管理
# ============================================================================

async def toggle_favorite(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> tuple[bool, bool]:
    """
    切换会话收藏状态

    :param session_id: 会话 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: (是否成功, 切换后的收藏状态)
    """
    session = await get_session(session_id, user_id, db)
    if not session:
        return False, False

    session.is_favorited = not session.is_favorited
    await db.commit()
    await db.refresh(session)
    logger.info(f"会话收藏状态已切换: {session_id} -> {session.is_favorited}")
    return True, session.is_favorited


# ============================================================================
# 下载: 生成阶段/全部资源的合并 Markdown
# ============================================================================

async def build_download_content(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    stage_index: Optional[int] = None,
) -> Optional[tuple[str, str]]:
    """
    构建可下载的学习资源 Markdown 内容

    :param session_id: 会话 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :param stage_index: 指定阶段序号, None 表示下载全部阶段
    :return: (文件名, Markdown 内容), 不存在或无权限时返回 None
    """
    session = await get_session(session_id, user_id, db)
    if not session:
        return None

    # 获取课程名称
    course = await db.get(Course, session.course_id)
    course_name = course.name if course else "课程"

    lines: list[str] = []
    lines.append(f"# {course_name} — 个性化学习资源")
    lines.append(f"\n> 由 MLA 多学助手生成 | {session.created_at.strftime('%Y-%m-%d') if session.created_at else ''}\n")

    # 收集需要导出的阶段
    stages_to_export = []
    for s in (session.stages or []):
        if stage_index is not None and s.order_index != stage_index:
            continue
        # 只导出有资源的阶段
        if s.resources:
            stages_to_export.append(s)

    if not stages_to_export:
        return f"{course_name}_学习资源.md", f"# {course_name}\n\n暂无生成资源。"

    for stage in stages_to_export:
        lines.append(f"---\n\n## 阶段 {stage.order_index + 1}: {stage.title}\n")
        if stage.description:
            lines.append(f"> {stage.description}\n")

        for res in (stage.resources or []):
            res_type_label = {
                "handout": "讲义", "mindmap": "思维导图", "exercise": "练习题",
                "reading": "拓展阅读", "coding_practice": "编程练习", "video_script": "交互动画",
            }.get(res.resource_type, res.resource_type)

            lines.append(f"### {res_type_label}: {res.title}\n")
            lines.append(res.content or "(无内容)")
            lines.append("\n")

    content = "\n".join(lines)
    filename = f"{course_name}_学习资源.md"
    return filename, content


async def complete_agent_task(
    task_id: uuid.UUID,
    output_summary: Optional[str] = None,
    latency_ms: Optional[int] = None,
    token_count: Optional[int] = None,
    error_message: Optional[str] = None,
    db: AsyncSession = None,
) -> Optional[AgentTask]:
    """
    完成智能体任务 (成功或失败)

    :param task_id: 任务 ID
    :param output_summary: 输出摘要
    :param latency_ms: 执行耗时 (毫秒)
    :param token_count: Token 消耗
    :param error_message: 错误信息 (失败时传入)
    :param db: 数据库会话
    :return: 更新后的任务对象
    """
    task = await db.get(AgentTask, task_id)
    if not task:
        return None

    task.status = "failed" if error_message else "completed"
    task.output_summary = output_summary
    task.latency_ms = latency_ms
    task.token_count = token_count
    task.error_message = error_message

    from datetime import datetime as dt
    task.completed_at = dt.now()

    await db.flush()
    return task
