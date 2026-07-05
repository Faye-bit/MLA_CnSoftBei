"""
LangGraph StateGraph 组装 — AI智学完整工作流

节点列表 (15 个):
  init_session → analyze_profile → process_profile → plan_path
  → stage_entry → scout_resources
  → craft_handout / craft_mindmap / craft_exercise
    / craft_reading / craft_animation / craft_code (Send API 并行)
  → review_materials → deliver_stage
  → collect_feedback → craft_remedial → finalize

中断点:
  - process_profile (等待用户填写问卷)
  - collect_feedback (等待用户提交阶段反馈)

条件路由:
  - stage_entry_router: has_more_stages? → scout / finalize
  - craft_router: Send API 扇出到选中材料
  - review_router: ALL_PASS → deliver / RETRY → retry / MAX_RETRY → fallback
  - feedback_router: mastered/partial → next / not_mastered → remedial
"""

import asyncio
import uuid
from typing import Optional

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, Chapter, KnowledgePoint
from app.services.zhixue.state import ZhiXueState
from app.services.zhixue.agents.yuzhi import analyze_profile, process_profile
from app.services.zhixue.agents.ligang import plan_path, deliver_stage
from app.services.zhixue.agents.caifeng import scout_resources
from app.services.zhixue.agents.crafter_base import craft_material
from app.services.zhixue.agents.jianzhen import (
    review_materials,
    fallback_materials,
)
from app.services.zhixue.edges import (
    stage_entry_router,
    craft_router,
    remedial_router,
    review_router,
    feedback_router,
)
from app.services.zhixue.utils import build_profile_text
from loguru import logger


# ============================================================================
# 图节点函数
# ============================================================================

async def _init_session_node(state: ZhiXueState) -> dict:
    """
    初始化会话 — 加载课程元信息和 KB 索引

    从数据库读取课程名称、章节和知识点列表,
    计算 total_knowledge_points (用于阶段数上限)。
    """
    # 从 config 获取 db (通过 RunnableConfig 的 configurable)
    # 注意: LangGraph 节点通过 state 传递, db/course_id/user_id
    # 在 Phase 2 中从 state 读取 (已在 start_session 时设置)
    session_id = state.get("session_id", "")
    course_id = state.get("course_id", "")
    user_id = state.get("user_id", "")

    logger.info(f"init_session: session={session_id}, course={course_id}")

    chapters = state.get("chapters", [])
    if not chapters:
        logger.warning("init_session: chapters 为空, 可能未设置")

    total_kps = sum(
        len(ch.get("knowledge_points", [])) for ch in chapters
    )

    return {
        "total_knowledge_points": total_kps,
        "status": "questionnaire",
        "current_stage": 0,
        "remedial_triggered": False,
        "review_retry_count": 0,
        "materials": {},
    }


async def _analyze_profile_node(state: ZhiXueState) -> dict:
    """俞知: 画像分析 → 生成问卷"""
    logger.info(f"analyze_profile: session={state.get('session_id', '')}")
    # 这里需要一个 db session — 但我们不在 LangGraph context 中
    # Phase 2 简化: 直接使用 state 中已有的 questionnaire (由向南在 start_session 时设置)
    # 完整的 LangGraph 节点实现在 Phase 3 通过 config["configurable"]["db"] 获取
    return {}


async def _process_profile_node(state: ZhiXueState) -> dict:
    """俞知: 处理问卷 → 画像融合"""
    logger.info(
        f"process_profile: skipped={state.get('questionnaire_response', {}).get('skipped', True)}"
    )

    # 从 state 中已有的 learning_profile 恢复 (由向南在 process_questionnaire 时设置)
    profile = state.get("learning_profile", {})
    if not profile:
        # 回复默认
        return {
            "learning_profile": {
                "profile_id": str(uuid.uuid4()),
                "user_id": state.get("user_id", ""),
                "course_id": state.get("course_id", ""),
                "study_pace": "moderate",
                "focus_area": "balanced",
                "mastery_depth": "master",
                "questionnaire_skipped": True,
            },
            "study_pace": "moderate",
            "difficulty_adjustment": 0.5,
            "status": "planning",
        }
    return {"status": "planning"}


