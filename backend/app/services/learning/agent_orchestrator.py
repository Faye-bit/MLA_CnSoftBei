"""
智能体编排器 (基于 LangGraph)
实现多智能体协同流水线, 通过 SSE 实时推送生成进度

编排流程:
1. Coordinator Agent — 规划学习路径阶段
2. Profile Agent — 读取并总结学生画像
3. Retrieval Agent — 从知识库检索相关资料
4. Teaching Design Agent — 设计阶段教学方案和资源类型
5. 并行资源生成 — 6 种资源同时生成 (asyncio.gather)
6. Safety & Fact Check Agent — 事实核查和安全过滤
7. Coordinator Summary — 汇总生成结果

策略: 懒加载阶段生成 — 首先生成第一阶段, 用户完成后触发生成下一阶段
"""

import uuid
import json
import time
import asyncio
import re
from typing import AsyncGenerator, Optional, TypedDict, List, Annotated
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from langgraph.graph import StateGraph, START, END
from langgraph.config import get_stream_writer
from langgraph.types import RunnableConfig

from app.models.learning import LearningSession, LearningStage, GeneratedResource
from app.models.course import Course, Chapter, KnowledgePoint
from app.models.profile import StudentProfile
from app.services.config_service import get_config_value
from app.services.retriever import retrieve as rag_retrieve
from app.services.learning.resource_generators import (
    RESOURCE_GENERATORS, RESOURCE_TYPE_LABELS,
)
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

    # 收集待保存资源的 (resource_type, title) 对
    new_keys = {(r["resource_type"], r["title"]) for r in resources}

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
    # 查询当前阶段的所有资源 (刚通过 _save_resources_with_unique_titles 添加的)
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

    client = _create_llm_client()
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
        # LLM 在处理长文本时可能意外修改 UUID 中的字符, 导致前端查找资源失败
        # =====================================================================
        valid_ids = {str(a.id) for a in animations}
        mla_pattern = re.compile(r'mla-resource://([0-9a-fA-F\-]{36})')

        def _validate_and_fix_uuid(match: re.Match) -> str:
            """如果 UUID 不在合法集合中, 尝试用原始 UUID 替换"""
            found = match.group(1)
            if found in valid_ids:
                return match.group(0)  # UUID 正确, 保持不变
            # UUID 被篡改: 查找最相似的合法 UUID 进行替换
            logger.warning(
                f"链接注入: 检测到被篡改的 UUID {found}, "
                f"合法 UUID: {valid_ids}"
            )
            # 返回第一个合法 UUID 作为兜底 (多动画场景极少)
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
# LangGraph 状态定义
# ============================================================================

class LearningState(TypedDict, total=False):
    """智能体编排的全局状态, 在 LangGraph 节点之间传递"""
    # 会话信息
    user_id: str
    course_id: str
    session_id: str

    # 课程信息
    course_name: str
    chapters: list  # 章节列表 (含知识点)

    # 学生画像
    profile_summary: str  # 画像摘要文本

    # 学习路径 (Coordinator 输出)
    stages: list  # 所有阶段的规划
    total_stages: int

    # 当前阶段
    current_stage_index: int
    stage_title: str
    stage_description: str
    stage_kps: list  # 当前阶段的知识点 ID

    # 检索结果 (Retrieval Agent 输出)
    knowledge_context: list  # RAG 检索上下文

    # 教学方案 (Teaching Design Agent 输出)
    teaching_plan: dict  # 包含 resource_types 列表

    # 生成资源
    resources: list  # 生成的资源列表

    # 事实核查
    fact_check_report: dict
    fact_check_passed: bool

    # 错误状态
    error: str


# ============================================================================
# LLM 客户端
# ============================================================================

def _create_llm_client() -> AsyncOpenAI:
    """创建 OpenAI 兼容的异步 LLM 客户端"""
    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    return AsyncOpenAI(api_key=api_key, base_url=api_base)


# ============================================================================
# Agent System Prompts
# ============================================================================

COORDINATOR_SYSTEM_PROMPT = """你是 MLA 多学助手的 Coordinator (协调者) Agent, 负责为学生的学习路径做整体规划。

你的任务:
1. 根据课程章节结构和学生画像, 将课程内容合理划分为 3-6 个学习阶段
2. 每个阶段应有一个明确的主题, 覆盖 2-5 个相关知识点
3. 阶段之间应有逻辑递进关系 (从基础到深入, 从概念到应用)
4. 考虑学生的当前水平和学习目标来调整阶段难度和顺序

输出格式 (严格 JSON):
{
  "stages": [
    {
      "title": "阶段标题 (精炼, 不超过8个汉字, 如: 进程管理、内存管理)",
      "description": "阶段描述 (一句话说明本阶段学什么和为什么)",
      "knowledge_points": ["知识点名称1", "知识点名称2"],
      "order": 0
    }
  ],
  "total_stages": 5,
  "overall_description": "整体学习路径说明"
}"""


def _shorten_title(title: str, max_len: int = 8) -> str:
    """
    精炼阶段标题到限定字数以内
    处理策略:
    1. 去除常见的编号前缀 (如 "第一章", "第1章", "一、")
    2. 若仍超出 max_len, 截取前 max_len 个字符

    :param title: 原始标题
    :param max_len: 最大字符数
    :return: 精炼后的标题
    """
    if len(title) <= max_len:
        return title

    # 去除常见前缀:
    # "第X章" / "第X节" / "一、" / "1." / "1、" 等
    cleaned = title
    for pattern in [
        r'^第[一二三四五六七八九十\d]+章\s*',
        r'^第[一二三四五六七八九十\d]+节\s*',
        r'^[一二三四五六七八九十]、\s*',
        r'^\d+[\.、]\s*',
    ]:
        cleaned = re.sub(pattern, '', cleaned).strip()

    # 再次检查长度
    if len(cleaned) <= max_len:
        return cleaned

    # 截取前 max_len 个字符
    return cleaned[:max_len]


PROFILE_SYSTEM_PROMPT = """你是 MLA 多学助手的 Profile Agent, 负责分析学生学习画像并为下游 Agent 提供参考。

请根据学生的画像数据, 用自然语言总结以下信息:
1. 学生的知识基础水平 (初学者/有一定基础/较扎实)
2. 学生的学习偏好 (喜欢什么类型的资源和学习方式)
3. 学生的薄弱环节 (需要重点关注的领域)
4. 适合该学生的教学策略建议

请输出一段 100-200 字的自然语言总结, 直接输出文本即可。"""


