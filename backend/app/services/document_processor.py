"""
文档处理流水线
负责文档解析、文本切片/页面渲染、知识点提取和向量嵌入的全流程编排
从 retriever.py 拆分, Phase 3
"""

import uuid
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentChunk
from app.models.document_page import DocumentPage
from app.models.course import Chapter, KnowledgePoint
from app.services.embedder import embedder
from app.services.vector_store import vector_store
from loguru import logger


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
