"""
RAG 检索服务
整合嵌入生成和向量检索, 提供端到端的语义搜索能力
Phase 2: 支持阈值过滤、文本清洗、LLM 增强和来源关联
"""

import uuid
from typing import List, Optional, Tuple
from dataclasses import dataclass, field
from sqlalchemy import select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.document import DocumentChunk, Document
from app.models.course import Chapter, KnowledgePoint
from app.services.embedder import embedder
from app.services.vector_store import vector_store
from app.services.text_normalizer import normalize_chunk_text, generate_keyword_highlights
from loguru import logger


@dataclass
class RetrievedChunk:
    """
    检索结果数据类
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

    # Step 3: 从数据库获取切片详情 (含章节和知识点关联)
    chunk_ids = [uuid.UUID(r["id"]) for r in raw_results]

    # 构建 score 映射
    score_map = {r["id"]: r["score"] for r in raw_results}

    # Phase 2: 查询切片及其关联文档、知识点、章节
    # 关联路径: DocumentChunk → Document (INNER JOIN)
    #          DocumentChunk → KnowledgePoint → Chapter (OUTER JOIN, 知识点为可选)
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
        ch_id = row[3]  # chapter_id (nullable)
        ch_title = row[4]  # chapter_title (nullable)
        kp_id = row[5]  # kp_id (nullable)
        kp_title = row[6]  # kp_title (nullable)

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


async def process_document(
    document_id: uuid.UUID,
    course_id: uuid.UUID,
    file_path: str,
    file_type: str,
    db: AsyncSession,
):
    """
    文档处理流水线: 解析 → 切片 → 嵌入 → 存储
    解析和切片是必需的, 嵌入失败不影响切片保存
    在文档上传后调用, 同步执行所有步骤
    :param document_id: 文档 ID
    :param course_id: 课程 ID
    :param file_path: 文件路径
    :param file_type: 文件类型
    :param db: 数据库会话
    """
    from app.models.document import Document, DocumentChunk
    from app.services.document_parser import parse_file
    from app.services.chunker import RecursiveTextSplitter, estimate_token_count
    from app.core.config import settings as app_settings

    # 1. 更新状态为处理中
    doc = await db.get(Document, document_id)
    if not doc:
        logger.error(f"文档不存在: {document_id}")
        return
    doc.parse_status = "processing"
    await db.commit()

    try:
        # 2. 解析文档
        text = parse_file(file_path, file_type)
        if not text or not text.strip():
            raise ValueError("文档解析失败: 文档内容为空或无法提取文本")

        # 3. 文本切片
        splitter = RecursiveTextSplitter(
            chunk_size=app_settings.chunk_size,
            chunk_overlap=app_settings.chunk_overlap,
        )
        chunks = splitter.split_text(text)

        if not chunks:
            raise ValueError("文本切片失败: 切片结果为空")

        # 4. 写入数据库 (DocumentChunk) — 切片先保存, 嵌入失败也不丢数据
        chunk_records: list[DocumentChunk] = []
        chunk_ids: list[uuid.UUID] = []
        chunk_metadatas: list[dict] = []

        for idx, chunk_text in enumerate(chunks):
            chunk_id = uuid.uuid4()

            metadata = {
                "document_id": str(document_id),
                "course_id": str(course_id),
                "file_type": file_type,
            }

            chunk_record = DocumentChunk(
                id=chunk_id,
                document_id=document_id,
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
        logger.info(f"文档解析+切片完成: {document_id}, 切片数={len(chunks)}")

        # 5. 生成嵌入向量并写入 Chroma (此步骤可能因 API Key 问题而失败)
        try:
            embeddings = await embedder.embed_texts(chunks)

            vector_store.add_chunks(
                course_id=course_id,
                chunk_ids=chunk_ids,
                embeddings=embeddings,
                contents=chunks,
                metadatas=chunk_metadatas,
            )

            # 全部成功
            doc.parse_status = "done"
            logger.info(f"文档处理流水线全部完成: {document_id}")

        except Exception as embed_err:
            error_msg = str(embed_err)
            # 检查是否为 API Key 问题, 给出明确的错误提示
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
            logger.warning(f"向量化失败但切片已保存: {document_id}, 原因={error_msg}")

        await db.commit()

    except Exception as e:
        error_msg = str(e)
        logger.error(f"文档处理失败: {document_id}, 错误={error_msg}")
        doc.parse_status = "failed"
        doc.error_message = error_msg
        await db.commit()