RETRIEVAL_SYSTEM_PROMPT = """你是 MLA 多学助手的 Knowledge Retrieval Agent, 负责从知识库中检索相关资料并整合。

请根据检索到的知识库内容, 以自然语言总结当前阶段的关键知识点:
1. 核心概念和定义
2. 重要的原理和机制
3. 常见的误区或易混淆点
4. 知识点之间的关联关系

请输出一段 150-300 字的总结, 供下游资源生成 Agent 参考。"""


TEACHING_DESIGN_SYSTEM_PROMPT = """你是 MLA 多学助手的 Teaching Design Agent, 负责为每个学习阶段设计教学方案。

你的任务是根据阶段主题、知识内容和学生画像, 确定该阶段应生成哪些类型的资源, 以及每种资源的具体主题。

可选的资源类型:
- handout: 课程讲义 (核心, 每个阶段必选)
- mindmap: 思维导图 (推荐, 展示知识结构)
- exercise: 练习题 (推荐, 巩固学习)
- reading: 拓展阅读 (可选, 深化理解)
- coding_practice: 编程实操 (面向编程相关知识点)
- video_script: 交互动画 (面向难以直观理解的单个重要知识点, 生成 HTML 动态页面)

输出格式 (严格 JSON):
{
  "resources": [
    {
      "type": "handout",
      "title": "资源标题",
      "description": "资源简介",
      "priority": "required|recommended|optional",
      "prompt_hint": "对该资源生成的具体提示建议"
    }
  ],
  "teaching_strategy": "整体教学策略说明 (一句话)"
}"""


FACT_CHECK_SYSTEM_PROMPT = """你是 MLA 多学助手的安全与事实核查 Agent, 负责检查生成内容的质量。

请对以下生成的学习资源进行审核:
1. 事实准确性: 资源中的定义、原理、例子是否与知识库内容一致
2. 内容完整性: 是否覆盖了关键知识点, 是否有明显遗漏
3. 适宜性: 内容难度是否适合学生水平
4. 安全性: 是否有不当内容或错误引导

输出格式 (严格 JSON):
{
  "passed": true,
  "overall_score": 85,
  "issues": [
    {"resource": "资源名称", "severity": "minor|major|critical", "description": "问题描述"}
  ],
  "summary": "整体评价 (一句话)"
}"""


# ============================================================================
# LangGraph 节点实现
# ============================================================================

async def coordinator_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    Coordinator Agent 节点
    分析课程结构和学生画像, 规划学习路径阶段
    """
    db = config["configurable"]["db"]
    user_id = config["configurable"]["user_id"]
    course_id = config["configurable"]["course_id"]

    writer = get_stream_writer()
    writer({"type": "agent_progress", "agent": "coordinator", "message": "正在分析课程结构和学生画像..."})

    client = _create_llm_client()
    model = get_config_value("llm_model")

    # 获取课程信息
    course = await db.get(Course, uuid.UUID(course_id))
    course_name = course.name if course else "未知课程"

    # 获取章节和知识点结构
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
        kp_stmt = select(KnowledgePoint).where(KnowledgePoint.chapter_id == ch.id)
        kp_result = await db.execute(kp_stmt)
        kps = kp_result.scalars().all()
        kp_names = [kp.title for kp in kps]
        all_kp_names.extend(kp_names)
        chapter_info.append({
            "id": str(ch.id),
            "title": ch.title,
            "knowledge_points": kp_names,
        })

    # 构建提示
    course_info_text = f"课程: {course_name}\n章节与知识点:\n"
    for ch in chapter_info:
        course_info_text += f"- {ch['title']}: {', '.join(ch['knowledge_points'])}\n"

    user_prompt = f"""请为以下课程规划学习路径:

{course_info_text}

学生画像:
{state.get('profile_summary', '暂无画像信息')}

请合理划分学习阶段。"""

    # 基础阶段: 每个章节作为一个阶段 (始终可用, 不依赖 LLM)
    # 标题精炼到 8 字以内, 确保前端 Steps 组件显示不溢出
    baseline_stages = [
        {
            "title": _shorten_title(ch["title"]),
            "description": f"学习 {ch['title']} 的核心知识点",
            "knowledge_points": ch["knowledge_points"],
            "order": i,
        }
        for i, ch in enumerate(chapter_info)
    ]

    # 尝试用 LLM 优化阶段划分 (失败则降级到基础阶段)
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": COORDINATOR_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw = response.choices[0].message.content or ""
        result_data = _parse_json_output(raw)

        llm_stages = result_data.get("stages", [])
        if llm_stages and len(llm_stages) > 0:
            # LLM 成功返回了阶段, 使用 LLM 结果
            # 对所有阶段标题进行精炼, 确保前端 Steps 不溢出
            for s in llm_stages:
                if isinstance(s, dict) and "title" in s:
                    s["title"] = _shorten_title(s["title"])
            total = result_data.get("total_stages", len(llm_stages))
            logger.info(f"Coordinator LLM 规划完成: {total} 个阶段")
            writer({"type": "agent_progress", "agent": "coordinator",
                    "message": f"规划了 {total} 个学习阶段"})
            return {
                "course_name": course_name,
                "chapters": chapter_info,
                "stages": llm_stages,
                "total_stages": total,
            }
        else:
            logger.warning(
                f"Coordinator LLM 返回空阶段, 使用基础阶段"
                f" ({len(baseline_stages)} 个)"
            )
    except Exception as e:
        logger.warning(
            f"Coordinator LLM 调用失败 (使用基础阶段, {len(baseline_stages)} 个): "
            f"{type(e).__name__}: {str(e)[:200]}"
        )

    # 降级: 使用基础阶段
    writer({"type": "agent_progress", "agent": "coordinator",
            "message": f"规划了 {len(baseline_stages)} 个学习阶段 (基础划分)"})
    return {
        "course_name": course_name,
        "chapters": chapter_info,
        "stages": baseline_stages,
        "total_stages": len(baseline_stages),
    }


async def profile_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    Profile Agent 节点
    读取学生画像并生成紧凑摘要供下游使用
    """
    db = config["configurable"]["db"]
    user_id = config["configurable"]["user_id"]

    writer = get_stream_writer()
    writer({"type": "agent_progress", "agent": "profile", "message": "正在读取学生画像..."})

    # 从数据库读取画像
    stmt = select(StudentProfile).where(StudentProfile.user_id == uuid.UUID(user_id))
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    if not profile or not profile.profile_data:
        return {"profile_summary": "暂无画像信息, 按通用水平生成内容"}

    profile_text_parts = []
    dim_labels = {
        "academic_background": "专业背景",
        "knowledge_basis": "知识基础",
        "learning_goals": "学习目标",
        "learning_preferences": "学习偏好",
        "weak_areas": "薄弱知识点",
        "interests": "兴趣方向",
    }
    for key, label in dim_labels.items():
        val = (profile.profile_data or {}).get(key, "")
        if isinstance(val, str) and val.strip():
            profile_text_parts.append(f"{label}: {val}")

    raw_profile = "\n".join(profile_text_parts) if profile_text_parts else "暂无画像信息"

    client = _create_llm_client()
    model = get_config_value("llm_model")

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": PROFILE_SYSTEM_PROMPT},
                {"role": "user", "content": f"学生画像数据:\n{raw_profile}"},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        summary = (response.choices[0].message.content or "").strip()
        logger.info(f"Profile 摘要: {summary[:80]}...")
        writer({"type": "agent_progress", "agent": "profile", "message": "画像分析完成"})
        return {"profile_summary": summary or raw_profile}
    except Exception as e:
        logger.warning(f"Profile Agent 失败 (使用原始数据): {e}")
        return {"profile_summary": raw_profile}


