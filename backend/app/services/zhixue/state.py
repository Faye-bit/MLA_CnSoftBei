"""
AI智学 — ZhiXueState TypedDict 定义
LangGraph StateGraph 的全局状态类型, 在节点之间传递

扩展自现有 LearningState 的设计模式, 增加问卷、审查、补救等新字段
"""

from typing import Annotated, Optional

from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage
from typing_extensions import TypedDict


class ZhiXueState(TypedDict, total=False):
    """AI智学 LangGraph 全局状态"""

    # ── 会话标识 ──
    session_id: str
    course_id: str
    user_id: str

    # ── 消息历史 (LangGraph 内置) ──
    messages: Annotated[list[BaseMessage], add_messages]

    # ── 课程上下文 (init_session 产出) ──
    course_name: str
    chapters: list          # [{"id": str, "title": str, "knowledge_points": [str]}]
    total_knowledge_points: int

    # ── 阶段控制 ──
    current_stage: int              # 当前阶段 (0-based)
    total_stages: int               # 总阶段数 (李纲动态决定: 2~20)
    remedial_triggered: bool        # 当前阶段已触发过补救? (最多 1 次)

    # ── 俞知 (学情诊断师) 产出 ──
    questionnaire: Optional[dict]           # 生成的轻量问卷
    questionnaire_response: Optional[dict]  # 用户作答 (为空=跳过)
    learning_profile: Optional[dict]        # 融合后的 LearningProfile
    study_pace: str                         # steady / moderate / cram
    focus_area: str                         # theory / practice / balanced
    mastery_depth: str                      # understand / master / expert

    # ── 李纲 (教纲设计专家) 产出 ──
    learning_plan: Optional[dict]           # LearningPlan
    delivery_package: Optional[dict]        # 阶段交付包

    # ── 蔡丰 (资源采集师) 产出 ──
    research_report: Optional[dict]         # ResearchReport (可为空)
    scouting_enabled: bool                  # 用户是否开启了采风

    # ── 6 匠产出 ──
    materials: dict[str, dict]              # {material_type: Material}

    # ── 简真 (质量审核师) 产出 ──
    review_report: Optional[dict]           # QualityReviewReport
    review_retry_count: int                 # L1 审查打回计数 (max 2)

    # ── 阶段反馈 ──
    stage_feedback: Optional[dict]          # 用户反馈
    remedial_request: Optional[list[str]]   # 用户勾选的补救资源类型

    # ── 独立补救 (解惑师霍然) ──
    confusion_text: str                     # 学生困惑描述文本
    huoran_diagnosis: Optional[dict]        # 霍然的困惑诊断报告

    # ── 中断控制 ──
    interrupt_at: Optional[str]
    status: str                             # idle/questionnaire/planning/generating/reviewing/delivering/completed/interrupted/failed
    error: Optional[dict]                   # {code, message, detail}

    # ── 用户配置 ──
    selected_materials: list[str]           # 用户选择的材料类型
    difficulty_adjustment: float            # 动态难度系数 (0.0~1.0)
