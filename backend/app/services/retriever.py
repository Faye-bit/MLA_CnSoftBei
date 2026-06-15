"""
RAG 检索服务
整合嵌入生成和向量检索, 提供端到端的语义搜索能力
Phase 2: 支持阈值过滤、文本清洗、LLM 增强和来源关联
Phase 3: 支持页面级知识点索引 (PDF/PPTX 使用 DocumentPage, DOCX/MD/TXT 使用 DocumentChunk)
"""

import uuid
from typing import List, Optional, Tuple
from dataclasses import dataclass, field
from sqlalchemy import select
from sqlalchemy.orm import aliased
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


async def _resolve_and_parse(
    file_path: str,
    file_type: str,
    document_id: uuid.UUID,
) -> tuple[str, Optional[str]]:
    """
    解析文档文本 (仅用于 DOCX/MD/TXT 的切片路径, PDF/PPTX 走页面级路径)

    :param file_path: 文件路径
    :param file_type: 文件类型
    :param document_id: 文档 ID (用于日志)
    :return: (解析后的文本, None)
    """
    from app.services.document_parser import parse_file as parse_file_legacy

    logger.info(f"文档 {document_id}: 使用传统解析 (type={file_type})")
    return parse_file_legacy(file_path, file_type), None


async def process_document(
    document_id: uuid.UUID,
    course_id: uuid.UUID,
    file_path: str,
    file_type: str,
    db: AsyncSession,
):
    """
    文档处理流水线 (Phase 3 分流版):
      - PDF/PPTX → 页面级知识点索引 (_process_page_based)
      - DOCX/MD/TXT → 传统文本切片 (保持现有逻辑)
    解析和切片/页面渲染是必需的, 嵌入失败不影响数据保存
    在文档上传后调用, 同步执行所有步骤
    :param document_id: 文档 ID
    :param course_id: 课程 ID
    :param file_path: 文件路径
    :param file_type: 文件类型
    :param db: 数据库会话
    """
    from app.models.document import Document

    # 1. 更新状态为处理中
    doc = await db.get(Document, document_id)
    if not doc:
        logger.error(f"文档不存在: {document_id}")
        return
    doc.parse_status = "processing"
    await db.commit()

    try:
        if file_type.lower() in ("pdf", "pptx"):
            # 新方案: 页面级知识点索引
            await _process_page_based(doc, file_path, file_type, course_id, db)
        else:
            # 旧方案: 文本切片 (DOCX/MD/TXT 保持不变)
            await _process_chunk_based(doc, file_path, file_type, course_id, db)

    except Exception as e:
        error_msg = str(e)
        logger.error(f"文档处理失败: {document_id}, 错误={error_msg}")
        doc.parse_status = "failed"
        doc.error_message = error_msg
        await db.commit()


