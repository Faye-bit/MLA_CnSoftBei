"""
页面知识点融合服务
负责跨页知识点去重、融合、自动关联

核心功能:
  1. 收集文档所有页面提取的知识点
  2. 按 title 相似度聚类 (跨页去重)
  3. 创建/复用 KnowledgePoint 记录
  4. 通过 PageKnowledgePoint 关联页面和知识点
"""

import uuid
from typing import List, Tuple
from difflib import SequenceMatcher
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document_page import DocumentPage, PageKnowledgePoint
from app.models.document import Document
from app.models.course import KnowledgePoint, Chapter, Course


# ==================== 相似度计算 ====================

def _normalize_title(title: str) -> str:
    """
    规范化知识点标题: 去除空白、转小写、去除特殊符号

    :param title: 原始标题
    :return: 规范化后的标题
    """
    import re
    title = title.strip().lower()
    # 去除括号内容 (如 "TCP三次握手(3-way handshake)" → "tcp三次握手")
    title = re.sub(r"\([^)]*\)", "", title)
    title = re.sub(r"（[^）]*）", "", title)
    # 去除特殊符号, 保留中英文和数字
    title = re.sub(r"[^\w一-鿿]", "", title)
    return title


def _title_similarity(a: str, b: str) -> float:
    """
    计算两个知识点标题的相似度

    判断逻辑:
      1. 规范化后完全一致 → 1.0
      2. 一个包含另一个 → 0.9
      3. SequenceMatcher 序列相似度 → 0.0-1.0

    :param a: 标题 A
    :param b: 标题 B
    :return: 相似度 (0.0-1.0)
    """
    na = _normalize_title(a)
    nb = _normalize_title(b)

    if not na or not nb:
        return 0.0

    # 完全匹配
    if na == nb:
        return 1.0

    # 包含关系
    if na in nb or nb in na:
        return 0.9

    # 序列匹配
    return SequenceMatcher(None, na, nb).ratio()


# ==================== 聚类算法 ====================

def cluster_by_title_similarity(
    kps_with_pages: List[Tuple[DocumentPage, dict]],
    threshold: float = 0.75,
) -> List[List[Tuple[DocumentPage, dict]]]:
    """
    按 title 相似度将知识点聚类

    使用简单的贪心聚类:
      遍历每个知识点, 查找已有簇中是否有相似度 >= threshold 的
      如果有 → 加入该簇
      如果没有 → 创建新簇

    :param kps_with_pages: [(page, kp_dict), ...] 其中 kp_dict 包含 title, description, difficulty
    :param threshold: 相似度阈值, 默认 0.75
    :return: 聚类列表, 每个元素是一个簇 (列表)
    """
    clusters: List[List[Tuple[DocumentPage, dict]]] = []

    for page, kp in kps_with_pages:
        title = kp.get("title", "")
        if not title:
            continue

        # 查找最相似的已有簇
        best_cluster_idx = -1
        best_similarity = 0.0

        for idx, cluster in enumerate(clusters):
            # 计算与簇中第一个元素 (代表) 的相似度
            rep_kp = cluster[0][1]
            sim = _title_similarity(title, rep_kp.get("title", ""))
            if sim > best_similarity:
                best_similarity = sim
                best_cluster_idx = idx

        if best_cluster_idx >= 0 and best_similarity >= threshold:
            # 加入已有簇
            clusters[best_cluster_idx].append((page, kp))
        else:
            # 创建新簇
            clusters.append([(page, kp)])

    logger.info(
        f"知识点聚类完成: {len(kps_with_pages)} 个知识点 → {len(clusters)} 个簇 "
        f"(threshold={threshold})"
    )
    return clusters


# ==================== 融合主函数 ====================

def _get_canonical_title(cluster: List[Tuple[DocumentPage, dict]]) -> str:
    """获取簇中出现次数最多的 title (取规范化后最短的)"""
    from collections import Counter
    titles = [_normalize_title(kp.get("title", "")) for _, kp in cluster]
    if not titles:
        return ""
    counter = Counter(titles)
    # 返回出现次数最多的
    return counter.most_common(1)[0][0]


def _get_best_description(cluster: List[Tuple[DocumentPage, dict]]) -> str:
    """获取簇中最长的 description"""
    best = ""
    for _, kp in cluster:
        desc = kp.get("description", "")
        if len(desc) > len(best):
            best = desc
    return best


def _get_highest_difficulty(cluster: List[Tuple[DocumentPage, dict]]) -> str:
    """获取簇中最高的难度等级"""
    difficulty_order = {"easy": 0, "medium": 1, "hard": 2}
    highest = "medium"
    highest_val = -1
    for _, kp in cluster:
        diff = kp.get("difficulty", "medium")
        if diff in difficulty_order and difficulty_order[diff] > highest_val:
            highest = diff
            highest_val = difficulty_order[diff]
    return highest


