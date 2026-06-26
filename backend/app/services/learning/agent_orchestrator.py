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
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from langgraph.config import get_stream_writer
from langgraph.types import RunnableConfig

# ============================================================================
# 安全 stream writer: 在 LangGraph 外部直接调用 node 时, get_stream_writer()
# 会抛出 RuntimeError。用此函数替代, 非 LangGraph 上下文时返回 no-op 函数
# ============================================================================

def _safe_stream_writer() -> callable:
    """获取 stream writer, 如果不在 LangGraph runtime context 中则返回 no-op"""
    try:
        return get_stream_writer()
    except RuntimeError:
        return lambda _data: None

from app.models.learning import LearningSession, LearningStage, GeneratedResource
from app.models.course import Course, Chapter, KnowledgePoint
from app.models.profile import StudentProfile
from app.services.config_service import get_config_value
from app.services.retriever import retrieve as rag_retrieve
from app.services.learning.resource_generators import (
    RESOURCE_GENERATORS, RESOURCE_TYPE_LABELS,
)
from app.services.llm_utils import create_llm_client, sse_event, parse_json_output
from loguru import logger



# 从 orchestrator_utils.py 重新导出工具函数 (保持向后兼容)
from app.services.learning.orchestrator_utils import (
    _deduplicate_resource_titles,
    _save_resources_with_unique_titles,
    _get_unique_stage_by_index,
    _get_resources_for_stage_index,
    _inject_animation_links,
    _summarize_node_output,
    score_exercise_answer,
    EXERCISE_SCORING_SYSTEM_PROMPT,
)

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
# Agent System Prompts
# ============================================================================

COORDINATOR_SYSTEM_PROMPT = """你是 MLA 智学引擎的 Coordinator (协调者) Agent, 负责为学生的学习路径做整体规划。

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


PROFILE_SYSTEM_PROMPT = """你是 MLA 智学引擎的 Profile Agent, 负责分析学生学习画像并为下游 Agent 提供参考。

请根据学生的画像数据, 用自然语言总结以下信息:
1. 学生的知识基础水平 (初学者/有一定基础/较扎实)
2. 学生的学习偏好 (喜欢什么类型的资源和学习方式)
3. 学生的薄弱环节 (需要重点关注的领域)
4. 适合该学生的教学策略建议

请输出一段 100-200 字的自然语言总结, 直接输出文本即可。"""


RETRIEVAL_SYSTEM_PROMPT = """你是 MLA 智学引擎的 Knowledge Retrieval Agent, 负责从知识库中检索相关资料并整合。

请根据检索到的知识库内容, 以自然语言总结当前阶段的关键知识点:
1. 核心概念和定义
2. 重要的原理和机制
3. 常见的误区或易混淆点
4. 知识点之间的关联关系

请输出一段 150-300 字的总结, 供下游资源生成 Agent 参考。"""


TEACHING_DESIGN_SYSTEM_PROMPT = """你是 MLA 智学引擎的 Teaching Design Agent, 负责为每个学习阶段设计教学方案。

你的任务是根据阶段主题、知识内容和学生画像, 确定该阶段应生成哪些类型的资源, 以及每种资源的具体主题。

可选的资源类型:
- handout: 课程讲义 (核心, 每个阶段必选)
- mindmap: 思维导图 (推荐, 展示知识结构)
- exercise: 练习题 (推荐, 巩固学习)
- reading: 拓展阅读 (可选, 深化理解)
- coding_practice: 编程实操 (强烈推荐, 每个阶段都应包含。即使是理论性课程如操作系统、计算机网络等, 也可将核心算法或原理转化为代码实操, 例如: 进程调度算法模拟、页面置换算法实现、内存分配可视化、银行家算法等)
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


