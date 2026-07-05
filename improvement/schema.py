"""
AI 个性化学习指导平台 — 完整 Pydantic 数据模型
================================================
本文件定义了系统中所有核心数据结构的 Schema。
所有 Agent 的 I/O 以及 LangGraph State 均基于这些模型。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator


# ============================================================================
# 枚举定义
# ============================================================================

class MaterialType(str, Enum):
    """学习材料类型"""
    LECTURE = "lecture"           # 讲义
    MINDMAP = "mindmap"           # 思维导图
    EXERCISE = "exercise"         # 练习题
    READING = "reading"           # 拓展阅读
    ANIMATION = "animation"       # 动画演示
    CODE = "code"                 # 代码实操
    EXTERNAL_LINK = "external_link"  # 外部链接


class SessionStatus(str, Enum):
    """会话状态"""
    IDLE = "idle"
    QUESTIONNAIRE = "questionnaire"
    PLANNING = "planning"
    GENERATING = "generating"
    REVIEWING = "reviewing"
    DELIVERING = "delivering"
    FEEDBACK = "feedback"
    COMPLETED = "completed"
    INTERRUPTED = "interrupted"
    FAILED = "failed"


class MasteryLevel(str, Enum):
    """掌握程度"""
    MASTERED = "mastered"             # 已掌握
    PARTIALLY = "partially_mastered"  # 部分掌握
    NOT_MASTERED = "not_mastered"     # 基本没掌握


class ReviewVerdict(str, Enum):
    """审查判定"""
    PASS = "PASS"
    FORMAT_FAIL = "FORMAT_FAIL"
    KNOWLEDGE_MISMATCH = "KNOWLEDGE_MISMATCH"
    LOGIC_FAIL = "LOGIC_FAIL"
    CROSS_INCONSISTENCY = "CROSS_INCONSISTENCY"


class OverallVerdict(str, Enum):
    """整体审查判定"""
    ALL_PASS = "ALL_PASS"
    RETRY = "RETRY"
    MAX_RETRY = "MAX_RETRY"


class AgentStatus(str, Enum):
    """Agent 状态"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    DEGRADED = "degraded"


class QuestionType(str, Enum):
    """问卷题目类型"""
    SINGLE_CHOICE = "single_choice"
    MULTI_CHOICE = "multi_choice"
    SCALE = "scale"               # 李克特量表
    OPEN_ENDED = "open_ended"


class KBContentType(str, Enum):
    """知识库内容类型"""
    TEXT = "text"
    CODE = "code"
    DIAGRAM = "diagram"
    FORMULA = "formula"
    REFERENCE = "reference"


# ============================================================================
# 用户画像（来自已有系统）
# ============================================================================

class KnowledgeLevel(BaseModel):
    """某个知识领域的水平评估"""
    domain: str = Field(..., description="知识领域名称")
    level: float = Field(..., ge=0.0, le=1.0, description="掌握水平 0~1")
    last_updated: Optional[datetime] = None
    evidence: list[str] = Field(default_factory=list, description="评估依据")


class StylePreference(BaseModel):
    """学习风格偏好"""
    dimension: str = Field(..., description="偏好维度，如 visual/auditory/reading/kinesthetic")
    score: float = Field(..., ge=0.0, le=1.0)
    description: Optional[str] = None


class UserProfile(BaseModel):
    """来自已有用户画像模块的结构"""
    user_id: str
    knowledge_levels: list[KnowledgeLevel] = Field(default_factory=list)
    style_preferences: list[StylePreference] = Field(default_factory=list)
    learning_history: list[str] = Field(default_factory=list, description="已完成的课程 ID 列表")
    goals: list[str] = Field(default_factory=list, description="学习目标关键词")
    updated_at: Optional[datetime] = None


# ============================================================================
# LearningProfile（知渔产出）
# ============================================================================

class LearningProfile(BaseModel):
    """知渔融合用户画像 + 问卷响应后的学习画像"""
    profile_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    course_id: str
    
    # 融合后的知识水平
    knowledge_levels: list[KnowledgeLevel] = Field(default_factory=list)
    
    # 融合后的学习风格
    style_preferences: list[StylePreference] = Field(default_factory=list)
    
    # 问卷解析结果
    questionnaire_insights: dict[str, Any] = Field(
        default_factory=dict,
        description="从问卷中提取的额外洞察"
    )
    
    # 学习目标（对齐后的）
    learning_goals: list[str] = Field(default_factory=list)
    
    # 推荐的材料类型（基于风格偏好）
    recommended_material_types: list[MaterialType] = Field(default_factory=list)
    
    # 难度建议
    suggested_difficulty: float = Field(default=0.5, ge=0.0, le=1.0)
    
    # 特殊需求
    special_requirements: list[str] = Field(default_factory=list)
    
    # 元信息
    created_at: datetime = Field(default_factory=datetime.utcnow)
    source_profile_version: Optional[str] = None  # 上游用户画像版本