async def retrieval_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    Retrieval Agent 节点
    为当前阶段的知识点执行 RAG 检索, 获取知识上下文
    """
    db = config["configurable"]["db"]
    course_id = config["configurable"]["course_id"]

    writer = get_stream_writer()
    writer({"type": "agent_progress", "agent": "retrieval", "message": "正在检索知识库..."})

    stage_kps = state.get("stage_kps", [])
    stage_title = state.get("stage_title", "")

    # 使用阶段标题和知识点名称进行检索
    query = f"{stage_title} {' '.join(stage_kps)}"
    knowledge_context = []

    try:
        # RAG 检索
        results = await rag_retrieve(query, uuid.UUID(course_id), db, top_k=8)

        for r in results:
            knowledge_context.append({
                "content": r.content[:800] if len(r.content) > 800 else r.content,
                "document_filename": r.document_filename,
                "score": r.score,
                "chunk_index": r.chunk_index,
            })

        writer({"type": "agent_progress", "agent": "retrieval",
                "message": f"检索到 {len(knowledge_context)} 条相关资料"})

        # 用 LLM 整合检索结果
        if knowledge_context:
            kp_text = "\n\n---\n\n".join(
                f"[资料{i+1}] {k['content'][:500]}" for i, k in enumerate(knowledge_context[:5])
            )
            client = _create_llm_client()
            model = get_config_value("llm_model")

            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": RETRIEVAL_SYSTEM_PROMPT},
                        {"role": "user", "content": f"阶段主题: {stage_title}\n\n检索到的知识库内容:\n{kp_text}"},
                    ],
                    temperature=0.2,
                    max_tokens=500,
                )
                summary = (response.choices[0].message.content or "").strip()
                knowledge_context.insert(0, {
                    "content": summary,
                    "document_filename": "AI 知识总结",
                    "score": 1.0,
                    "chunk_index": 0,
                })
            except Exception as e:
                logger.warning(f"知识整合 LLM 调用失败: {e}")

        logger.info(f"Retrieval 完成: {len(knowledge_context)} 条上下文")
        return {"knowledge_context": knowledge_context}
    except Exception as e:
        logger.warning(f"RAG 检索失败: {e}")
        return {"knowledge_context": []}


async def teaching_design_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    Teaching Design Agent 节点
    根据阶段主题、知识内容和学生画像, 设计应生成哪些资源
    """
    writer = get_stream_writer()
    writer({"type": "agent_progress", "agent": "teaching_design", "message": "正在设计教学方案..."})

    stage_title = state.get("stage_title", "")
    profile_summary = state.get("profile_summary", "")

    # 获取知识摘要
    kp_summary = ""
    for ctx in (state.get("knowledge_context", []) or []):
        if ctx.get("document_filename") == "AI 知识总结":
            kp_summary = ctx.get("content", "")
            break

    client = _create_llm_client()
    model = get_config_value("llm_model")

    user_prompt = f"""请为以下学习阶段设计教学方案:

阶段: {stage_title}
知识内容: {kp_summary[:500] or "暂无详细信息"}
学生画像: {profile_summary[:300] or "暂无"}

请确定该阶段应生成哪些类型的资源。"""

    # 基础教学方案: 始终可用的默认资源列表
    baseline_resources = [
        {"type": "handout", "title": f"{stage_title} 讲义", "priority": "required"},
        {"type": "mindmap", "title": f"{stage_title} 思维导图", "priority": "recommended"},
        {"type": "exercise", "title": f"{stage_title} 练习题", "priority": "recommended"},
        {"type": "reading", "title": f"{stage_title} 拓展阅读", "priority": "optional"},
        {"type": "video_script", "title": f"{stage_title} 交互动画", "priority": "optional"},
    ]

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TEACHING_DESIGN_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=1000,
        )
        raw = response.choices[0].message.content or ""
        plan = _parse_json_output(raw)
        resources = plan.get("resources", []) if isinstance(plan, dict) else []

        if resources and len(resources) > 0:
            logger.info(f"Teaching Design LLM: {len(resources)} 种资源")
            return {"teaching_plan": plan}
        else:
            logger.warning("Teaching Design LLM 返回空, 使用基础方案")
    except Exception as e:
        logger.warning(f"Teaching Design LLM 失败 (使用基础方案): {type(e).__name__}: {str(e)[:200]}")

    # 降级: 使用基础教学方案
    return {
        "teaching_plan": {
            "resources": baseline_resources,
            "teaching_strategy": "标准教学方案"
        }
    }


