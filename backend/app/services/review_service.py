"""
艾宾浩斯遗忘曲线复习提醒服务

核心逻辑:
  1. 用户学习时调用 record_learning() 记录事件
  2. 自动按艾宾浩斯曲线 (1/3/7/15/30 天) 生成 5 条 ReviewSchedule
  3. 定时或登录时调用 get_pending_reviews() 获取待复习项
  4. 用户复习后调用 mark_reviewed() 标记完成
  5. 邮件提醒调用 send_review_email() (复用现有邮件基础设施)

提醒方式: 系统弹窗 (默认) / 邮件 (用户可在设置中开启)
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.review import LearningRecord, ReviewSchedule, EBBINGHAUS_INTERVALS
from app.models.course import Course, Chapter, KnowledgePoint
from app.models.user import User
from app.services.config_service import get_config_value
from loguru import logger


# ============================================================================
# 学习记录
# ============================================================================

async def record_learning(
    user_id: uuid.UUID,
    content_type: str,
    content_title: str,
    db: AsyncSession,
    course_id: Optional[uuid.UUID] = None,
    knowledge_point_id: Optional[uuid.UUID] = None,
    duration_seconds: Optional[int] = None,
    enable_email_reminder: bool = False,
) -> LearningRecord:
    """
    记录一次学习活动, 并自动生成艾宾浩斯复习计划

    :param user_id: 用户 ID
    :param content_type: 内容类型 (course_view / chapter_view / kp_view / chat / exercise / resource)
    :param content_title: 内容标题
    :param db: 数据库会话
    :param course_id: 关联课程 ID (可选)
    :param knowledge_point_id: 关联知识点 ID (可选)
    :param duration_seconds: 学习时长 (秒)
    :param enable_email_reminder: 是否启用邮件提醒
    :return: 创建的学习记录
    """
    now = datetime.now(timezone.utc)
    remind_method = "both" if enable_email_reminder else "popup"

    # 自动解析内容类型和标题
    if content_type == "course_view" and course_id:
        course = await db.get(Course, course_id)
        if course:
            content_title = f"课程: {course.name}"
    elif content_type == "chapter_view" and course_id:
        course = await db.get(Course, course_id)
        content_title = f"章节: {content_title} (来自「{course.name if course else '?'}」)"
    elif content_type == "kp_view" and knowledge_point_id:
        kp = await db.get(KnowledgePoint, knowledge_point_id)
        if kp:
            content_title = f"知识点: {kp.title}"

    # 去重: 同一天内重复学习同一内容的, 更新已有记录而不是新建
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = select(LearningRecord).where(
        and_(
            LearningRecord.user_id == user_id,
            LearningRecord.content_type == content_type,
            LearningRecord.content_title == content_title,
            LearningRecord.created_at >= today_start,
        )
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        # 更新已有记录的时间戳, 重新生成复习计划
        existing.created_at = now
        # 删除旧计划重建
        from sqlalchemy import delete as sqla_delete
        del_stmt = sqla_delete(ReviewSchedule).where(
            ReviewSchedule.record_id == existing.id
        )
        await db.execute(del_stmt)
        record = existing
        logger.info(f"去重: 更新已有学习记录 {record.id}")
    else:
        record = LearningRecord(
            user_id=user_id,
            course_id=course_id,
            knowledge_point_id=knowledge_point_id,
            content_type=content_type,
            content_title=content_title,
            duration_seconds=duration_seconds,
        )
        db.add(record)
        await db.flush()

    # 按艾宾浩斯曲线生成复习计划
    schedule_count = 0
    for idx, days in enumerate(EBBINGHAUS_INTERVALS):
        review_date = now + timedelta(days=days)
        schedule = ReviewSchedule(
            record_id=record.id,
            user_id=user_id,
            course_id=course_id,
            interval_index=idx,
            review_at=review_date,
            remind_method=remind_method,
            content_title=content_title,
            content_type=content_type,
        )
        db.add(schedule)
        schedule_count += 1

    await db.commit()
    logger.info(
        f"学习记录: user={user_id}, type={content_type}, "
        f"title={content_title[:30]}..., 复习计划={schedule_count} 条"
    )
    return record


# ============================================================================
# 获取待复习提醒
# ============================================================================

async def get_pending_reviews(
    user_id: uuid.UUID,
    db: AsyncSession,
    limit: int = 20,
) -> List[ReviewSchedule]:
    """
    获取用户当前到期的待复习提醒列表
    仅返回 review_at <= now 且 status='pending' 的条目

    :param user_id: 用户 ID
    :param db: 数据库会话
    :param limit: 最多返回条数
    :return: 待复习提醒列表 (按复习时间排序)
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(ReviewSchedule)
        .where(
            and_(
                ReviewSchedule.user_id == user_id,
                ReviewSchedule.review_at <= now,
                ReviewSchedule.status == "pending",
            )
        )
        .order_by(ReviewSchedule.review_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    schedules = result.scalars().all()
    return list(schedules)


async def get_upcoming_reviews(
    user_id: uuid.UUID,
    db: AsyncSession,
    days_ahead: int = 3,
) -> List[ReviewSchedule]:
    """
    获取未来 N 天内到期的复习提醒 (用于预告)

    :param user_id: 用户 ID
    :param db: 数据库会话
    :param days_ahead: 提前天数
    :return: 即将到期的复习提醒
    """
    now = datetime.now(timezone.utc)
    future = now + timedelta(days=days_ahead)
    stmt = (
        select(ReviewSchedule)
        .where(
            and_(
                ReviewSchedule.user_id == user_id,
                ReviewSchedule.review_at > now,
                ReviewSchedule.review_at <= future,
                ReviewSchedule.status == "pending",
            )
        )
        .order_by(ReviewSchedule.review_at.asc())
        .limit(10)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ============================================================================
# 标记已复习
# ============================================================================

async def mark_reviewed(
    schedule_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[ReviewSchedule]:
    """
    标记一条复习提醒为已完成

    :param schedule_id: 复习计划 ID
    :param user_id: 用户 ID (权限校验)
    :param db: 数据库会话
    :return: 更新后的计划, 不存在或权限不匹配返回 None
    """
    stmt = select(ReviewSchedule).where(
        and_(
            ReviewSchedule.id == schedule_id,
            ReviewSchedule.user_id == user_id,
        )
    )
    result = await db.execute(stmt)
    schedule = result.scalar_one_or_none()

    if not schedule:
        return None

    schedule.status = "completed"
    schedule.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info(f"复习完成: {schedule.content_title[:30]}... (day+{EBBINGHAUS_INTERVALS[schedule.interval_index]})")
    return schedule


async def mark_all_reviewed(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> int:
    """
    一键标记所有到期提醒为已完成

    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 标记数量
    """
    now = datetime.now(timezone.utc)
    stmt = select(ReviewSchedule).where(
        and_(
            ReviewSchedule.user_id == user_id,
            ReviewSchedule.review_at <= now,
            ReviewSchedule.status == "pending",
        )
    )
    result = await db.execute(stmt)
    schedules = result.scalars().all()

    count = 0
    for s in schedules:
        s.status = "completed"
        s.reviewed_at = now
        count += 1

    await db.commit()
    logger.info(f"批量标记复习完成: {count} 条")
    return count


# ============================================================================
# 邮件提醒 (复用现有邮件基础设施)
# ============================================================================

async def send_review_email_reminder(
    user: User,
    pending_reviews: List[ReviewSchedule],
) -> bool:
    """
    发送复习提醒邮件

    :param user: 用户对象
    :param pending_reviews: 待复习列表 (最多 5 条, 避免邮件过长)
    :return: 是否发送成功
    """
    if not user.email:
        return False

    try:
        from app.services.email_service import send_email

        review_items = ""
        for i, rv in enumerate(pending_reviews[:5], 1):
            days_ago = (datetime.now(timezone.utc) - rv.review_at).days
            review_items += f"  {i}. {rv.content_title} (应于 {days_ago} 天前复习)\n"

        subject = f"MLA 智学引擎 - 学习复习提醒"
        body = f"""你好 {user.nickname or user.username},

根据艾宾浩斯遗忘曲线, 以下内容建议你尽快复习巩固:

{review_items}

定期复习是提升长期记忆的关键。登录平台即可查看详情并完成复习任务。

祝学习愉快!
MLA 智学引擎
"""

        await send_email(
            to_email=user.email,
            subject=subject,
            body=body,
        )

        # 标记这些提醒已发送
        logger.info(f"复习邮件已发送: {user.email}, {len(pending_reviews)} 条提醒")
        return True
    except Exception as e:
        logger.warning(f"复习邮件发送失败: {e}")
        return False