async def _get_or_create_default_chapter(
    course_id: uuid.UUID,
    db: AsyncSession,
) -> uuid.UUID:
    """
    获取或创建一个默认章节 "自动提取", 用于存放 LLM 自动提取的知识点

    :param course_id: 课程 ID
    :param db: 数据库会话
    :return: 章节 ID
    """
    # 查找是否已有 "自动提取" 章节
    stmt = select(Chapter).where(
        Chapter.course_id == course_id,
        Chapter.title == "自动提取",
    )
    result = await db.execute(stmt)
    chapter = result.scalar_one_or_none()

    if chapter:
        return chapter.id

    # 创建默认章节
    chapter = Chapter(
        course_id=course_id,
        title="自动提取",
        description="LLM 从文档页面自动提取的知识点",
        order_index=999,  # 放在最后
    )
    db.add(chapter)
    await db.flush()
    logger.info(f"课程 {course_id}: 创建默认章节 '自动提取'")
    return chapter.id


async def fuse_knowledge_points(
    document_id: uuid.UUID,
    course_id: uuid.UUID,
    db: AsyncSession,
) -> int:
    """
    文档解析完成后, 对提取的知识点做跨页融合:
      1. 收集所有页面的 extracted_kps
      2. 按 title 相似度分组
      3. 同组知识点合并为一个 KnowledgePoint 记录
      4. 通过 page_knowledge_points 关联到多个页面

    :param document_id: 文档 ID
    :param course_id: 课程 ID
    :param db: 数据库会话
    :return: 创建/复用的知识点总数
    """
    # Step 1: 获取所有页面的知识点
    stmt = (
        select(DocumentPage)
        .where(DocumentPage.document_id == document_id)
        .order_by(DocumentPage.page_number)
    )
    result = await db.execute(stmt)
    pages = result.scalars().all()

    if not pages:
        logger.warning(f"文档 {document_id}: 无页面数据, 跳过知识点融合")
        return 0

    # 收集所有知识点及其来源页面
    all_kps: List[Tuple[DocumentPage, dict]] = []
    for page in pages:
        for kp in (page.extracted_kps or []):
            if isinstance(kp, dict) and kp.get("title"):
                all_kps.append((page, kp))

    if not all_kps:
        logger.info(f"文档 {document_id}: 无提取的知识点, 跳过融合")
        return 0

    logger.info(f"文档 {document_id}: 开始知识点融合, 共 {len(all_kps)} 个原始知识点")

    # Step 2: 按 title 相似度聚类
    clusters = cluster_by_title_similarity(all_kps)

    # Step 3: 确定目标章节 — 优先使用文档绑定的章节, 否则创建/使用 "自动提取"
    doc = await db.get(Document, document_id)
    if doc and doc.chapter_id:
        chapter_id = doc.chapter_id
        logger.info(f"文档 {document_id}: 知识点将归入文档绑定的章节 {chapter_id}")
    else:
        chapter_id = await _get_or_create_default_chapter(course_id, db)
        logger.info(f"文档 {document_id}: 知识点将归入默认章节 '自动提取'")

    # Step 4: 每个簇创建/复用 KnowledgePoint + 关联页面
    kp_count = 0
    for cluster in clusters:
        if not cluster:
            continue

        canonical_title = _get_canonical_title(cluster)
        canonical_desc = _get_best_description(cluster)
        canonical_difficulty = _get_highest_difficulty(cluster)

        # 查找是否已有同名 KnowledgePoint (在同一课程下)
        stmt = select(KnowledgePoint).where(
            KnowledgePoint.chapter_id == chapter_id,
            KnowledgePoint.title.ilike(f"%{canonical_title}%"),
        )
        result = await db.execute(stmt)
        existing_kp = result.scalar_one_or_none()

        if existing_kp:
            kp = existing_kp
            # 更新描述 (如果新描述更长)
            if len(canonical_desc) > len(kp.description or ""):
                kp.description = canonical_desc
            logger.debug(f"复用已有知识点: {kp.title}")
        else:
            kp = KnowledgePoint(
                chapter_id=chapter_id,
                title=canonical_title[:200],
                description=canonical_desc,
                difficulty=canonical_difficulty,
                source_type="auto",
            )
            db.add(kp)
            await db.flush()
            logger.debug(f"创建新知识点: {kp.title}")

        # Step 5: 关联到所有相关页面
        seen_pages: set[uuid.UUID] = set()
        for page, _ in cluster:
            if page.id in seen_pages:
                continue
            seen_pages.add(page.id)

            # 检查是否已有此关联 (避免重复)
            stmt = select(PageKnowledgePoint).where(
                PageKnowledgePoint.document_page_id == page.id,
                PageKnowledgePoint.knowledge_point_id == kp.id,
            )
            result = await db.execute(stmt)
            existing_link = result.scalar_one_or_none()

            if not existing_link:
                link = PageKnowledgePoint(
                    document_page_id=page.id,
                    knowledge_point_id=kp.id,
                    relevance=1.0,
                )
                db.add(link)

        kp_count += 1

    await db.flush()
    logger.info(
        f"文档 {document_id}: 知识点融合完成, "
        f"{len(all_kps)} 个原始知识点 → {len(clusters)} 个簇 → {kp_count} 个 KnowledgePoint"
    )
    return kp_count
