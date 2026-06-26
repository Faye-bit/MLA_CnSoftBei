"""
RAG 检索服务
整合嵌入生成和向量检索, 提供端到端的语义搜索能力
Phase 2: 支持阈值过滤、文本清洗、LLM 增强和来源关联
Phase 3: 支持页面级知识点索引检索 (文档处理已拆分至 document_processor)
"""

import uuid
from typing import List, Optional, Tuple
from dataclasses import dataclass, field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.document import DocumentChunk, Document
from app.models.document_page import DocumentPage, PageKnowledgePoint
from app.models.course import Chapter, KnowledgePoint
from app.services.embedder import embedder
from app.services.vector_store import vector_store
from app.services.text_normalizer import normalize_chunk_text, generate_keyword_highlights
from loguru import logger


@dataclass
class RetrievedChunk:
    """
    检索结果数据类 (文本切片类型)
    封装一条检索结果的完整信息
    Phase 2: 新增章节/知识点关联和 LLM 增强字段
    """
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_filename: str
    content: str
    score: float
    chunk_index: int
    metadata: dict

    # Phase 2: 来源结构化上下文
    chapter_id: Optional[uuid.UUID] = None
    chapter_title: Optional[str] = None
    knowledge_point_id: Optional[uuid.UUID] = None
    knowledge_point_title: Optional[str] = None

    # Phase 2: LLM 增强结果
    enhanced_summary: Optional[str] = None
    keywords: list = field(default_factory=list)
    highlights: list = field(default_factory=list)


@dataclass
class RetrievedPage:
    """
    检索结果数据类 (页面类型)
    用于 PDF/PPTX 文档的页面级检索结果
    """
    page_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    page_number: int
    image_path: str
    summary: Optional[str]
    score: float
    knowledge_points: list = field(default_factory=list)  # [{id, title, description, difficulty}, ...]


async def retrieve(
    query: str,
    course_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 5,
) -> List[RetrievedChunk]:
    """
    执行 RAG 语义检索流程:
    1. 将查询文本转换为嵌入向量
    2. 在课程向量空间中检索最相似的切片
    3. 从数据库获取切片的完整信息 (文件名、章节、知识点等)
    :param query: 查询文本
    :param course_id: 课程 ID (限定检索范围)
    :param db: 数据库会话
    :param top_k: 返回结果数
    :return: 检索结果列表
    """
    # Step 1: 为查询文本生成嵌入向量
    query_embedding = await embedder.embed_query(query)

    # Step 2: 在 Chroma 中执行向量检索
    raw_results = vector_store.search(course_id, query_embedding, top_k)

    if not raw_results:
        logger.info(f"RAG 检索无结果: query={query[:50]}...")
        return []

    # Step 3: 先尝试查找 DocumentChunk (旧切片方案)
    chunk_ids = [uuid.UUID(r["id"]) for r in raw_results]
    score_map = {r["id"]: r["score"] for r in raw_results}

    stmt = (
        select(
            DocumentChunk,
            Document.filename,
            Document.file_type,
            Chapter.id.label("chapter_id"),
            Chapter.title.label("chapter_title"),
            KnowledgePoint.id.label("kp_id"),
            KnowledgePoint.title.label("kp_title"),
        )
        .join(Document, DocumentChunk.document_id == Document.id)
        .outerjoin(KnowledgePoint, DocumentChunk.knowledge_point_id == KnowledgePoint.id)
        .outerjoin(Chapter, KnowledgePoint.chapter_id == Chapter.id)
        .where(DocumentChunk.id.in_(chunk_ids))
    )
    result = await db.execute(stmt)
    rows = result.all()

    # 构建返回结果, 按原始相似度排序
    chunk_map: dict[uuid.UUID, RetrievedChunk] = {}
    for row in rows:
        chunk = row[0]
        filename = row[1]
        file_type = row[2]
        ch_id = row[3]
        ch_title = row[4]
        kp_id = row[5]
        kp_title = row[6]

        chunk_map[chunk.id] = RetrievedChunk(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            document_filename=filename,
            content=chunk.content,
            score=score_map.get(str(chunk.id), 0.0),
            chunk_index=chunk.chunk_index,
            metadata=chunk.chunk_metadata or {},
            chapter_id=ch_id,
            chapter_title=ch_title,
            knowledge_point_id=kp_id,
            knowledge_point_title=kp_title,
        )

    # Fallback: 如果 Chunk 表中匹配不到, 尝试 DocumentPage 表 (页面级索引方案)
    # 将页面结果转为 RetrievedChunk 格式, 保持调用方兼容
    unmatched_ids = [cid for cid in chunk_ids if cid not in chunk_map]
    if unmatched_ids:
        page_stmt = (
            select(
                DocumentPage,
                Document.filename,
                Document.file_type,
            )
            .join(Document, DocumentPage.document_id == Document.id)
            .where(DocumentPage.id.in_(unmatched_ids))
        )
        page_result = await db.execute(page_stmt)
        page_rows = page_result.all()

        for page, fname, ftype in page_rows:
            # 构造内容为 "页面摘要 + 知识点" 的文本
            content_parts = [page.summary] if page.summary else []
            for kp in (page.extracted_kps or []):
                if isinstance(kp, dict):
                    content_parts.append(f"{kp.get('title', '')}: {kp.get('description', '')}")
            content = " ".join(content_parts) if content_parts else f"(第{page.page_number}页)"

            chunk_map[page.id] = RetrievedChunk(
                chunk_id=page.id,
                document_id=page.document_id,
                document_filename=fname,
                content=content,
                score=score_map.get(str(page.id), 0.0),
                chunk_index=page.page_number,  # 用页码代替 chunk_index
                metadata={
                    "document_id": str(page.document_id),
                    "course_id": str(course_id),
                    "page_number": page.page_number,
                    "type": "document_page",
                },
            )

        if page_rows:
            logger.info(
                f"RAG 检索: {len(rows)} 条 chunk + {len(page_rows)} 条页面 "
                f"({len(unmatched_ids) - len(page_rows)} 条未匹配)"
            )

    # 按 score 降序排列
    sorted_chunks = sorted(
        chunk_map.values(),
        key=lambda x: x.score,
        reverse=True,
    )

    logger.info(f"RAG 检索完成: {len(sorted_chunks)} 条结果")
    return sorted_chunks


