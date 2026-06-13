"""
学生画像模型
存储从对话中提取的结构化学生画像, 包含 8 个维度的学习特征
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class StudentProfile(Base):
    """
    学生画像表
    每个用户只有一条最新画像记录, 历史版本通过 version 字段追踪

    profile_data JSONB 结构 (描述式, 6 维度, 每维度为自然语言字符串):
    {
      "academic_background": "学生是软件工程专业大二本科在读。",
      "knowledge_basis": "学生已学习C++和数据结构, 当前在学操作系统原理。",
      "learning_goals": "学生希望通过期末考试并掌握核心概念。",
      "learning_preferences": "学生喜欢先看理论再动手实践。",
      "weak_areas": "学生对进程调度和死锁处理有困惑。",
      "interests": "学生对计算机系统和底层原理感兴趣。"
    }

    memories JSONB 数组: 后台自动从对话中提取的用户信息片段
    """
    __tablename__ = "student_profiles"

    # 主键: UUID 全局唯一标识
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 所属用户 ID: 唯一约束, 一个用户一条画像
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        unique=True, nullable=False, index=True
    )

    # 结构化画像数据: JSONB 格式, 存储全部 8 个维度的具体信息
    profile_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 各维度置信度: JSONB, 格式 {"academic_background": 0.9, "knowledge_basis": 0.5, ...}
    # 置信度基于各维度的字段填充率和信息具体程度自动计算
    confidence_scores: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # 尚未收集的字段: JSONB 数组, 如 ["major", "grade", "specific_goals"]
    # 用于画像收集时引导 LLM 追问
    missing_fields: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )

    # 画像摘要: LLM 生成的简短文本描述, 便于快速了解学生情况
    summary: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # 记忆片段: 后台自动从对话中提取的用户信息片段 (自然语言)
    # 格式: ["学生是计算机科学专业大三学生", "学生对反向传播理解有困难", ...]
    # 最多保留 30 条, 去重后按时间排序
    memories: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )

    # 画像版本号: 每次更新递增, 用于追踪画像演进历史
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<StudentProfile(id={self.id}, user_id={self.user_id}, version={self.version})>"