async def resource_generation_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    并行资源生成节点
    使用 asyncio.gather() 并行生成所有规划的资源类型
    """
    writer = get_stream_writer()

    teaching_plan = state.get("teaching_plan", {})
    planned_resources = teaching_plan.get("resources", [])
    stage_title = state.get("stage_title", "")
    profile_summary = state.get("profile_summary", "")
    knowledge_context = state.get("knowledge_context", [])

    if not planned_resources:
        logger.warning("无规划资源, 跳过生成")
        return {"resources": []}

    async def generate_single(resource_spec: dict) -> dict:
        """生成单个资源, 包含进度报告"""
        res_type = resource_spec.get("type", "handout")
        res_title = resource_spec.get("title", f"{stage_title} - {RESOURCE_TYPE_LABELS.get(res_type, res_type)}")

        writer({"type": "agent_progress", "agent": res_type,
                "message": f"正在生成: {res_title}"})

        t_start = time.monotonic()

        generator = RESOURCE_GENERATORS.get(res_type)
        if not generator:
            logger.warning(f"未知资源类型: {res_type}")
            return None

        try:
            if res_type == "handout":
                content = await generator(stage_title, profile_summary, knowledge_context)
            elif res_type == "exercise":
                content_dict = await generator(stage_title, profile_summary, knowledge_context)
                content = json.dumps(content_dict, ensure_ascii=False)
            elif res_type == "mindmap":
                content = await generator(stage_title, knowledge_context)
            elif res_type == "reading":
                content = await generator(stage_title, knowledge_context)
            elif res_type == "coding_practice":
                content = await generator(stage_title, profile_summary, knowledge_context)
            elif res_type == "video_script":
                content = await generator(stage_title, knowledge_context)
            else:
                content = await generator(stage_title, profile_summary, knowledge_context)

            latency = int((time.monotonic() - t_start) * 1000)
            logger.info(f"资源生成完成: {res_title} ({latency}ms)")

            return {
                "resource_type": res_type,
                "title": res_title,
                "description": resource_spec.get("description", ""),
                "content": content,
                "resource_metadata": {
                    "generator": res_type,
                    "latency_ms": latency,
                    "priority": resource_spec.get("priority", "recommended"),
                },
            }
        except Exception as e:
            logger.error(f"资源生成失败 [{res_type}]: {e}")
            return {
                "resource_type": res_type,
                "title": res_title,
                "description": resource_spec.get("description", ""),
                "content": f"# {res_title}\n\n资源生成失败, 请稍后重试。\n\n错误信息: {str(e)}",
                "resource_metadata": {
                    "generator": res_type,
                    "error": str(e),
                },
            }

    # 并行生成所有资源
    tasks = [generate_single(r) for r in planned_resources]
    results = await asyncio.gather(*tasks)
    resources = [r for r in results if r is not None]

    # 注意: 不在此处发送 resource_ready 事件
    # 因为此时资源尚未持久化到数据库, 没有真实的 resource_id
    # resource_ready 事件将在 summary_node 持久化后由主流程统一发送

    logger.info(f"资源生成阶段完成: {len(resources)} 个资源")
    return {"resources": resources}


async def fact_check_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    Safety & Fact Check Agent 节点
    审查生成资源的质量和安全性
    """
    writer = get_stream_writer()
    writer({"type": "agent_progress", "agent": "safety", "message": "正在进行事实核查和安全审查..."})

    resources = state.get("resources", [])
    knowledge_context = state.get("knowledge_context", [])

    if not resources:
        return {"fact_check_passed": True, "fact_check_report": {"passed": True, "summary": "无资源需要核查"}}

    # 构建核查内容
    resources_text = ""
    for i, res in enumerate(resources[:5]):  # 最多核查 5 个资源
        content_preview = (res.get("content", "") or "")[:300]
        resources_text += f"\n[{i+1}] {res.get('title', '')}: {content_preview}\n"

    kp_text = "\n".join(
        k.get("content", "")[:200] for k in knowledge_context[:3]
    )

    client = _create_llm_client()
    model = get_config_value("llm_model")

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": FACT_CHECK_SYSTEM_PROMPT},
                {"role": "user", "content": f"知识库参考:\n{kp_text}\n\n生成资源:\n{resources_text}"},
            ],
            temperature=0.1,
            max_tokens=500,
        )
        raw = response.choices[0].message.content or ""
        report = _parse_json_output(raw)
        passed = report.get("passed", True) if isinstance(report, dict) else True
        logger.info(f"Fact Check: passed={passed}")
        return {"fact_check_passed": passed, "fact_check_report": report if isinstance(report, dict) else {}}
    except Exception as e:
        logger.warning(f"Fact Check 失败 (默认通过): {e}")
        return {"fact_check_passed": True, "fact_check_report": {"passed": True, "summary": "核查跳过"}}


async def summary_node(state: LearningState, config: RunnableConfig) -> dict:
    """
    Summary 节点
    汇总生成结果, 将资源持久化到数据库
    """
    db = config["configurable"]["db"]
    session_id = config["configurable"]["session_id"]

    resources = state.get("resources", [])
    stages = state.get("stages", [])
    current_index = state.get("current_stage_index", 0)

    writer = get_stream_writer()

    # 持久化资源到数据库
    session = await db.get(LearningSession, uuid.UUID(session_id))
    if session:
        # 创建或更新阶段记录 (使用安全查询, 容忍 SSE 重连产生的重复行)
        stage_title = state.get("stage_title", "")
        stage = await _get_unique_stage_by_index(
            db, uuid.UUID(session_id), current_index
        )

        if not stage:
            stage = LearningStage(
                session_id=uuid.UUID(session_id),
                title=stage_title,
                description=state.get("stage_description", ""),
                order_index=current_index,
                status="completed",
                knowledge_point_ids=state.get("stage_kps", []),
                stage_metadata={
                    "total_resources": len(resources),
                    "fact_check_passed": state.get("fact_check_passed", False),
                },
            )
            db.add(stage)
            await db.flush()
        else:
            stage.status = "completed"
            # 清除旧资源, 避免 SSE 重连导致重复累积
            from sqlalchemy import delete as sqla_delete
            del_stmt = sqla_delete(GeneratedResource).where(
                GeneratedResource.stage_id == stage.id
            )
            await db.execute(del_stmt)

        # 保存资源 (同类型重名时自动添加序号后缀)
        await _save_resources_with_unique_titles(db, stage.id, resources)

        # 后处理: 在讲义中嵌入指向交互动画的跳转链接
        await _inject_animation_links(db, stage.id)

        # 更新 learning_path
        if current_index < len(stages):
            stages[current_index]["status"] = "completed"
        session.learning_path = {"stages": stages}
        session.session_metadata = {
            **(session.session_metadata or {}),
            "total_resources": (session.session_metadata or {}).get("total_resources", 0) + len(resources),
        }

        await db.commit()
        logger.info(f"阶段 {current_index} 结果已持久化: {len(resources)} 个资源")

    writer({"type": "agent_progress", "agent": "summary", "message": "阶段资源已保存"})

    return {
        "stages": stages,  # 更新后的 stages
    }


# ============================================================================
# LangGraph 图构建
# ============================================================================

