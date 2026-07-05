"""
解惑师霍然 (remedial_guide) 实现

职责:
  1. 接收学生自由文本困惑描述
  2. 分析知识薄弱点, 生成诊断报告
  3. 为每个匠人生成个性化生成指令 (craft_instructions)

调用时机: 学生在阶段学习中点击独立的"生成补救资源"按钮,
         输入困惑描述后, 由向南编排器调起霍然进行分析。
"""

import json
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.config_service import get_config_value
from app.services.llm_utils import create_llm_client, parse_json_output
from app.services.zhixue.prompts import HUORAN_REMEDIAL_SYSTEM_PROMPT
from loguru import logger


async def analyze_confusion(
    state: dict,
    *,
    db: AsyncSession | None = None,
) -> dict:
    """
    霍然 — 困惑分析与补救策略生成

    接收学生的自然语言困惑描述, 对照当前阶段的主题和知识点,
    调用 LLM 生成诊断报告和针对每个匠人的个性化生成指令。

    :param state: ZhiXueState 字典, 需包含:
        - confusion_text: 学生困惑描述文本
        - learning_plan: 学习计划 (含 stages)
        - current_stage: 当前阶段序号
        - learning_profile: 学生画像
    :param db: 数据库会话 (预留, 当前版本暂不用于 RAG)
    :return: {
        diagnosis: {confused_concepts, gap_analysis, root_cause},
        remedial_strategy: {approach, difficulty_level, focus_areas, ...},
        craft_instructions: {handout, exercise, mindmap, reading, animation, code},
        summary: 给学生的一句话鼓励
    }
    """
    confusion_text = state.get("confusion_text", "")
    if not confusion_text or len(confusion_text.strip()) < 5:
        logger.warning("霍然: 困惑描述过短或为空, 使用通用降级策略")
        return _fallback_diagnosis(state)

    # ── 构建上下文 ──
    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current = state.get("current_stage", 0)
    stage = stages[current] if current < len(stages) else {}
    stage_title = stage.get("title", stage.get("topic", ""))
    stage_kps = stage.get("knowledge_points", [])
    profile = state.get("learning_profile", {})

    # ── 构建 user prompt ──
    user_prompt = f"""当前阶段: {stage_title}
阶段知识点: {', '.join(stage_kps[:10]) if stage_kps else '未指定'}
学生学习画像: {json.dumps(profile, ensure_ascii=False)[:500] if profile else '暂无画像'}

学生困惑描述:
\"{confusion_text}\"

请分析学生的困惑, 制定补救策略, 并为每个选中的资源类型生成具体的生成指令。
如果某个 craft_instructions 中的资源类型未被选择, 该字段可留空字符串。"""

    # ── 调用 LLM ──
    try:
        client = create_llm_client()
        model = get_config_value("llm_model")

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": HUORAN_REMEDIAL_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        # ── 校验关键字段 ──
        if "diagnosis" not in result:
            logger.warning("霍然: LLM 返回缺少 diagnosis 字段, 使用降级方案")
            return _fallback_diagnosis(state)

        diagnosis = result.get("diagnosis", {})
        confused = diagnosis.get("confused_concepts", [])
        logger.info(
            f"霍然: 困惑分析完成, "
            f"concepts={confused}, "
            f"root_cause={diagnosis.get('root_cause', 'unknown')}"
        )
        return result

    except Exception as e:
        logger.error(f"霍然: LLM 调用失败: {e}")
        return _fallback_diagnosis(state)


def _fallback_diagnosis(state: dict) -> dict:
    """
    降级诊断: LLM 调用失败或困惑描述为空时的兜底方案

    从学习计划和画像中提取信息, 生成通用的补救策略,
    确保补救流程不会因为霍然分析失败而中断。
    """
    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current = state.get("current_stage", 0)
    stage = stages[current] if current < len(stages) else {}
    stage_title = stage.get("title", stage.get("topic", "当前阶段"))
    stage_kps = stage.get("knowledge_points", [])
    confusion_text = state.get("confusion_text", "")
    profile = state.get("learning_profile", {})

    # 如果有困惑文本, 尝试提取关键概念 (简单关键词匹配)
    focus_kps = stage_kps[:3] if stage_kps else [stage_title]

    approach = f"学生对「{stage_title}」的核心概念理解不足"
    if confusion_text:
        approach += f", 困惑描述: 「{confusion_text[:80]}...」" if len(confusion_text) > 80 else f", 困惑描述: 「{confusion_text}」"

    # 从画像中获取难度参考
    suggested_difficulty = profile.get("suggested_difficulty", 0.5)
    remedial_difficulty = max(0.1, suggested_difficulty - 0.2)

    return {
        "diagnosis": {
            "confused_concepts": focus_kps,
            "gap_analysis": f"学生对「{stage_title}」的核心概念存在理解困难, 需要从更基础的角度重新讲解",
            "root_cause": "疑似概念混淆或缺乏前置知识",
        },
        "remedial_strategy": {
            "approach": approach,
            "difficulty_level": remedial_difficulty,
            "focus_areas": focus_kps,
            "suggested_analogies": [],
            "terms_to_simplify": [],
        },
        "craft_instructions": {
            "handout": f"请围绕「{stage_title}」的核心概念, 用更通俗的语言重新解释。降低术语密度, 多使用生活化的比喻。重点讲解: {', '.join(focus_kps)}",
            "exercise": f"请设计针对「{stage_title}」的基础练习题, 从最简单的概念辨析开始, 逐步增加难度。题型以选择题和判断题为主。",
            "mindmap": f"请梳理「{stage_title}」各概念之间的关系, 用思维导图展示知识结构。",
            "reading": f"请推荐与「{stage_title}」相关的入门级阅读材料。",
            "animation": f"请为「{stage_title}」的核心概念制作可视化的交互动画。",
            "code": f"请设计与「{stage_title}」相关的基础代码实操练习。",
        },
        "summary": "别担心, 每个人在学习新知识时都会遇到困难。让我们一起从最基础的地方开始, 一步步来! 💪",
    }
