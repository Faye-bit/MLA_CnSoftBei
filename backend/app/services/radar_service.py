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
import json
from typing import Optional
from datetime import datetime, timedelta, timezone
from collections import Counter
from sqlalchemy import select, func, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.document import Document
from app.models.course import Course
from app.models.conversation import Conversation, Message
from app.models.learning import LearningSession, LearningStage, GeneratedResource
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
        "tooltip": "高分: 多学科均衡上传课件、使用AI学习资源，无明显学科偏好偏差； 低分: 仅聚焦单一学科上传资料、AI提问学习，存在严重偏科行为。",
        "icon": "pie-chart",
    },
    {
        "key": "learning_discipline",
        "label": "学习自律度",
        "tooltip": "高分: 学习节奏稳定，上传课件后会及时借助AI巩固学习，不囤积资料； 低分: 学习碎片化、无规律，频繁断更，上传课件后长期不开展配套学习。",
        "icon": "clock-circle",
    },
    {
        "key": "active_learning",
        "label": "学习主动性",
        "tooltip": "高分: 主动沉淀学习资料、自主向AI探索提问，主动积累优质学习资源； 低分: 仅被动浏览平台资源，极少主动上传资料、发起AI学习互动。",
        "icon": "thunderbolt",
    },
    {
        "key": "practice_intensity",
        "label": "课后巩固度",
        "tooltip": "高分: 高频借助AI出题刷题，重视错题复盘，巩固学习效果； 低分: 仅生成习题不作答、做错不复盘，刷题无实际巩固效果。",
        "icon": "form",
    },
    {
        "key": "review_habit",
        "label": "知识留存度",
        "tooltip": "高分: 定期回顾已学知识，及时在遗忘临界前复习，知识留存率高； 低分: 学过即忘，很少回顾旧知识，长期记忆薄弱。",
        "icon": "sync",
    },
    {
        "key": "focus_level",
        "label": "学习沉浸度",
        "tooltip": "高分: 单次学习深度足、完成阶段多，能保持长时间专注学习； 低分: 学习碎片化，浅度浏览，单次学习完成阶段少。",
        "icon": "eye",
    },
]


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

    # 1b. AI智学 (v2) 习题生成量: 计数 ZhiXueResource 中的 exercise
    from app.models.zhixue import ZhiXueSession, ZhiXueStage, ZhiXueResource
    since_naive_pi = since.replace(tzinfo=None)  # v2 表使用 naive DateTime
    zx_ex_stmt = (
        select(func.count(ZhiXueResource.id))
        .join(ZhiXueStage, ZhiXueResource.stage_id == ZhiXueStage.id)
        .join(ZhiXueSession, ZhiXueStage.session_id == ZhiXueSession.id)
        .where(
            ZhiXueSession.user_id == user_id,
            ZhiXueResource.resource_type.in_(("exercise", "coding_practice")),
            ZhiXueResource.created_at >= since_naive_pi,
        )
    )
    zx_ex_result = await db.execute(zx_ex_stmt)
    exercise_count += (zx_ex_result.scalar() or 0)

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


# ============================================================================
# 各维度详情查询 (点击雷达图维度时使用)
# ============================================================================

async def get_dimension_detail(
    user_id: uuid.UUID,
    dimension_key: str,
    db: AsyncSession,
) -> dict:
    """
    获取某个维度的详细追踪数据
    返回该维度的细分指标、历史趋势和改进建议
    """
    since = _now_utc() - timedelta(days=DAYS_WINDOW)

    handlers = {
        "subject_balance": _detail_subject_balance,
        "learning_discipline": _detail_learning_discipline,
        "active_learning": _detail_active_learning,
        "practice_intensity": _detail_practice_intensity,
        "review_habit": _detail_review_habit,
        "focus_level": _detail_focus_level,
    }

    handler = handlers.get(dimension_key)
    if not handler:
        return {"detail_items": [], "suggestion": ""}

    score, items, suggestion = await handler(user_id, db, since)
    dim = next((d for d in RADAR_DIMENSIONS if d["key"] == dimension_key), None)
    return {
        "key": dimension_key,
        "label": dim["label"] if dim else dimension_key,
        "score": round(score, 1),
        "detail_items": items,
        "suggestion": suggestion,
    }