# ============================================================================
# LearningPlan（筑径产出）
# ============================================================================

class StageObjective(BaseModel):
    """阶段目标"""
    objective_id: str = Field(default_factory=lambda: str(uuid4()))
    description: str
    measurable_outcome: str = Field(..., description="可量化的学习成果")
    kb_refs: list[str] = Field(default_factory=list, description="关联的知识库文档 ID")


class Stage(BaseModel):
    """学习阶段"""
    stage_number: int = Field(..., ge=1, le=6)
    title: str
    topic: str = Field(..., description="阶段主题")
    description: str
    objectives: list[StageObjective] = Field(default_factory=list)
    
    # 知识库引用
    kb_refs: list[str] = Field(default_factory=list)
    
    # 预估学习时长（分钟）
    estimated_duration_minutes: int = Field(default=60)
    
    # 本阶段的材料类型（可从全局 selection 中筛选，也可单独指定）
    material_types: list[MaterialType] = Field(default_factory=list)
    
    # 前置阶段（如果是第一阶段则为空）
    prerequisites: list[int] = Field(default_factory=list)


class LearningPlan(BaseModel):
    """筑径生成的一次性固定学习计划"""
    plan_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    course_id: str
    profile_id: str
    
    # 阶段列表 (3~6 阶段)
    stages: list[Stage] = Field(..., min_length=3, max_length=6)
    
    # 全局材料选择
    selected_materials: list[MaterialType] = Field(default_factory=list)
    
    # 计划概述
    overview: str = Field(..., description="学习计划整体概述")
    
    # 元信息
    created_at: datetime = Field(default_factory=datetime.utcnow)
    version: int = Field(default=1)
    
    # 总预估时长（分钟）
    total_estimated_minutes: int = Field(default=0)
    
    @field_validator("stages")
    @classmethod
    def stages_must_be_sequential(cls, v: list[Stage]) -> list[Stage]:
        numbers = [s.stage_number for s in v]
        expected = list(range(1, len(v) + 1))
        if numbers != expected:
            raise ValueError(f"Stage numbers must be sequential 1..N, got {numbers}")
        return v
    
    def model_post_init(self, __context) -> None:
        if self.total_estimated_minutes == 0:
            self.total_estimated_minutes = sum(
                s.estimated_duration_minutes for s in self.stages
            )


# ============================================================================
# ResearchReport（采风产出）
# ============================================================================

class ExternalLink(BaseModel):
    """外部链接材料"""
    url: str
    title: str
    description: str
    relevance_score: float = Field(default=0.5, ge=0.0, le=1.0)
    source_type: str = Field(default="web", description="web / academic / video / tool")
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    # 注意：不检查链接时效性（按需求约束）


class ResearchFinding(BaseModel):
    """调研发现"""
    topic: str
    key_concepts: list[str] = Field(default_factory=list)
    summary: str
    relevance: float = Field(default=0.5, ge=0.0, le=1.0)
    sources: list[str] = Field(default_factory=list, description="来源 URL 或引用")


class ResearchReport(BaseModel):
    """采风网络调研的结构化报告"""
    report_id: str = Field(default_factory=lambda: str(uuid4()))
    stage_number: int
    plan_id: str
    
    # 调研发现
    findings: list[ResearchFinding] = Field(default_factory=list)
    
    # 推荐的外部链接
    external_links: list[ExternalLink] = Field(default_factory=list)
    
    # 搜索查询记录
    search_queries: list[str] = Field(default_factory=list)
    
    # 执行摘要
    executive_summary: str = ""
    
    # 对材料生成的建议
    generation_hints: dict[MaterialType, str] = Field(
        default_factory=dict,
        description="针对每种材料类型的生成提示"
    )
    
    # 元信息
    created_at: datetime = Field(default_factory=datetime.utcnow)
    search_engine: str = Field(default="tavily")
    total_sources_consulted: int = 0


# ============================================================================
# Material（匠·X 产出）
# ============================================================================

class SourceRef(BaseModel):
    """来源引用"""
    ref_type: Literal["kb", "web", "original"]
    ref_id: str
    title: Optional[str] = None
    url: Optional[str] = None
    excerpt: Optional[str] = None


