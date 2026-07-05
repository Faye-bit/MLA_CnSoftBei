"""
匠 Agent 基类 — 6 个匠 (张义/屠思/习真/岳读/董华/戴码) 共享的逻辑

每个匠 Agent 从 ZhiXueState 中提取上下文 (画像/知识库/RAG/蔡丰报告),
调用现有 resource_generators 中的生成函数, 返回统一格式的 material dict。
"""

import json
import uuid
import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.retriever import retrieve as rag_retrieve
from app.services.zhixue.resource_generators import (
    generate_handout,
    generate_mindmap,
    generate_exercise,
    generate_reading,
    generate_coding_practice,
    generate_video_script,
)
from loguru import logger


async def craft_material(
    material_type: str,
    state: dict,
    *,
    db: AsyncSession,
    course_id: str,
    is_remedial: bool = False,
) -> dict:
    """
    匠统一入口 — 根据 material_type 调用对应生成器

    :param material_type: 资源类型 (handout/mindmap/exercise/reading/animation/code)
    :param state: 当前 ZhiXueState
    :param db: 数据库会话
    :param course_id: 课程 ID
    :param is_remedial: 是否为补救资源 (影响 Prompt 参数)
    :return: {"material_type": str, "title": str, "content": str, ...}
    """
    # ── 提取上下文 ──
    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current_stage = state.get("current_stage", 0)
    stage = stages[current_stage] if current_stage < len(stages) else {}
    topic = stage.get("topic", stage.get("title", ""))

    profile = state.get("learning_profile", {})
    profile_summary = _build_profile_summary(profile)

    difficulty = state.get("difficulty_adjustment", 0.5)

    # RAG 检索
    knowledge_context = await _get_knowledge_context(
        topic, stage.get("knowledge_points", []), course_id, db,
    )

    # 蔡丰报告
    research = state.get("research_report")

    # 补救模式标识
    if is_remedial:
        topic = f"{topic} (巩固补充)"
        difficulty = max(0.0, difficulty - 0.2)  # 降低难度

    # ── 路由到对应生成器 ──
    t0 = time.time()
    generators = {
        "handout": lambda: generate_handout(
            topic, profile_summary, knowledge_context, db,
        ),
        "mindmap": lambda: generate_mindmap(topic, knowledge_context, db),
        "exercise": lambda: _gen_exercise(
            topic, profile_summary, knowledge_context, difficulty, is_remedial,
        ),
        "reading": lambda: generate_reading(topic, knowledge_context, db),
        "animation": lambda: generate_video_script(topic, knowledge_context, db),
        "code": lambda: generate_coding_practice(
            topic, profile_summary, knowledge_context, db,
        ),
    }

    gen = generators.get(material_type)
    if not gen:
        return None

    try:
        result = await gen()

        if material_type == "exercise":
            content = (
                json.dumps(result, ensure_ascii=False)
                if isinstance(result, dict) else str(result)
            )
        else:
            content = result if isinstance(result, str) else json.dumps(
                result, ensure_ascii=False
            )

        material = {
            "material_type": material_type,
            "title": f"{topic} {'(补充)' if is_remedial else ''}",
            "content": content,
            "is_remedial": is_remedial,
            "resource_metadata": {
                "generator": material_type,
                "profile_summary": profile_summary,
                "knowledge_context": [
                    {"content": kc.get("content", "")[:200]}
                    for kc in knowledge_context[:5]
                ],
                "generation_time": time.time() - t0,
                "is_remedial": is_remedial,
            },
        }

        elapsed = time.time() - t0
        logger.info(
            f"匠 {material_type}: 生成完成 "
            f"({len(content)} 字符, {elapsed:.1f}s)"
            f"{' [补救]' if is_remedial else ''}"
        )
        return material

    except Exception as e:
        logger.error(f"匠 {material_type}: 生成失败: {e}")
        return {
            "material_type": material_type,
            "title": topic,
            "content": (
                f"# {topic}\n\n生成失败: {str(e)}\n\n请稍后重试。"
            ),
            "is_remedial": is_remedial,
            "resource_metadata": {"error": str(e)},
        }


# ============================================================================
# 辅助函数
# ============================================================================

def _build_profile_summary(profile: dict) -> str:
    """从 LearningProfile 构建画像摘要文本"""
    parts = []
    if profile.get("study_pace"):
        pace_labels = {
            "steady": "每天坚持学习",
            "moderate": "正常学习节奏",
            "cram": "短期突击学习",
        }
        parts.append(f"学习节奏: {pace_labels.get(profile['study_pace'], profile['study_pace'])}")
    if profile.get("focus_area"):
        parts.append(f"侧重点: {profile['focus_area']}")
    if profile.get("mastery_depth"):
        parts.append(f"期望深度: {profile['mastery_depth']}")
    if profile.get("learning_goals"):
        parts.append(f"学习目标: {', '.join(profile['learning_goals'][:3])}")
    if profile.get("special_requirements"):
        parts.append(f"特殊需求: {', '.join(profile['special_requirements'][:3])}")
    return "\n".join(parts) if parts else "暂无画像信息, 按通用水平讲解"


async def _get_knowledge_context(
    topic: str,
    kps: list[str],
    course_id: str,
    db: AsyncSession,
) -> list[dict]:
    """执行 RAG 检索, 获取知识上下文"""
    query = f"{topic} {' '.join(kps[:5])}"
    try:
        import uuid as _uuid
        results = await rag_retrieve(
            query, _uuid.UUID(course_id), db, top_k=8,
        )
        return [
            {
                "content": r.content[:600],
                "document_filename": r.document_filename,
                "score": r.score,
            }
            for r in results
        ]
    except Exception as e:
        logger.warning(f"RAG 检索失败 (非致命): {e}")
        return []


async def _gen_exercise(
    topic: str,
    profile_summary: str,
    knowledge_context: list[dict],
    difficulty: float,
    is_remedial: bool,
) -> dict:
    """生成习题 — 带补救模式参数"""
    difficulty_label = "easy" if is_remedial else (
        "easy" if difficulty < 0.4 else (
            "hard" if difficulty > 0.7 else "medium"
        )
    )
    result = await generate_exercise(
        topic, profile_summary, knowledge_context, difficulty_label,
    )
    # 补救模式: 侧重基础题
    if is_remedial and isinstance(result, dict):
        questions = result.get("questions", [])
        for q in questions:
            # 降难度
            if q.get("difficulty") == "hard":
                q["difficulty"] = "medium"
            if q.get("difficulty") == "medium":
                q["difficulty"] = "easy"
        result["remedial"] = True
    return result