async def _detail_subject_balance(user_id, db, since):
    """学科均衡度明细: 各课程的行为分布"""
    from app.models.learning import LearningSession
    course_ids = await _get_user_course_ids(user_id, db)
    if not course_ids:
        return 0.0, [], "创建至少一门课程开始学习吧"

    items = []
    for cid in course_ids:
        doc_cnt = (await db.execute(select(func.count(Document.id)).where(Document.course_id == cid))).scalar() or 0
        session_cnt = (await db.execute(
            select(func.count(LearningSession.id)).where(
                LearningSession.course_id == cid, LearningSession.user_id == user_id
            )
        )).scalar() or 0
        course = await db.get(Course, cid)
        items.append({
            "label": course.name if course else "未知课程",
            "value": doc_cnt + session_cnt * 2,
            "doc_count": doc_cnt,
            "session_count": session_cnt,
        })

    counts = [i["value"] for i in items]
    total = sum(counts) if counts else 0
    mean = total / len(counts) if counts else 0
    variance = sum((c - mean) ** 2 for c in counts) / len(counts) if counts else 0
    std_dev = math.sqrt(variance)
    max_std = mean * math.sqrt(len(counts) - 1) if len(counts) > 1 and mean > 0 else 1.0
    score = max(0.0, 10.0 - (std_dev / max_std) * 10.0) if max_std > 0 else 10.0

    if len(counts) <= 1:
        suggestion = "尝试创建第二个课程, 在不同学科间均衡学习"
    elif std_dev < mean * 0.3:
        suggestion = "学科分布很均衡, 继续保持!"
    else:
        suggestion = f"「{items[counts.index(min(counts))]['label']}」投入较少, 可以增加学习时间"
    return score, items, suggestion


async def _detail_learning_discipline(user_id, db, since):
    """学习自律度明细: 近30天每日活跃日历"""
    conversations = await _get_user_conversations(user_id, db, since)
    docs = await _get_user_documents(user_id, db, since)
    from app.models.learning import LearningSession
    sessions_stmt = (
        select(LearningSession.created_at)
        .where(LearningSession.user_id == user_id, LearningSession.created_at >= since)
    )
    sessions_result = await db.execute(sessions_stmt)
    session_dates = [row[0].date() for row in sessions_result.all() if row[0]]

    # 构建每日活跃日历
    active_set: set = set()
    for c in conversations:
        if c.created_at: active_set.add(c.created_at.date())
    for d in docs:
        if d.created_at: active_set.add(d.created_at.date())
    for sd in session_dates:
        active_set.add(sd)

    today = _now_utc().date()
    days_list = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        days_list.append({"date": d.strftime("%Y-%m-%d"), "active": d in active_set})

    active_count = len(active_set)
    score = min(10.0, (active_count / 20.0) * 10.0)  # 20天活跃 → 满分

    if active_count >= 20:
        suggestion = "学习频率很高, 自律性优秀!"
    elif active_count >= 10:
        suggestion = "学习比较规律, 可以增加周末的学习频次"
    else:
        suggestion = "学习频率偏低, 建议每天至少安排30分钟学习时间"
    return score, days_list, suggestion