class MaterialMetadata(BaseModel):
    """材料元信息"""
    material_type: MaterialType
    stage_number: int
    crafter_code: str  # agent_code，如 "lecture_crafter"
    generation_model: Optional[str] = None  # 使用的 LLM 模型
    generation_time_seconds: float = 0.0
    source_refs: list[SourceRef] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    difficulty_level: float = Field(default=0.5, ge=0.0, le=1.0)
    estimated_study_minutes: int = Field(default=30)


class BaseMaterial(BaseModel):
    """所有材料的基础 Schema"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: MaterialType
    title: str
    description: Optional[str] = None
    content: str = Field(..., description="主体内容（Markdown 格式）")
    metadata: MaterialMetadata
    
    # 降级标记（鉴真 fallback 后设置）
    fallback: bool = Field(default=False)
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None  # "[KB-SOURCE]" 等

    created_at: datetime = Field(default_factory=datetime.utcnow)


class LectureMaterial(BaseModel):
    """讲义"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.LECTURE] = MaterialType.LECTURE
    title: str
    description: Optional[str] = None
    content: str
    metadata: MaterialMetadata
    
    # 讲义特有字段
    sections: list[dict[str, str]] = Field(
        default_factory=list,
        description="[{section_title: str, content: str}]"
    )
    key_points: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    summary: Optional[str] = None
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MindmapMaterial(BaseModel):
    """思维导图"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.MINDMAP] = MaterialType.MINDMAP
    title: str
    description: Optional[str] = None
    content: str  # Markdown 格式的思维导图描述
    metadata: MaterialMetadata
    
    # 思维导图特有字段
    mindmap_structure: dict[str, Any] = Field(
        default_factory=dict,
        description="树形结构 {root: {child1: {...}, child2: {...}}}"
    )
    # 可视化渲染数据（Mermaid 语法）
    mermaid_code: Optional[str] = None
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ExerciseQuestion(BaseModel):
    """练习题"""
    question_id: str = Field(default_factory=lambda: str(uuid4()))
    question_text: str
    question_type: Literal["single_choice", "multi_choice", "fill_blank", "short_answer", "essay"]
    options: list[str] = Field(default_factory=list)
    correct_answer: str
    explanation: str
    difficulty: float = Field(default=0.5, ge=0.0, le=1.0)
    points: int = Field(default=1)


class ExerciseMaterial(BaseModel):
    """练习题集"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.EXERCISE] = MaterialType.EXERCISE
    title: str
    description: Optional[str] = None
    content: str  # 概述
    metadata: MaterialMetadata
    
    # 特有字段
    questions: list[ExerciseQuestion] = Field(default_factory=list)
    total_points: int = 0
    suggested_time_minutes: int = 30
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    def model_post_init(self, __context) -> None:
        if self.total_points == 0:
            self.total_points = sum(q.points for q in self.questions)


class ReadingMaterial(BaseModel):
    """拓展阅读"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.READING] = MaterialType.READING
    title: str
    description: Optional[str] = None
    content: str
    metadata: MaterialMetadata
    
    # 特有字段
    reading_list: list[dict[str, str]] = Field(
        default_factory=list,
        description="[{title, author, url, annotation}]"
    )
    discussion_questions: list[str] = Field(default_factory=list)
    further_reading: list[str] = Field(default_factory=list, description="进阶阅读建议")
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnimationMaterial(BaseModel):
    """动画演示"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.ANIMATION] = MaterialType.ANIMATION
    title: str
    description: Optional[str] = None
    content: str  # 动画的文本描述
    metadata: MaterialMetadata
    
    # 特有字段
    animation_type: str = Field(default="conceptual", description="conceptual / process / interactive")
    frames: list[dict[str, str]] = Field(
        default_factory=list,
        description="[{frame_number, description, visual_elements}]"
    )
    # 可执行的动画代码 (HTML/JS/CSS 或 Python matplotlib/Manim)
    animation_code: Optional[str] = None
    preview_url: Optional[str] = None
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CodeTask(BaseModel):
    """代码实操任务"""
    task_id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str
    starter_code: Optional[str] = None
    reference_solution: str
    explanation: str
    language: str = Field(default="python")
    difficulty: float = Field(default=0.5, ge=0.0, le=1.0)
    test_cases: list[dict[str, str]] = Field(
        default_factory=list,
        description="[{input, expected_output}]"
    )


