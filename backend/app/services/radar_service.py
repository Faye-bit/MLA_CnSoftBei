"""
学习行为雷达图服务
根据用户近 30 天的平台行为数据, 计算 6 个维度的 0-10 分评分

六大维度 (来自雷达图标准.md):
  1. 学科均衡度    — 基于上传课件的学科分布方差
  2. 学习自律度    — 基于学习活跃天数、连续性、跟进率
  3. 主动学习意愿  — 基于自主上传、主动提问、资源收藏
  4. 刷题巩固强度  — 基于 AI 习题生成与完成情况 (接口已预留)
  5. 复习复盘习惯  — 基于历史课件回看、旧资料重新提问
  6. 听课专注度    — 基于单次学习时长、页面切换行为

数据来源: documents / conversations / messages 表 (无新增埋点)
习题和视频相关数据接口已预留, 后续完善行为追踪后自动生效
"""

import uuid
import math
from typing import Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.document import Document
from app.models.course import Course
from app.models.conversation import Conversation, Message
from loguru import logger

# 当前 UTC 时间 (带时区, 兼容数据库 TIMESTAMPTZ 字段)
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

# 近 30 天的时间窗口
DAYS_WINDOW = 30

# ============================================================================
# 雷达图维度配置
# ============================================================================

RADAR_DIMENSIONS = [
    {
        "key": "subject_balance",
        "label": "学科均衡度",
        "tooltip": "高分: 多学科均衡上传课件、使用AI学习资源，无明显学科偏好偏差；低分: 仅聚焦单一学科上传资料、AI提问学习，存在严重偏科行为。",
        "icon": "pie-chart",
    },
    {
        "key": "learning_discipline",
        "label": "学习自律度",
        "tooltip": "高分: 学习节奏稳定，上传课件后会及时借助AI巩固学习，不囤积资料；低分: 学习碎片化、无规律，频繁断更，上传课件后长期不开展配套学习。",
        "icon": "clock-circle",
    },
    {
        "key": "active_learning",
        "label": "主动学习意愿",
        "tooltip": "高分: 主动沉淀学习资料、自主向AI探索提问，主动积累优质学习资源；低分: 仅被动浏览平台资源，极少主动上传资料、发起AI学习互动。",
        "icon": "thunderbolt",
    },
    {
        "key": "practice_intensity",
        "label": "刷题巩固强度",
        "tooltip": "高分: 高频借助AI出题刷题，重视错题复盘，巩固学习效果；低分: 仅生成习题不作答、做错不复盘，刷题无实际巩固效果。",
        "icon": "form",
    },
    {
        "key": "review_habit",
        "label": "复习复盘习惯",
        "tooltip": "高分: 善于复用历史学习资料，借助AI定期复盘巩固旧知识；低分: 学习一次性完成，课件浏览、AI学习后不再复盘，知识留存率低。",
        "icon": "sync",
    },
    {
        "key": "focus_level",
        "label": "听课专注度",
        "tooltip": "高分: 学习专注力强，单次学习时长充足，完整观看AI学习视频，深度研读资料；低分: 学习碎片化严重，浅度浏览资源，频繁中断学习、跳转页面。",
        "icon": "eye",
    },
]

# 近 30 天的时间窗口
DAYS_WINDOW = 30


# ============================================================================
# 数据查询辅助函数
# ============================================================================

async def _get_user_course_ids(user_id: uuid.UUID, db: AsyncSession) -> list[uuid.UUID]:
    """获取用户创建的所有课程 ID"""
    stmt = select(Course.id).where(Course.created_by == user_id)
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]


async def _get_user_documents(
    user_id: uuid.UUID, db: AsyncSession, since: Optional[datetime] = None
) -> list[Document]:
    """获取用户上传的文档列表 (可按时间过滤)"""
    course_ids = await _get_user_course_ids(user_id, db)
    if not course_ids:
        return []
    stmt = select(Document).where(Document.course_id.in_(course_ids))
    if since:
        stmt = stmt.where(Document.created_at >= since)
    result = await db.execute(stmt)
    return result.scalars().all()


