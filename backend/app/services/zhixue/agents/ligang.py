"""
教纲设计专家李纲 (path_planner) 实现
职责:
  1. 基于 LearningProfile + study_pace 动态规划学习阶段 (2~20)
  2. 阶段粒度调整: steady=多而轻, cram=少而重
  3. 汇总交付 DeliveryPackage

遵循 AgentHandler Protocol: async def run(state: ZhiXueState, **kwargs) -> dict
"""

import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, Chapter, KnowledgePoint
from app.services.config_service import get_config_value
from app.services.llm_utils import create_llm_client, parse_json_output
from app.services.zhixue.prompts import LIGANG_PATH_PLANNING_SYSTEM_PROMPT
from loguru import logger


async def plan_path(
    state: dict,
    *,
    db: AsyncSession,
    course_id: str,
) -> dict:
    """
    李纲 — 路径规划阶段

    基于 LearningProfile (含 study_pace) 和课程内容, 动态规划学习阶段。

    :param state: 当前 ZhiXueState (含 learning_profile, study_pace 等)
    :param db: 数据库会话
    :param course_id: 课程 ID
    :return: 部分 State 字典, 含 learning_plan + total_stages
    """
    client = create_llm_client()
    model = get_config_value("llm_model")

    # ── 获取课程信息 ──
    course = await db.get(Course, uuid.UUID(course_id))
    course_name = course.name if course else "未知课程"

    chapters_stmt = (
        select(Chapter)
        .where(Chapter.course_id == uuid.UUID(course_id))
        .order_by(Chapter.order_index)
    )
    result = await db.execute(chapters_stmt)
    chapters_list = result.scalars().all()

    chapter_info = []
    all_kp_names = []
    for ch in chapters_list:
        kp_stmt = select(KnowledgePoint).where(
            KnowledgePoint.chapter_id == ch.id
        )
        kp_result = await db.execute(kp_stmt)
        kps = kp_result.scalars().all()
        kp_names = [kp.title for kp in kps]
        all_kp_names.extend(kp_names)
        chapter_info.append({
            "id": str(ch.id),
            "title": ch.title,
            "knowledge_points": kp_names,
        })

    # ── 构建规划上下文 ──
    study_pace = state.get("study_pace", "moderate")
    difficulty = state.get("difficulty_adjustment", 0.5)
    profile = state.get("learning_profile", {})
    selected = state.get("selected_materials", ["handout", "mindmap", "exercise"])

    # 阶段数约束: 下限统一 2, 上限 = min(kp_count, 12)
    kp_count = len(all_kp_names)
    max_stages = min(kp_count, 12)   # 最多 12 个阶段 (即使知识点很多)
    min_stages = 2                   # 至少 2 个阶段

    if study_pace == "cram":
        pace_hint = f"突击学习 → 偏向较少阶段 ({min_stages}~{min(5, max_stages)}), 每阶段覆盖更多知识点"
    elif study_pace == "steady":
        pace_hint = f"每天坚持 → 偏向较多阶段 ({max_stages//3}~{max_stages}), 每阶段 1-2 个知识点"
    else:
        pace_hint = f"正常节奏 → 适中 ({max_stages//4}~{max_stages//1.5}), 每阶段 3-8 个知识点"

    course_info = f"""课程: {course_name}
知识点总数: {kp_count}
知识点列表: {', '.join(all_kp_names[:30])}{'...' if kp_count > 30 else ''}

学生画像:
- 学习节奏: {study_pace} (steady=每天坚持, moderate=正常, cram=突击)
- 侧重点: {profile.get('focus_area', 'balanced')}
- 掌握深度: {profile.get('mastery_depth', 'master')}
- 难度偏好: {difficulty} (0.0=最简单, 1.0=最难)
- 学习目标: {', '.join(profile.get('learning_goals', []) or ['未指定'])}
- 偏好资源: {json.dumps(selected, ensure_ascii=False)}

阶段数约束: {min_stages}~{max_stages} 阶段
{pace_hint}"""

    user_prompt = f"""请为以下课程规划个性化学习路径:

{course_info}

请根据 study_pace={study_pace} 在范围 {min_stages}~{max_stages} 内决定适当的阶段数,
并生成完整的阶段列表。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": LIGANG_PATH_PLANNING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4000,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        stages = result.get("stages", [])
        total = result.get("total_stages", len(stages))

        # 护栏杆: 确保阶段数在合法范围内
        if total < min_stages or total > max_stages:
            logger.warning(
                f"李纲: LLM 返回阶段数 {total} 越界 "
                f"({min_stages}~{max_stages}), 已修正"
            )
            total = max(min_stages, min(total, max_stages))

        if not stages:
            logger.warning("李纲: LLM 返回空阶段, 使用基线划分")
            stages = _baseline_stages(chapter_info, study_pace, min_stages, max_stages)
            total = len(stages)
        else:
            # 确保标题精炼 (≤10 汉字)
            for s in stages:
                if isinstance(s, dict) and "title" in s:
                    s["title"] = s["title"][:10]

        learning_plan = {
            "plan_id": str(uuid.uuid4()),
            "user_id": state.get("user_id", ""),
            "course_id": course_id,
            "profile_id": profile.get("profile_id", ""),
            "stages": stages,
            "selected_materials": selected,
            "overview": result.get("overview", f"共 {total} 个学习阶段"),
            "total_estimated_minutes": result.get("total_estimated_minutes", total * 40),
        }

        logger.info(
            f"李纲: 路径规划完成 — {total} 个阶段 "
            f"(pace={study_pace}, kps={kp_count}, "
            f"range={min_stages}~{max_stages})"
        )

        return {
            "learning_plan": learning_plan,
            "total_stages": total,
            "status": "planning",
        }

    except Exception as e:
        logger.error(f"李纲: 路径规划失败 (使用基线): {e}")
        stages = _baseline_stages(chapter_info, study_pace, min_stages, max_stages)
        learning_plan = {
            "plan_id": str(uuid.uuid4()),
            "user_id": state.get("user_id", ""),
            "course_id": course_id,
            "profile_id": profile.get("profile_id", ""),
            "stages": stages,
            "selected_materials": selected,
            "overview": f"共 {len(stages)} 个学习阶段 (基线划分)",
            "total_estimated_minutes": len(stages) * 40,
        }
        return {
            "learning_plan": learning_plan,
            "total_stages": len(stages),
            "status": "planning",
            "error": None,  # 非致命
        }


async def deliver_stage(
    state: dict,
) -> dict:
    """
    李纲 — 阶段交付

    汇总当前阶段的材料和审查结果 → DeliveryPackage。
    Phase 2 简化版: 从 materials 和 review_report 组装交付包。

    :param state: 当前 ZhiXueState (含 materials, review_report, current_stage)
    :return: 部分 State 字典, 含 delivery_package
    """
    materials = state.get("materials", {})
    review = state.get("review_report", {})
    stages = state.get("learning_plan", {}).get("stages", [])
    current_stage = state.get("current_stage", 0)

    material_summaries = []
    for mt, material in materials.items():
        per_review = review.get("per_material", {}).get(mt, {})
        summary = {
            "material_type": mt,
            "title": material.get("title", ""),
            "is_remedial": material.get("is_remedial", False),
            "l1_passed": per_review.get("l1_passed", True),
            "warnings": []
        }
        if per_review.get("l2_warning"):
            summary["warnings"].append(f"L2: {per_review['l2_warning']}")
        if per_review.get("l3_warning"):
            summary["warnings"].append(f"L3: {per_review['l3_warning']}")
        material_summaries.append(summary)

    # 下一阶段预览
    next_preview = None
    if current_stage + 1 < len(stages):
        next_stage = stages[current_stage + 1]
        next_preview = next_stage.get("title", "")

    delivery = {
        "package_id": str(uuid.uuid4()),
        "session_id": state.get("session_id", ""),
        "stage_number": current_stage,
        "materials": material_summaries,
        "study_guide": (
            f"请认真阅读讲义, 完成练习题。"
            f"如有疑问可随时使用 AI 对话功能。"
        ),
        "next_stage_preview": next_preview,
    }

    logger.info(
        f"李纲: 阶段 {current_stage} 交付完成 "
        f"({len(material_summaries)} 个材料)"
    )

    return {"delivery_package": delivery}


# ============================================================================
# 基线阶段划分 (LLM 失败降级)
# ============================================================================

def _baseline_stages(
    chapter_info: list[dict],
    study_pace: str,
    min_stages: int,
    max_stages: int,
) -> list[dict]:
    """
    基线阶段划分: 按章节拆分, 根据 study_pace 决定是否合并/细分

    :param chapter_info: 章节列表 [{id, title, knowledge_points}]
    :param study_pace: 学习节奏
    :param min_stages: 最小阶段数
    :param max_stages: 最大阶段数
    :return: 阶段列表
    """
    import re

    def shorten(title: str) -> str:
        """精炼标题到 10 字以内"""
        if len(title) <= 10:
            return title
        for pattern in [
            r'^第[一二三四五六七八九十\d]+章\s*',
            r'^第[一二三四五六七八九十\d]+节\s*',
        ]:
            title = re.sub(pattern, '', title).strip()
        return title[:10]

    if study_pace == "cram":
        # 突击: 合并章节, 每阶段 2-3 章
        stages = []
        chunk_size = max(1, len(chapter_info) // max(min_stages, max_stages))
        for i in range(0, len(chapter_info), chunk_size):
            chunk = chapter_info[i:i + chunk_size]
            kps = []
            for ch in chunk:
                kps.extend(ch.get("knowledge_points", []))
            stages.append({
                "title": shorten(" + ".join(ch["title"] for ch in chunk)) + " (综合)",
                "topic": "阶段" + str(len(stages) + 1),
                "description": f"综合学习 {len(kps)} 个知识点",
                "knowledge_points": kps,
                "estimated_duration_minutes": 90,
                "status": "pending",
            })
    elif study_pace == "steady":
        # 坚持: 细分知识点, 每阶段 1-2 个知识点
        stages = []
        for ch in chapter_info:
            kps = ch.get("knowledge_points", [])
            # 每个知识点一个阶段
            for kp in kps:
                stages.append({
                    "title": shorten(kp),
                    "topic": kp,
                    "description": f"深入理解 {kp}",
                    "knowledge_points": [kp],
                    "estimated_duration_minutes": 25,
                    "status": "pending",
                })
        # 如果超出上限, 合并
        while len(stages) > max_stages:
            merged = []
            for i in range(0, len(stages), 2):
                pair = stages[i:i + 2]
                if len(pair) == 1:
                    merged.append(pair[0])
                else:
                    merged.append({
                        "title": shorten(f"{pair[0]['title']} + {pair[1]['title']}"),
                        "topic": "阶段" + str(len(merged) + 1),
                        "description": f"学习 {pair[0]['topic']} 和 {pair[1]['topic']}",
                        "knowledge_points": (
                            pair[0].get("knowledge_points", [])
                            + pair[1].get("knowledge_points", [])
                        ),
                        "estimated_duration_minutes": 40,
                        "status": "pending",
                    })
            stages = merged
    else:
        # moderate: 每章 1-2 个阶段
        stages = []
        for ch in chapter_info:
            stages.append({
                "title": shorten(ch["title"]),
                "topic": ch["title"],
                "description": f"学习 {ch['title']} 的核心知识点",
                "knowledge_points": ch.get("knowledge_points", []),
                "estimated_duration_minutes": 40,
                "status": "pending",
            })

    # 确保在范围内
    if len(stages) < min_stages and len(chapter_info) > 1:
        # 如果阶段太少, 每个阶段拆分
        pass  # 当前已按章节划分, 不会再少了
    if len(stages) > max_stages:
        stages = stages[:max_stages]

    # 设置序号
    for i, s in enumerate(stages):
        s["stage_number"] = i

    return stages
