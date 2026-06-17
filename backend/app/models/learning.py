"""
学习会话模型
包含学习会话(LearningSession)、学习阶段(LearningStage)、
生成资源(GeneratedResource)和智能体任务(AgentTask)四张表
用于 Phase 3 多智能体协同与个性化资源生成功能
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Text, Integer, Boolean, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class LearningSession(Base):
    """
    学习会话表
    记录用户对某门课程的一次完整学习过程, 包含学习路径规划、阶段进度等信息
    支持中断恢复: 用户随时退出后可通过此表恢复学习状态
    """
    __tablename__ = "learning_sessions"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属用户 ID: 每个用户的学习会话互相隔离
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 关联课程 ID: 限定学习范围
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 会话状态: active (进行中) / completed (已完成) / paused (已暂停)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active"
    )

    # 完整学习路径: JSONB 存储阶段树
    # 结构: {"stages": [{"id": "stage-uuid", "title": "...", "order": 0,
    #         "status": "completed|active|pending", "kps": ["kp-id",...],
    #         "description": "..."}, ...]}
    learning_path: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 当前阶段序号: 0-based, 指向 learning_path.stages 的索引
    current_stage_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 画像快照: 会话开始时的学生画像, 保证此会话内画像一致性
    profile_snapshot: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 会话元数据: 总阶段数、已生成资源数、总 token 消耗等
    session_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 收藏标记: 用户可收藏学习会话以便快速访问
    is_favorited: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间: 每次保存学习状态或完成阶段时更新
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # 关联关系: 会话下的所有阶段, 按 order_index 升序
    stages: Mapped[List["LearningStage"]] = relationship(
        "LearningStage", back_populates="session", cascade="all, delete-orphan",
        order_by="LearningStage.order_index"
    )

    # 关联关系: 会话下的所有智能体任务
    agent_tasks: Mapped[List["AgentTask"]] = relationship(
        "AgentTask", back_populates="session", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return (
            f"<LearningSession(id={self.id}, course_id={self.course_id}, "
            f"status={self.status}, stage={self.current_stage_index})>"
        )


class LearningStage(Base):
    """
    学习阶段表
    学习路径中的每个阶段, 包含该阶段的学习目标、涵盖知识点和生成的所有资源
    """
    __tablename__ = "learning_stages"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属会话 ID
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("learning_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 阶段标题: 如"进程与线程基础"
    title: Mapped[str] = mapped_column(
        String(200), nullable=False
    )

    # 阶段描述: Coordinator Agent 生成的阶段概述
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 阶段排序序号: 0-based, 在会话内的顺序
    order_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 阶段状态: pending (待生成) / generating (生成中) / completed (已完成) / failed (生成失败)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )

    # 知识点 ID 列表: JSONB 数组, 本阶段涵盖的知识点
    # 格式: ["kp-uuid-1", "kp-uuid-2", ...]
    knowledge_point_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )

    # 阶段元数据: 生成耗时、token 消耗、已读资源数等
    stage_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # 表级约束: 同一会话内每个阶段序号唯一, 防止 SSE 重连产生重复阶段
    __table_args__ = (
        UniqueConstraint("session_id", "order_index", name="uq_learning_stage_session_order"),
    )

    # 关联关系: 所属会话
    session: Mapped["LearningSession"] = relationship(
        "LearningSession", back_populates="stages"
    )

    # 关联关系: 阶段下生成的所有资源, 按 order_index 升序
    resources: Mapped[List["GeneratedResource"]] = relationship(
        "GeneratedResource", back_populates="stage", cascade="all, delete-orphan",
        order_by="GeneratedResource.order_index"
    )

    def __repr__(self) -> str:
        return (
            f"<LearningStage(id={self.id}, title={self.title}, "
            f"order={self.order_index}, status={self.status})>"
        )


class GeneratedResource(Base):
    """
    生成资源表
    各个 Agent 生成的单个学习资源文件, 如讲义、思维导图、练习题等
    资源内容以 Markdown / JSON / Mermaid 语法等形式存储在 content 字段中
    """
    __tablename__ = "generated_resources"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属阶段 ID
    stage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("learning_stages.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 资源类型: handout (讲义) / mindmap (思维导图) / exercise (练习题) /
    #          code_practice (编程练习) / reading (拓展阅读) / video_script (动画脚本) /
    #          document (参考文档) / assessment (自测评估)
    resource_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )

    # 资源标题: 如"进程调度算法深度讲解"
    title: Mapped[str] = mapped_column(
        String(300), nullable=False
    )

    # 资源描述: Teaching Design Agent 生成的简短说明
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 资源内容: Markdown 格式 (讲义/拓展阅读/动画脚本/编程练习),
    #          JSON 格式 (练习题/自测评估), Mermaid 语法 (思维导图)
    content: Mapped[str] = mapped_column(
        Text, nullable=False, default=""
    )

    # 资源元数据: 格式提示、生成 Agent 名称、生成配置、难度、引用来源等
    resource_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 排序序号: 在同一阶段内的展示顺序
    order_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 关联关系: 所属阶段
    stage: Mapped["LearningStage"] = relationship(
        "LearningStage", back_populates="resources"
    )

    # 关联关系: 生成此资源所涉及的智能体任务
    agent_tasks: Mapped[List["AgentTask"]] = relationship(
        "AgentTask", back_populates="resource", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return (
            f"<GeneratedResource(id={self.id}, type={self.resource_type}, "
            f"title={self.title})>"
        )


class AgentTask(Base):
    """
    智能体任务追踪表
    记录每次 Agent 调用的输入输出、状态和性能指标
    用于多智能体流程可视化和调试
    """
    __tablename__ = "agent_tasks"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属会话 ID
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("learning_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    # 关联资源 ID: 可选, 资源生成类 Agent 关联到具体生成的资源
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generated_resources.id", ondelete="SET NULL"),
        nullable=True
    )

    # Agent 角色名称: coordinator (协调者) / profile (画像) / retrieval (检索) /
    #               teaching_design (教学设计) / handout (讲义) / mindmap (思维导图) /
    #               exercise (练习题) / reading (拓展阅读) / coding_practice (编程练习) /
    #               video_script (动画脚本) / document (参考文档) / assessment (自测评估) /
    #               safety (安全核查)
    agent_name: Mapped[str] = mapped_column(
        String(30), nullable=False
    )

    # 任务状态: pending (等待) / running (运行中) / completed (已完成) / failed (失败)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )

    # 输入摘要: Agent 接收的输入内容的简短描述
    input_summary: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 输出摘要: Agent 生成的输出内容的简短摘要
    output_summary: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 执行延迟: 毫秒, Agent 调用耗时
    latency_ms: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # Token 消耗: 本次 Agent 调用消耗的 token 数
    token_count: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # 错误信息: 仅在 status=failed 时有值
    error_message: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 完成时间: 任务完成时记录
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 关联关系: 所属会话
    session: Mapped["LearningSession"] = relationship(
        "LearningSession", back_populates="agent_tasks"
    )

    # 关联关系: 生成的资源 (可选, 协调/画像/检索/教学设计/安全 Agent 不直接生成资源)
    resource: Mapped[Optional["GeneratedResource"]] = relationship(
        "GeneratedResource", back_populates="agent_tasks"
    )

    def __repr__(self) -> str:
        return (
            f"<AgentTask(id={self.id}, agent={self.agent_name}, "
            f"status={self.status})>"
        )
