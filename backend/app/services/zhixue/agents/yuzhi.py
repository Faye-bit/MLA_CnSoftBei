"""
学情诊断师俞知 (profile_analyst) 实现
职责:
  1. 读取 StudentProfile → 提取已有画像数据
  2. 组装轻量问卷 (6 道固定模板 + 1 次小型 LLM 生成重点知识题)
  3. 融合问卷响应 (+ 跳过/超时路径) → 结构化的 LearningProfile

遵循 AgentHandler Protocol: async def run(state: ZhiXueState, **kwargs) -> dict
"""

import json
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import StudentProfile
from app.models.course import Course, Chapter, KnowledgePoint
from app.services.config_service import get_config_value
from app.services.llm_utils import create_llm_client, parse_json_output
from app.services.zhixue.prompts import (
    YUZHI_KNOWLEDGE_QUESTION_PROMPT,
    YUZHI_PROFILE_MERGE_SYSTEM_PROMPT,
)
from loguru import logger


async def analyze_profile(
    state: dict,
    *,
    db: AsyncSession,
    course_id: str,
    user_id: str,
) -> dict:
    """
    俞知 — 画像分析阶段

    生成轻量问卷, 供前端弹出。
    同时提取已有 StudentProfile 数据, 为后续融合做准备。

    :param state: 当前 ZhiXueState (部分)
    :param db: 数据库会话
    :param course_id: 课程 ID
    :param user_id: 用户 ID
    :return: 部分 State 字典, 含 questionnaire
    """
    # ── 获取课程信息 ──
    course = await db.get(Course, uuid.UUID(course_id))
    course_name = course.name if course else "未知课程"

    # 获取章节列表 + 知识点列表 (供 LLM 生成重点知识题参考)
    chapters_stmt = (
        select(Chapter)
        .where(Chapter.course_id == uuid.UUID(course_id))
        .order_by(Chapter.order_index)
    )
    result = await db.execute(chapters_stmt)
    chapters_list = result.scalars().all()
    chapter_names = [ch.title for ch in chapters_list]

    # 查询知识点名称 (LLM 需要用知识点来提炼有意义的主题选项)
    kp_names = []
    for ch in chapters_list:
        kp_stmt = select(KnowledgePoint).where(
            KnowledgePoint.chapter_id == ch.id
        )
        kp_result = await db.execute(kp_stmt)
        kps = kp_result.scalars().all()
        kp_names.extend([kp.title for kp in kps])

    # ── 组装问卷 ──
    # 5 道固定模板题: 节奏、侧重、深度、基础、特殊需求
    fixed = _build_fixed_questions()

    # 1 道课程关联题: LLM 生成重点知识题, 失败时用章节名兜底
    kq = await _generate_knowledge_question_llm(
        course_name, chapter_names, kp_names,
    )
    if kq is None:
        kq = _build_knowledge_question(chapter_names)

    questions = [
        fixed[0],  # q1: pace
        fixed[1],  # q2: focus
        fixed[2],  # q3: depth
        fixed[3],  # q4: basis
        kq,         # q5: knowledge (LLM 生成, 含课程主题)
        fixed[4],  # q7: special requirement
    ]

    questionnaire = {
        "questionnaire_id": str(uuid.uuid4()),
        "session_id": state.get("session_id", ""),
        "course_id": course_id,
        "title": "课前学习调研",
        "description": "为了给你提供更精准的学习方案, 请花 1 分钟回答几个问题",
        "questions": questions,
        "timeout_seconds": 180,
        "generated_by": "学情诊断师俞知",
    }

    logger.info(
        f"俞知: 问卷组装完成 ({len(questions)} 题, 1 次小型 LLM) "
        f"course={course_name}, chapters={len(chapter_names)}, kp={len(kp_names)}"
    )
    return {"questionnaire": questionnaire}