async def _detail_active_learning(user_id, db, since):
    """主动学习意愿明细: 上传/提问/会话"""
    docs = await _get_user_documents(user_id, db, since)
    user_msg_count = await _get_user_message_count(user_id, db, since, role="user")
    from app.models.learning import LearningSession
    session_count = (await db.execute(
        select(func.count(LearningSession.id)).where(
            LearningSession.user_id == user_id, LearningSession.created_at >= since
        )
    )).scalar() or 0

    items = [
        {"label": "上传文档", "value": len(docs), "max": 10, "unit": "份"},
        {"label": "AI 提问", "value": user_msg_count, "max": 50, "unit": "条"},
        {"label": "开启学习", "value": session_count, "max": 5, "unit": "次"},
    ]

    upload_score = min(10.0, (len(docs) / 10.0) * 10.0)
    question_score = min(10.0, (user_msg_count / 50.0) * 10.0)
    session_score = min(10.0, (session_count / 5.0) * 10.0)
    score = upload_score * 0.4 + question_score * 0.35 + session_score * 0.25

    total_activity = len(docs) + user_msg_count + session_count
    if total_activity >= 30:
        suggestion = "学习非常主动, 保持这个节奏!"
    elif total_activity >= 10:
        suggestion = "可以多向 AI 提问, 深度探索感兴趣的知识点"
    else:
        suggestion = "尝试上传一些课程资料或开启一次 AI 学习会话"
    return score, items, suggestion


def _is_correct(q: dict, user_ans, q_score) -> bool:
    """判断单题是否正确"""
    qtype = q.get("type", "")
    correct_ans = q.get("answer")
    if qtype == "multiple_choice":
        cs = set(int(x) for x in correct_ans) if isinstance(correct_ans, list) else set()
        us = set(int(x) for x in user_ans) if isinstance(user_ans, list) else set(x for x in (user_ans or []))
        return cs == us
    elif qtype in ("single_choice", "true_false"):
        expected = int(correct_ans) if not isinstance(correct_ans, bool) else (0 if correct_ans is True else 1)
        return int(user_ans or -1) == expected
    elif qtype in ("fill_blank", "short_answer"):
        if q_score is not None:
            return q_score >= 10
        return False
    return str(user_ans or "").strip() == str(correct_ans or "").strip()


async def _query_practice_weekly_stats(
    user_id, db: AsyncSession, since,
) -> tuple[list, list[dict]]:
    """
    查询练习数据并按天统计已答/错题数, 生成近 7 天周统计

    同时查询 v1 (GeneratedResource) 和 v2 (ZhiXueResource) 的习题数据

    :param user_id: 用户 ID
    :param db:      数据库会话
    :param since:   时间窗口起始
    :return:        (merged_rows, weekly_stats)
    """
    # ── v1: GeneratedResource ──
    ex_stmt = (
        select(
            GeneratedResource.id, GeneratedResource.title, GeneratedResource.resource_type,
            GeneratedResource.content, GeneratedResource.resource_metadata,
            GeneratedResource.created_at,
            LearningSession.course_id,
            LearningStage.id, LearningStage.title, LearningStage.order_index,
        )
        .join(LearningStage, GeneratedResource.stage_id == LearningStage.id)
        .join(LearningSession, LearningStage.session_id == LearningSession.id)
        .where(
            LearningSession.user_id == user_id,
            GeneratedResource.resource_type.in_(("exercise", "code_practice", "assessment")),
            GeneratedResource.created_at >= since,
        )
    )
    ex_result = await db.execute(ex_stmt)
    all_rows = list(ex_result.all())

    # ── v2: ZhiXueResource (模型使用 naive DateTime, 需将 since 转为 naive) ──
    from app.models.zhixue import ZhiXueSession, ZhiXueStage, ZhiXueResource
    since_naive = since.replace(tzinfo=None)  # v2 表的 DateTime 未带时区
    zx_stmt = (
        select(
            ZhiXueResource.id, ZhiXueResource.title, ZhiXueResource.resource_type,
            ZhiXueResource.content, ZhiXueResource.resource_metadata,
            ZhiXueResource.created_at,
            ZhiXueSession.course_id,
            ZhiXueStage.id, ZhiXueStage.title, ZhiXueStage.order_index,
        )
        .join(ZhiXueStage, ZhiXueResource.stage_id == ZhiXueStage.id)
        .join(ZhiXueSession, ZhiXueStage.session_id == ZhiXueSession.id)
        .where(
            ZhiXueSession.user_id == user_id,
            ZhiXueResource.resource_type.in_(("exercise", "coding_practice")),
            ZhiXueResource.created_at >= since_naive,
        )
    )
    zx_result = await db.execute(zx_stmt)
    all_rows.extend(zx_result.all())

    # 按天统计已答/错题
    ans_daily = Counter()
    wrong_daily = Counter()
    for row in all_rows:
        metadata = row[4]
        day = row[5].strftime("%a") if row[5] else None
        if not day:
            continue

        progress = (metadata or {}).get("exercise_progress", {})
        submitted_map = progress.get("submitted", {})
        answers = progress.get("answers", {})
        scores = progress.get("scores", {})

        try:
            content_json = json.loads(row[3]) if isinstance(row[3], str) else row[3]
            questions = content_json.get("questions", [])
        except (json.JSONDecodeError, TypeError):
            questions = []

        for q in questions:
            qid = q.get("id", "")
            if submitted_map.get(qid):
                ans_daily[day] += 1
                if not _is_correct(q, answers.get(qid), scores.get(qid, {}).get("score")):
                    wrong_daily[day] += 1

    # 构建周统计 (周一~周日)
    today = _now_utc().date()
    weekly_map = {(today - timedelta(days=i)).strftime("%a"): 0 for i in range(6, -1, -1)}
    wrong_weekly = dict(weekly_map)
    for k in weekly_map:
        weekly_map[k] = ans_daily.get(k, 0)
    for k in wrong_weekly:
        wrong_weekly[k] = wrong_daily.get(k, 0)
    weekly_stats = [{"day": k, "count": weekly_map[k], "wrong": wrong_weekly[k]} for k in weekly_map]

    return all_rows, weekly_stats


