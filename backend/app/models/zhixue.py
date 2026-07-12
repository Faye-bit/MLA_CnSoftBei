"""
AI智学 数据库模型
包含智学会话(ZhiXueSession)、智学阶段(ZhiXueStage)、
智学资源(ZhiXueResource)、智学智能体任务(ZhiXueAgentTask)、
智学审查(ZhiXueReview)、智学问卷(ZhiXueQuestionnaire)、
智学搜索结果(ZhiXueSearchResult) 七张表

与旧 AI助学 表 (learning_*) 完全独立, 通过 zhixue_ 前缀区分
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, Integer, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ZhiXueSession(Base):
    """
    智学会话表
    记录用户在 AI智学 中对某门课程的一次完整学习过程。
    与 LearningSession 表完全独立, 通过 study_pace 和 difficulty_adjustment
    实现个性化阶段划分和难度动态调整。
    """
    __tablename__ = "zhixue_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 会话状态
    status: Mapped[str] = mapped_column(
        String(32), default="idle", nullable=False,
        comment="idle / questionnaire / planning / generating / reviewing / "
                "delivering / completed / interrupted / failed"
    )

    # 学习路径规划 (JSONB: 存储阶段列表)
    learning_path: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True,
        comment="各阶段信息, 含 title, description, knowledge_points, status"
    )

    # 当前正在学习的阶段序号 (0-based)
    current_stage_index: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False,
    )

    # 学习节奏 (问卷收集)
    study_pace: Mapped[Optional[str]] = mapped_column(
        String(16), nullable=True,
        comment="steady / moderate / cram"
    )

    # 基于反馈的动态难度系数 (0.0~1.0, 默认 0.5)
    difficulty_adjustment: Mapped[float] = mapped_column(
        Float, default=0.5, nullable=False,
    )

    # 采风网络搜索开关
    scouting_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False,
    )

    # 用户选择的资源类型列表 (JSONB)
    selected_materials: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
        comment="用户勾选的材料类型: handout, mindmap, exercise, reading, animation, code"
    )

    # 画像快照 (创建会话时的画像副本)
    profile_snapshot: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True,
    )

    # LangGraph Checkpointer 的 thread_id (与 session_id 相同)
    checkpoint_thread_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True,
    )

    # 会话元信息 (JSONB: token 消耗、生成耗时等)
    session_metadata: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True,
    )

    # 用户收藏标记
    is_favorited: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False,
        comment="用户是否收藏此会话"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default="now()", nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default="now()", nullable=False,
    )


class ZhiXueStage(Base):
    """智学阶段表: 学习路径中的单个阶段, 对应一组学习资源"""
    __tablename__ = "zhixue_stages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    title: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 阶段状态
    status: Mapped[str] = mapped_column(
        String(32), default="pending", nullable=False,
        comment="pending / generating / completed / failed"
    )

    # 知识点 ID 列表 (JSONB)
    knowledge_point_ids: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # 是否触发了补救资源 (最多 1 次)
    remedial_triggered: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False,
    )

    # 阶段元信息 (JSONB: 预计时长, 审查报告等)
    stage_metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")


class ZhiXueResource(Base):
    """智学资源表: 各阶段生成的学习资源"""
    __tablename__ = "zhixue_resources"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    stage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_stages.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 资源类型
    resource_type: Mapped[str] = mapped_column(
        String(32), nullable=False,
        comment="handout / mindmap / exercise / reading / animation / code"
    )

    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 资源内容 (Markdown / HTML / JSON 字符串)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 是否为补救资源
    is_remedial: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False,
    )

    # 排序序号
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # 资源元信息 (JSONB: 生成器信息, 审查标记, 来源引用等)
    resource_metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")


class ZhiXueAgentTask(Base):
    """智学智能体任务表: 记录每个 Agent 的执行轨迹, 用于调试和性能追踪"""
    __tablename__ = "zhixue_agent_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    stage_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_stages.id", ondelete="SET NULL"),
        nullable=True,
    )

    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_resources.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Agent 标识
    agent_code: Mapped[str] = mapped_column(
        String(64), nullable=False,
        comment="profile_analyst / path_planner / crafter_handout / ..."
    )
    agent_name: Mapped[str] = mapped_column(
        String(64), nullable=False,
        comment="学情诊断师俞知 / 教纲设计专家李纲 / ..."
    )

    # 任务状态
    status: Mapped[str] = mapped_column(
        String(32), default="pending", nullable=False,
    )

    # 输入/输出摘要
    input_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    output_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 性能指标
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 错误信息
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ZhiXueReview(Base):
    """智学审查表: 存储简真对每个阶段的 L1/L2/L3 审查结果"""
    __tablename__ = "zhixue_reviews"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    stage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_stages.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 整体审查结果
    overall_verdict: Mapped[str] = mapped_column(
        String(32), nullable=False,
        comment="ALL_PASS / RETRY_L1 / MAX_RETRY"
    )

    # 重试次数
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # 逐材料审查详情 (JSONB)
    per_material: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True,
        comment="{ material_type: { l1_passed, l2_score, l2_warning, l3_warning, ... } }"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")


class ZhiXueQuestionnaire(Base):
    """智学问卷表: 存储俞知生成的问卷和用户作答"""
    __tablename__ = "zhixue_questionnaires"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zhixue_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 问卷类型
    questionnaire_type: Mapped[str] = mapped_column(
        String(32), default="initial", nullable=False,
        comment="initial / stage_feedback"
    )

    # 生成的问卷内容 (JSONB: 题目列表)
    questions: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
    )

    # 用户作答 (JSONB: 答案列表, 可为空表示跳过)
    answers: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
    )

    # 是否超时跳过
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    skip_reason: Mapped[Optional[str]] = mapped_column(
        String(32), nullable=True,
        comment="user_skipped / timeout"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ZhiXueSearchResult(Base):
    """智学搜索结果表: 缓存蔡丰的网络搜索结果 (按 course 级缓存)"""
    __tablename__ = "zhixue_search_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 搜索查询关键词
    query: Mapped[str] = mapped_column(String(512), nullable=False)

    # 搜索结果 (JSONB: 结构化结果列表)
    results: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # 搜索源
    search_source: Mapped[str] = mapped_column(
        String(64), default="bocha", nullable=False,
    )

    # 结果摘要
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 缓存过期时间
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="now()")