async def _process_page_based(
    doc,
    file_path: str,
    file_type: str,
    course_id: uuid.UUID,
    db: AsyncSession,
):
    """
    页面级知识点提取流程 (用于 PDF/PPTX)

    步骤:
      1. 渲染页面图片
      2. 保存图片到磁盘, 创建 DocumentPage 记录
      3. 如果配置了 doc_parser API Key → 并发 LLM 提取每页知识点 (扁平)
      4. 知识点融合去重 → 扁平 KnowledgePoint 记录
      4.5 全文上下文建树 → LLM 拿到所有页面摘要后建立 core→sub→concept 知识树
      5. 生成嵌入向量 (每页摘要 + 知识点 → 嵌入 → Chroma)
      6. 更新文档状态
    """
    from app.models.document import Document
    from app.services.page_parser import (
        render_pages,
        extract_pages_via_llm,
        build_page_embedding_text,
    )
    from app.services.page_kp_service import fuse_knowledge_points
    from app.services.config_service import get_config_value
    from app.core.config import settings as app_settings

    logger.info(f"文档 {doc.id}: 开始页面级处理 (type={file_type})")

    # 1. 渲染页面图片
    try:
        image_paths = render_pages(
            file_path=file_path,
            file_type=file_type,
            doc_id=doc.id,
            upload_dir=app_settings.upload_dir,
        )
    except Exception as e:
        logger.error(f"文档 {doc.id}: 页面渲染失败: {e}")
        raise

    if not image_paths:
        raise ValueError("页面渲染失败: 未生成任何页面图片")

    # 2. 保存图片到磁盘 + 创建 DocumentPage 记录
    pages = []
    for i, img_path in enumerate(image_paths, start=1):
        page = DocumentPage(
            document_id=doc.id,
            page_number=i,
            image_path=img_path,
        )
        db.add(page)
        pages.append(page)

    await db.flush()  # 获取 page.id
    logger.info(f"文档 {doc.id}: 已创建 {len(pages)} 条 DocumentPage 记录")

    # 3. 检查是否配置了文档解析 LLM
    doc_parser_key = get_config_value("doc_parser_api_key")
    if doc_parser_key:
        doc_parser_base = get_config_value("doc_parser_api_base")
        doc_parser_model = get_config_value("doc_parser_model")

        logger.info(
            f"文档 {doc.id}: 开始 LLM 知识点提取 "
            f"(model={doc_parser_model}, pages={len(pages)})"
        )
        try:
            await extract_pages_via_llm(
                pages=pages,
                api_key=doc_parser_key,
                api_base=doc_parser_base,
                model=doc_parser_model,
            )
            # LLM 提取完成后立即保存 (commit)
            await db.commit()
            logger.info(f"文档 {doc.id}: LLM 知识点提取完成")
        except Exception as e:
            logger.warning(f"文档 {doc.id}: LLM 提取异常, 页面图片已保存: {e}")
            # 不阻塞流程, 页面图片已保存, 用户可以手动标注
    else:
        logger.info(f"文档 {doc.id}: 未配置 doc_parser API Key, 跳过 LLM 提取")

    # 4. 知识点融合 + 创建 KnowledgePoint 记录
    kp_count = 0
    try:
        kp_count = await fuse_knowledge_points(doc.id, course_id, db)
        logger.info(f"文档 {doc.id}: 知识点融合完成, 创建/关联 {kp_count} 个知识点")
    except Exception as e:
        logger.warning(f"文档 {doc.id}: 知识点融合失败, 跳过: {e}")

    # 4.5 LLM 分类 → 将扁平知识点整理为树形结构 (category→item)
    if kp_count > 1:
        try:
            from app.services.kp_extractor import (
                classify_knowledge_points, batch_create_tree_knowledge_points,
            )
            from app.models.course import KnowledgePoint as KPModel, Chapter

            # 确定目标章节
            doc_chapter_id = doc.chapter_id
            target_chapter = doc_chapter_id
            if not target_chapter:
                ch_stmt = select(Chapter).where(
                    Chapter.course_id == course_id, Chapter.title == "自动提取"
                )
                ch_result = await db.execute(ch_stmt)
                default_ch = ch_result.scalar_one_or_none()
                if default_ch:
                    target_chapter = default_ch.id
            if not target_chapter:
                logger.warning(f"文档 {doc.id}: 无有效目标章节, 跳过知识树构建")
            else:
                # 加载该章节下所有扁平知识点 (fuse 阶段创建的)
                kp_stmt = (
                    select(KPModel)
                    .where(KPModel.chapter_id == target_chapter)
                )
                kp_result = await db.execute(kp_stmt)
                flat_kps = list(kp_result.scalars().all())

                if len(flat_kps) >= 2:
                    # 转为 dict 格式 → LLM 分类
                    kp_dicts = [
                        {"title": kp.title, "description": kp.description or "",
                         "difficulty": kp.difficulty}
                        for kp in flat_kps
                    ]
                    classified = await classify_knowledge_points(kp_dicts)

                    if classified:
                        result2 = await batch_create_tree_knowledge_points(
                            target_chapter, classified, db
                        )
                        logger.info(
                            f"文档 {doc.id}: 知识树整理完成, "
                            f"{result2['category_count']} 个分类, "
                            f"{result2['item_count']} 个知识点"
                        )
        except Exception as e:
            logger.warning(f"文档 {doc.id}: 知识树构建失败, 保留扁平结构: {e}")

    # 5. 生成嵌入向量: 每页的摘要 + 知识点 → 嵌入 → Chroma
    try:
        await _embed_pages(pages, course_id, doc.id, file_path=file_path)
        logger.info(f"文档 {doc.id}: 页面嵌入完成")
    except Exception as e:
        logger.warning(f"文档 {doc.id}: 页面嵌入失败 (页面数据已保存): {e}")
        # 嵌入失败不阻塞, 页面和知识点已保存

    # 6. 更新文档状态
    doc.parse_status = "done"
    doc.page_count = len(pages)
    doc.kp_count = kp_count
    await db.commit()
    logger.info(f"文档 {doc.id}: 页面级处理全部完成 (pages={len(pages)}, kps={kp_count})")


async def _embed_pages(
    pages: list,  # List[DocumentPage]
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    file_path: str = "",  # 源文件路径, 用于 fitz 降级提取
) -> None:
    """
    为文档页面生成嵌入向量并存入 Chroma

    嵌入文本 = 页面摘要 + 知识点标题和描述
    若 LLM 未提取任何文本, 降级使用 PyMuPDF (fitz) 从 PDF 原文提取该页文字作为嵌入文本
    存储时标记 metadata.type = "document_page" 以区分 chunk 类型的向量

    :param pages: DocumentPage 对象列表
    :param course_id: 课程 ID
    :param document_id: 文档 ID (用于日志)
    :param file_path: 源文件路径 (PDF), 用于降级文本提取
    """
    from app.services.page_parser import build_page_embedding_text

    # 生成嵌入文本
    embedding_texts: list[str] = []
    page_ids: list[uuid.UUID] = []
    metadatas: list[dict] = []

    for page in pages:
        text = build_page_embedding_text(page)
        if not text.strip():
            # 降级: 用 fitz 从 PDF 原文提取该页文字
            text = _extract_page_text_fitz(file_path, page.page_number, document_id)
        if not text.strip():
            # 最终降级: 至少用文档+页码作为嵌入文本
            text = f"文档第{page.page_number}页"
        embedding_texts.append(text)
        page_ids.append(page.id)
        metadatas.append({
            "document_id": str(document_id),
            "course_id": str(course_id),
            "page_number": page.page_number,
            "type": "document_page",  # 标记类型, 区分于旧版 chunk
        })

    if not embedding_texts:
        logger.warning(f"文档 {document_id}: 无可嵌入的页面文本, 跳过向量化")
        return

    # 生成嵌入向量
    embeddings = await embedder.embed_texts(embedding_texts)

    # 存入 Chroma
    vector_store.add_chunks(
        course_id=course_id,
        chunk_ids=page_ids,  # page ID 作为 Chroma 键
        embeddings=embeddings,
        contents=embedding_texts,
        metadatas=metadatas,
    )

    logger.info(f"文档 {document_id}: 已嵌入 {len(page_ids)} 个页面到 Chroma")