async def process_profile(
    state: dict,
    *,
    db: AsyncSession,
    user_id: str,
) -> dict:
    """
    俞知 — 画像融合阶段

    将已有 StudentProfile 与问卷答案 (或跳过标记) 融合, 生成 LearningProfile。

    :param state: 当前 ZhiXueState (含 questionnaire 和 questionnaire_response)
    :param db: 数据库会话
    :param user_id: 用户 ID
    :return: 部分 State 字典, 含 learning_profile + study_pace 等
    """
    client = create_llm_client()
    model = get_config_value("llm_model")

    # ── 已有画像 ──
    profile_summary = await _extract_profile_summary(db, user_id)

    # ── 问卷响应 ──
    questionnaire_response = state.get("questionnaire_response")
    skipped = (
        questionnaire_response is None
        or questionnaire_response.get("skipped", False)
    )

    if skipped:
        # 跳过: 直接使用已有画像, 用默认值填充
        skip_reason = (
            questionnaire_response.get("skip_reason", "user_skipped")
            if questionnaire_response
            else "user_skipped"
        )
        logger.info(f"俞知: 用户跳过问卷 (原因: {skip_reason}), 使用已有画像")
        return _build_default_profile(state, profile_summary, skipped=True)

    # ── LLM 融合 ──
    answers_text = json.dumps(
        questionnaire_response.get("answers", []),
        ensure_ascii=False,
        indent=2,
    )

    user_prompt = f"""请融合以下信息, 生成结构化的 LearningProfile:

已有学生画像:
{profile_summary or "暂无画像信息"}

问卷答案:
{answers_text}

请根据答案中反映的学习节奏、侧重点、掌握深度期望、已有基础等信息,
生成完整的 LearningProfile JSON。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": YUZHI_PROFILE_MERGE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        learning_profile = {
            "profile_id": str(uuid.uuid4()),
            "user_id": user_id,
            "course_id": state.get("course_id", ""),
            "study_pace": result.get("study_pace", "moderate"),
            "focus_area": result.get("focus_area", "balanced"),
            "mastery_depth": result.get("mastery_depth", "master"),
            "knowledge_levels": result.get("knowledge_levels", []),
            "style_preferences": result.get("style_preferences", []),
            "learning_goals": result.get("learning_goals", []),
            "recommended_material_types": result.get(
                "recommended_material_types",
                state.get("selected_materials", ["handout", "mindmap", "exercise"]),
            ),
            "suggested_difficulty": result.get("suggested_difficulty", 0.5),
            "special_requirements": result.get("special_requirements", []),
            "questionnaire_insights": result.get("questionnaire_insights", {}),
            "questionnaire_skipped": False,
        }

        logger.info(
            f"俞知: 画像融合完成 "
            f"(pace={learning_profile['study_pace']}, "
            f"difficulty={learning_profile['suggested_difficulty']})"
        )
        return {
            "learning_profile": learning_profile,
            "study_pace": learning_profile["study_pace"],
            "focus_area": learning_profile["focus_area"],
            "mastery_depth": learning_profile["mastery_depth"],
            "difficulty_adjustment": learning_profile["suggested_difficulty"],
        }

    except Exception as e:
        logger.error(f"俞知: 画像融合失败 (使用已有画像): {e}")
        return _build_default_profile(state, profile_summary, skipped=False)


# ============================================================================
# 辅助函数
# ============================================================================

async def _extract_profile_summary(
    db: AsyncSession, user_id: str
) -> str:
    """从 StudentProfile 表中提取画像摘要文本"""
    try:
        stmt = select(StudentProfile).where(
            StudentProfile.user_id == uuid.UUID(user_id)
        )
        result = await db.execute(stmt)
        profile = result.scalar_one_or_none()

        if profile and profile.profile_data:
            parts = []
            for k, v in profile.profile_data.items():
                if isinstance(v, str) and v.strip():
                    parts.append(f"{k}: {v}")
            return "\n".join(parts)

        if profile and profile.summary:
            return profile.summary

    except Exception as e:
        logger.warning(f"俞知: 画像读取失败: {e}")

    return ""


def _build_default_profile(
    state: dict, profile_summary: str, skipped: bool
) -> dict:
    """构建默认 LearningProfile (LLM 融合失败或用户跳过时使用)"""
    return {
        "learning_profile": {
            "profile_id": str(uuid.uuid4()),
            "user_id": state.get("user_id", ""),
            "course_id": state.get("course_id", ""),
            "study_pace": "moderate",
            "focus_area": "balanced",
            "mastery_depth": "master",
            "knowledge_levels": [],
            "style_preferences": [],
            "learning_goals": [],
            "recommended_material_types": state.get(
                "selected_materials",
                ["handout", "mindmap", "exercise"],
            ),
            "suggested_difficulty": 0.5,
            "special_requirements": [],
            "questionnaire_insights": {},
            "questionnaire_skipped": skipped,
            "raw_profile_summary": profile_summary,
        },
        "study_pace": "moderate",
        "focus_area": "balanced",
        "mastery_depth": "master",
        "difficulty_adjustment": 0.5,
    }


async def _generate_knowledge_question_llm(
    course_name: str,
    chapter_names: list[str],
    kp_names: list[str],
) -> dict | None:
    """LLM 生成 1 道重点知识多选题 (小型调用, max_tokens=500)

    综合章节名称和知识点名称, 生成有意义的课程主题选项。
    当章节名只是"第一章""第二章"等编号时,
    LLM 可从知识点中提炼出"进程管理""内存管理"等有意义的表述。

    :param course_name: 课程名称
    :param chapter_names: 章节名称列表 (供参考)
    :param kp_names: 知识点名称列表 (供参考, 采样前 30 个)
    :return: q5 题目 dict, 失败时返回 None
    """
    try:
        client = create_llm_client()
        model = get_config_value("llm_model")

        chapters_text = (
            "\n".join(f"- {c}" for c in chapter_names[:15]) or "(无章节)"
        )
        kp_text = ", ".join(kp_names[:30]) or "(无知识点)"

        user_prompt = f"""课程: {course_name}