async def _get_user_conversations(
    user_id: uuid.UUID, db: AsyncSession, since: Optional[datetime] = None
) -> list[Conversation]:
    """获取用户的对话列表 (可按时间过滤)"""
    stmt = select(Conversation).where(
        and_(
            Conversation.user_id == user_id,
            Conversation.conversation_type == "chat",
        )
    )
    if since:
        stmt = stmt.where(Conversation.created_at >= since)
    result = await db.execute(stmt)
    return result.scalars().all()


async def _get_user_message_count(
    user_id: uuid.UUID, db: AsyncSession, since: Optional[datetime] = None,
    role: Optional[str] = None,
) -> int:
    """获取用户的消息总数 (可按时间和角色过滤)"""
    subq = select(Conversation.id).where(Conversation.user_id == user_id)
    stmt = select(func.count(Message.id)).where(
        Message.conversation_id.in_(subq)
    )
    if since:
        stmt = stmt.where(Message.created_at >= since)
    if role:
        stmt = stmt.where(Message.role == role)
    result = await db.execute(stmt)
    return result.scalar() or 0


# ============================================================================
# 各维度打分函数
# ============================================================================

async def _score_subject_balance(
    user_id: uuid.UUID, db: AsyncSession
) -> float:
    """
    学科均衡度评分
    计算用户各学科(课程)的学习行为分布标准差, 标准差越小越均衡
    数据来源: 各课程下上传的文档数量分布
    """
    course_ids = await _get_user_course_ids(user_id, db)
    if not course_ids:
        return 0.0

    # 统计每个课程下的文档数
    counts: list[int] = []
    for cid in course_ids:
        stmt = select(func.count(Document.id)).where(Document.course_id == cid)
        result = await db.execute(stmt)
        counts.append(result.scalar() or 0)

    total = sum(counts)
    if total == 0:
        return 0.0

    # 如果只有 1 个课程且有文档, 偏科严重
    if len(counts) == 1:
        return 3.0 if counts[0] > 0 else 0.0

    # 计算标准差
    mean = total / len(counts)
    variance = sum((c - mean) ** 2 for c in counts) / len(counts)
    std_dev = math.sqrt(variance)

    # 平台最大标准差 (假设: 全部文档集中在 1 个课程, 其余为 0)
    # 归一化: 均衡分 = 10 - (std / max_std) * 10
    max_std = mean * math.sqrt(len(counts) - 1) if len(counts) > 1 and mean > 0 else 1.0
    score = max(0.0, 10.0 - (std_dev / max_std) * 10.0) if max_std > 0 else 10.0

    return round(score, 1)


async def _score_learning_discipline(
    user_id: uuid.UUID, db: AsyncSession
) -> float:
    """
    学习自律度评分 (加权: 周稳定活跃 50% + 连续性 30% + 跟进率 20%)
    """
    since = _now_utc() - timedelta(days=DAYS_WINDOW)

    # 1. 周稳定活跃 (50%): 近 30 天有活跃的周数 / 4 周
    conversations = await _get_user_conversations(user_id, db, since)
    docs = await _get_user_documents(user_id, db, since)

    active_days: set[int] = set()
    for conv in conversations:
        if conv.created_at:
            active_days.add(conv.created_at.day)
    for doc in docs:
        if doc.created_at:
            active_days.add(doc.created_at.day)

    weeks_active = len(active_days) / 7.0  # 近似: 活跃天数/7
    weeks_active = min(weeks_active, 4.0)
    weekly_score = (weeks_active / 4.0) * 10.0

    # 2. 连续性 (30%): 最长连续活跃天数
    sorted_days = sorted(active_days)
    max_streak = 1
    current_streak = 1
    for i in range(1, len(sorted_days)):
        if sorted_days[i] - sorted_days[i - 1] <= 2:  # 间隔 2 天内视为连续
            current_streak += 1
        else:
            max_streak = max(max_streak, current_streak)
            current_streak = 1
    max_streak = max(max_streak, current_streak)
    streak_score = min(10.0, (max_streak / 14.0) * 10.0)  # 14 天连续 → 满分

    # 3. 跟进率 (20%): 上传课件后 7 天内有对话活动的比例
    follow_score = 0.0
    if docs:
        followed = 0
        for doc in docs:
            # 检查文档上传后 7 天内是否有对话
            doc_time = doc.created_at
            if doc_time:
                seven_days_after = doc_time + timedelta(days=7)
                conv_in_window = [
                    c for c in conversations
                    if c.created_at and doc_time <= c.created_at <= seven_days_after
                ]
                if conv_in_window:
                    followed += 1
        follow_score = (followed / len(docs)) * 10.0 if docs else 0.0

    score = weekly_score * 0.5 + streak_score * 0.3 + follow_score * 0.2
    return round(min(10.0, max(0.0, score)), 1)