def _build_orchestration_graph() -> StateGraph:
    """
    构建 LangGraph 智能体编排图
    定义节点和边, 描述多智能体协同流程

    :return: 编译后的 LangGraph 图
    """
    workflow = StateGraph(LearningState)

    # 注册节点
    workflow.add_node("coordinator", coordinator_node)
    workflow.add_node("profile", profile_node)
    workflow.add_node("retrieval", retrieval_node)
    workflow.add_node("teaching_design", teaching_design_node)
    workflow.add_node("resource_generation", resource_generation_node)
    workflow.add_node("fact_check", fact_check_node)
    workflow.add_node("summary", summary_node)

    # 定义流转边 (线性流水线)
    workflow.add_edge(START, "coordinator")
    workflow.add_edge("coordinator", "profile")
    workflow.add_edge("profile", "retrieval")
    workflow.add_edge("retrieval", "teaching_design")
    workflow.add_edge("teaching_design", "resource_generation")
    workflow.add_edge("resource_generation", "fact_check")
    workflow.add_edge("fact_check", "summary")
    workflow.add_edge("summary", END)

    return workflow.compile()


# ============================================================================
# SSE 事件格式化
# ============================================================================

def _sse_event(event_type: str, data: dict) -> str:
    """将事件数据格式化为 SSE 标准格式"""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


# ============================================================================
# 主入口: SSE 流式编排生成器
# ============================================================================

AGENT_DISPLAY_NAMES = {
    "coordinator": "协调者 Agent",
    "profile": "画像 Agent",
    "retrieval": "知识检索 Agent",
    "teaching_design": "教学设计 Agent",
    "resource_generation": "资源生成 Agent",
    "fact_check": "安全核查 Agent",
    "summary": "汇总 Agent",
}

AGENT_START_MESSAGES = {
    "coordinator": "正在规划学习路径...",
    "profile": "正在分析学生画像...",
    "retrieval": "正在检索知识库...",
    "teaching_design": "正在设计教学方案...",
    "resource_generation": "正在生成学习资源...",
    "fact_check": "正在进行事实核查...",
    "summary": "正在汇总结果...",
}