def apply_threshold(chunks: List[RetrievedChunk], threshold: float) -> List[RetrievedChunk]:
    """
    过滤低于相似度阈值的结果
    :param chunks: 检索结果列表
    :param threshold: 相似度阈值 (0.0-1.0), 0.0 表示不过滤
    :return: 过滤后的结果列表
    """
    if threshold <= 0.0 or not chunks:
        return chunks

    filtered = [c for c in chunks if c.score >= threshold]
    removed = len(chunks) - len(filtered)
    if removed > 0:
        logger.info(f"阈值过滤: {len(chunks)} → {len(filtered)} 条 (threshold={threshold}, 移除了 {removed} 条低分结果)")
    return filtered


async def retrieve_pages(
    query: str,
    course_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 5,
) -> List[RetrievedPage]:
    """
    执行页面级语义检索 (用于 PDF/PPTX 文档):
    1. 将查询文本转换为嵌入向量
    2. 在 Chroma 中搜索类型为 "document_page" 的向量
    3. 联表查询 DocumentPage → Document → PageKnowledgePoint → KnowledgePoint
    :param query: 查询文本
    :param course_id: 课程 ID (限定检索范围)
    :param db: 数据库会话
    :param top_k: 返回结果数
    :return: 页面检索结果列表, 按 score 降序
    """
    # Step 1: 为查询文本生成嵌入向量
    query_embedding = await embedder.embed_query(query)

    # Step 2: 在 Chroma 中执行向量检索
    raw_results = vector_store.search(course_id, query_embedding, top_k)

    if not raw_results:
        logger.info(f"页面检索无结果: query={query[:50]}...")
        return []

    # Step 3: 尝试将所有 Chroma 结果 ID 作为 DocumentPage ID 查询
    #    不再依赖 metadata.type 判断 (旧数据可能没有该字段)
    all_ids = [uuid.UUID(r["id"]) for r in raw_results]
    score_map = {r["id"]: r["score"] for r in raw_results}

    # 查询哪些 ID 对应 DocumentPage 记录
    stmt = (
        select(
            DocumentPage,
            Document.filename,
            Document.file_type,
        )
        .join(Document, DocumentPage.document_id == Document.id)
        .where(DocumentPage.id.in_(all_ids))
    )
    result = await db.execute(stmt)
    rows = result.all()

    # 如果没有任何 ID 是 DocumentPage, 返回空 (调用方会回退到 chunk 检索)
    if not rows:
        logger.info(f"页面检索: {len(raw_results)} 条原始结果中无页面记录")
        return []

    # 筛选出属于该课程的页面
    page_ids = [row[0].id for row in rows]
    valid_rows = [(row[0], row[1]) for row in rows]  # (DocumentPage, filename)

    # Step 5: 获取每个页面的关联知识点
    page_kp_map: dict[uuid.UUID, list] = {}
    if page_ids:
        kp_stmt = (
            select(
                PageKnowledgePoint.document_page_id,
                KnowledgePoint.id,
                KnowledgePoint.title,
                KnowledgePoint.description,
                KnowledgePoint.difficulty,
            )
            .join(KnowledgePoint, PageKnowledgePoint.knowledge_point_id == KnowledgePoint.id)
            .where(PageKnowledgePoint.document_page_id.in_(page_ids))
        )
        kp_result = await db.execute(kp_stmt)
        for row in kp_result.all():
            pid = row[0]
            kp_info = {
                "id": str(row[1]),
                "title": row[2],
                "description": row[3],
                "difficulty": row[4],
            }
            if pid not in page_kp_map:
                page_kp_map[pid] = []
            page_kp_map[pid].append(kp_info)

    # Step 6: 构建返回结果
    retrieved_pages: List[RetrievedPage] = []
    for page, filename in valid_rows:
        retrieved_pages.append(RetrievedPage(
            page_id=page.id,
            document_id=page.document_id,
            document_name=filename,
            page_number=page.page_number,
            image_path=page.image_path,
            summary=page.summary,
            score=score_map.get(str(page.id), 0.0),
            knowledge_points=page_kp_map.get(page.id, []),
        ))

    # 按 score 降序排列
    retrieved_pages.sort(key=lambda x: x.score, reverse=True)

    logger.info(
        f"页面检索完成: {len(retrieved_pages)} 条结果 "
        f"(从 {len(raw_results)} 条原始结果中匹配到 {len(valid_rows)} 条页面)"
    )
    return retrieved_pages


