"""
艾宾浩斯复习提醒模型
记录用户的学习行为和基于遗忘曲线的复习计划

艾宾浩斯遗忘曲线复习节点: 1天 / 3天 / 7天 / 15天 / 30天
每当用户浏览课程/章节/知识点时, 系统自动记录并生成复习计划
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Text, Integer, Float, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

# 艾宾浩斯复习间隔 (天)
EBBINGHAUS_INTERVALS = [1, 3, 7, 15, 30]


class LearningRecord(Base):
    """
    学习记录表
    记录用户每次学习活动 (浏览课程/章节/知识点、完成对话等)
    每次记录会级联生成多个 ReviewSchedule 行
    """
    __tablename__ = "learning_records"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属用户
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 关联课程 (可选, 如果学习内容属于某个课程)
    course_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL"),
        nullable=True, index=True
    )

    # 关联知识点 (可选)
    knowledge_point_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="SET NULL"),
        nullable=True
    )

    # 学习内容类型: course_view / chapter_view / kp_view / chat / exercise / resource
    content_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )

    # 学习内容标题 (如课程名、知识点名)
    content_title: Mapped[str] = mapped_column(
        String(300), nullable=False
    )

    # 学习时长 (秒, 可选)
    duration_seconds: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # 创建时间 (学习时间)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 级联关系: 此学习记录对应的所有复习计划行
    schedules: Mapped[List["ReviewSchedule"]] = relationship(
        "ReviewSchedule", back_populates="record", cascade="all, delete-orphan",
        order_by="ReviewSchedule.review_at"
    )

    def __repr__(self) -> str:
        return f"<LearningRecord({self.id}, {self.content_type}, {self.content_title[:20]})>"


class ReviewSchedule(Base):
    """
    复习计划表
    每条记录 = 一次学习事件在某个时间节点的复习提醒
    用户完成复习后标记为 completed
    """
    __tablename__ = "review_schedules"

    # 主键
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属学习记录
    record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("learning_records.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 所属用户 (冗余, 加速查询)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 关联知识点 (可选, 用于展示 AI 解释知识卡片)
    knowledge_point_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="SET NULL"),
        nullable=True
    )

    # 关联课程 (冗余, 用于前端展示)
    course_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL"),
        nullable=True
    )

    # 艾宾浩斯区间索引: 0=1天, 1=3天, 2=7天, 3=15天, 4=30天
    interval_index: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    # 计划复习时间
    review_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    # 状态: pending / completed / skipped
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )

    # 实际复习时间
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 提醒方式: popup (系统弹窗) / email (邮件) / both (两者都有)
    remind_method: Mapped[str] = mapped_column(
        String(20), nullable=False, default="popup"
    )

    # 是否已发送提醒
    reminded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # 学习内容标题 (冗余, 方便前端直接展示)
    content_title: Mapped[str] = mapped_column(
        String(300), nullable=False
    )

    # 学习内容类型
    content_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 关联关系
    record: Mapped["LearningRecord"] = relationship(
        "LearningRecord", back_populates="schedules"
    )

    def __repr__(self) -> str:
        return (
            f"<ReviewSchedule({self.id}, day+{EBBINGHAUS_INTERVALS[self.interval_index]}, "
            f"status={self.status})>"
        )