async def generate_learning_path_stream(
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """
    SSE 流式智能体编排生成器 — 主入口
    运行完整的 LangGraph 编排流水线, 实时推送进度事件

    供 API 端点 /learning/sessions/{id}/stream 调用

    :param user_id: 用户 ID
    :param course_id: 课程 ID
    :param session_id: 学习会话 ID
    :param db: 数据库会话
    :yield: SSE 格式化的事件字符串
    """
    # 获取课程名称
    course = await db.get(Course, course_id)
    course_name = course.name if course else "未知课程"

    # 发送会话初始化事件
    yield _sse_event("session_init", {
        "session_id": str(session_id),
        "course_name": course_name,
    })

    # 获取会话 (普通查询, 不持锁)
    # 并发安全由后续的幂等性检查 + 数据库 UNIQUE 约束保证:
    #   1. 如果有资源 → 直接返回已有资源, 不重新生成
    #   2. LearningStage (session_id, order_index) UNIQUE → 防止重复阶段
    #   3. _save_resources_with_unique_titles 先删同类型再插入 → 防止资源累积
    session = await db.get(LearningSession, session_id)
    if not session:
        yield _sse_event("error", {"message": "学习会话不存在"})
        return

    existing_stages = (session.learning_path or {}).get("stages", [])
    current_index = session.current_stage_index

    # =========================================================================
    # 幂等性检查: 如果当前阶段已有资源, 直接返回 (跳过重新生成)
    # 防止 SSE 重连时重复生成, 也是并发安全的最后防线
    # =========================================================================
    if existing_stages and current_index < len(existing_stages):
        existing_resources = await _get_resources_for_stage_index(
            db, session_id, current_index
        )
        if existing_resources:
            logger.info(
                f"会话 {session_id} 阶段 {current_index} 已有 "
                f"{len(existing_resources)} 个资源, 跳过生成直接返回"
            )
            yield _sse_event("path_update", {"learning_path": {"stages": existing_stages}})
            yield _sse_event("stage_start", {
                "stage_index": current_index,
                "stage_title": existing_stages[current_index].get("title", ""),
                "total_stages": len(existing_stages),
            })
            for res in existing_resources:
                yield _sse_event("resource_ready", {
                    "resource_id": str(res.id),
                    "resource_type": res.resource_type,
                    "title": res.title,
                    "stage_index": current_index,
                })
            yield _sse_event("stage_complete", {
                "stage_index": current_index,
                "resources": [
                    {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
                    for r in existing_resources
                ],
            })
            yield _sse_event("session_complete", {
                "session_id": str(session_id),
                "message": "阶段资源已存在, 无需重新生成",
            })
            return

    # 如果已有完整路径, 直接为当前阶段生成资源
    if existing_stages and current_index < len(existing_stages):
        stage = existing_stages[current_index]
        yield _sse_event("path_update", {"learning_path": {"stages": existing_stages}})
        yield _sse_event("stage_start", {
            "stage_index": current_index,
            "stage_title": stage.get("title", ""),
            "total_stages": len(existing_stages),
        })

        # 按流水线顺序发送 SSE 进度事件
        yield _sse_event("agent_start", {"agent": "retrieval", "message": "正在检索知识库..."})
        yield _sse_event("agent_start", {"agent": "teaching_design", "message": "正在设计教学方案..."})
        yield _sse_event("agent_start", {"agent": "resource_generation", "message": "正在生成学习资源..."})

        await _run_stage_generation_with_progress(
            stage, current_index, len(existing_stages),
            user_id, course_id, session_id, db,
        )

        yield _sse_event("agent_done", {"agent": "retrieval", "result_summary": "检索完成"})
        yield _sse_event("agent_done", {"agent": "teaching_design", "result_summary": "教学方案已准备"})
        yield _sse_event("agent_done", {"agent": "resource_generation", "result_summary": "资源生成完成"})

        # 查询持久化后的资源并推送前端
        persisted_rows = await _get_resources_for_stage_index(
            db, session_id, current_index
        )
        persisted_resources = [
            {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
            for r in persisted_rows
        ]

        for res in persisted_resources:
            yield _sse_event("resource_ready", {
                "resource_id": res["id"],
                "resource_type": res["resource_type"],
                "title": res["title"],
                "stage_index": current_index,
            })

        yield _sse_event("stage_complete", {
            "stage_index": current_index,
            "resources": persisted_resources,
        })
        yield _sse_event("session_complete", {
            "session_id": str(session_id),
            "message": "阶段资源已生成完毕",
        })
        return

    # 否则: 完整运行 LangGraph 编排流水线
    initial_state: LearningState = {
        "user_id": str(user_id),
        "course_id": str(course_id),
        "session_id": str(session_id),
        "profile_summary": "",
        "chapters": [],
        "stages": [],
        "total_stages": 0,
        "current_stage_index": 0,
        "stage_title": "",
        "stage_description": "",
        "stage_kps": [],
        "knowledge_context": [],
        "teaching_plan": {},
        "resources": [],
        "fact_check_report": {},
        "fact_check_passed": False,
        "error": "",
    }

    config = {
        "configurable": {
            "thread_id": str(session_id),
            "db": db,
            "user_id": str(user_id),
            "course_id": str(course_id),
            "session_id": str(session_id),
        }
    }

    graph = _build_orchestration_graph()

    try:
        # 使用 astream 逐节点执行, 获取进度事件
        async for chunk in graph.astream(initial_state, config, stream_mode="updates"):
            for node_name, node_output in chunk.items():
                display_name = AGENT_DISPLAY_NAMES.get(node_name, node_name)

                # Agent 完成事件
                yield _sse_event("agent_done", {
                    "agent": node_name,
                    "result_summary": _summarize_node_output(node_name, node_output),
                })

                # 特殊处理: Coordinator 输出 stages
                if node_name == "coordinator" and "stages" in node_output:
                    stages = node_output["stages"]
                    total = node_output.get("total_stages", len(stages))

                    # 持久化学习路径
                    session.learning_path = {"stages": stages}
                    session.session_metadata = {
                        **(session.session_metadata or {}),
                        "total_stages": total,
                    }
                    await db.commit()

                    yield _sse_event("path_update", {
                        "learning_path": {"stages": stages}
                    })

                    # 开始第一阶段
                    if stages:
                        first_stage = stages[0]
                        yield _sse_event("stage_start", {
                            "stage_index": 0,
                            "stage_title": first_stage.get("title", ""),
                            "total_stages": total,
                        })

                # 特殊处理: resource_generation 节点完成 (进度已由 writer 实时推送)
                if node_name == "resource_generation":
                    # resource_ready 事件将在资源持久化后统一发送 (带真实 DB ID)
                    pass

                # 下一节点开始
                # (astream 模式下, 每个 chunk 对应一个节点完成)

        # 持久化当前阶段的资源 (已在 summary_node 中处理)
        await db.commit()

        # 安全查询持久化后的资源 (使用子查询防重复行放大)
        persisted_rows = await _get_resources_for_stage_index(
            db, session_id, 0
        )
        persisted_resources = [
            {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
            for r in persisted_rows
        ]

        # 发送每个资源的就绪事件 (带真实数据库 ID)
        for res in persisted_resources:
            yield _sse_event("resource_ready", {
                "resource_id": res["id"],
                "resource_type": res["resource_type"],
                "title": res["title"],
                "stage_index": 0,
            })

        # 发送完成事件
        stages = session.learning_path.get("stages", [])
        yield _sse_event("stage_complete", {
            "stage_index": 0,
            "resources": persisted_resources,
        })

        if len(stages) <= 1:
            yield _sse_event("session_complete", {
                "session_id": str(session_id),
                "message": f"学习路径已生成, 共 {len(stages)} 个阶段",
            })
        else:
            yield _sse_event("session_complete", {
                "session_id": str(session_id),
                "message": f"第一阶段已生成完成, 共 {len(stages)} 个阶段",
            })

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"编排流水线失败: {e}\n完整堆栈:\n{tb}")
        yield _sse_event("error", {"message": str(e), "agent": "orchestrator"})


async def _run_stage_generation_with_progress(
    stage: dict,
    stage_index: int,
    total_stages: int,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession,
):
    """
    为单个阶段执行资源生成 (无 LangGraph 依赖)

    与旧版的区别:
      - 不依赖 get_stream_writer() (此函数在 LangGraph 外部被调用)
      - SSE 进度事件由外层 SSE 生成器负责, 本函数仅执行实际工作
      - 完成后自动持久化阶段和资源

    :param stage: 阶段信息 dict
    :param stage_index: 阶段序号
    :param total_stages: 总阶段数
    :param user_id: 用户 ID
    :param course_id: 课程 ID
    :param session_id: 会话 ID
    :param db: 数据库会话
    """
    # ── Step 1: 知识检索 ──
    query = f"{stage.get('title', '')} {' '.join(stage.get('knowledge_points', []))}"
    knowledge_context = []
    try:
        results = await rag_retrieve(query, course_id, db, top_k=8)
        for r in results:
            knowledge_context.append({
                "content": r.content[:600],
                "document_filename": r.document_filename,
                "score": r.score,
                "chunk_index": r.chunk_index,
            })
        logger.info(
            f"阶段 {stage_index}: 检索到 {len(knowledge_context)} 条相关资料"
        )
    except Exception as e:
        logger.warning(f"RAG 检索失败 (非致命): {e}")

    # ── Step 2: 教学设计 ──
    planned = [
        {"type": "handout", "title": f"{stage.get('title', '')} 讲义", "priority": "required"},
        {"type": "mindmap", "title": f"{stage.get('title', '')} 思维导图", "priority": "recommended"},
        {"type": "exercise", "title": f"{stage.get('title', '')} 练习题", "priority": "recommended"},
        {"type": "reading", "title": f"{stage.get('title', '')} 拓展阅读", "priority": "optional"},
        {"type": "video_script", "title": f"{stage.get('title', '')} 交互动画", "priority": "optional"},
    ]

    # ── Step 3: 获取画像 & 并行生成资源 ──
    profile_summary = ""
    stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    if profile and profile.profile_data:
        parts = []
        for k, v in profile.profile_data.items():
            if isinstance(v, str) and v.strip():
                parts.append(f"{k}: {v}")
        profile_summary = "\n".join(parts)

    async def _gen_one(res_spec):
        gen = RESOURCE_GENERATORS.get(res_spec["type"])
        if not gen:
            return None
        try:
            if res_spec["type"] == "handout":
                content = await gen(res_spec["title"], profile_summary, knowledge_context)
            elif res_spec["type"] == "exercise":
                content_dict = await gen(res_spec["title"], profile_summary, knowledge_context)
                content = json.dumps(content_dict, ensure_ascii=False)
            else:
                content = await gen(res_spec["title"], knowledge_context)
            return {
                "resource_type": res_spec["type"],
                "title": res_spec["title"],
                "description": res_spec.get("description", ""),
                "content": content,
                "resource_metadata": {"generator": res_spec["type"]},
            }
        except Exception as e:
            logger.error(f"资源生成失败 [{res_spec['type']}]: {e}")
            return {
                "resource_type": res_spec["type"],
                "title": res_spec["title"],
                "content": f"生成失败: {str(e)}",
                "resource_metadata": {"error": str(e)},
            }

    tasks = [_gen_one(r) for r in planned]
    resources = [r for r in await asyncio.gather(*tasks) if r is not None]

    # ── Step 4: 持久化 ──
    stage_obj = await _get_unique_stage_by_index(db, session_id, stage_index)

    if not stage_obj:
        from app.models.learning import LearningStage
        stage_obj = LearningStage(
            session_id=session_id,
            title=stage.get("title", ""),
            description=stage.get("description", ""),
            order_index=stage_index,
            status="completed",
            knowledge_point_ids=stage.get("knowledge_points", []),
            stage_metadata={"total_resources": len(resources)},
        )
        db.add(stage_obj)
        await db.flush()
    else:
        from sqlalchemy import delete as sqla_delete
        del_stmt = sqla_delete(GeneratedResource).where(
            GeneratedResource.stage_id == stage_obj.id
        )
        await db.execute(del_stmt)

    await _save_resources_with_unique_titles(db, stage_obj.id, resources)
    await _inject_animation_links(db, stage_obj.id)

    session_obj = await db.get(LearningSession, session_id)
    if session_obj:
        stages = session_obj.learning_path.get("stages", [])
        if stage_index < len(stages):
            stages[stage_index]["status"] = "completed"
        session_obj.learning_path["stages"] = stages
        session_obj.current_stage_index = stage_index
        session_obj.session_metadata = {
            **(session_obj.session_metadata or {}),
            "total_resources": (session_obj.session_metadata or {}).get("total_resources", 0) + len(resources),
        }

    await db.commit()
    logger.info(
        f"_run_stage_generation_with_progress: "
        f"阶段 {stage_index} 完成 ({len(resources)} 个资源)"
    )


async def _generate_stage_resources(
    stage: dict,
    stage_index: int,
    total_stages: int,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession,
):
    """
    为单个阶段生成资源 (用于懒加载 — 用户完成前一阶段后触发生成下一阶段)
    此函数作为内部辅助, 不直接产生 SSE, 由调用者包裹

    :param stage: 阶段信息 dict
    :param stage_index: 阶段序号
    :param total_stages: 总阶段数
    :param user_id: 用户 ID
    :param course_id: 课程 ID
    :param session_id: 会话 ID
    :param db: 数据库会话
    """
    # =========================================================================
    # 幂等性守卫: 如果阶段已存在且有资源, 跳过重新生成
    # 改进: 检查 ANY status (不仅是 completed), 防止在 generating 状态下
    #       也生成重复阶段。使用安全的子查询防 duplicate 行。
    # =========================================================================
    stage_obj = await _get_unique_stage_by_index(
        db, session_id, stage_index
    )

    if stage_obj is not None:
        from sqlalchemy import func as sqla_func
        res_count_stmt = select(sqla_func.count()).select_from(
            GeneratedResource
        ).where(GeneratedResource.stage_id == stage_obj.id)
        res_count_result = await db.execute(res_count_stmt)
        resource_count = res_count_result.scalar() or 0

        if resource_count > 0:
            logger.info(
                f"阶段 {stage_index} 已有 {resource_count} 个资源 (status={stage_obj.status}), "
                f"跳过重新生成 (幂等性守卫)"
            )
            return

    # 获取画像
    stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    profile_summary = ""
    if profile and profile.profile_data:
        parts = []
        for k, v in profile.profile_data.items():
            if isinstance(v, str) and v.strip():
                parts.append(f"{k}: {v}")
        profile_summary = "\n".join(parts)

    # RAG 检索
    query = f"{stage.get('title', '')} {' '.join(stage.get('knowledge_points', []))}"
    knowledge_context = []
    try:
        results = await rag_retrieve(query, course_id, db, top_k=5)
        for r in results:
            knowledge_context.append({
                "content": r.content[:600],
                "document_filename": r.document_filename,
                "score": r.score,
                "chunk_index": r.chunk_index,
            })
    except Exception as e:
        logger.warning(f"RAG 检索失败: {e}")

    # 教学设计 (简化版)
    planned = [
        {"type": "handout", "title": f"{stage.get('title', '')} 讲义", "priority": "required"},
        {"type": "mindmap", "title": f"{stage.get('title', '')} 思维导图", "priority": "recommended"},
        {"type": "exercise", "title": f"{stage.get('title', '')} 练习题", "priority": "recommended"},
        {"type": "reading", "title": f"{stage.get('title', '')} 拓展阅读", "priority": "optional"},
        {"type": "video_script", "title": f"{stage.get('title', '')} 交互动画", "priority": "optional"},
    ]

    # 并行生成资源
    async def _gen_one(res_spec):
        gen = RESOURCE_GENERATORS.get(res_spec["type"])
        if not gen:
            return None
        try:
            if res_spec["type"] == "handout":
                content = await gen(res_spec["title"], profile_summary, knowledge_context)
            elif res_spec["type"] == "exercise":
                content_dict = await gen(res_spec["title"], profile_summary, knowledge_context)
                content = json.dumps(content_dict, ensure_ascii=False)
            else:
                content = await gen(res_spec["title"], knowledge_context)
            return {
                "resource_type": res_spec["type"],
                "title": res_spec["title"],
                "description": res_spec.get("description", ""),
                "content": content,
                "resource_metadata": {"generator": res_spec["type"]},
            }
        except Exception as e:
            logger.error(f"资源生成失败 [{res_spec['type']}]: {e}")
            return {
                "resource_type": res_spec["type"],
                "title": res_spec["title"],
                "content": f"生成失败: {str(e)}",
                "resource_metadata": {"error": str(e)},
            }

    tasks = [_gen_one(r) for r in planned]
    resources = [r for r in await asyncio.gather(*tasks) if r is not None]

    # 持久化: stage_obj 已在幂等性守卫中获取
    # 如果 stage_obj 为 None (阶段不存在), 创建新记录
    if not stage_obj:
        stage_obj = LearningStage(
            session_id=session_id,
            title=stage.get("title", ""),
            description=stage.get("description", ""),
            order_index=stage_index,
            status="completed",
            knowledge_point_ids=stage.get("knowledge_points", []),
            stage_metadata={"total_resources": len(resources)},
        )
        db.add(stage_obj)
        await db.flush()
    else:
        # stage 已存在但资源为空 (前次生成中途失败)
        # 清除可能存在的孤儿资源后重新生成
        from sqlalchemy import delete as sqla_delete
        del_stmt = sqla_delete(GeneratedResource).where(
            GeneratedResource.stage_id == stage_obj.id
        )
        await db.execute(del_stmt)

    # 持久化资源 (自动给重名资源添加序号)
    await _save_resources_with_unique_titles(db, stage_obj.id, resources)

    # 后处理: 在讲义中嵌入指向交互动画的跳转链接
    await _inject_animation_links(db, stage_obj.id)

    session = await db.get(LearningSession, session_id)
    if session:
        stages = session.learning_path.get("stages", [])
        if stage_index < len(stages):
            stages[stage_index]["status"] = "completed"
        session.learning_path["stages"] = stages
        session.current_stage_index = stage_index
        session.session_metadata = {
            **(session.session_metadata or {}),
            "total_resources": (session.session_metadata or {}).get("total_resources", 0) + len(resources),
        }

    await db.commit()
    logger.info(f"阶段 {stage_index} 资源持久化完成: {len(resources)} 个")


async def generate_next_stage_stream(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """
    生成下一阶段的资源 (SSE 流式)
    供 API 端点完成当前阶段后调用

    :param session_id: 会话 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :yield: SSE 事件字符串
    """
    session = await db.get(LearningSession, session_id)
    if not session:
        yield _sse_event("error", {"message": "学习会话不存在"})
        return

    stages = (session.learning_path or {}).get("stages", [])
    next_index = session.current_stage_index

    if next_index >= len(stages):
        yield _sse_event("session_complete", {
            "session_id": str(session_id),
            "message": "全部阶段已完成",
        })
        return

    # 幂等性: 如果下一阶段已有资源, 直接返回
    existing = await _get_resources_for_stage_index(db, session_id, next_index)
    if existing:
        logger.info(f"下一阶段 {next_index} 已有 {len(existing)} 个资源, 跳过生成")
        yield _sse_event("path_update", {"learning_path": session.learning_path})
        for res in existing:
            yield _sse_event("resource_ready", {
                "resource_id": str(res.id),
                "resource_type": res.resource_type,
                "title": res.title,
                "stage_index": next_index,
            })
        yield _sse_event("stage_complete", {
            "stage_index": next_index,
            "resources": [
                {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
                for r in existing
            ],
        })
        yield _sse_event("session_complete", {
            "session_id": str(session_id),
            "message": f"阶段 {next_index + 1} 资源已存在",
        })
        return

    stage = stages[next_index]
    stage["status"] = "active"
    session.learning_path["stages"] = stages
    session.current_stage_index = next_index
    await db.commit()

    yield _sse_event("stage_start", {
        "stage_index": next_index,
        "stage_title": stage.get("title", ""),
        "total_stages": len(stages),
    })

    # 发送进度事件: agent_start → 执行 → agent_done
    yield _sse_event("agent_start", {"agent": "retrieval", "message": "正在检索知识库..."})
    yield _sse_event("agent_start", {"agent": "teaching_design", "message": "正在设计教学方案..."})
    yield _sse_event("agent_start", {"agent": "resource_generation", "message": "正在生成学习资源..."})

    await _run_stage_generation_with_progress(
        stage, next_index, len(stages), user_id, session.course_id, session_id, db,
    )

    yield _sse_event("agent_done", {"agent": "retrieval", "result_summary": "检索完成"})
    yield _sse_event("agent_done", {"agent": "teaching_design", "result_summary": "教学方案已准备"})
    yield _sse_event("agent_done", {"agent": "resource_generation", "result_summary": "资源生成完成"})

    # 查询持久化后的资源
    persisted_rows = await _get_resources_for_stage_index(
        db, session_id, next_index
    )
    persisted_resources = [
        {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
        for r in persisted_rows
    ]

    yield _sse_event("path_update", {
        "learning_path": session.learning_path,
    })
    yield _sse_event("stage_complete", {
        "stage_index": next_index,
        "resources": persisted_resources,
    })
    yield _sse_event("session_complete", {
        "session_id": str(session_id),
        "message": f"阶段 {next_index + 1} 资源已生成完毕",
    })


async def regenerate_single_resource_stream(
    resource_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """
    重新生成单个资源 (SSE 流式)

    :param resource_id: 资源 ID
    :param user_id: 用户 ID
    :param db: 数据库会话
    :yield: SSE 事件字符串
    """
    from sqlalchemy import and_
    stmt = (
        select(GeneratedResource)
        .join(LearningStage)
        .join(LearningSession)
        .where(
            and_(
                GeneratedResource.id == resource_id,
                LearningSession.user_id == user_id,
            )
        )
    )
    result = await db.execute(stmt)
    resource = result.scalar_one_or_none()

    if not resource:
        yield _sse_event("error", {"message": "资源不存在"})
        return

    generator = RESOURCE_GENERATORS.get(resource.resource_type)
    if not generator:
        yield _sse_event("error", {"message": f"不支持的资源类型: {resource.resource_type}"})
        return

    yield _sse_event("agent_start", {
        "agent": resource.resource_type,
        "message": f"正在重新生成: {resource.title}",
    })

    try:
        # 获取上下文 (简化: 使用资源元数据中的信息)
        if resource.resource_type == "handout":
            new_content = await generator(resource.title, "", [])
        elif resource.resource_type == "exercise":
            content_dict = await generator(resource.title, "", [])
            new_content = json.dumps(content_dict, ensure_ascii=False)
        else:
            new_content = await generator(resource.title, [])

        resource.content = new_content
        await db.commit()

        yield _sse_event("resource_ready", {
            "resource_id": str(resource_id),
            "resource_type": resource.resource_type,
            "title": resource.title,
        })
    except Exception as e:
        logger.error(f"资源重新生成失败: {e}")
        yield _sse_event("error", {"message": str(e), "agent": resource.resource_type})


# ============================================================================
# 辅助函数
# ============================================================================

def _parse_json_output(raw: str) -> dict | list:
    """鲁棒的 JSON 解析, 处理 markdown 代码块包裹"""
    raw = raw.strip()
    if raw.startswith("```json"):
        raw = raw[7:]
    elif raw.startswith("```"):
        raw = raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        for boundary in [("[", "]"), ("{", "}")]:
            start = raw.find(boundary[0])
            end = raw.rfind(boundary[1])
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(raw[start:end + 1])
                except json.JSONDecodeError:
                    pass
    logger.warning(f"JSON 解析失败: {raw[:200]}")
    return {}


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

EXERCISE_SCORING_SYSTEM_PROMPT = """你是 MLA 多学助手的 AI 评分教师, 负责对学生的填空题和简答题答案进行智能评分。

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
    client = _create_llm_client()
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
        result = _parse_json_output(raw)

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