async def enhance_retrieve(
    query: str,
    course_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 5,
    similarity_threshold: float = 0.0,
) -> Tuple[List[RetrievedChunk], int]:
    """
    增强版 RAG 检索流程 (Phase 2):
    1. 执行基础语义检索
    2. 阈值过滤低分结果
    3. 文本清洗 (去 PDF 残留、合并断行等)
    4. 调用 LLM 提取核心观点和关键词
    5. LLM 识别并合并重复结果
    6. 生成查询关键词高亮位置
    :param query: 查询文本
    :param course_id: 课程 ID
    :param db: 数据库会话
    :param top_k: 返回结果数
    :param similarity_threshold: 相似度阈值
    :return: (增强后的检索结果列表, 去重合并数量)
    """
    from app.services.content_enhancer import enhance_retrieval_results

    # Step 1: 基础 RAG 检索
    raw_chunks = await retrieve(query, course_id, db, top_k)

    if not raw_chunks:
        return [], 0

    # Step 2: 阈值过滤
    chunks = apply_threshold(raw_chunks, similarity_threshold)
    if not chunks:
        logger.info(f"阈值过滤后无结果, threshold={similarity_threshold}")
        return [], 0

    # Step 3: 文本清洗 — 对每个 chunk 的 content 执行清洗
    for chunk in chunks:
        chunk.content = normalize_chunk_text(chunk.content)

    # Step 4: LLM 增强 — 提取核心观点、关键词、识别重复
    try:
        chunks_data = [
            {
                "id": str(c.chunk_id),
                "content": c.content[:800],  # 截取前 800 字符, 减少 token 消耗
                "score": c.score,
                "chunk_index": c.chunk_index,
            }
            for c in chunks
        ]

        enhanced_info = await enhance_retrieval_results(query, chunks_data, db)

        # Step 5: 将 LLM 增强结果填充到 chunk
        deduplicated_count = _apply_enhancement(chunks, enhanced_info)

        # Step 6: 生成关键词高亮位置
        for chunk in chunks:
            chunk.highlights = generate_keyword_highlights(chunk.content, query)

        logger.info(
            f"增强检索完成: {len(chunks)} 条结果, "
            f"去重合并 {deduplicated_count} 条"
        )
        return chunks, deduplicated_count

    except Exception as e:
        # LLM 增强失败时 fallback: 返回清洗后的原始结果, 不做增强
        logger.warning(f"LLM 增强失败, 降级为原始结果: {e}")
        # 仍然生成高亮位置
        for chunk in chunks:
            chunk.highlights = generate_keyword_highlights(chunk.content, query)
        return chunks, 0