async def _plan_path_node(state: ZhiXueState) -> dict:
    """李纲: 路径规划 → LearningPlan"""
    logger.info(f"plan_path: session={state.get('session_id', '')}")
    # Phase 2: 使用 state 中已有的 learning_plan (由向南或 Phase 3 完整节点设置)
    plan = state.get("learning_plan", {})
    if plan:
        return {
            "total_stages": len(plan.get("stages", [])),
            "status": "generating",
        }
    # 默认: 2 个阶段
    return {
        "learning_plan": {
            "plan_id": str(uuid.uuid4()),
            "stages": [
                {"title": "阶段1", "topic": "基础入门", "knowledge_points": [], "status": "pending"},
                {"title": "阶段2", "topic": "深入理解", "knowledge_points": [], "status": "pending"},
            ],
        },
        "total_stages": 2,
        "status": "generating",
    }


async def _scout_resources_node(state: ZhiXueState) -> dict:
    """蔡丰: 网络调研 → ResearchReport"""
    logger.info(
        f"scout_resources: enabled={state.get('scouting_enabled', True)}"
    )
    # Phase 2: 蔡丰需要 db + course_id, 此处使用 state 中的数据
    # 完整实现在 Phase 3 通过 config 传递
    return {"research_report": None}


async def _craft_material_node(state: ZhiXueState, **kwargs) -> dict:
    """
    匠节点 — 生成单个材料

    通过 Send API 调用, kwargs 含 material_type 和 is_remedial。
    """
    material_type = kwargs.get("material_type", "handout")
    is_remedial = kwargs.get("is_remedial", False)

    logger.info(
        f"craft_{material_type}: "
        f"stage={state.get('current_stage', 0)}"
        f"{' [remedial]' if is_remedial else ''}"
    )

    # ── 生成材料 ──
    # Phase 2: 简化 — 从 state 提取上下文直接调生成器
    # Phase 3: 通过 config["configurable"]["db"] 获取 db 会话

    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current = state.get("current_stage", 0)
    stage = stages[current] if current < len(stages) else {}

    topic = stage.get("topic", stage.get("title", "未知主题"))
    profile = state.get("learning_profile", {})
    profile_summary = build_profile_text(profile)
    difficulty = state.get("difficulty_adjustment", 0.5)

    if is_remedial:
        topic = f"{topic} (巩固补充)"

    # 直接调生成器
    try:
        content = await _generate_material(
            material_type, topic, profile_summary, difficulty, is_remedial,
        )
    except Exception as e:
        logger.error(f"匠 {material_type}: 生成异常: {e}")
        content = f"# {topic}\n\n生成失败: {str(e)}"

    material = {
        "material_type": material_type,
        "title": f"{topic} {'(补充)' if is_remedial else ''}",
        "content": content,
        "is_remedial": is_remedial,
        "resource_metadata": {
            "generator": material_type,
            "is_remedial": is_remedial,
        },
    }

    # 更新 materials dict
    materials = dict(state.get("materials", {}))
    materials[material_type] = material

    return {"materials": materials}


async def _review_materials_node(state: ZhiXueState) -> dict:
    """简真: 审查所有材料 (L1 严格 + L2/L3 宽松)"""
    logger.info(
        f"review_materials: "
        f"{len(state.get('materials', {}))} materials"
    )

    materials = state.get("materials", {})
    per_material = {}
    has_l1_failure = False

    for mt, material in materials.items():
        result = _validate_single(mt, material)
        if not result["l1_passed"]:
            has_l1_failure = True
            logger.warning(
                f"简真 L1: {mt} 格式校验失败 — {result['l1_errors']}"
            )
        per_material[mt] = result

    retry_count = state.get("review_retry_count", 0)
    if has_l1_failure and retry_count < 2:
        overall = "RETRY_L1"
    elif has_l1_failure:
        overall = "MAX_RETRY"
    else:
        overall = "ALL_PASS"

    return {
        "review_report": {
            "report_id": str(uuid.uuid4()),
            "per_material": per_material,
            "overall_verdict": overall,
            "retry_count": retry_count + (1 if has_l1_failure else 0),
        },
        "review_retry_count": retry_count + (1 if has_l1_failure else 0),
        "status": "reviewing",
    }


