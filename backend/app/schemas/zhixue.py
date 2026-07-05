"""
AI智学 Pydantic Schema 定义
包含学习画像、学习计划、资源材料、审查报告、问卷等核心数据结构

引用 improvement/schema.py 中的设计, 精简为实际需要的字段
"""

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# ============================================================================
# 章节与课程信息
# ============================================================================

class ChapterInfo(BaseModel):
    """章节信息 (从数据库读取, 供李纲规划使用)"""
    id: str
    title: str
    knowledge_points: list[str] = Field(default_factory=list)


class CourseContext(BaseModel):
    """课程上下文 (init_session 节点产出)"""
    course_id: str
    course_name: str
    chapters: list[ChapterInfo] = Field(default_factory=list)
    total_knowledge_points: int = 0


# ============================================================================
# 学习画像 (俞知产出)
# ============================================================================

class KnowledgeLevel(BaseModel):
    """某个知识领域的水平评估"""
    domain: str = Field(..., description="知识领域名称")
    level: float = Field(default=0.5, ge=0.0, le=1.0, description="掌握水平 0~1")


class StylePreference(BaseModel):
    """学习风格偏好"""
    dimension: str = Field(..., description="偏好维度: visual/auditory/reading/kinesthetic")
    score: float = Field(default=0.5, ge=0.0, le=1.0)


class LearningProfile(BaseModel):
    """融合后的学习画像 (俞知产出)"""
    profile_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    course_id: str

    # 知识水平
    knowledge_levels: list[KnowledgeLevel] = Field(default_factory=list)

    # 学习风格
    style_preferences: list[StylePreference] = Field(default_factory=list)

    # 学习目标
    learning_goals: list[str] = Field(default_factory=list)

    # 学习节奏 (驱动李纲动态阶段数)
    study_pace: Literal["steady", "moderate", "cram"] = "moderate"

    # 学习侧重点
    focus_area: Literal["theory", "practice", "balanced"] = "balanced"

    # 掌握深度期望
    mastery_depth: Literal["understand", "master", "expert"] = "master"

    # 推荐的材料类型
    recommended_material_types: list[str] = Field(default_factory=list)

    # 难度建议 (0.0~1.0)
    suggested_difficulty: float = Field(default=0.5, ge=0.0, le=1.0)

    # 特殊需求
    special_requirements: list[str] = Field(default_factory=list)

    # 问卷洞察 (从问卷中提取的额外信息)
    questionnaire_insights: dict[str, Any] = Field(default_factory=dict)

    # 用户跳过问卷?
    questionnaire_skipped: bool = False


# ============================================================================
# 学习计划 (李纲产出)
# ============================================================================

class StageObjective(BaseModel):
    """阶段学习目标"""
    objective_id: str = Field(default_factory=lambda: str(uuid4()))
    description: str
    measurable_outcome: str = ""
    kb_refs: list[str] = Field(default_factory=list)


class StageInfo(BaseModel):
    """学习阶段信息 (含预估时长)"""
    stage_number: int = Field(..., ge=0)
    title: str
    topic: str
    description: str = ""
    objectives: list[StageObjective] = Field(default_factory=list)
    kb_refs: list[str] = Field(default_factory=list)
    estimated_duration_minutes: int = Field(default=30)
    material_types: list[str] = Field(default_factory=list)
    knowledge_points: list[str] = Field(default_factory=list)
    status: str = "pending"


class LearningPlan(BaseModel):
    """学习计划 (李纲产出)"""
    plan_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    course_id: str
    profile_id: str

    # 阶段列表 (数量由 study_pace 动态决定: 2~20)
    stages: list[StageInfo] = Field(default_factory=list, min_length=2, max_length=20)

    # 全局材料选择
    selected_materials: list[str] = Field(default_factory=list)

    # 计划概述
    overview: str = ""

    # 总预估时长 (分钟)
    total_estimated_minutes: int = 0


# ============================================================================
# 问卷 (俞知产出)
# ============================================================================