def _apply_enhancement(
    chunks: List[RetrievedChunk],
    enhanced_info: List[dict],
) -> int:
    """
    将 LLM 返回的增强信息填充到对应的 RetrievedChunk 中
    处理去重合并: 被标记为重复的 chunk 将被移除, 其信息合并到主 chunk
    :param chunks: 检索结果列表 (会原地修改)
    :param enhanced_info: LLM 返回的增强信息列表
    :return: 被去重移除的 chunk 数量
    """
    # 构建 chunk_id → chunk 映射
    chunk_by_id: dict[str, RetrievedChunk] = {}
    for c in chunks:
        chunk_by_id[str(c.chunk_id)] = c

    # 构建 chunk_id → enhanced_info 映射
    enhance_map: dict[str, dict] = {}
    for info in enhanced_info:
        cid = info.get("chunk_id", "")
        if cid:
            enhance_map[cid] = info

    # 第一步: 填充增强信息
    for c in chunks:
        cid = str(c.chunk_id)
        info = enhance_map.get(cid, {})
        if info.get("viewpoint"):
            c.enhanced_summary = info["viewpoint"]
        if info.get("keywords"):
            c.keywords = info["keywords"] if isinstance(info["keywords"], list) else [info["keywords"]]

    # 第二步: 识别并处理重复
    duplicate_map: dict[str, str] = {}  # duplicate_id → primary_id
    for info in enhanced_info:
        cid = info.get("chunk_id", "")
        dup_of = info.get("is_duplicate_of", "")
        if cid and dup_of:
            duplicate_map[cid] = dup_of

    # 第三步: 移除被标记为重复的 chunk, 将信息合并到主 chunk
    removed_ids: set[str] = set()
    for dup_id, primary_id in duplicate_map.items():
        if dup_id in chunk_by_id and primary_id in chunk_by_id:
            dup_chunk = chunk_by_id[dup_id]
            primary_chunk = chunk_by_id[primary_id]

            # 如果主 chunk 没有增强摘要, 尝试从重复 chunk 获取
            if not primary_chunk.enhanced_summary and dup_chunk.enhanced_summary:
                primary_chunk.enhanced_summary = dup_chunk.enhanced_summary

            # 合并关键词 (去重)
            combined_keywords = list(set(primary_chunk.keywords + dup_chunk.keywords))
            primary_chunk.keywords = combined_keywords[:6]  # 最多保留 6 个关键词

            # 在增强摘要末尾追加合并提示
            merge_note = f"（已自动合并相似结果: 切片 #{dup_chunk.chunk_index}）"
            primary_chunk.enhanced_summary = (
                (primary_chunk.enhanced_summary or "") + merge_note
            ).strip()

            removed_ids.add(dup_id)

    # 第四步: 从列表中移除重复 chunk (原地修改列表)
    if removed_ids:
        chunks[:] = [c for c in chunks if str(c.chunk_id) not in removed_ids]

    # 第五步: 计算被吸收合并的数量 (某个 chunk 的重复项被合并到它)
    absorbed_count = len(removed_ids)

    return absorbed_count


# 向后兼容 re-export:
# process_document 已移动至 app.services.document_processor
# 外部调用者 (如 documents API) 无需修改 import 路径
from app.services.document_processor import process_document  # noqa: E402