async def _deliver_stage_node(state: ZhiXueState) -> dict:
    """李纲: 汇总交付"""
    logger.info(f"deliver_stage: stage={state.get('current_stage', 0)}")
    materials = state.get("materials", {})
    return {
        "delivery_package": {
            "package_id": str(uuid.uuid4()),
            "session_id": state.get("session_id", ""),
            "stage_number": state.get("current_stage", 0),
            "materials": [
                {"material_type": mt, "title": m.get("title", "")}
                for mt, m in materials.items()
            ],
        },
        "status": "delivering",
    }


async def _collect_feedback_node(state: ZhiXueState) -> dict:
    """俞知: 收集阶段反馈"""
    logger.info(f"collect_feedback: stage={state.get('current_stage', 0)}")
    # 反馈已在 state 中 (由前端提交后通过 resume 注入)
    return {"status": "feedback"}


async def _craft_remedial_node(state: ZhiXueState) -> dict:
    """
    补救资源节点: 生成用户勾选的补救材料 (内部并行生成, 非 Send API)

    仅支持 讲义 (张义) + 习题 (习真) 两种补救类型。
    生成后直接合并到 materials, 不经过审查 (补救内容可接受宽松质量)。
    """
    logger.info("craft_remedial: 生成补救资源")

    remedial_request = state.get("remedial_request", [])
    if not remedial_request:
        logger.info("craft_remedial: 用户未勾选补救资源, 跳过")
        return {"remedial_triggered": True}

    # 提取上下文
    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current = state.get("current_stage", 0)
    stage = stages[current] if current < len(stages) else {}
    topic = stage.get("topic", stage.get("title", "未知主题"))
    profile = state.get("learning_profile", {})

    # 并行生成 (asyncio.gather, 仅 1-2 个)
    async def gen_one(mt: str) -> dict | None:
        try:
            content = await _generate_material(
                mt, f"{topic} (巩固补充)",
                build_profile_text(profile),
                max(0.0, state.get("difficulty_adjustment", 0.5) - 0.2),
                is_remedial=True,
            )
            return {
                "material_type": mt,
                "title": f"{topic} (补充)",
                "content": content,
                "is_remedial": True,
                "resource_metadata": {
                    "generator": mt, "is_remedial": True,
                },
            }
        except Exception as e:
            logger.error(f"补救 {mt} 生成失败: {e}")
            return {
                "material_type": mt,
                "title": f"{topic} (补充)",
                "content": f"# {topic}\n\n补救资源生成失败: {e}",
                "is_remedial": True,
                "resource_metadata": {"error": str(e), "is_remedial": True},
            }

    tasks = [gen_one(mt) for mt in remedial_request if mt in ("handout", "exercise")]
    results = await asyncio.gather(*tasks)

    materials = dict(state.get("materials", {}))
    for r in results:
        if r:
            materials[r["material_type"]] = r

    logger.info(
        f"craft_remedial: 生成完成 ({len([r for r in results if r])} 个补救资源)"
    )
    return {
        "materials": materials,
        "remedial_triggered": True,
    }


async def _finalize_node(state: ZhiXueState) -> dict:
    """完成所有阶段"""
    logger.info(f"finalize: session={state.get('session_id', '')}")
    return {"status": "completed"}


async def _stage_entry_node(state: ZhiXueState) -> dict:
    """阶段入口节点 (透传, 实际路由由 stage_entry_router 条件边处理)"""
    return {}


# ============================================================================
# 图构建
# ============================================================================