async def _build_practice_course_hierarchy(
    db: AsyncSession, ex_rows: list,
) -> tuple[list, int, int, int, list]:
    """
    从练习数据行构建 课程→阶段→练习题 层级结构

    :param db:      数据库会话
    :param ex_rows: _query_practice_weekly_stats 查询结果
    :return:        (courses_out, total_questions, answered_questions, correct_questions, weak_points)
    """
    course_map: dict = {}
    total_questions = 0
    answered_questions = 0
    correct_questions = 0
    weak_points = []

    for row in ex_rows:
        rid, title, rtype, content, metadata, created_at, course_id, stage_id, stage_title, stage_order = row

        # 课程名
        course_name = "未知课程"
        if course_id:
            c = await db.get(Course, course_id)
            if c:
                course_name = c.name

        if course_name not in course_map:
            course_map[course_name] = {"stages": {}}
        stages = course_map[course_name]["stages"]

        stage_key = stage_title or f"阶段{stage_order}"
        if stage_key not in stages:
            stages[stage_key] = {"exercises": [], "question_count": 0}

        try:
            content_json = json.loads(content) if isinstance(content, str) else content
            questions = content_json.get("questions", [])
        except (json.JSONDecodeError, TypeError):
            questions = []

        progress = (metadata or {}).get("exercise_progress", {})
        answers = progress.get("answers", {})
        submitted = progress.get("submitted", {})
        scores = progress.get("scores", {})

        exercise_questions = []
        for q in questions:
            qid = q.get("id", "")
            is_submitted = submitted.get(qid, False)
            user_ans = answers.get(qid)
            is_correct = False

            total_questions += 1
            stages[stage_key]["question_count"] += 1

            q_score = scores.get(qid, {}).get("score") if is_submitted else None
            if is_submitted:
                answered_questions += 1
                is_correct = _is_correct(q, user_ans, q_score)
                if is_correct:
                    correct_questions += 1
                else:
                    weak_points.append({
                        "title": q.get("question", qid)[:40],
                        "exercise_title": title,
                        "date": created_at.strftime("%m/%d") if created_at else "",
                    })

            exercise_questions.append({
                "id": qid,
                "text": q.get("question", "")[:60],
                "answered": is_submitted,
                "correct": is_correct if is_submitted else None,
                "score": q_score if is_submitted else None,
            })

        stages[stage_key]["exercises"].append({
            "id": str(rid),
            "title": title,
            "date": created_at.strftime("%m/%d") if created_at else "",
            "questions": exercise_questions,
            "content": content,
            "progress": progress,
        })

    # 扁平化为输出列表
    courses_out = []
    for cname, cdata in course_map.items():
        stages_out = []
        for sname, sdata in cdata["stages"].items():
            stages_out.append({
                "title": sname,
                "question_count": sdata["question_count"],
                "exercises": sdata["exercises"],
            })
        courses_out.append({"name": cname, "stages": stages_out})

    return courses_out, total_questions, answered_questions, correct_questions, weak_points