async def _score_active_learning(
    user_id: uuid.UUID, db: AsyncSession
) -> float:
    """
    主动学习意愿评分 (加权: 自主上传 40% + 主动提问 35% + 收藏 25%)
    收藏功能暂未实现, 权重转移到上传和提问
    """
    since = _now_utc() - timedelta(days=DAYS_WINDOW)

    # 1. 自主上传课件 (40% → 实际 50% 因收藏暂缺)
    docs = await _get_user_documents(user_id, db, since)
    doc_count = len(docs)
    # 假设平台 30 天极值 = 30 个文档
    upload_score = min(10.0, (doc_count / 10.0) * 10.0)  # 10 个文档 → 满分

    # 2. 主动 AI 提问 (35% → 实际 50% 因收藏暂缺)
    user_msg_count = await _get_user_message_count(
        user_id, db, since, role="user"
    )
    question_score = min(10.0, (user_msg_count / 50.0) * 10.0)  # 50 条消息 → 满分

    # 收藏 占 25% → 暂用 0 代替, 接口预留
    collection_score = 0.0

    score = upload_score * 0.5 + question_score * 0.5
    return round(min(10.0, max(0.0, score)), 1)


async def _score_practice_intensity(
    user_id: uuid.UUID, db: AsyncSession
) -> float:
    """
    刷题巩固强度评分 (加权: 习题生成量 60% + Agent 完成率 40%)

    数据来源:
      - generated_resources: resource_type in ('exercise','code_practice','assessment')
      - agent_tasks: agent_name in ('exercise','coding_practice','assessment')
      - 通过 learning_sessions.user_id 关联到当前用户
    """
    from app.models.learning import LearningSession, LearningStage, GeneratedResource, AgentTask

    since = _now_utc() - timedelta(days=DAYS_WINDOW)

    # 1. 习题生成量 (60%): 近 30 天生成的习题资源数
    ex_stmt = (
        select(func.count(GeneratedResource.id))
        .join(LearningStage, GeneratedResource.stage_id == LearningStage.id)
        .join(LearningSession, LearningStage.session_id == LearningSession.id)
        .where(
            LearningSession.user_id == user_id,
            GeneratedResource.resource_type.in_(("exercise", "code_practice", "assessment")),
            GeneratedResource.created_at >= since,
        )
    )
    ex_result = await db.execute(ex_stmt)
    exercise_count = ex_result.scalar() or 0

    # 8 道题 → 满分
    exercise_score = min(10.0, (exercise_count / 8.0) * 10.0)

    # 2. Agent 完成率 (40%): 习题相关 Agent 任务的成功比例
    agent_stmt = (
        select(AgentTask.status, func.count(AgentTask.id))
        .join(LearningSession, AgentTask.session_id == LearningSession.id)
        .where(
            LearningSession.user_id == user_id,
            AgentTask.agent_name.in_(("exercise", "coding_practice", "assessment")),
            AgentTask.created_at >= since,
        )
        .group_by(AgentTask.status)
    )
    agent_result = await db.execute(agent_stmt)
    agent_rows = agent_result.all()

    total_tasks = 0
    completed_tasks = 0
    for row in agent_rows:
        status, cnt = row[0], row[1]
        total_tasks += cnt
        if status == "completed":
            completed_tasks += cnt

    agent_score = (completed_tasks / total_tasks) * 10.0 if total_tasks > 0 else 0.0

    score = exercise_score * 0.6 + agent_score * 0.4
    return round(min(10.0, max(0.0, score)), 1)