def _extract_page_text_fitz(file_path: str, page_number: int, document_id: uuid.UUID) -> str:
    """
    使用 PyMuPDF (fitz) 从 PDF 文件中提取指定页的文字

    :param file_path: PDF 文件路径
    :param page_number: 页码 (1-based)
    :param document_id: 文档 ID (用于日志)
    :return: 提取的文字, 失败时返回空字符串
    """
    if not file_path or not file_path.lower().endswith(".pdf"):
        return ""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(file_path)
        if page_number < 1 or page_number > len(doc):
            doc.close()
            return ""
        page = doc[page_number - 1]
        text = page.get_text()
        doc.close()
        # 截取前 2000 字符, 避免嵌入文本过长
        return text[:2000].strip()
    except Exception as e:
        logger.debug(f"fitz 提取第 {page_number} 页文字失败: {e}")
        return ""


async def _process_chunk_based(
    doc,
    file_path: str,
    file_type: str,
    course_id: uuid.UUID,
    db: AsyncSession,
):
    """
    传统文本切片流程 (用于 DOCX/MD/TXT)
    保持原有 process_document() 的逻辑不变
    """
    from app.models.document import DocumentChunk
    from app.services.chunker import RecursiveTextSplitter, estimate_token_count
    from app.core.config import settings as app_settings

    # 解析文档
    text, fallback_reason = await _resolve_and_parse(file_path, file_type, doc.id)
    if not text or not text.strip():
        raise ValueError("文档解析失败: 文档内容为空或无法提取文本")

    if fallback_reason:
        doc.error_message = fallback_reason

    # 文本切片
    splitter = RecursiveTextSplitter(
        chunk_size=app_settings.chunk_size,
        chunk_overlap=app_settings.chunk_overlap,
    )
    chunks = splitter.split_text(text)

    if not chunks:
        raise ValueError("文本切片失败: 切片结果为空")

    # 写入数据库
    chunk_records: list[DocumentChunk] = []
    chunk_ids: list[uuid.UUID] = []
    chunk_metadatas: list[dict] = []

    for idx, chunk_text in enumerate(chunks):
        chunk_id = uuid.uuid4()
        metadata = {
            "document_id": str(doc.id),
            "course_id": str(course_id),
            "file_type": file_type,
            "type": "document_chunk",
        }
        chunk_record = DocumentChunk(
            id=chunk_id,
            document_id=doc.id,
            chunk_index=idx,
            content=chunk_text,
            chunk_metadata=metadata,
            token_count=estimate_token_count(chunk_text),
        )
        chunk_records.append(chunk_record)
        chunk_ids.append(chunk_id)
        chunk_metadatas.append(metadata)

    db.add_all(chunk_records)
    doc.chunk_count = len(chunks)
    logger.info(f"文档解析+切片完成: {doc.id}, 切片数={len(chunks)}")

    # 生成嵌入向量并写入 Chroma
    try:
        embeddings = await embedder.embed_texts(chunks)
        vector_store.add_chunks(
            course_id=course_id,
            chunk_ids=chunk_ids,
            embeddings=embeddings,
            contents=chunks,
            metadatas=chunk_metadatas,
        )
        doc.parse_status = "done"
        logger.info(f"文档处理流水线全部完成: {doc.id}")
    except Exception as embed_err:
        error_msg = str(embed_err)
        if "api" in error_msg.lower() or "key" in error_msg.lower() or "auth" in error_msg.lower() or "connection" in error_msg.lower():
            doc.parse_status = "chunked"
            doc.error_message = (
                f"文本已解析为 {len(chunks)} 个切片, "
                f"但向量化失败: {error_msg}。"
                f"请检查 backend/.env 中 EMBEDDING_API_KEY 是否正确配置。"
            )
        else:
            doc.parse_status = "chunked"
            doc.error_message = (
                f"文本已解析为 {len(chunks)} 个切片, 但向量化失败: {error_msg}"
            )
        logger.warning(f"向量化失败但切片已保存: {doc.id}, 原因={error_msg}")

    await db.commit()
    logger.info(f"文档 {doc.id}: 传统切片处理完成")
