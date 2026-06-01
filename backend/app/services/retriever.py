"""
RAG 检索服务
整合嵌入生成和向量检索, 提供端到端的语义搜索能力
"""

import uuid
from typing import List, Optional
from dataclasses import dataclass
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.document import DocumentChunk, Document
from app.services.embedder import embedder
from app.services.vector_store import vector_store
from loguru import logger


@dataclass
class RetrievedChunk:
    """
    检索结果数据类
    封装一条检索结果的完整信息
    """
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_filename: str
    content: str
    score: float
    chunk_index: int
    metadata: dict


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
    3. 从数据库获取切片的完整信息 (文件名等)
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

    # Step 3: 从数据库获取切片详情
    chunk_ids = [uuid.UUID(r["id"]) for r in raw_results]

    # 构建 score 映射
    score_map = {r["id"]: r["score"] for r in raw_results}

    # 查询切片及其关联文档
    stmt = (
        select(DocumentChunk, Document.filename, Document.file_type)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(DocumentChunk.id.in_(chunk_ids))
    )
    result = await db.execute(stmt)
    rows = result.all()

    # 构建返回结果, 按原始相似度排序
    chunk_map: dict[uuid.UUID, RetrievedChunk] = {}
    for chunk, filename, file_type in rows:
        chunk_map[chunk.id] = RetrievedChunk(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            document_filename=filename,
            content=chunk.content,
            score=score_map.get(str(chunk.id), 0.0),
            chunk_index=chunk.chunk_index,
            metadata=chunk.chunk_metadata or {},
        )

    # 按 score 降序排列
    sorted_chunks = sorted(
        chunk_map.values(),
        key=lambda x: x.score,
        reverse=True,
    )

    logger.info(f"RAG 检索完成: {len(sorted_chunks)} 条结果")
    return sorted_chunks


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