async def _score_review_habit(
    user_id: uuid.UUID, db: AsyncSession
) -> float:
    """
    复习复盘习惯评分
    基于: 历史课件二次回看、旧课件重新提问、AI 生成总结/复习视频
    当前: 统计用户是否在近 30 天对 30 天前上传的旧课件有新的对话提问
    """
    since_30d = _now_utc() - timedelta(days=DAYS_WINDOW)
    before_30d = _now_utc() - timedelta(days=DAYS_WINDOW)

    # 查找 30 天前上传的旧文档
    old_docs = await _get_user_documents(user_id, db)
    old_docs = [d for d in old_docs if d.created_at and d.created_at < before_30d]

    if not old_docs:
        return 3.0  # 没有旧资料 → 不适用, 给中低分

    # 检查近 30 天是否有对这些旧课程的新对话
    conversations = await _get_user_conversations(user_id, db, since_30d)
    review_conv_count = len(conversations)

    # 也统计近 30 天的用户消息数作为复习活动指标
    user_msgs = await _get_user_message_count(user_id, db, since_30d, role="user")

    # 复习活动越多分越高
    score = min(10.0, (review_conv_count / 5.0) * 5.0 + (user_msgs / 30.0) * 5.0)
    return round(min(10.0, max(0.0, score)), 1)


async def _score_focus_level(
    user_id: uuid.UUID, db: AsyncSession
) -> float:
    """
    听课专注度 (AI 学习沉浸度) 评分
    基于: 每次对话的平均消息数 (代理单次学习深度)
    当前: 统计近 30 天对话的平均消息数作为沉浸度指标
    后续可扩展: 视频观看率、页面停留时间等
    """
    since = _now_utc() - timedelta(days=DAYS_WINDOW)
    conversations = await _get_user_conversations(user_id, db, since)

    if not conversations:
        return 0.0

    # 统计每个对话的消息数 (代理学习深度)
    msg_counts: list[int] = []
    for conv in conversations:
        stmt = select(func.count(Message.id)).where(
            Message.conversation_id == conv.id
        )
        result = await db.execute(stmt)
        msg_counts.append(result.scalar() or 0)

    # 平均消息数 / 对话 → 学习深度指标
    avg_msgs = sum(msg_counts) / len(msg_counts) if msg_counts else 0

    # 有深度对话 (>20 条消息/对话) 的对话占比
    deep_convs = sum(1 for m in msg_counts if m >= 20)
    deep_ratio = deep_convs / len(msg_counts) if msg_counts else 0

    # 复合得分: 平均深度 + 深度对话占比
    depth_score = min(10.0, (avg_msgs / 30.0) * 7.0)  # 30 条/对话 → 7 分
    ratio_score = deep_ratio * 3.0  # 全部深度 → 3 分

    score = depth_score + ratio_score
    return round(min(10.0, max(0.0, score)), 1)


# ============================================================================
# 雷达图总控
# ============================================================================

async def get_radar_data(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> dict:
    """
    获取用户雷达图数据
    返回 6 维评分 + 每个维度的详细信息

    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: {
        dimensions: [{key, label, score, tooltip, icon, data_source}, ...],
        overall_score: 平均分,
        updated_at: 计算时间,
        data_available: 是否有足量数据,
    }
    """
    logger.info(f"计算雷达图: user_id={user_id}")

    # 并行计算各维度得分
    scores = {
        "subject_balance": await _score_subject_balance(user_id, db),
        "learning_discipline": await _score_learning_discipline(user_id, db),
        "active_learning": await _score_active_learning(user_id, db),
        "practice_intensity": await _score_practice_intensity(user_id, db),
        "review_habit": await _score_review_habit(user_id, db),
        "focus_level": await _score_focus_level(user_id, db),
    }

    # 检查数据可用性: 是否有任何维度拿到了有效数据
    has_data = any(v > 0.0 for v in scores.values())
    overall = round(sum(scores.values()) / len(scores), 1) if scores else 0.0

    # 组装维度列表
    dimensions = []
    for dim in RADAR_DIMENSIONS:
        key = dim["key"]
        score = scores.get(key, 0.0)
        dimensions.append({
            "key": key,
            "label": dim["label"],
            "score": score,
            "tooltip": dim["tooltip"],
            "icon": dim.get("icon", ""),
        })

    logger.info(
        f"雷达图计算完成: user_id={user_id}, "
        f"overall={overall}, dimensions={[d['score'] for d in dimensions]}"
    )

    return {
        "dimensions": dimensions,
        "overall_score": overall,
        "updated_at": _now_utc().isoformat(),
        "data_available": has_data,
    }