FACT_CHECK_SYSTEM_PROMPT = """你是 MLA 智学引擎的安全与事实核查 Agent, 负责检查生成内容的质量。

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

    writer = _safe_stream_writer()
    writer({"type": "agent_progress", "agent": "coordinator", "message": "正在分析课程结构和学生画像..."})

    client = create_llm_client()
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
        result_data = parse_json_output(raw)

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
    yield sse_event("session_init", {
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
        yield sse_event("error", {"message": "学习会话不存在"})
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
            yield sse_event("path_update", {"learning_path": {"stages": existing_stages}})
            yield sse_event("stage_start", {
                "stage_index": current_index,
                "stage_title": existing_stages[current_index].get("title", ""),
                "total_stages": len(existing_stages),
            })
            for res in existing_resources:
                yield sse_event("resource_ready", {
                    "resource_id": str(res.id),
                    "resource_type": res.resource_type,
                    "title": res.title,
                    "stage_index": current_index,
                })
            yield sse_event("stage_complete", {
                "stage_index": current_index,
                "resources": [
                    {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
                    for r in existing_resources
                ],
            })
            yield sse_event("session_complete", {
                "session_id": str(session_id),
                "message": "阶段资源已存在, 无需重新生成",
            })
            return

    # 如果已有完整路径, 直接为当前阶段生成资源
    if existing_stages and current_index < len(existing_stages):
        stage = existing_stages[current_index]
        yield sse_event("path_update", {"learning_path": {"stages": existing_stages}})
        yield sse_event("stage_start", {
            "stage_index": current_index,
            "stage_title": stage.get("title", ""),
            "total_stages": len(existing_stages),
        })

        # 按流水线顺序发送 SSE 进度事件
        yield sse_event("agent_start", {"agent": "retrieval", "message": "正在检索知识库..."})
        yield sse_event("agent_start", {"agent": "teaching_design", "message": "正在设计教学方案..."})
        yield sse_event("agent_start", {"agent": "resource_generation", "message": "正在生成学习资源..."})

        await _run_stage_generation_with_progress(
            stage, current_index, len(existing_stages),
            user_id, course_id, session_id, db,
        )

        yield sse_event("agent_done", {"agent": "retrieval", "result_summary": "检索完成"})
        yield sse_event("agent_done", {"agent": "teaching_design", "result_summary": "教学方案已准备"})
        yield sse_event("agent_done", {"agent": "resource_generation", "result_summary": "资源生成完成"})

        # 查询持久化后的资源并推送前端
        persisted_rows = await _get_resources_for_stage_index(
            db, session_id, current_index
        )
        persisted_resources = [
            {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
            for r in persisted_rows
        ]

        for res in persisted_resources:
            yield sse_event("resource_ready", {
                "resource_id": res["id"],
                "resource_type": res["resource_type"],
                "title": res["title"],
                "stage_index": current_index,
            })

        yield sse_event("stage_complete", {
            "stage_index": current_index,
            "resources": persisted_resources,
        })
        yield sse_event("session_complete", {
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

    try:
        # 直接调用 coordinator_node 获取阶段规划, 资源生成走直接调用
        coord_result = await coordinator_node(initial_state, config)
        stages = coord_result.get("stages", [])
        total = coord_result.get("total_stages", len(stages))

        if not stages:
            yield sse_event("error", {"message": "未能生成学习路径, 请检查课程是否有章节和知识点"})
            return

        session.learning_path = {"stages": stages}
        await db.commit()
        # 仅生成第一阶段 (stage 0), 后续阶段由用户完成前一阶段后
        # 通过 "我已完成本阶段" → generate_next_stage_stream 懒加载生成
        yield sse_event("path_update", {"learning_path": {"stages": stages}})
        yield sse_event("agent_done", {"agent": "coordinator", "result_summary": f"规划了 {total} 个阶段"})

        # ── 生成第一阶段 ──
        first_stage = stages[0]
        idx = 0
        yield sse_event("stage_start", {"stage_index": idx, "stage_title": first_stage.get("title", ""), "total_stages": total})

        yield sse_event("agent_start", {"agent": "retrieval", "message": "正在检索知识库..."})
        yield sse_event("agent_start", {"agent": "teaching_design", "message": "正在设计教学方案..."})
        yield sse_event("agent_start", {"agent": "resource_generation", "message": "正在生成学习资源..."})

        await _run_stage_generation_with_progress(first_stage, idx, total, user_id, course_id, session_id, db)

        yield sse_event("agent_done", {"agent": "retrieval", "result_summary": "检索完成"})
        yield sse_event("agent_done", {"agent": "teaching_design", "result_summary": "教学方案已准备"})
        yield sse_event("agent_done", {"agent": "resource_generation", "result_summary": "资源生成完成"})

        persisted_rows = await _get_resources_for_stage_index(db, session_id, idx)
        persisted_resources = [{"id": str(r.id), "resource_type": r.resource_type, "title": r.title} for r in persisted_rows]
        for res in persisted_resources:
            yield sse_event("resource_ready", {"resource_id": res["id"], "resource_type": res["resource_type"], "title": res["title"], "stage_index": idx})
        yield sse_event("stage_complete", {"stage_index": idx, "resources": persisted_resources})

        yield sse_event("session_complete", {"session_id": str(session_id), "message": f"第一阶段已生成，剩余 {total - 1} 个阶段将在学习中逐步生成"})


    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"编排流水线失败: {e}\n完整堆栈:\n{tb}")
        yield sse_event("error", {"message": str(e), "agent": "orchestrator"})


async def _generate_resources_for_stage(
    stage: dict,
    stage_index: int,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession,
    *,
    top_k: int = 8,
    skip_if_exists: bool = False,
    update_session_stage_index: bool = True,
    on_progress=None,  # async callable(type: str, title: str) → 用于 SSR 事件推送
):
    """
    为单个阶段执行资源生成 (统一入口)

    合并了原 _run_stage_generation_with_progress (初次生成, 无幂等守卫, top_k=8)
    和 _generate_stage_resources (懒加载, 有幂等守卫, top_k=5) 的 90% 重复逻辑。

    流程: 幂等性检查 → RAG检索 → 获取画像 → 并行生成6种资源 → 持久化 → 注入动画链接

    :param stage:                     阶段信息 dict
    :param stage_index:              阶段序号
    :param user_id:                  用户 ID
    :param course_id:                课程 ID
    :param session_id:               会话 ID
    :param db:                       数据库会话
    :param top_k:                    RAG 检索数量 (初次生成=8, 懒加载=5)
    :param skip_if_exists:           幂等性守卫: 阶段已有资源时跳过 (懒加载=True, 初次=False)
    :param update_session_stage_index: 是否更新 session.current_stage_index (初次=True, 懒加载=True)
    """
    # ── 幂等性守卫 ──
    stage_obj = await _get_unique_stage_by_index(db, session_id, stage_index)
    if skip_if_exists and stage_obj is not None:
        from sqlalchemy import func as sqla_func
        res_count_stmt = select(sqla_func.count()).select_from(
            GeneratedResource
        ).where(GeneratedResource.stage_id == stage_obj.id)
        res_count_result = await db.execute(res_count_stmt)
        if (res_count_result.scalar() or 0) > 0:
            logger.info(
                f"阶段 {stage_index} 已有资源 (status={stage_obj.status}), 跳过重新生成"
            )
            return

    # ── Step 1: RAG 检索 ──
    query = f"{stage.get('title', '')} {' '.join(stage.get('knowledge_points', []))}"
    knowledge_context = []
    try:
        results = await rag_retrieve(query, course_id, db, top_k=top_k)
        for r in results:
            knowledge_context.append({
                "content": r.content[:600],
                "document_filename": r.document_filename,
                "score": r.score,
                "chunk_index": r.chunk_index,
            })
    except Exception as e:
        logger.warning(f"RAG 检索失败 (非致命): {e}")

    # ── Step 2: 获取画像 ──
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

    # ── Step 3: 资源规划 (按用户选择的类型过滤) ──
    # 读取 session_metadata 中存储的资源类型偏好
    session = await db.get(LearningSession, session_id)
    enabled_types = set(
        (session.session_metadata or {}).get("resource_types",
            ["handout", "mindmap", "exercise"])
    ) if session else {"handout", "mindmap", "exercise"}

    ALL_RESOURCE_TYPES = [
        {"type": "handout",        "title": f"{stage.get('title', '')} 讲义",     "priority": "required"},
        {"type": "mindmap",        "title": f"{stage.get('title', '')} 思维导图",  "priority": "recommended"},
        {"type": "exercise",       "title": f"{stage.get('title', '')} 练习题",    "priority": "recommended"},
        {"type": "coding_practice","title": f"{stage.get('title', '')} 编程实操",  "priority": "recommended"},
        {"type": "reading",        "title": f"{stage.get('title', '')} 拓展阅读",  "priority": "optional"},
        {"type": "video_script",   "title": f"{stage.get('title', '')} 交互动画",  "priority": "optional"},
    ]
    planned = [r for r in ALL_RESOURCE_TYPES if r["type"] in enabled_types]

    if not planned:
        # 防御: 如果用户选的类型都不在列表中，至少生成讲义
        planned = [r for r in ALL_RESOURCE_TYPES if r["type"] == "handout"]
        logger.warning(
            f"用户选择的资源类型 {enabled_types} 无匹配, 回退到仅讲义"
        )

    # ── Step 4: 并行生成资源 ──
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
            elif res_spec["type"] == "coding_practice":
                content = await gen(res_spec["title"], profile_summary, knowledge_context)
            else:
                content = await gen(res_spec["title"], knowledge_context)
            return {
                "resource_type": res_spec["type"],
                "title": res_spec["title"],
                "description": res_spec.get("description", ""),
                "content": content,
                "resource_metadata": {
                    "generator": res_spec["type"],
                    # 存储生成上下文, 供 regenerate 时精确重现
                    "profile_summary": profile_summary,
                    "knowledge_context": knowledge_context,
                },
            }
        except Exception as e:
            logger.error(f"资源生成失败 [{res_spec['type']}]: {e}")
            return {
                "resource_type": res_spec["type"],
                "title": res_spec["title"],
                "content": f"生成失败: {str(e)}",
                "resource_metadata": {"error": str(e)},
            }

    # 并行生成, 每完成一个资源就通过 on_progress 推送进度
    async def _gen_one_with_progress(res_spec):
        result = await _gen_one(res_spec)
        if on_progress and result:
            await on_progress(res_spec["type"], res_spec["title"])
        return result

    tasks = [_gen_one_with_progress(r) for r in planned]
    resources = [r for r in await asyncio.gather(*tasks) if r is not None]

    # ── Step 5: 持久化阶段 ──
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
        from sqlalchemy import delete as sqla_delete
        del_stmt = sqla_delete(GeneratedResource).where(
            GeneratedResource.stage_id == stage_obj.id
        )
        await db.execute(del_stmt)
        stage_obj.status = "completed"
        stage_obj.title = stage.get("title", stage_obj.title)
        stage_obj.stage_metadata = {
            **(stage_obj.stage_metadata or {}),
            "total_resources": len(resources),
        }

    await _save_resources_with_unique_titles(db, stage_obj.id, resources)
    await _inject_animation_links(db, stage_obj.id)

    # ── Step 6: 更新会话元数据 ──
    session = await db.get(LearningSession, session_id)
    if session:
        stages = session.learning_path.get("stages", [])
        if stage_index < len(stages):
            stages[stage_index]["status"] = "completed"
        session.learning_path["stages"] = stages
        if update_session_stage_index:
            session.current_stage_index = stage_index
        session.session_metadata = {
            **(session.session_metadata or {}),
            "total_resources": (session.session_metadata or {}).get("total_resources", 0) + len(resources),
        }

    await db.commit()
    logger.info(
        f"_generate_resources_for_stage: 阶段 {stage_index} 完成 ({len(resources)} 个资源)"
    )


# 向后兼容别名 (保留旧函数签名, 调新函数)
async def _run_stage_generation_with_progress(
    stage, stage_index, total_stages, user_id, course_id, session_id, db,
    on_progress=None,
):
    """初次生成: 无幂等守卫, top_k=8 (调用统一入口)"""
    await _generate_resources_for_stage(
        stage, stage_index, user_id, course_id, session_id, db,
        top_k=8, skip_if_exists=False, update_session_stage_index=True,
        on_progress=on_progress,
    )


async def _generate_stage_resources(
    stage, stage_index, total_stages, user_id, course_id, session_id, db
):
    """懒加载生成: 有幂等守卫, top_k=5 (调用统一入口)"""
    await _generate_resources_for_stage(
        stage, stage_index, user_id, course_id, session_id, db,
        top_k=5, skip_if_exists=True, update_session_stage_index=True,
    )


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
        yield sse_event("error", {"message": "学习会话不存在"})
        return

    stages = (session.learning_path or {}).get("stages", [])
    next_index = session.current_stage_index

    if next_index >= len(stages):
        yield sse_event("session_complete", {
            "session_id": str(session_id),
            "message": "全部阶段已完成",
        })
        return

    # 幂等性: 如果下一阶段已有资源, 直接返回
    existing = await _get_resources_for_stage_index(db, session_id, next_index)
    if existing:
        logger.info(f"下一阶段 {next_index} 已有 {len(existing)} 个资源, 跳过生成")
        yield sse_event("path_update", {"learning_path": session.learning_path})
        for res in existing:
            yield sse_event("resource_ready", {
                "resource_id": str(res.id),
                "resource_type": res.resource_type,
                "title": res.title,
                "stage_index": next_index,
            })
        yield sse_event("stage_complete", {
            "stage_index": next_index,
            "resources": [
                {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
                for r in existing
            ],
        })
        yield sse_event("session_complete", {
            "session_id": str(session_id),
            "message": f"阶段 {next_index + 1} 资源已存在",
        })
        return

    stage = stages[next_index]
    stage["status"] = "active"
    session.learning_path["stages"] = stages
    session.current_stage_index = next_index
    await db.commit()

    yield sse_event("stage_start", {
        "stage_index": next_index,
        "stage_title": stage.get("title", ""),
        "total_stages": len(stages),
    })

    # 发送进度事件: agent_start → 执行 → agent_done
    yield sse_event("agent_start", {"agent": "retrieval", "message": "正在检索知识库..."})
    yield sse_event("agent_start", {"agent": "teaching_design", "message": "正在设计教学方案..."})
    yield sse_event("agent_start", {"agent": "resource_generation", "message": "正在生成学习资源..."})

    await _run_stage_generation_with_progress(
        stage, next_index, len(stages), user_id, session.course_id, session_id, db,
    )

    yield sse_event("agent_done", {"agent": "retrieval", "result_summary": "检索完成"})
    yield sse_event("agent_done", {"agent": "teaching_design", "result_summary": "教学方案已准备"})
    yield sse_event("agent_done", {"agent": "resource_generation", "result_summary": "资源生成完成"})

    # 查询持久化后的资源
    persisted_rows = await _get_resources_for_stage_index(
        db, session_id, next_index
    )
    persisted_resources = [
        {"id": str(r.id), "resource_type": r.resource_type, "title": r.title}
        for r in persisted_rows
    ]

    yield sse_event("path_update", {
        "learning_path": session.learning_path,
    })
    yield sse_event("stage_complete", {
        "stage_index": next_index,
        "resources": persisted_resources,
    })
    yield sse_event("session_complete", {
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
        yield sse_event("error", {"message": "资源不存在"})
        return

    generator = RESOURCE_GENERATORS.get(resource.resource_type)
    if not generator:
        yield sse_event("error", {"message": f"不支持的资源类型: {resource.resource_type}"})
        return

    yield sse_event("agent_start", {
        "agent": resource.resource_type,
        "message": f"正在重新生成: {resource.title}",
    })

    try:
        # ── 重建上下文: 优先使用存储的原始生成上下文, 缺失时重新检索 ──
        stored_meta = resource.resource_metadata or {}
        profile_summary = stored_meta.get("profile_summary", "")
        knowledge_context = stored_meta.get("knowledge_context", [])

        if not profile_summary or not knowledge_context:
            # 上下文缺失 (旧数据未存储), 回退到重新检索
            stage_obj = await db.get(LearningStage, resource.stage_id)
            course_id = None
            if stage_obj:
                session_obj = await db.get(LearningSession, stage_obj.session_id)
                if session_obj:
                    course_id = session_obj.course_id

            if not profile_summary and course_id:
                stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
                result_prof = await db.execute(stmt)
                profile = result_prof.scalar_one_or_none()
                if profile and profile.profile_data:
                    parts = []
                    for k, v in profile.profile_data.items():
                        if isinstance(v, str) and v.strip():
                            parts.append(f"{k}: {v}")
                    profile_summary = "\n".join(parts)

            if not knowledge_context and course_id and stage_obj:
                stage_title = stage_obj.title or resource.title
                query = f"{stage_title}"
                try:
                    results = await rag_retrieve(query, course_id, db, top_k=8)
                    for r in results:
                        knowledge_context.append({
                            "content": r.content[:600],
                            "document_filename": r.document_filename,
                            "score": r.score,
                            "chunk_index": r.chunk_index,
                        })
                except Exception as e:
                    logger.warning(f"资源再生 RAG 检索失败 (非致命): {e}")

        logger.info(
            f"资源再生: type={resource.resource_type}, "
            f"profile_len={len(profile_summary)}, rag_hits={len(knowledge_context)}"
            f"{' (from stored metadata)' if stored_meta.get('profile_summary') else ' (re-retrieved)'}"
        )

        if resource.resource_type == "handout":
            new_content = await generator(resource.title, profile_summary, knowledge_context)
        elif resource.resource_type == "exercise":
            content_dict = await generator(resource.title, profile_summary, knowledge_context)
            new_content = json.dumps(content_dict, ensure_ascii=False)
        elif resource.resource_type == "coding_practice":
            new_content = await generator(resource.title, profile_summary, knowledge_context)
        else:
            new_content = await generator(resource.title, knowledge_context)

        resource.content = new_content
        await db.commit()

        yield sse_event("resource_ready", {
            "resource_id": str(resource_id),
            "resource_type": resource.resource_type,
            "title": resource.title,
        })
    except Exception as e:
        logger.error(f"资源重新生成失败: {e}")
        yield sse_event("error", {"message": str(e), "agent": resource.resource_type})


# _summarize_node_output 已移至 orchestrator_utils.py, 此处通过 re-export 提供

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