def _compute_practice_score(
    total_questions: int, answered_questions: int, correct_questions: int, weak_points: list,
) -> tuple[int, list, list, str]:
    """
    计算刷题巩固强度评分、薄弱点和建议

    :return: (score, detail_items, weak_dedup, suggestion)
    """
    accuracy = round(correct_questions / max(answered_questions, 1) * 100, 0)
    detail_items = [
        {"label": "总生成量", "value": total_questions, "unit": "题"},
        {"label": "已作答", "value": answered_questions, "unit": "题"},
        {"label": "正确率", "value": int(accuracy), "unit": "%"},
    ]

    completion_rate = answered_questions / max(total_questions, 1)
    accuracy_rate = correct_questions / max(answered_questions, 1) if answered_questions > 0 else 0
    score = round(min(10.0, completion_rate * 5.0 + accuracy_rate * 5.0), 1)

    # 薄弱点去重 Top 5
    weak_dedup = []
    seen = set()
    for w in weak_points:
        if w["title"] not in seen:
            seen.add(w["title"])
            weak_dedup.append(w)
    weak_dedup = weak_dedup[:5]

    if total_questions >= 30 and completion_rate >= 0.7:
        suggestion = "刷题量和作答率都很高! 关注错题对应的知识点加强巩固"
    elif total_questions >= 10:
        suggestion = "继续增加练习量, 每道题都提交后系统会追踪薄弱知识点"
    else:
        suggestion = "去 AI 助学开启学习会话, 系统会为你生成练习题"

    return int(score), detail_items, weak_dedup, suggestion


async def _detail_practice_intensity(user_id, db, since):
    """
    刷题巩固强度明细: 按题目为单位统计, 课程→阶段→资源→题目 层级

    拆分为三个子步骤:
      1. _query_practice_weekly_stats() → 查询数据 + 周统计
      2. _build_practice_course_hierarchy() → 构建层级结构
      3. _compute_practice_score() → 计算评分和薄弱点
    """
    ex_rows, weekly_stats = await _query_practice_weekly_stats(user_id, db, since)

    courses_out, total_q, answered_q, correct_q, weak_points = \
        await _build_practice_course_hierarchy(db, ex_rows)

    score, detail_items, weak_dedup, suggestion = \
        _compute_practice_score(total_q, answered_q, correct_q, weak_points)

    detail_data = {
        "weekly_stats": weekly_stats,
        "courses": courses_out,
        "weak_points": weak_dedup,
        "detail_items": detail_items,
    }
    return score, detail_data, suggestion