章节:
{chapters_text}

知识点 ({len(kp_names)} 个): {kp_text}

请为这门课生成 1 道"重点知识"多选题。"""

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": YUZHI_KNOWLEDGE_QUESTION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=500,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)
        if result.get("options"):
            logger.info(f"俞知: LLM 生成重点知识题 ({len(result['options'])} 个选项)")
            return result
        else:
            logger.warning("俞知: LLM 返回的重点知识题无选项, 使用章节名兜底")
            return None
    except Exception as e:
        logger.warning(f"俞知: LLM 生成重点知识题失败 (使用章节名兜底): {e}")
        return None


def _build_fixed_questions() -> list[dict]:
    """返回 5 道不随课程变化的固定模板题 (0 LLM 调用)

    覆盖维度:
      q1 — 学习节奏 (single_choice)
      q2 — 学习侧重点 (single_choice)
      q3 — 掌握深度 (single_choice)
      q4 — 已有基础 (single_choice)
      q7 — 特殊需求 (open_ended, 选填)

    资源偏好题已移除: 用户在创建会话时已选择资源类型 (selected_materials)。
    重点知识题 (q5) 由 _generate_knowledge_question_llm() 单独构造,
    失败时 fallback 到 _build_knowledge_question(chapter_names)。
    """
    return [
        {
            "question_id": "q1",
            "question_type": "single_choice",
            "category": "pace",
            "text": "你打算怎么安排这门课的学习?",
            "options": [
                "每天坚持, 细水长流 (如每天30分钟)",
                "每周集中几次, 正常节奏",
                "短期突击, 快速完成 (备考冲刺)",
            ],
            "required": True,
        },
        {
            "question_id": "q2",
            "question_type": "single_choice",
            "category": "focus",
            "text": "你更偏向哪种学习方式?",
            "options": [
                "侧重理论学习, 理解概念和原理",
                "侧重动手实操, 多写代码多练习",
                "理论 + 实操兼顾",
            ],
            "required": True,
        },
        {
            "question_id": "q3",
            "question_type": "single_choice",
            "category": "depth",
            "text": "你希望学到什么程度?",
            "options": [
                "简单了解, 知道基本概念即可",
                "基本掌握, 能通过考试或应用",
                "完全精通, 深入理解原理和细节",
            ],
            "required": True,
        },
        {
            "question_id": "q4",
            "question_type": "single_choice",
            "category": "basis",
            "text": "你对这门课的相关基础感觉如何?",
            "options": [
                "零基础, 从入门开始",
                "有一些基础, 学过相关课程",
                "基础扎实, 想深入提高",
            ],
            "required": True,
        },
        {
            "question_id": "q7",
            "question_type": "open_ended",
            "category": "requirement",
            "text": "有没有特别想了解的方向或特殊需求?",
            "required": False,
        },
    ]


def _build_knowledge_question(chapter_names: list[str]) -> dict:
    """从 DB 章节名称构造重点知识多选题 (0 LLM 调用)

    使用章节名称而非知识点名称, 因为:
      - 章节数量适中 (5-15), 知识点过多 (20-50+), 采样子集无法代表全课程
      - 章节天然覆盖全课程, 层级更高, 语义更清晰
      - DB 中的章节名称由课程设计者精心命名, 无需 LLM 再做措辞

    :param chapter_names: 课程章节名称列表
    :return: q5 重点知识多选题
    """
    # 当课程无章节时的兜底选项
    if not chapter_names:
        return {
            "question_id": "q5",
            "question_type": "multi_choice",
            "category": "knowledge",
            "text": "你更希望重点学习哪些内容? (可多选)",
            "options": ["全部内容", "基础概念部分", "进阶应用部分"],
            "required": True,
        }

    return {
        "question_id": "q5",
        "question_type": "multi_choice",
        "category": "knowledge",
        "text": "你更希望重点学习哪些章节/内容? (可多选)",
        "options": chapter_names,
        "required": True,
    }


def _default_questionnaire_questions(chapter_names: list[str]) -> list[dict]:
    """生成默认问卷 (委托给共享 helper, 0 LLM 调用)

    保留此函数作为向后兼容的公开 API。
    主路径 analyze_profile() 已直接使用 _build_fixed_questions()
    和 _build_knowledge_question() 组装, 不再调用此函数。
    """
    fixed = _build_fixed_questions()
    kq = _build_knowledge_question(chapter_names)
    return [
        fixed[0],  # q1: pace
        fixed[1],  # q2: focus
        fixed[2],  # q3: depth
        fixed[3],  # q4: basis
        kq,         # q5: knowledge
        fixed[4],  # q7: special requirement
    ]
