"""
学习会话 Schema 定义
包含学习会话、学习阶段、生成资源和智能体任务的请求/响应模型
"""

import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


# ============================================================================
# 学习会话 Schemas
# ============================================================================

class LearningSessionCreate(BaseModel):
    """创建学习会话请求体"""
    course_id: uuid.UUID = Field(..., description="目标课程 ID")


class LearningSessionResponse(BaseModel):
    """学习会话响应体"""
    id: uuid.UUID
    user_id: uuid.UUID
    course_id: uuid.UUID
    status: str
    learning_path: dict
    current_stage_index: int
    profile_snapshot: dict
    session_metadata: dict
    is_favorited: bool = Field(default=False, description="是否已收藏")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class LearningSessionDetailResponse(LearningSessionResponse):
    """学习会话详情响应体, 包含所有阶段"""
    course_name: Optional[str] = Field(default=None, description="课程名称")
    stages: list["LearningStageDetailResponse"] = Field(
        default_factory=list, description="学习阶段列表"
    )


class LearningSessionListItem(BaseModel):
    """学习会话列表项 (不含完整资源内容, 用于列表页展示)"""
    id: uuid.UUID
    course_id: uuid.UUID
    course_name: Optional[str] = Field(default=None, description="课程名称")
    status: str
    learning_path: dict
    current_stage_index: int
    progress_percent: int = Field(default=0, description="进度百分比")
    total_stages: int = Field(default=0, description="总阶段数")
    completed_stages: int = Field(default=0, description="已完成阶段数")
    is_favorited: bool = Field(default=False, description="是否已收藏")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============================================================================
# 学习阶段 Schemas
# ============================================================================

class LearningStageResponse(BaseModel):
    """学习阶段响应体"""
    id: uuid.UUID
    session_id: uuid.UUID
    title: str
    description: Optional[str] = None
    order_index: int
    status: str
    knowledge_point_ids: list
    stage_metadata: dict
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class LearningStageDetailResponse(LearningStageResponse):
    """学习阶段详情响应体, 包含所有资源"""
    resources: list["GeneratedResourceResponse"] = Field(
        default_factory=list, description="本阶段的生成资源列表"
    )


class StageCompleteRequest(BaseModel):
    """完成阶段请求体"""
    completed: bool = Field(default=True, description="是否标记为已完成")


class FavoriteToggleResponse(BaseModel):
    """收藏切换响应体"""
    is_favorited: bool = Field(..., description="切换后的收藏状态")


# ============================================================================
# 生成资源 Schemas
# ============================================================================

class GeneratedResourceResponse(BaseModel):
    """生成资源响应体 (不含完整 content, 用于列表展示)"""
    id: uuid.UUID
    stage_id: uuid.UUID
    resource_type: str
    title: str
    description: Optional[str] = None
    order_index: int
    resource_metadata: dict
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class GeneratedResourceDetailResponse(GeneratedResourceResponse):
    """生成资源详情响应体 (含完整 content)"""
    content: str = Field(default="", description="资源完整内容")


class RegenerateResourceRequest(BaseModel):
    """重新生成资源请求体"""
    pass  # 目前无需额外参数, 使用存储的元数据重新生成


class ExerciseProgressRequest(BaseModel):
    """保存练习题进度请求体
    前端将用户在当前资源（练习题集）中的作答进度同步到后端持久化
    """
    answers: dict = Field(
        default_factory=dict,
        description="用户答案映射, 如 {'q1': 0, 'q2': [0, 2], 'q3': '填空题答案'}"
    )
    submitted: dict = Field(
        default_factory=dict,
        description="已提交标记映射, 如 {'q1': true, 'q2': true}"
    )
    current_index: int = Field(
        default=0,
        description="当前浏览的题目序号 (0-based)"
    )
    scores: Optional[dict] = Field(
        default=None,
        description="AI 评分映射, 如 {'q3': {'score': 8, 'feedback': '...'}}"
    )


class ExerciseScoreRequest(BaseModel):
    """AI 打分的请求体
    前端提交用户的主观题答案, 后端调用 LLM 进行评分
    """
    question_id: str = Field(..., description="题目 ID")
    question_type: str = Field(..., description="题目类型 (fill_blank / short_answer)")
    question_text: str = Field(..., description="题目正文")
    user_answer: str = Field(..., description="用户输入的答案")
    reference_answer: str = Field(..., description="参考答案")
    explanation: Optional[str] = Field(default=None, description="题目解析")


class ExerciseScoreResponse(BaseModel):
    """AI 打分响应体"""
    question_id: str = Field(..., description="题目 ID")
    score: int = Field(..., ge=0, le=10, description="AI 评分 (0-10)")
    feedback: str = Field(..., description="AI 评语和建议")


# ============================================================================
# 智能体任务 Schemas
# ============================================================================

class AgentTaskResponse(BaseModel):
    """智能体任务响应体"""
    id: uuid.UUID
    session_id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    agent_name: str
    status: str
    input_summary: Optional[str] = None
    output_summary: Optional[str] = None
    latency_ms: Optional[int] = None
    token_count: Optional[int] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============================================================================
# SSE 进度事件 Schemas (供前端类型参考, 实际通过 SSE 推送 JSON)
# ============================================================================

class SSEEventBase(BaseModel):
    """SSE 事件基类"""
    type: str


class SessionInitEvent(SSEEventBase):
    """会话初始化事件"""
    type: str = "session_init"
    session_id: str
    course_name: str


class StageStartEvent(SSEEventBase):
    """阶段开始事件"""
    type: str = "stage_start"
    stage_index: int
    stage_title: str
    total_stages: int


class AgentStartEvent(SSEEventBase):
    """Agent 开始事件"""
    type: str = "agent_start"
    agent: str
    message: str


class AgentProgressEvent(SSEEventBase):
    """Agent 进度事件"""
    type: str = "agent_progress"
    agent: str
    message: str


class AgentDoneEvent(SSEEventBase):
    """Agent 完成事件"""
    type: str = "agent_done"
    agent: str
    result_summary: Optional[str] = None


class ResourceReadyEvent(SSEEventBase):
    """资源就绪事件"""
    type: str = "resource_ready"
    resource_id: str
    resource_type: str
    title: str
    stage_index: int


class StageCompleteEvent(SSEEventBase):
    """阶段完成事件"""
    type: str = "stage_complete"
    stage_index: int
    resources: list = Field(default_factory=list)


class PathUpdateEvent(SSEEventBase):
    """学习路径更新事件"""
    type: str = "path_update"
    learning_path: dict


class SessionCompleteEvent(SSEEventBase):
    """会话完成事件"""
    type: str = "session_complete"
    session_id: str
    message: str


class SSEErrorEvent(SSEEventBase):
    """SSE 错误事件"""
    type: str = "error"
    message: str
    agent: Optional[str] = None
