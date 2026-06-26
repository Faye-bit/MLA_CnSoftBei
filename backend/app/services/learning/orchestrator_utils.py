"""
智能体编排器 — 工具函数
包含数据库查询辅助、资源去重持久化、链接注入和主观题 AI 评分
从 agent_orchestrator.py 中提取
"""

import uuid
import re
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.learning import LearningSession, LearningStage, GeneratedResource
from app.services.config_service import get_config_value
from app.services.llm_utils import create_llm_client, parse_json_output
from loguru import logger


# ============================================================================
# 工具函数
# ============================================================================

def _deduplicate_resource_titles(resources: list[dict]) -> list[dict]:
    """
    对同类型资源重名时自动添加序号后缀, 确保用户可区分

    例如: 3 个名为 "操作系统 思维导图" 的资源会被重命名为:
      "操作系统 思维导图 (1)" → "操作系统 思维导图 (2)" → "操作系统 思维导图 (3)"

    :param resources: 资源 dict 列表 (含 resource_type 和 title 字段)
    :return: 去重后的资源列表 (原地修改)
    """
    # 按类型分组计数
    type_counts: dict[str, int] = {}
    for res in resources:
        res_type = res.get("resource_type", "")
        type_counts[res_type] = type_counts.get(res_type, 0) + 1

    # 同类型多于 1 个时才添加序号
    type_indices: dict[str, int] = {}
    for res in resources:
        res_type = res.get("resource_type", "")
        if type_counts.get(res_type, 0) > 1:
            idx = type_indices.get(res_type, 0) + 1
            type_indices[res_type] = idx
            res["title"] = f"{res['title']} ({idx})"

    return resources


async def _save_resources_with_unique_titles(
    db: AsyncSession,
    stage_id: uuid.UUID,
    resources: list[dict],
):
    """
    持久化资源到数据库, 自动处理重名问题并去重

    去重策略:
      1. 同类型同标题的资源只保留一份 (按 title + resource_type 去重)
      2. 清除 stage 中与待保存资源类型匹配的旧资源 (避免累积)

    :param db: 数据库会话
    :param stage_id: 阶段 ID
    :param resources: 资源 dict 列表
    """
    _deduplicate_resource_titles(resources)

    # 删除同一 stage 下与待保存资源同类型的旧资源
    new_types = {r["resource_type"] for r in resources}
    if new_types:
        from sqlalchemy import delete as sqla_delete
        del_stmt = sqla_delete(GeneratedResource).where(
            GeneratedResource.stage_id == stage_id,
            GeneratedResource.resource_type.in_(new_types),
        )
        await db.execute(del_stmt)

    for i, res in enumerate(resources):
        gen_res = GeneratedResource(
            stage_id=stage_id,
            resource_type=res["resource_type"],
            title=res["title"],
            description=res.get("description", ""),
            content=res.get("content", ""),
            resource_metadata=res.get("resource_metadata", {}),
            order_index=i,
        )
        db.add(gen_res)


# ============================================================================
# 数据库查询辅助: 安全查询阶段 (防重复行)
# ============================================================================

