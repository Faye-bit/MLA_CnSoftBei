"""
资源采集师蔡丰 (resource_scout) 实现
职责:
  1. 调用博查 Search API 进行网络调研
  2. 将搜索结果结构化 → ResearchReport + 外部链接
  3. 默认开启 (用户可关闭), API 不可用时优雅降级
  4. 结果按 course 级别缓存

遵循 AgentHandler Protocol: async def run(state: ZhiXueState, **kwargs) -> dict
"""

import json
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.zhixue import ZhiXueSearchResult
from app.services.config_service import get_config_value
from app.services.llm_utils import create_llm_client, parse_json_output
from app.services.zhixue.prompts import CAIFENG_SEARCH_SYSTEM_PROMPT
from app.services.web_search import search_web
from loguru import logger


async def scout_resources(
    state: dict,
    *,
    db: AsyncSession,
    course_id: str,
) -> dict:
    """
    蔡丰 — 网络调研

    根据当前阶段主题, 搜索外部资源 (考研题/官方文档/教学视频)。
    结果按 course 级别缓存, 不同用户复用。

    :param state: 当前 ZhiXueState (含 learning_plan, current_stage, scouting_enabled)
    :param db: 数据库会话
    :param course_id: 课程 ID
    :return: 部分 State 字典, 含 research_report 或 None
    """
    # 用户未开启采风 (检查 session 级别 + 全局配置)
    # 注意: state.get("scouting_enabled") 可能为 None, 需要显式处理
    session_scout = state.get("scouting_enabled")
    session_scout_enabled = True if session_scout is None else bool(session_scout)
    if not session_scout_enabled:
        logger.info("蔡丰: 会话级别关闭了采风, 跳过网络搜索")
        return {"research_report": None}
    global_enabled = get_config_value("scouting_enabled")
    if global_enabled and global_enabled.lower() != "true":
        logger.info("蔡丰: 全局配置关闭了采风, 跳过网络搜索")
        return {"research_report": None}

    # 获取当前阶段主题
    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current_stage = state.get("current_stage", 0)

    if current_stage >= len(stages):
        return {"research_report": None}

    stage = stages[current_stage]
    topic = stage.get("topic", stage.get("title", ""))
    kps = stage.get("knowledge_points", [])

    if not topic:
        logger.warning("蔡丰: 当前阶段无主题, 跳过搜索")
        return {"research_report": None}

    # ── 检查缓存 ──
    query = f"{topic} {' '.join(kps[:3])}"
    cached = await _check_cache(db, course_id, query)
    if cached:
        logger.info(f"蔡丰: 缓存命中 (query={query[:50]}...)")
        return {"research_report": cached}

    # ── 执行搜索 ──
    try:
        search_results = await _search_web(topic, kps)
    except Exception as e:
        logger.warning(f"蔡丰: 搜索失败 (非致命, 跳过): {e}")
        return {"research_report": None}

    if not search_results:
        return {"research_report": None}

    # ── LLM 总结 ──
    client = create_llm_client()
    model = get_config_value("llm_model")

    results_text = json.dumps(search_results[:8], ensure_ascii=False, indent=2)

    user_prompt = f"""请对以下网络搜索结果进行筛选和总结:

阶段主题: {topic}
知识点: {', '.join(kps[:5])}

搜索结果:
{results_text}

请筛选出与当前学习阶段最相关的优质资源, 重点关注:
- 知乎、CSDN、博客园、掘金等国内主流知识分享平台的内容 (优先选取)
- B站、小红书上的优质教程和实操演示
- 官方文档和权威技术站点
- 相关考试/练习题目

注意: 优先选取 source_platform 为知乎、CSDN、博客园、掘金、B站、小红书的结果。
对于质量较低或内容重复的平台 (如泛采集站、SEO页面), 降低优先级或忽略。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": CAIFENG_SEARCH_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        research_report = {
            "report_id": str(uuid.uuid4()),
            "stage_number": current_stage,
            "key_concepts": result.get("key_concepts", []),
            "external_links": result.get("external_links", []),
            "executive_summary": result.get(
                "executive_summary",
                f"为「{topic}」找到 {len(search_results)} 条相关资源",
            ),
            "search_queries": [query],
            "total_sources_consulted": len(search_results),
        }

        # ── 写入缓存 ──
        await _save_cache(db, course_id, query, research_report)

        logger.info(
            f"蔡丰: 调研完成 — "
            f"topic={topic[:30]}..., "
            f"links={len(result.get('external_links', []))}"
        )

        return {"research_report": research_report}

    except Exception as e:
        logger.warning(f"蔡丰: LLM 总结失败 (非致命): {e}")
        return {"research_report": None}


# ============================================================================
# 搜索实现 (委托给共享 web_search 模块)
# ============================================================================

async def _search_web(topic: str, kps: list[str]) -> list[dict]:
    """
    调用共享 web_search 模块执行网络搜索

    使用 LLM 改写查询词以获得更好的平台覆盖，然后委托 search_web() 执行。
    如果未配置 API Key, search_web() 会优雅降级返回空列表。

    :param topic: 阶段主题
    :param kps: 知识点列表
    :return: 搜索结果列表 [{title, url, content, source_platform, ...}]
    """
    # 构建搜索查询: 主题 + 前 3 个知识点
    raw_query = f"{topic} {' '.join(kps[:3])}"

    # LLM 改写查询词 (融入平台偏好关键词, 如 site:zhihu.com)
    try:
        from app.services.chat_prompts import QUERY_REPHRASE_PROMPT

        client = create_llm_client()
        model = get_config_value("llm_model")
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": QUERY_REPHRASE_PROMPT.format(
                    user_message=f"学习资料: {raw_query}"
                )},
            ],
            temperature=0.3,
            max_tokens=100,
        )
        rewritten = (response.choices[0].message.content or "").strip().strip('"\'').strip()
        if rewritten and 3 <= len(rewritten) <= 80:
            query = rewritten
            logger.info(f"蔡丰: 查询改写 '{raw_query[:50]}...' → '{query}'")
        else:
            query = raw_query
    except Exception as e:
        logger.warning(f"蔡丰: 查询改写失败 (已忽略): {e}")
        query = raw_query

    logger.info(f"蔡丰: 开始搜索 query='{query[:80]}...'")

    # 委托给共享搜索模块，保留 source_platform 供 LLM 平台优先级筛选
    results = await search_web(query, count=10)
    return results  # 返回完整字段: title, url, content, source_platform, favicon, image


# ============================================================================
# 缓存
# ============================================================================

async def _check_cache(
    db: AsyncSession,
    course_id: str,
    query: str,
) -> dict | None:
    """检查是否有未过期的缓存"""
    try:
        stmt = select(ZhiXueSearchResult).where(
            ZhiXueSearchResult.course_id == uuid.UUID(course_id),
            ZhiXueSearchResult.query == query,
        ).order_by(ZhiXueSearchResult.created_at.desc()).limit(1)
        result = await db.execute(stmt)
        cached = result.scalar_one_or_none()

        if cached and cached.expires_at and cached.expires_at > datetime.utcnow():
            if cached.results:
                return {
                    "report_id": str(uuid.uuid4()),
                    "external_links": cached.results,
                    "executive_summary": cached.summary,
                    "key_concepts": [],
                    "cached": True,
                }
    except Exception:
        pass
    return None


async def _save_cache(
    db: AsyncSession,
    course_id: str,
    query: str,
    research_report: dict,
):
    """保存搜索结果到缓存 (7 天过期)"""
    try:
        cache = ZhiXueSearchResult(
            id=uuid.uuid4(),
            course_id=uuid.UUID(course_id),
            query=query,
            results=research_report.get("external_links", []),
            summary=research_report.get("executive_summary", ""),
            search_source="bocha",
            expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add(cache)
        await db.commit()
    except Exception as e:
        logger.warning(f"蔡丰: 缓存写入失败: {e}")
