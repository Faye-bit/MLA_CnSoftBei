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
   - description: 一句话描述 (50字以内)
   - difficulty: 难度 (easy/medium/hard)
2. 只提取片段中明确涉及的知识点, 不要编造
3. 如果片段不包含明确的知识点, 返回空列表
4. 请自行判断应提取多少个知识点

输出格式: 严格的JSON数组, 不要包含任何解释文字
[{"title": "知识点名", "description": "一句话描述", "difficulty": "easy|medium|hard"}]"""


async def extract_knowledge_points(
    document_id: uuid.UUID,
    chapter_id: uuid.UUID,
    db: AsyncSession,
    max_chunks: int = 50,
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
        # 拼接切片内容 (不截断, LLM 自行判断知识点)
        snippet = chunk.content.replace("\n", " ")
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


# ===== AI 知识点自动分类 =====

CLASSIFY_PROMPT = """你是一位专业的课程知识图谱构建专家，擅长将零散的知识点按主题逻辑进行科学分类。

你的任务是将给定的知识点列表按主题分组，形成清晰的树形知识结构。

## 分类规则 (必须严格遵守)

1. **必须全覆盖**: 每一个知识点都必须被归入某个分类，不允许遗漏任何一个，对于零散的独立知识点，统一归入“独立知识点”类
2. **分类粒度适中**: 每个分类下应有 2-8 个知识点，避免分类过粗（一个分类包含过多知识点）或过细（每个分类只有 1 个知识点）
3. **分类命名规范**:
   - 分类名应简洁准确，使用学科通用术语（如"进程管理"、"内存管理"、"死锁"等）
   - 分类名控制在 10 字以内
   - 分类名应反映该组知识点的共同主题
4. **分类逻辑**:
   - 按知识点之间的逻辑关联分组（如：概念相近、同属一个子领域、有前后依赖关系）
   - 同一分类内的知识点应具有明显的主题关联性
   - 避免创建"其他"或"杂项"等模糊分类（除非确实存在零星不相关的知识点）

## 输出格式

严格输出以下 JSON 数组，不要包含任何解释文字或 markdown 标记:

```json
[
  {
    "category": "分类名称",
    "items": [
      {"title": "知识点名称", "description": "知识点描述", "difficulty": "easy|medium|hard"}
    ]
  }
]
```

## 示例

输入知识点: ["进程概念", "线程概念", "进程调度", "内存分配", "虚拟内存", "页面置换"]

正确输出:
```json
[
  {
    "category": "进程与线程",
    "items": [
      {"title": "进程概念", "description": "进程的定义与特征", "difficulty": "easy"},
      {"title": "线程概念", "description": "线程的定义与特征", "difficulty": "easy"},
      {"title": "进程调度", "description": "进程调度算法", "difficulty": "medium"}
    ]
  },
  {
    "category": "内存管理",
    "items": [
      {"title": "内存分配", "description": "内存分配策略", "difficulty": "medium"},
      {"title": "虚拟内存", "description": "虚拟内存技术", "difficulty": "medium"},
      {"title": "页面置换", "description": "页面置换算法", "difficulty": "hard"}
    ]
  }
]
```