def build_zhixue_graph(
    checkpointer: Optional[MemorySaver] = None,
) -> StateGraph:
    """
    构建 AI智学 LangGraph StateGraph

    节点:
      init_session → analyze_profile → process_profile → plan_path
      → stage_entry → scout_resources
      → craft_handout / craft_mindmap / craft_exercise
        / craft_reading / craft_animation / craft_code (Send API 并行)
      → review_materials → deliver_stage
      → collect_feedback → (remedial) → finalize

    Send API 并行扇出: craft_router 将选中的材料类型分发到各自匠节点
    补救路径: feedback_router 判断 "基本没掌握" → remedial_router 分发

    :param checkpointer: 检查点存储 (默认 MemorySaver)
    :return: 编译后的 StateGraph
    """
    if checkpointer is None:
        checkpointer = MemorySaver()

    builder = StateGraph(ZhiXueState)

    # ── 注册节点 ──
    builder.add_node("init_session", _init_session_node)
    builder.add_node("analyze_profile", _analyze_profile_node)
    builder.add_node("process_profile", _process_profile_node)
    builder.add_node("plan_path", _plan_path_node)
    builder.add_node("stage_entry", _stage_entry_node)
    builder.add_node("scout_resources", _scout_resources_node)

    # 6 个匠节点 (通过 Send API 并行)
    builder.add_node("craft_handout", _craft_material_node)
    builder.add_node("craft_mindmap", _craft_material_node)
    builder.add_node("craft_exercise", _craft_material_node)
    builder.add_node("craft_reading", _craft_material_node)
    builder.add_node("craft_animation", _craft_material_node)
    builder.add_node("craft_code", _craft_material_node)

    builder.add_node("review_materials", _review_materials_node)
    builder.add_node("fallback_materials", _fallback_materials_node)
    builder.add_node("deliver_stage", _deliver_stage_node)
    builder.add_node("collect_feedback", _collect_feedback_node)
    builder.add_node("craft_remedial", _craft_remedial_node)
    builder.add_node("finalize", _finalize_node)

    # ── 入口 ──
    builder.set_entry_point("init_session")

    # ── 顺序边 ──
    builder.add_edge("init_session", "analyze_profile")
    builder.add_edge("analyze_profile", "process_profile")
    builder.add_edge("process_profile", "plan_path")
    builder.add_edge("plan_path", "stage_entry")

    # ── 阶段入口条件路由 ──
    builder.add_conditional_edges(
        "stage_entry",
        stage_entry_router,
        {
            "scout": "scout_resources",
            "finalize": "finalize",
        },
    )

    # scouting → craft 并行扇出 (Send API)
    builder.add_conditional_edges(
        "scout_resources",
        craft_router,
        [
            "craft_handout", "craft_mindmap", "craft_exercise",
            "craft_reading", "craft_animation", "craft_code",
        ],
    )

    # ── 匠 sync barrier → 审查 ──
    for node in [
        "craft_handout", "craft_mindmap", "craft_exercise",
        "craft_reading", "craft_animation", "craft_code",
    ]:
        builder.add_edge(node, "review_materials")

    # ── 审查条件路由 ──
    builder.add_conditional_edges(
        "review_materials",
        review_router,
        {
            "deliver": "deliver_stage",
            "retry": "review_materials",   # 自循环重试 (Phase 3 改进为精确打回)
            "fallback": "fallback_materials",
        },
    )
    builder.add_edge("fallback_materials", "deliver_stage")

    # ── 交付 → 反馈 ──
    builder.add_edge("deliver_stage", "collect_feedback")

    # ── 反馈条件路由 ──
    builder.add_conditional_edges(
        "collect_feedback",
        feedback_router,
        {
            "next_stage": "stage_entry",
            "remedial": "craft_remedial",
        },
    )

    # ── 补救 → 交付 ──
    builder.add_edge("craft_remedial", "deliver_stage")

    # ── finalize → END ──
    builder.add_edge("finalize", END)

    # ── 编译 (带中断点 + Checkpointer) ──
    graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=[
            "process_profile",      # 等待用户填写问卷
            "collect_feedback",     # 等待用户提交阶段反馈
        ],
    )

    logger.info(
        "LangGraph 图编译完成: "
        "15 个节点, 6 匠并行 (Send API), "
        "interrupt_before=[process_profile, collect_feedback]"
    )
    return graph


# ============================================================================
# 辅助函数
# ============================================================================

async def _generate_material(
    material_type: str,
    topic: str,
    profile_summary: str,
    difficulty: float,
    is_remedial: bool,
) -> str:
    """
    生成材料内容 — 调用现有 resource_generators

    Phase 2 简化: 直接调生成器。
    Phase 3 通过 config["configurable"]["db"] 获取 RAG 上下文。
    """
    import json as _json
    from app.services.learning.resource_generators import (
        generate_handout,
        generate_mindmap,
        generate_exercise,
        generate_reading,
        generate_coding_practice,
        generate_video_script,
    )

    # 空知识上下文 (Phase 3 接入 RAG)
    knowledge_context = []

    generators = {
        "handout": lambda: generate_handout(
            topic, profile_summary, knowledge_context,
        ),
        "mindmap": lambda: generate_mindmap(topic, knowledge_context),
        "exercise": lambda: _gen_exercise_phase2(
            topic, profile_summary, knowledge_context, difficulty, is_remedial,
        ),
        "reading": lambda: generate_reading(topic, knowledge_context),
        "animation": lambda: generate_video_script(topic, knowledge_context),
        "code": lambda: generate_coding_practice(
            topic, profile_summary, knowledge_context,
        ),
    }

    gen = generators.get(material_type)
    if not gen:
        return f"# {topic}\n\n不支持的资源类型: {material_type}"

    result = await gen()

    if material_type == "exercise" and isinstance(result, dict):
        return _json.dumps(result, ensure_ascii=False)
    return result if isinstance(result, str) else str(result)