class QuestionnaireQuestion(BaseModel):
    """单个问卷题目 (轻量: 单选/多选 + 选填简答)"""
    question_id: str = Field(default_factory=lambda: f"q{uuid4().hex[:8]}")
    question_type: Literal["single_choice", "multi_choice", "open_ended"]
    category: str = Field(default="general", description="knowledge/style/goal/pace/requirement")
    text: str
    description: Optional[str] = None
    options: list[str] = Field(default_factory=list)
    required: bool = True


class Questionnaire(BaseModel):
    """轻量问卷 (5-8 题)"""
    questionnaire_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    course_id: str
    title: str = "课前学习调研"
    description: str = "为了给你提供更精准的学习方案, 请花 1 分钟回答几个问题"
    questions: list[QuestionnaireQuestion] = Field(default_factory=list)
    timeout_seconds: int = Field(default=180)
    generated_by: str = Field(default="学情诊断师俞知")


class QuestionnaireAnswer(BaseModel):
    """单个题目的回答"""
    question_id: str
    selected_options: list[str] = Field(default_factory=list)
    open_text: Optional[str] = None


class QuestionnaireResponse(BaseModel):
    """用户提交的问卷回答"""
    response_id: str = Field(default_factory=lambda: str(uuid4()))
    questionnaire_id: str
    session_id: str
    answers: list[QuestionnaireAnswer] = Field(default_factory=list)
    skipped: bool = False
    skip_reason: str = ""


# ============================================================================
# 审查 (简真产出)
# ============================================================================

class PerMaterialReview(BaseModel):
    """单个材料的审查结果"""
    material_type: str
    l1_passed: bool = True
    l1_errors: list[str] = Field(default_factory=list)
    l2_score: Optional[float] = None
    l2_warning: Optional[str] = None
    l3_warning: Optional[str] = None


class QualityReviewReport(BaseModel):
    """审查报告"""
    report_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    stage_number: int
    per_material: dict[str, PerMaterialReview] = Field(default_factory=dict)
    overall_verdict: Literal["ALL_PASS", "RETRY_L1", "MAX_RETRY"] = "ALL_PASS"
    retry_count: int = Field(default=0, ge=0, le=2)


# ============================================================================
# 交付 (李纲产出)
# ============================================================================

class MaterialSummary(BaseModel):
    """阶段材料摘要"""
    material_id: str
    material_type: str
    title: str
    is_remedial: bool = False


class DeliveryPackage(BaseModel):
    """阶段交付包"""
    package_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    stage_number: int
    materials: list[MaterialSummary] = Field(default_factory=list)
    study_guide: Optional[str] = None
    next_stage_preview: Optional[str] = None


# ============================================================================
# 阶段反馈
# ============================================================================

class StageFeedback(BaseModel):
    """用户对当前阶段的反馈"""
    mastery: Literal["mastered", "partially_mastered", "not_mastered"] = "partially_mastered"
    self_assessment: Optional[str] = None


class RemedialRequest(BaseModel):
    """补救资源请求 (旧版, 与阶段反馈耦合, 保留兼容)"""
    selected: list[Literal["handout", "exercise"]] = Field(default_factory=list)


class IndependentRemedialRequest(BaseModel):
    """独立补救资源请求 (与阶段反馈解耦)

    用户通过独立的"生成补救资源"按钮触发,
    输入困惑描述文本和需要的资源类型,
    由解惑师霍然分析后协调六匠生成个性化补救资源。
    """
    confusion_text: str = Field(
        ..., min_length=5, max_length=2000,
        description="学生用自然语言描述的困惑",
    )
    resource_types: list[str] = Field(
        default_factory=lambda: ["handout", "exercise"],
        min_length=1,
        description="需要的补救资源类型: handout / mindmap / exercise / reading / animation / code",
    )


# ============================================================================
# API 请求/响应
# ============================================================================

class StartSessionRequest(BaseModel):
    """创建智学会话请求"""
    course_id: str
    selected_materials: list[str] = Field(
        default_factory=lambda: ["handout", "mindmap", "exercise"],
        min_length=1,
    )
    scouting_enabled: bool = True


class SessionHandle(BaseModel):
    """会话句柄 (API 返回)"""
    session_id: str
    course_id: str
    status: str
    current_stage: Optional[int] = None
    total_stages: Optional[int] = None
    next_action: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