async def _detail_review_habit(user_id, db, since):
    """复习复盘习惯/知识留存度明细 (含 v1 LearningStage + v2 ZhiXueStage)"""
    from app.models.learning import LearningSession, LearningStage
    from app.models.zhixue import ZhiXueSession, ZhiXueStage

    # v1 stages
    stages_stmt = (
        select(LearningStage.title, LearningStage.status, LearningStage.created_at, LearningStage.knowledge_point_ids)
        .join(LearningSession, LearningStage.session_id == LearningSession.id)
        .where(LearningSession.user_id == user_id, LearningStage.created_at >= since)
    )
    stages_result = await db.execute(stages_stmt)
    stages = list(stages_result.all())

    # v2 ZhiXue stages (naive DateTime)
    since_naive = since.replace(tzinfo=None)
    zx_stages_stmt = (
        select(ZhiXueStage.title, ZhiXueStage.status, ZhiXueStage.created_at)
        .join(ZhiXueSession, ZhiXueStage.session_id == ZhiXueSession.id)
        .where(ZhiXueSession.user_id == user_id, ZhiXueStage.created_at >= since_naive)
    )
    zx_stages_result = await db.execute(zx_stages_stmt)
    for row in zx_stages_result.all():
        stages.append((row[0], row[1], row[2], []))  # ZhiXueStage has no knowledge_point_ids

    # Sort by created_at descending
    stages.sort(key=lambda s: s[2] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    items = []
    completed = sum(1 for s in stages if s[1] == "completed")
    total = len(stages)
    for s in stages[:8]:
        kp_names = (s[3] or [])[:3] if len(s) > 3 and isinstance(s[3], list) else []
        items.append({
            "label": s[0],
            "date": s[2].strftime("%m/%d") if s[2] else "",
            "status": s[1],
            "knowledge_points": kp_names,
        })

    score = min(10.0, (completed / max(total, 1)) * 10.0)

    if completed >= 3:
        suggestion = "复习习惯很好! 可以定期回顾已完成阶段的知识点"
    elif completed >= 1:
        suggestion = "完成学习后记得回顾之前学过但已遗忘的知识点"
    else:
        suggestion = "开启一次 AI 学习会话, 系统会帮你规划复习路径"
    return score, items, suggestion


async def _detail_focus_level(user_id, db, since):
    """学习沉浸度明细: 学习会话分析 (含 v1 + v2)"""
    from app.models.learning import LearningSession, LearningStage
    from app.models.zhixue import ZhiXueSession, ZhiXueStage
    from app.models.conversation import Message

    # v1 sessions
    sessions_stmt = (
        select(LearningSession.id, LearningSession.status, LearningSession.created_at)
        .where(LearningSession.user_id == user_id, LearningSession.created_at >= since)
        .order_by(LearningSession.created_at.desc())
    )
    sessions_result = await db.execute(sessions_stmt)
    sessions = list(sessions_result.all())

    # v2 ZhiXue sessions (naive DateTime)
    since_naive = since.replace(tzinfo=None)
    zx_stmt = (
        select(ZhiXueSession.id, ZhiXueSession.status, ZhiXueSession.created_at)
        .where(ZhiXueSession.user_id == user_id, ZhiXueSession.created_at >= since_naive)
        .order_by(ZhiXueSession.created_at.desc())
    )
    zx_result = await db.execute(zx_stmt)
    sessions.extend(zx_result.all())

    # Sort by created_at descending
    sessions.sort(key=lambda s: s[2] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    items = []
    total_stage_count = 0
    for sess in sessions:
        # Count stages from either v1 or v2
        if len(sess) >= 3:
            stage_count = (await db.execute(
                select(func.count(LearningStage.id)).where(LearningStage.session_id == sess[0])
            )).scalar() or 0
            stage_count += (await db.execute(
                select(func.count(ZhiXueStage.id)).where(ZhiXueStage.session_id == sess[0])
            )).scalar() or 0
            total_stage_count += stage_count
            items.append({
                "label": f"学习会话",
                "date": sess[2].strftime("%m/%d") if sess[2] else "",
                "status": sess[1],
                "stage_count": stage_count,
            })

    # 基于会话的阶段完成数评分
    score = min(10.0, (len(sessions) / 5.0) * 5.0 + (total_stage_count / 10.0) * 5.0)

    if len(sessions) >= 3:
        suggestion = "学习沉浸度不错! 每次会话完成后可以稍作休息再继续"
    elif len(sessions) >= 1:
        suggestion = "学习深度还可以加强, 试着每次学习完成 2-3 个阶段"
    else:
        suggestion = "开启 AI 助学进行一次完整的学习会话"
    return score, items, suggestion