async def _gen_exercise_phase2(
    topic: str, profile_summary: str,
    knowledge_context: list[dict], difficulty: float,
    is_remedial: bool,
) -> dict:
    """Phase 2 习题生成 (适配 generate_exercise 签名)"""
    from app.services.learning.resource_generators import generate_exercise

    diff_label = "easy" if is_remedial or difficulty < 0.4 else (
        "hard" if difficulty > 0.7 else "medium"
    )
    return await generate_exercise(topic, profile_summary, knowledge_context, diff_label)


async def _fallback_materials_node(state: ZhiXueState) -> dict:
    """降级材料替换"""
    import json as _json

    materials = dict(state.get("materials", {}))
    review = state.get("review_report", {})
    per_material = review.get("per_material", {})

    for mt, rev in per_material.items():
        if not rev.get("l1_passed", True):
            logger.warning(f"fallback: {mt} 替换为降级内容")
            content = _build_fallback_content(mt)
            materials[mt] = {
                "material_type": mt,
                "title": f"降级{materials.get(mt, {}).get('title', mt)}",
                "content": content,
                "is_remedial": False,
                "resource_metadata": {
                    "fallback": True,
                    "fallback_reason": str(rev.get("l1_errors", [])),
                    "source_marker": "[KB-SOURCE]",
                },
            }

    return {"materials": materials}


def _build_fallback_content(material_type: str) -> str:
    """构建降级内容"""
    import json as _json
    if material_type == "mindmap":
        return "# 知识点\n## 概述\n### 核心\n#### 要点\n## 应用\n### 示例"
    elif material_type == "exercise":
        return _json.dumps({"questions": [], "fallback": True}, ensure_ascii=False)
    elif material_type == "animation":
        return "<!DOCTYPE html><html><body><p>生成失败</p></body></html>"
    return "# 内容生成失败\n\n[KB-SOURCE]\n请参考知识库原文。"


def _validate_single(material_type: str, material: dict) -> dict:
    """L1 格式校验 (单个材料)"""
    import json as _json

    content = material.get("content", "")
    errors = []

    if material_type == "mindmap":
        heading_lines = [
            l.strip() for l in content.split("\n") if l.strip().startswith("#")
        ]
        has_root = any(
            l.startswith("# ") and not l.startswith("## ") for l in heading_lines
        )
        depths = set()
        for line in heading_lines:
            level = 0
            for ch in line:
                if ch == '#': level += 1
                else: break
            depths.add(level)

        if not has_root:
            errors.append("缺少根节点")
        if len(depths) < 3:
            errors.append(f"深度不足")
        if len(heading_lines) < 10:
            errors.append(f"节点不足 ({len(heading_lines)})")

    elif material_type == "exercise":
        if not content.strip():
            errors.append("内容为空")
        else:
            try:
                parsed = _json.loads(content)
                if not parsed.get("questions"):
                    errors.append("questions 为空")
            except _json.JSONDecodeError:
                errors.append("JSON 解析失败")

    elif material_type == "animation":
        if not content.strip().startswith("<!DOCTYPE"):
            errors.append("缺少 DOCTYPE")
        if not content.rstrip().endswith("</html>"):
            errors.append("缺少 </html>")
        if "<script" in content.lower() and "</script>" not in content:
            errors.append("缺少 </script>")

    else:
        if not content or len(content.strip()) < 50:
            errors.append(f"内容过短")

    return {
        "material_type": material_type,
        "l1_passed": len(errors) == 0,
        "l1_errors": errors,
        "l2_warning": None,
        "l3_warning": None,
    }