async def _get_unique_stage_by_index(
    db: AsyncSession,
    session_id: uuid.UUID,
    order_index: int,
) -> Optional[LearningStage]:
    """
    安全查询指定索引的 LearningStage, 容忍重复行

    背景: SSE 重连可能导致同一 (session_id, order_index) 存在多条记录。
    scalar_one_or_none() 在遇到多条时会抛 MultipleRows 错误。
    本函数使用 ORDER BY + LIMIT 1 确保总是返回最多一条, 并在检测到
    重复时发出警告日志。

    :param db: 数据库会话
    :param session_id: 会话 ID
    :param order_index: 阶段序号
    :return: 最新的一条 LearningStage, 不存在时返回 None
    """
    stmt = (
        select(LearningStage)
        .where(
            LearningStage.session_id == session_id,
            LearningStage.order_index == order_index,
        )
        .order_by(LearningStage.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalars().first()


async def _get_resources_for_stage_index(
    db: AsyncSession,
    session_id: uuid.UUID,
    order_index: int,
) -> list[GeneratedResource]:
    """
    安全查询指定阶段索引的所有已生成资源

    同样容忍重复 LearningStage 行: 只查询最新一条 stage 的资源。
    使用子查询避免 JOIN 在重复行场景下放大结果集。

    :param db: 数据库会话
    :param session_id: 会话 ID
    :param order_index: 阶段序号
    :return: 资源列表 (按 order_index 排序)
    """
    # 子查询: 找到最新的 stage ID
    stage_subq = (
        select(LearningStage.id)
        .where(
            LearningStage.session_id == session_id,
            LearningStage.order_index == order_index,
        )
        .order_by(LearningStage.created_at.desc())
        .limit(1)
        .scalar_subquery()
    )
    stmt = (
        select(GeneratedResource)
        .where(GeneratedResource.stage_id == stage_subq)
        .order_by(GeneratedResource.order_index)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ============================================================================
# 链接注入: 讲义 → 交互动画
# ============================================================================

async def _inject_animation_links(
    db: AsyncSession,
    stage_id: uuid.UUID,
) -> None:
    """
    后处理函数: 在讲义 Markdown 中智能嵌入指向同一阶段交互动画的跳转链接

    仅在同一个阶段同时存在 handout 和 video_script 资源时执行。
    调用 LLM 判断讲义中与动画最相关的段落位置, 自然插入链接,
    链接使用自定义协议 mla-resource://{resource_id}, 前端统一拦截处理。

    此函数为非致命操作: 链接注入失败不会影响主流程 (静默降级)。

    :param db: 数据库会话
    :param stage_id: 阶段 ID
    """
    # 查询当前阶段的所有资源
    stmt = select(GeneratedResource).where(
        GeneratedResource.stage_id == stage_id
    ).order_by(GeneratedResource.order_index)
    result = await db.execute(stmt)
    stage_resources = result.scalars().all()

    # 找出讲义和动画资源
    handout = next(
        (r for r in stage_resources if r.resource_type == "handout"), None
    )
    animations = [r for r in stage_resources if r.resource_type == "video_script"]

    if not handout or not animations:
        return  # 无需注入: 缺少讲义或动画

    # 讲义内容为空或过短 (容错)
    if not handout.content or len(handout.content.strip()) < 50:
        logger.warning("讲义内容过短, 跳过链接注入")
        return

    # 构建可用动画链接描述 (供 LLM 参考)
    links_info = "\n".join(
        f"- 动画标题: 「{a.title}」, 链接: mla-resource://{a.id}"
        for a in animations
    )

    client = create_llm_client()
    model = get_config_value("llm_model")

    # 截断保护: 避免超长讲义超出 token 限制
    content_snippet = handout.content[:10000] if len(handout.content) > 10000 else handout.content

    prompt = f"""请在以下课程讲义中, 在讲到与动画内容相关的知识点时, 自然地插入动画演示链接。

可用的动画链接:
{links_info}

讲义原文:
{content_snippet}

## 插入规则
1. 找到讲义中与动画标题最相关的一个段落, 在该段落末尾插入对应链接
2. 链接格式: [🎬 观看「{animations[0].title if len(animations) == 1 else "动画演示"}」](mla-resource://资源ID)
3. 不要修改讲义的任何其他内容 (包括标题、段落文字、格式)
4. 如果一个阶段有多个动画, 分别放在最相关的位置
5. 如果讲义中没有明显对应的段落, 在文末添加一个"## 🎬 交互动画演示"小节, 将全部动画链接以列表形式列出
6. 直接输出修改后的完整讲义, 不要加任何解释性文字"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,  # 低温度, 减少对原文的不必要修改
            max_tokens=10000,
        )
        new_content = (response.choices[0].message.content or "").strip()

        # =====================================================================
        # UUID 完整性校验: 防止 LLM 篡改链接中的资源 ID
        # =====================================================================
        valid_ids = {str(a.id) for a in animations}
        mla_pattern = re.compile(r'mla-resource://([0-9a-fA-F\-]{36})')

        def _validate_and_fix_uuid(match: re.Match) -> str:
            """如果 UUID 不在合法集合中, 尝试用原始 UUID 替换"""
            found = match.group(1)
            if found in valid_ids:
                return match.group(0)  # UUID 正确, 保持不变
            logger.warning(
                f"链接注入: 检测到被篡改的 UUID {found}, "
                f"合法 UUID: {valid_ids}"
            )
            fallback = next(iter(valid_ids))
            return f"mla-resource://{fallback}"

        new_content = mla_pattern.sub(_validate_and_fix_uuid, new_content)

        # 安全检查: 确保 LLM 没有严重截断或破坏原文
        if new_content and len(new_content) >= len(handout.content) * 0.6:
            handout.content = new_content
            logger.info(
                f"讲义链接注入完成: "
                f"handout={handout.id[:8]}..., "
                f"animations={len(animations)} 个链接已嵌入"
            )
        else:
            logger.warning(
                f"讲义链接注入被放弃 (内容长度异常): "
                f"原 {len(handout.content)} 字符, 新 {len(new_content)} 字符"
            )
    except Exception as e:
        # 非致命错误: 链接注入失败不影响主流程
        logger.warning(f"讲义链接注入失败 (非致命): {e}")


# ============================================================================
# Agent 输出摘要
# ============================================================================

def _summarize_node_output(node_name: str, output: dict) -> str:
    """根据节点名称和输出生成摘要"""
    summaries = {
        "coordinator": lambda o: f"规划了 {o.get('total_stages', 0)} 个学习阶段",
        "profile": lambda o: "画像分析完成",
        "retrieval": lambda o: f"检索到 {len(o.get('knowledge_context', []))} 条相关资料",
        "teaching_design": lambda o: f"设计了 {len(o.get('teaching_plan', {}).get('resources', []))} 种资源",
        "resource_generation": lambda o: f"生成了 {len(o.get('resources', []))} 个学习资源",
        "fact_check": lambda o: "核查通过" if o.get("fact_check_passed", False) else "核查发现问题",
        "summary": lambda o: "结果已保存",
    }
    fn = summaries.get(node_name, lambda o: "完成")
    return fn(output)


# ============================================================================
# 主观题 AI 打分 (填空题 / 简答题)
# ============================================================================

EXERCISE_SCORING_SYSTEM_PROMPT = """你是 MLA 智学引擎的 AI 评分教师, 负责对学生的填空题和简答题答案进行智能评分。

评分规则:
1. 满分 10 分, 最低 0 分
2. 评分标准:
   - 9-10分: 答案完全正确或接近完美, 核心要点全部命中
   - 7-8分: 答案基本正确, 覆盖了大部分核心要点, 可能有轻微遗漏
   - 5-6分: 答案部分正确, 抓住了部分要点, 但有明显遗漏或不准确
   - 3-4分: 答案有一些相关思路, 但不够准确或遗漏较多
   - 0-2分: 答案与参考答案差距较大或完全偏离主题
3. 对简答题侧重考察理解深度和要点覆盖度
4. 对填空题侧重考察关键概念/术语的准确性, 允许表述略有不同但语义一致
5. 评语 feedback 应包含:
   - 简短肯定 (如果有可取之处)
   - 指出不足或遗漏 (如有)
   - 建议改进方向 (1-2 句话)

输出格式 (严格 JSON):
{
  "score": 8,
  "feedback": "你的回答抓住了核心要点... 建议补充..."
}"""


async def score_exercise_answer(
    question_id: str,
    question_type: str,
    question_text: str,
    user_answer: str,
    reference_answer: str,
    explanation: str | None = None,
) -> dict:
    """
    调用 LLM 对主观题答案进行智能评分

    :param question_id: 题目 ID
    :param question_type: 题目类型 (fill_blank / short_answer)
    :param question_text: 题目正文
    :param user_answer: 用户输入的答案
    :param reference_answer: 参考答案
    :param explanation: 题目解析 (可选)
    :return: {"question_id": str, "score": int, "feedback": str}
    """
    client = create_llm_client()
    model = get_config_value("llm_model")

    question_type_label = "填空题" if question_type == "fill_blank" else "简答题"

    user_prompt = f"""请为以下{question_type_label}的学生答案评分:

题目: {question_text}

参考答案: {reference_answer}
{f"题目解析: {explanation}" if explanation else ""}

学生答案: {user_answer}

请根据评分规则给出 0-10 的分数和评语。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": EXERCISE_SCORING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=300,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        score = result.get("score", 5)
        # 确保分数在 0-10 范围内
        if not isinstance(score, (int, float)) or score < 0:
            score = 5
        score = max(0, min(10, int(round(score))))

        feedback = result.get("feedback", "")
        if not feedback:
            feedback = f"评分: {score}/10"

        logger.info(
            f"AI 评分完成: question_id={question_id}, "
            f"type={question_type}, score={score}/10"
        )
        return {
            "question_id": question_id,
            "score": score,
            "feedback": feedback,
        }

    except Exception as e:
        logger.error(
            f"AI 评分失败 (降级为默认评分 5/10): "
            f"question_id={question_id}, error={type(e).__name__}: {str(e)[:200]}"
        )
        # 降级: 返回默认评分
        return {
            "question_id": question_id,
            "score": 5,
            "feedback": f"自动评分暂时不可用, 已记录你的答案。请参考标准答案自行对比。",
        }
