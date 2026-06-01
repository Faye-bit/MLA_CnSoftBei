"""
知识点自动提取服务
将文档切片分批发送给 LLM, 自动识别并提取结构化知识点
"""

import uuid
import json
from typing import List
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.document import Document, DocumentChunk
from app.models.course import Chapter, KnowledgePoint
from app.services.config_service import get_config_value
from loguru import logger

# 知识点提取 System Prompt
EXTRACT_SYSTEM_PROMPT = """你是一个专业的课程知识图谱构建助手。你的任务是从给定的课程文档片段中提取知识点。

要求:
1. 识别片段中涉及的核心知识点, 每个知识点包括:
   - title: 知识点名称 (简洁准确, 10字以内)
   - description: 一句话描述 (30字以内)
   - difficulty: 难度 (easy/medium/hard)
2. 只提取片段中明确涉及的知识点, 不要编造
3. 如果片段不包含明确的知识点, 返回空列表
4. 每个片段最多提取3个知识点

输出格式: 严格的JSON数组, 不要包含任何解释文字
[{"title": "知识点名", "description": "一句话描述", "difficulty": "easy|medium|hard"}]"""


async def extract_knowledge_points(
    document_id: uuid.UUID,
    chapter_id: uuid.UUID,
    db: AsyncSession,
    max_chunks: int = 15,
) -> list[dict]:
    """
    从文档切片中自动提取知识点
    :param document_id: 文档 ID
    :param chapter_id: 目标章节 ID (知识点将创建到此章节下)
    :param db: 数据库会话
    :param max_chunks: 最多使用的切片数, 控制 token 消耗
    :return: 提取到的知识点列表 [{title, description, difficulty, chunk_ids}]
    """
    # 1. 获取文档切片
    stmt = (
        select(DocumentChunk)
        .where(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .limit(max_chunks)
    )
    result = await db.execute(stmt)
    chunks = result.scalars().all()

    if not chunks:
        logger.warning(f"文档 {document_id} 没有切片")
        return []

    # 2. 确认章节存在 (预加载课程信息)
    from sqlalchemy.orm import selectinload
    stmt = (
        select(Chapter)
        .where(Chapter.id == chapter_id)
        .options(selectinload(Chapter.course))
    )
    ch_result = await db.execute(stmt)
    chapter = ch_result.scalar_one_or_none()
    if not chapter:
        raise ValueError(f"章节不存在: {chapter_id}")

    # 3. 获取已有知识点用于去重
    existing_stmt = select(KnowledgePoint).where(KnowledgePoint.chapter_id == chapter_id)
    existing_result = await db.execute(existing_stmt)
    existing_kps = existing_result.scalars().all()
    existing_titles = {kp.title for kp in existing_kps}

    # 4. 汇总切片文本 (带编号, 便于追溯)
    chunks_text = ""
    chunk_map: dict[int, uuid.UUID] = {}  # 文本编号 → 切片ID
    for i, chunk in enumerate(chunks):
        # 每条切片截取前800字符, 控制上下文长度
        snippet = chunk.content[:800].replace("\n", " ")
        chunks_text += f"[片段{i+1}] {snippet}\n\n"
        chunk_map[i + 1] = chunk.id

    if not chunks_text.strip():
        return []

    # 5. 调用 LLM 提取知识点
    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    model = get_config_value("llm_model")

    client = AsyncOpenAI(api_key=api_key, base_url=api_base)

    user_prompt = (
        f"课程: {chapter.course.name if chapter.course else '未知'}\n"
        f"章节: {chapter.title}\n\n"
        f"文档片段:\n{chunks_text}\n\n"
        f"请从以上文档片段中提取知识点。"
        f"注意: 以下知识点已存在, 请勿重复提取: {', '.join(existing_titles) if existing_titles else '无'}"
    )

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw_output = response.choices[0].message.content or ""
        logger.info(f"LLM 知识点提取完成: {len(raw_output)} 字符")
    except Exception as e:
        logger.error(f"LLM 调用失败: {e}")
        raise RuntimeError(f"LLM 调用失败: {e}")

    # 6. 解析 LLM 输出
    kp_list = _parse_kp_output(raw_output)

    # 7. 去重 (过滤与已有知识点重名的)
    filtered: list[dict] = []
    for kp in kp_list:
        if kp["title"] not in existing_titles:
            filtered.append(kp)
            existing_titles.add(kp["title"])

    # 8. 尝试将每个提取的知识点与切片建立关联
    for kp in filtered:
        kp["chunk_ids"] = []
        # 简单关键词匹配: 如果知识点名出现在切片中, 则关联
        for i, chunk in enumerate(chunks):
            if kp["title"] in chunk.content:
                kp["chunk_ids"].append(str(chunk.id))

    logger.info(f"知识点提取结果: {len(filtered)} 个新知识点 (去重后), 原始输出 {len(kp_list)} 个")
    return filtered


def _parse_kp_output(raw: str) -> list[dict]:
    """
    解析 LLM 输出的 JSON 知识点列表
    兼容各种可能的格式问题 (markdown 代码块包裹, 尾逗号等)
    """
    # 去掉 markdown 代码块包裹
    text = raw.strip()
    if text.startswith("```"):
        # 去掉 ```json 和结尾 ```
        lines = text.split("\n")
        text = "\n".join(lines[1:-1])

    # 尝试查找 JSON 数组
    bracket_start = text.find("[")
    bracket_end = text.rfind("]")
    if bracket_start != -1 and bracket_end != -1:
        text = text[bracket_start:bracket_end + 1]

    try:
        items = json.loads(text)
        if not isinstance(items, list):
            return []
    except json.JSONDecodeError:
        logger.warning(f"LLM 输出 JSON 解析失败: {text[:200]}")
        return []

    # 标准化字段
    result: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        if not title:
            continue
        result.append({
            "title": title[:50],
            "description": str(item.get("description", "")).strip()[:100],
            "difficulty": item.get("difficulty", "medium") in ("easy", "medium", "hard")
                          and item["difficulty"] or "medium",
        })
    return result


async def batch_create_knowledge_points(
    chapter_id: uuid.UUID,
    kp_list: list[dict],
    db: AsyncSession,
) -> list[KnowledgePoint]:
    """
    批量创建知识点并关联切片
    :param chapter_id: 章节 ID
    :param kp_list: 知识点列表 [{title, description, difficulty, chunk_ids}]
    :param db: 数据库会话
    :return: 创建的知识点列表
    """
    created: list[KnowledgePoint] = []

    for kp_data in kp_list:
        kp = KnowledgePoint(
            chapter_id=chapter_id,
            title=kp_data["title"],
            description=kp_data.get("description", ""),
            difficulty=kp_data.get("difficulty", "medium"),
        )
        db.add(kp)
        await db.flush()  # 获取 kp.id

        # 关联切片到知识点
        chunk_ids = kp_data.get("chunk_ids", [])
        for cid_str in chunk_ids:
            try:
                cid = uuid.UUID(cid_str)
                chunk = await db.get(DocumentChunk, cid)
                if chunk:
                    chunk.knowledge_point_id = kp.id
            except ValueError:
                pass

        created.append(kp)

    await db.commit()
    logger.info(f"批量创建知识点完成: {len(created)} 个")
    return created