class CodeMaterial(BaseModel):
    """代码实操"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.CODE] = MaterialType.CODE
    title: str
    description: Optional[str] = None
    content: str  # 概述
    metadata: MaterialMetadata
    
    # 特有字段：题目列表 + 参考代码
    tasks: list[CodeTask] = Field(default_factory=list)
    # 注意：不包含沙箱执行环境（按需求约束）
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ExternalLinkMaterial(BaseModel):
    """外部链接材料（由采风直接产出）"""
    material_id: str = Field(default_factory=lambda: str(uuid4()))
    material_type: Literal[MaterialType.EXTERNAL_LINK] = MaterialType.EXTERNAL_LINK
    title: str
    description: Optional[str] = None
    content: str  # 链接列表描述
    metadata: MaterialMetadata
    
    # 特有字段
    links: list[ExternalLink] = Field(default_factory=list)
    
    fallback: bool = False
    fallback_reason: Optional[str] = None
    source_marker: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# 联合类型
Material = (
    LectureMaterial | MindmapMaterial | ExerciseMaterial |
    ReadingMaterial | AnimationMaterial | CodeMaterial |
    ExternalLinkMaterial
)


# ============================================================================
# DeliveryPackage（筑径交付）
# ============================================================================

class MaterialSummary(BaseModel):
    """阶段材料摘要"""
    material_id: str
    material_type: MaterialType
    title: str
    review_verdict: ReviewVerdict
    is_fallback: bool = False


class DeliveryPackage(BaseModel):
    """筑径汇总的阶段交付包"""
    package_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    stage_number: int
    plan_id: str
    
    # 材料清单
    materials: dict[MaterialType, Material] = Field(default_factory=dict)
    material_summaries: list[MaterialSummary] = Field(default_factory=list)
    
    # 审查摘要
    review_summary: Optional[str] = None
    has_fallbacks: bool = False
    
    # 阶段学习指导
    study_guide: Optional[str] = None
    
    # 元信息
    delivered_at: datetime = Field(default_factory=datetime.utcnow)
    estimated_total_minutes: int = 0
    
    # 下一阶段预告
    next_stage_preview: Optional[str] = None


# ============================================================================
# Questionnaire & Response（知渔）
# ============================================================================

class Question(BaseModel):
    """单个问卷题目"""
    question_id: str = Field(default_factory=lambda: str(uuid4()))
    question_type: QuestionType
    text: str
    description: Optional[str] = None
    options: list[str] = Field(default_factory=list)
    scale_range: Optional[tuple[int, int]] = None  # 仅 scale 类型
    required: bool = True
    category: str = Field(default="general", description="题目分类: knowledge / style / goal / prerequisite")


class Questionnaire(BaseModel):
    """知渔动态生成的问卷"""
    questionnaire_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    course_id: str
    
    # 问卷类型
    questionnaire_type: Literal["initial", "stage_feedback"] = "initial"
    stage_number: Optional[int] = None  # 阶段反馈问卷时填充
    
    # 标题和说明
    title: str
    description: str
    
    # 题目列表
    questions: list[Question] = Field(default_factory=list)
    
    # 元信息
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    generated_by: str = Field(default="profile_analyst")
    # 生成依据
    generation_context: dict[str, Any] = Field(
        default_factory=dict,
        description="生成此问卷所用的课程上下文、KB 上下文等"
    )


class QuestionAnswer(BaseModel):
    """单个题目的回答"""
    question_id: str
    selected_options: list[str] = Field(default_factory=list)
    scale_value: Optional[int] = None
    open_text: Optional[str] = None


class QuestionnaireResponse(BaseModel):
    """用户提交的问卷回答"""
    response_id: str = Field(default_factory=lambda: str(uuid4()))
    questionnaire_id: str
    session_id: str
    user_id: str
    
    answers: list[QuestionAnswer] = Field(default_factory=list)
    
    submitted_at: datetime = Field(default_factory=datetime.utcnow)
    completion_time_seconds: Optional[float] = None


class StageFeedback(BaseModel):
    """阶段反馈（用户对当前阶段学习的评价）"""
    feedback_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    stage_number: int
    
    # 整体掌握程度
    mastery: MasteryLevel
    
    # 分材料反馈
    material_feedback: dict[MaterialType, MasteryLevel] = Field(default_factory=dict)
    
    # 自评
    self_assessment: Optional[str] = None
    time_spent_minutes: Optional[int] = None
    
    # 是否请求重生成（"基本没掌握"时触发）
    request_regeneration: bool = False
    
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================================================
# QualityReviewReport（鉴真产出）
# ============================================================================

class L1FormatCheck(BaseModel):
    """L1 格式校验结果"""
    passed: bool
    schema_errors: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)


class L2KnowledgeCheck(BaseModel):
    """L2 知识一致性校验结果"""
    passed: bool
    score: float = Field(default=0.0, ge=0.0, le=1.0, description="RAG 语义相似度")
    threshold: float = Field(default=0.75)
    matched_chunks: list[str] = Field(default_factory=list)
    mismatched_segments: list[str] = Field(default_factory=list)


class L3LogicCheck(BaseModel):
    """L3 逻辑正确性校验结果"""
    passed: bool
    issues: list[str] = Field(default_factory=list)
    llm_model: Optional[str] = None
    reasoning: Optional[str] = None


class L4CrossCheck(BaseModel):
    """L4 跨材料一致性校验结果"""
    passed: bool
    conflicts: list[dict[str, str]] = Field(
        default_factory=list,
        description="[{material_a, material_b, conflict_description}]"
    )
    consistency_score: float = Field(default=0.0, ge=0.0, le=1.0)


class PerMaterialReview(BaseModel):
    """单个材料的审查结果"""
    material_id: str
    material_type: MaterialType
    verdict: ReviewVerdict
    
    l1: Optional[L1FormatCheck] = None
    l2: Optional[L2KnowledgeCheck] = None
    l3: Optional[L3LogicCheck] = None
    l4: Optional[L4CrossCheck] = None
    
    summary: Optional[str] = None


class QualityReviewReport(BaseModel):
    """鉴真四层审查的完整报告"""
    report_id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    stage_number: int
    
    per_material: dict[str, PerMaterialReview] = Field(
        default_factory=dict,
        description="key = material_type 字符串"
    )
    
    overall_verdict: OverallVerdict = OverallVerdict.ALL_PASS
    
    retry_count: int = Field(default=0, ge=0, le=2)
    
    reviewed_at: datetime = Field(default_factory=datetime.utcnow)
    reviewer_code: str = Field(default="quality_reviewer")


# ============================================================================
# Agent Registry
# ============================================================================

class RetryPolicy(BaseModel):
    """Agent 重试策略"""
    max_retries: int = Field(default=1, ge=0, le=3)
    backoff: Literal["fixed", "exponential", "none"] = "fixed"
    backoff_seconds: int = Field(default=5)


class AgentRecord(BaseModel):
    """Agent Registry 中的一条注册记录"""
    agent_id: str = Field(..., description="唯一标识，如 'profile_analyst_v1'")
    agent_name: str = Field(..., description="正式名称，如 '知渔'")
    agent_code: str = Field(..., description="代号，如 'profile_analyst'")
    version: str = Field(default="1.0.0")
    description: str = ""
    
    # 调用信息
    module_path: str = Field(..., description="Python 模块路径")
    handler_fn: str = Field(..., description="入口函数名")
    
    # Schema
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    
    # 依赖
    dependencies: list[str] = Field(default_factory=list)
    
    # 配置
    timeout_seconds: int = Field(default=120, ge=10, le=600)
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    
    # 状态
    status: AgentStatus = AgentStatus.ACTIVE
    
    # 元信息
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================================================
# API 请求/响应模型
# ============================================================================

class StartSessionRequest(BaseModel):
    """创建学习会话请求"""
    course_id: str
    selected_materials: list[MaterialType] = Field(
        default_factory=lambda: [
            MaterialType.LECTURE,
            MaterialType.MINDMAP,
            MaterialType.EXERCISE,
        ],
        min_length=1,
        max_length=7,
    )


class SessionHandle(BaseModel):
    """会话句柄（API 返回）"""
    session_id: str
    course_id: str
    user_id: str
    status: SessionStatus
    current_stage: Optional[int] = None
    total_stages: Optional[int] = None
    
    # 下一步动作
    next_action: Optional[str] = None  # "fill_questionnaire" | "wait_feedback" | "view_delivery" | "completed"
    payload: Optional[dict[str, Any]] = None  # 问卷数据 / 交付包数据
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ErrorResponse(BaseModel):
    """错误响应"""
    code: str
    message: str
    detail: Optional[dict[str, Any]] = None
    session_id: Optional[str] = None


class StageFeedbackRequest(BaseModel):
    """阶段反馈请求"""
    session_id: str
    stage_number: int
    mastery: MasteryLevel
    material_feedback: dict[MaterialType, MasteryLevel] = Field(default_factory=dict)
    self_assessment: Optional[str] = None
    time_spent_minutes: Optional[int] = None


class ResumeRequest(BaseModel):
    """恢复会话请求"""
    session_id: str
    resume_type: Literal["questionnaire", "feedback"]
    payload: dict[str, Any]