现在请严格按照以上规则，对给定的知识点列表进行分类。记住：每个知识点都必须被归类！"""


async def classify_knowledge_points(kp_list: list[dict], batch_size: int = 30) -> list[dict]:
    """ LLM 将知识点按主题自动分组 (大批量自动分批处理) """
    if len(kp_list) <= 1:
        return [{"category": "", "items": kp_list}]

    # 超过 batch_size 则分批处理
    if len(kp_list) > batch_size:
        all_results: list[dict] = []
        for i in range(0, len(kp_list), batch_size):
            batch = kp_list[i:i + batch_size]
            batch_result = await classify_knowledge_points(batch, batch_size)
            all_results.extend(batch_result)
        # 合并同名分类
        merged: dict[str, list[dict]] = {}
        for cat in all_results:
            name = cat.get("category", "未分类")
            if name not in merged:
                merged[name] = []
            merged[name].extend(cat.get("items", []))
        return [{"category": k, "items": v} for k, v in merged.items()]

    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    model = get_config_value("llm_model")
    client = AsyncOpenAI(api_key=api_key, base_url=api_base)
    kp_summary = json.dumps([
        {"title": k["title"], "description": k.get("description", ""),
         "difficulty": k.get("difficulty", "medium")} for k in kp_list
    ], ensure_ascii=False, indent=2)
    try:
        resp = await client.chat.completions.create(
            model=model, temperature=0.1, max_tokens=4000,
            messages=[{"role": "system", "content": CLASSIFY_PROMPT},
                       {"role": "user", "content": f"请对以下 {len(kp_list)} 个知识点进行分类，每个知识点都必须被归入某个分类:\n{kp_summary}"}])
        raw = resp.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"LLM 分类失败: {e}")
        return [{"category": "", "items": kp_list}]
    try:
        t = raw.strip(); b1, b2 = t.find("["), t.rfind("]")
        if b1 != -1 and b2 != -1: t = t[b1:b2 + 1]
        cats = json.loads(t)
        if not isinstance(cats, list): raise ValueError("not list")
    except Exception:
        return [{"category": "", "items": kp_list}]
    all_titles = {k["title"] for k in kp_list}; seen = set()
    result = []
    for cat in cats or []:
        if not isinstance(cat, dict): continue
        name = str(cat.get("category", "")).strip() or "未分类"
        items = []
        for item in (cat.get("items") or []):
            t2 = str(item.get("title", "")).strip()
            if t2 and t2 in all_titles and t2 not in seen:
                items.append({"title": t2, "description": str(item.get("description", "")).strip()[:100],
                              "difficulty": item.get("difficulty", "medium")})
                seen.add(t2)
        if items: result.append({"category": name, "items": items})
    for kp in kp_list:
        if kp["title"] not in seen:
            f = next((c for c in result if c["category"] == "未分类"), None)
            if f: f["items"].append(kp)
            else: result.append({"category": "未分类", "items": [kp]})
            seen.add(kp["title"])
    logger.info(f"分类: {len(result)} 组, {len(seen)} KP")
    return result


async def batch_create_classified_knowledge_points(
    chapter_id: uuid.UUID, classified: list[dict], db: AsyncSession,
    page_map: dict[str, list[uuid.UUID]] | None = None,
) -> dict:
    """ 批量创建分类后的树形知识点, 可选恢复页面关联 """
    from app.models.document_page import PageKnowledgePoint
    cn, ic = 0, 0
    for cat in classified:
        name = cat.get("category", "").strip() or "零散概念"
        items = cat.get("items", [])
        if not items: continue
        ck = KnowledgePoint(chapter_id=chapter_id, title=name, kp_type="category", difficulty="medium")
        db.add(ck); await db.flush(); cn += 1
        for kd in items:
            ik = KnowledgePoint(chapter_id=chapter_id, title=kd["title"],
                description=kd.get("description", ""), difficulty=kd.get("difficulty", "medium"),
                kp_type="item", parent_kp_id=ck.id)
            db.add(ik); await db.flush(); ic += 1
            # 恢复页面关联
            if page_map and kd["title"] in page_map:
                for page_id in page_map[kd["title"]]:
                    db.add(PageKnowledgePoint(document_page_id=page_id, knowledge_point_id=ik.id, relevance=1.0))
            for cid_str in kd.get("chunk_ids", []):
                try:
                    cid = uuid.UUID(cid_str); chunk = await db.get(DocumentChunk, cid)
                    if chunk: chunk.knowledge_point_id = ik.id
                except ValueError: pass
    await db.commit()
    logger.info(f"分类创建: {cn} 类, {ic} KP")
    return {"category_count": cn, "item_count": ic}


async def batch_create_tree_knowledge_points(
    chapter_id: uuid.UUID, classified: list[dict], db: AsyncSession
) -> dict:
    """
    将 LLM 分类结果应用到章节中的已有知识点:
      1. 为每个分类创建 category 类型的父知识点
      2. 将章节下已有的 item 知识点按标题匹配, 挂到对应 category 下 (设置 parent_kp_id)
      3. 保留已有的 PageKnowledgePoint 关联 (不删除重建, 只更新 parent_kp_id)

    与 batch_create_classified_knowledge_points 的区别:
      前者创建全新的知识点 (适合从零构建), 本函数操作已有知识点 (适合 fuse 后的二次整理)

    :param chapter_id: 目标章节 ID
    :param classified: classify_knowledge_points() 的输出 [{"category": "..", "items": [..]}]
    :param db: 数据库会话
    :return: {"category_count": int, "item_count": int}
    """
    from app.models.course import KnowledgePoint as KPModel

    # 1. 加载章节下所有已有知识点, 建立标题→实例的索引
    stmt = select(KPModel).where(KPModel.chapter_id == chapter_id)
    result = await db.execute(stmt)
    existing_kps: dict[str, KPModel] = {kp.title: kp for kp in result.scalars().all()}

    cn, ic = 0, 0
    for cat in classified:
        name = str(cat.get("category", "")).strip() or "默认分类"
        items = cat.get("items", [])
        if not items:
            continue

        # 检查是否已有同名 category, 复用
        cat_kp = existing_kps.get(name)
        if cat_kp is None:
            cat_kp = KPModel(
                chapter_id=chapter_id, title=name,
                kp_type="category", difficulty="medium",
            )
            db.add(cat_kp)
            await db.flush()
            cn += 1
        else:
            # 已有同名知识点, 将其转为 category 类型
            cat_kp.kp_type = "category"
            cat_kp.parent_kp_id = None  # category 不应有父节点

        # 将已有 item 知识点按标题匹配, 挂到 category 下
        for kd in items:
            title = kd["title"]
            kp = existing_kps.get(title)
            if kp is not None:
                kp.parent_kp_id = cat_kp.id
                kp.kp_type = "item"
                if not kp.description and kd.get("description"):
                    kp.description = kd["description"]
                kp.difficulty = kd.get("difficulty", kp.difficulty or "medium")
                ic += 1

    await db.commit()
    logger.info(f"知识树整理完成: {cn} 个分类, {ic} 个知识点已关联")
    return {"category_count": cn, "item_count": ic}
