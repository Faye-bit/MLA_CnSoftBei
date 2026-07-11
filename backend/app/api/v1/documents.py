"""
文档管理 API 路由
提供课程资料的上传、列表、详情、删除接口
上传后自动触发文档解析流水线 (后台异步执行)
Phase 3: 新增页面图片获取、页面关联知识点、页面级文档详情
"""

import uuid
import os
import asyncio
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db, async_session_factory
from app.core.config import settings
from app.models.course import Course, Chapter, KnowledgePoint
from app.models.document import Document, DocumentChunk
from app.models.document_page import DocumentPage, PageKnowledgePoint
from app.models.user import User
from app.schemas.common import PaginatedResponse, ApiResponse
from app.schemas.document import (
    DocumentResponse,
    DocumentDetailResponse,
    DocumentChunkResponse,
    DocumentPageResponse,
    DocumentUploadResponse,
    PageKnowledgePointLinkRequest,
)
from app.services.document_parser import detect_file_type
from app.services.retriever import process_document
from app.services.kp_extractor import extract_knowledge_points, batch_create_knowledge_points
from app.api.deps import get_current_user
from loguru import logger

router = APIRouter(prefix="/courses/{course_id}/documents", tags=["文档管理"])


async def _verify_course_owner(
    course_id: uuid.UUID, user: User, db: AsyncSession,
) -> Course:
    """ 验证课程存在且属于当前用户, 否则返回 404 """
    course = await db.get(Course, course_id)
    if not course or course.created_by != user.id:
        raise HTTPException(status_code=404, detail="课程不存在")
    return course


async def _background_process_document(
    document_id: uuid.UUID,
    course_id: uuid.UUID,
    file_path: str,
    file_type: str,
):
    """
    后台异步处理文档: 解析 → 切片/页面渲染 → 嵌入 → 知识点提取
    使用独立的数据库会话, 不阻塞上传请求的 HTTP 响应

    异常处理: 所有异常都会被捕获并记录日志, 不会导致后台任务崩溃
    """
    logger.info(f"后台任务启动: 文档 {document_id} 开始处理 (type={file_type})")
    async with async_session_factory() as db:
        try:
            await process_document(
                document_id=document_id,
                course_id=course_id,
                file_path=file_path,
                file_type=file_type,
                db=db,
            )
            await db.commit()
            logger.info(f"后台任务完成: 文档 {document_id} 处理成功")
        except Exception as e:
            await db.rollback()
            logger.error(f"后台任务失败: 文档 {document_id} 处理出错: {e}")
            # 更新文档状态为 failed
            from app.models.document import Document
            try:
                doc = await db.get(Document, document_id)
                if doc:
                    doc.parse_status = "failed"
                    doc.error_message = f"后台处理异常: {str(e)[:500]}"
                    await db.commit()
            except Exception as inner_e:
                logger.error(f"更新失败状态时出错: {inner_e}")


@router.post("/upload", response_model=ApiResponse[DocumentUploadResponse], summary="上传文档")
async def upload_document(
    course_id: uuid.UUID,
    file: UploadFile = File(..., description="课程资料文件 (PDF/DOCX/PPTX/MD/TXT)"),
    chapter_id: uuid.UUID | None = Query(default=None, description="所属章节 ID (可选, 将文档绑定到指定章节)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    上传课程资料文件并触发解析流水线, 仅课程所有者可操作
    可指定 chapter_id 将文档绑定到具体章节, LLM 提取的知识点将归入该章节
    """
    await _verify_course_owner(course_id, current_user, db)

    # 校验 chapter_id (如果提供)
    if chapter_id:
        chapter = await db.get(Chapter, chapter_id)
        if not chapter or chapter.course_id != course_id:
            raise HTTPException(status_code=400, detail="章节不存在或不属于该课程")

    # 2. 校验文件名
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 3. 检测文件类型
    try:
        file_type = detect_file_type(file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 4. 校验文件大小
    max_size = settings.max_upload_size_mb * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"文件大小超出限制: {len(content) / 1024 / 1024:.1f}MB > {settings.max_upload_size_mb}MB",
        )

    # 5. 保存文件到本地
    doc_id = uuid.uuid4()
    ext = os.path.splitext(file.filename)[1]
    stored_filename = f"{doc_id}{ext}"
    file_path = os.path.join(settings.upload_dir, stored_filename)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # 6. 创建文档记录
    document = Document(
        id=doc_id,
        course_id=course_id,
        chapter_id=chapter_id,
        filename=file.filename,
        file_type=file_type,
        file_size=len(content),
        file_path=file_path,
        parse_status="pending",
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    # 7. 后台异步触发文档处理流水线 (解析 → 切片 → 嵌入)
    #    不阻塞上传响应, 避免客户端超时
    asyncio.create_task(
        _background_process_document(
            document_id=document.id,
            course_id=course_id,
            file_path=file_path,
            file_type=file_type,
        )
    )

    response = DocumentUploadResponse(
        document_id=document.id,
        filename=document.filename,
        file_type=document.file_type,
        file_size=document.file_size,
        parse_status=document.parse_status,
    )
    return ApiResponse(data=response, message="文件上传成功，正在后台解析处理...")


@router.get("/", response_model=ApiResponse[PaginatedResponse[DocumentResponse]], summary="文档列表")
async def list_documents(
    course_id: uuid.UUID,
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 分页查询课程文档列表, 仅课程所有者可访问 """
    await _verify_course_owner(course_id, current_user, db)

    # 查询总数
    count_query = select(func.count(Document.id)).where(Document.course_id == course_id)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 分页查询
    offset = (page - 1) * page_size
    stmt = (
        select(Document)
        .where(Document.course_id == course_id)
        .order_by(Document.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    documents = result.scalars().all()

    total_pages = (total + page_size - 1) // page_size
    paginated = PaginatedResponse(
        items=list(documents), total=total, page=page, page_size=page_size, total_pages=total_pages
    )
    return ApiResponse(data=paginated)


@router.get("/knowledge-points", response_model=ApiResponse[list], summary="获取课程所有知识点(供关联选择)")
async def get_course_knowledge_points(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _verify_course_owner(course_id, current_user, db)
    """
    获取课程下所有知识点 (含章节信息), 用于切片关联时的下拉选择
    """
    from app.models.course import KnowledgePoint, Chapter
    stmt = (
        select(KnowledgePoint, Chapter.title)
        .join(Chapter, KnowledgePoint.chapter_id == Chapter.id)
        .where(Chapter.course_id == course_id)
        .order_by(Chapter.order_index)
    )
    result = await db.execute(stmt)
    rows = result.all()
    items = [
        {
            "knowledge_point_id": str(kp.id),
            "title": kp.title,
            "chapter_title": chapter_title,
            "chapter_id": str(kp.chapter_id),
        }
        for kp, chapter_title in rows
    ]
    return ApiResponse(data=items)


@router.get("/{document_id}", response_model=ApiResponse[DocumentDetailResponse], summary="文档详情")
async def get_document(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 获取文档详情, 仅课程所有者可访问。PDF/PPTX 返回页面列表, DOCX/MD/TXT 返回切片列表 """
    await _verify_course_owner(course_id, current_user, db)

    # 根据 file_type 加载不同的关联关系
    doc = await db.get(Document, document_id)
    if not doc or doc.course_id != course_id:
        raise HTTPException(status_code=404, detail="文档不存在")

    chunks: list[DocumentChunkResponse] = []
    pages: list[DocumentPageResponse] = []

    if doc.file_type.lower() in ("pdf", "pptx"):
        # 加载页面列表及其关联的知识点
        stmt = (
            select(DocumentPage)
            .where(DocumentPage.document_id == document_id)
            .order_by(DocumentPage.page_number)
        )
        result = await db.execute(stmt)
        db_pages = result.scalars().all()

        # 收集所有页面关联的知识点 ID
        all_page_ids = [p.id for p in db_pages]
        page_kp_map: dict[uuid.UUID, list[str]] = {}
        if all_page_ids:
            kp_stmt = (
                select(PageKnowledgePoint)
                .where(PageKnowledgePoint.document_page_id.in_(all_page_ids))
            )
            kp_result = await db.execute(kp_stmt)
            for pkp in kp_result.scalars().all():
                if pkp.document_page_id not in page_kp_map:
                    page_kp_map[pkp.document_page_id] = []
                page_kp_map[pkp.document_page_id].append(str(pkp.knowledge_point_id))

        # 构建图片 URL 的辅助函数
        def _page_image_url(page: DocumentPage) -> str:
            return (
                f"/api/v1/courses/{course_id}/documents/"
                f"{document_id}/pages/{page.page_number}/image"
            )

        pages = [
            DocumentPageResponse(
                id=page.id,
                page_number=page.page_number,
                image_url=_page_image_url(page),
                summary=page.summary,
                extracted_kps=page.extracted_kps or [],
                linked_kp_ids=page_kp_map.get(page.id, []),
                created_at=page.created_at,
            )
            for page in db_pages
        ]
    else:
        # 加载切片列表 (原有逻辑)
        stmt = (
            select(Document)
            .where(Document.id == document_id, Document.course_id == course_id)
            .options(selectinload(Document.chunks))
        )
        result = await db.execute(stmt)
        doc_with_chunks = result.scalar_one_or_none()
        if doc_with_chunks:
            chunks = [
                DocumentChunkResponse.model_validate(chunk)
                for chunk in doc_with_chunks.chunks
            ]

    detail = DocumentDetailResponse(
        id=doc.id,
        course_id=doc.course_id,
        filename=doc.filename,
        file_type=doc.file_type,
        file_size=doc.file_size,
        file_path=doc.file_path,
        parse_status=doc.parse_status,
        chunk_count=doc.chunk_count,
        page_count=doc.page_count,
        kp_count=doc.kp_count,
        error_message=doc.error_message,
        chunks=chunks,
        pages=pages,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )
    return ApiResponse(data=detail)


@router.put("/chunks/{chunk_id}/link", response_model=ApiResponse, summary="关联切片到知识点")
async def link_chunk_to_kp(
    course_id: uuid.UUID,
    chunk_id: uuid.UUID,
    knowledge_point_id: uuid.UUID = Query(..., description="知识点 ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _verify_course_owner(course_id, current_user, db)
    """
    将文档切片关联到指定知识点
    关联后检索结果可展示结构化来源 (章节/知识点)
    """
    chunk = await db.get(DocumentChunk, chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail="切片不存在")

    # 校验知识点存在
    from app.models.course import KnowledgePoint
    kp = await db.get(KnowledgePoint, knowledge_point_id)
    if not kp:
        raise HTTPException(status_code=404, detail="知识点不存在")

    chunk.knowledge_point_id = knowledge_point_id
    await db.commit()
    return ApiResponse(message="切片已关联到知识点")


@router.delete("/{document_id}", response_model=ApiResponse, summary="删除文档")
async def delete_document(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _verify_course_owner(course_id, current_user, db)
    """
    删除文档及其关联的切片/页面和向量数据
    同时清理本地存储文件 (包括页面图片目录)
    """
    from app.services.vector_store import vector_store

    document = await db.get(Document, document_id)
    if not document or document.course_id != course_id:
        raise HTTPException(status_code=404, detail="文档不存在")

    # 收集需要删除的向量 ID (切片 + 页面)
    ids_to_remove: list[uuid.UUID] = []

    # 收集切片 ID
    stmt = select(DocumentChunk.id).where(DocumentChunk.document_id == document_id)
    result = await db.execute(stmt)
    for row in result.all():
        ids_to_remove.append(row[0])

    # 收集页面 ID (PDF/PPTX 文档)
    stmt = select(DocumentPage.id).where(DocumentPage.document_id == document_id)
    result = await db.execute(stmt)
    for row in result.all():
        ids_to_remove.append(row[0])

    # 删除 Chroma 中的向量
    if ids_to_remove:
        vector_store.remove_chunks(course_id, ids_to_remove)

    # 删除本地文件
    if os.path.exists(document.file_path):
        os.remove(document.file_path)

    # 删除页面图片目录 (如果存在)
    pages_dir = os.path.join(settings.upload_dir, str(document_id), "pages")
    if os.path.exists(pages_dir):
        import shutil
        shutil.rmtree(pages_dir)

    # 清理临时目录 (PPTX 转换残留)
    temp_dir = os.path.join(settings.upload_dir, str(document_id))
    if os.path.exists(temp_dir) and not os.listdir(temp_dir):
        os.rmdir(temp_dir)

    # 删除数据库记录 (级联删除切片和页面)
    await db.delete(document)
    await db.commit()
    return ApiResponse(message="文档已删除, 关联数据和向量已清理")


@router.put("/{document_id}/link-chapter", response_model=ApiResponse[dict], summary="关联文档到章节并自动分类")
async def link_document_to_chapter(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    chapter_id: uuid.UUID = Query(..., description="目标章节 ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 将已有文档关联到指定章节, 并自动对该章节知识点运行 AI 分类 """
    await _verify_course_owner(course_id, current_user, db)
    document = await db.get(Document, document_id)
    if not document or document.course_id != course_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.course_id != course_id:
        raise HTTPException(status_code=404, detail="章节不存在")
    document.chapter_id = chapter_id
    await db.commit()

    # 如果文档有页面但无知识点记录, 先运行知识点融合 (fuse_knowledge_points)
    classify_result = {"category_count": 0, "item_count": 0}
    try:
        from app.services.kp_extractor import classify_knowledge_points, batch_create_tree_knowledge_points
        from app.services.page_kp_service import fuse_knowledge_points
        from app.models.course import KnowledgePoint
        from app.models.document_page import PageKnowledgePoint, DocumentPage

        # 检查是否有页面数据但无关联知识点
        page_count_stmt = select(DocumentPage.id).where(DocumentPage.document_id == document_id).limit(1)
        has_pages = (await db.execute(page_count_stmt)).scalar_one_or_none() is not None

        linked_kp_stmt = (
            select(PageKnowledgePoint.knowledge_point_id)
            .join(DocumentPage, PageKnowledgePoint.document_page_id == DocumentPage.id)
            .where(DocumentPage.document_id == document_id)
            .limit(1)
        )
        has_linked_kps = (await db.execute(linked_kp_stmt)).scalar_one_or_none() is not None

        # 有页面但没关联知识点 → 运行融合
        if has_pages and not has_linked_kps:
            logger.info(f"文档 {document_id}: 有页面无知识点, 运行 fuse_knowledge_points")
            kp_count = await fuse_knowledge_points(document_id, course_id, db)
            logger.info(f"文档 {document_id}: fuse 完成, 创建 {kp_count} 个知识点")

        # 迁移该文档关联的知识点到目标章节
        pkp_stmt = (
            select(PageKnowledgePoint.knowledge_point_id)
            .join(DocumentPage, PageKnowledgePoint.document_page_id == DocumentPage.id)
            .where(DocumentPage.document_id == document_id)
        )
        pkp_result = await db.execute(pkp_stmt)
        related_kp_ids = [row[0] for row in pkp_result.all()]
        if related_kp_ids:
            kp_stmt = select(KnowledgePoint).where(KnowledgePoint.id.in_(related_kp_ids))
            kp_result = await db.execute(kp_stmt)
            for kp in kp_result.scalars().all():
                kp.chapter_id = chapter_id
            await db.flush()

        # 对目标章节所有知识点进行分类
        stmt = select(KnowledgePoint).where(KnowledgePoint.chapter_id == chapter_id)
        r = await db.execute(stmt)
        kps = list(r.scalars().all())
        if len(kps) >= 2:
            kp_dicts = [{"title": k.title, "description": k.description or "", "difficulty": k.difficulty} for k in kps]
            classified = await classify_knowledge_points(kp_dicts)
            if classified:
                classify_result = await batch_create_tree_knowledge_points(chapter_id, classified, db)
    except Exception as e:
        logger.warning(f"关联后分类失败: {e}")

    return ApiResponse(
        data={"document_id": str(document_id), "chapter_id": str(chapter_id), **classify_result},
        message=f"已关联到章节「{chapter.title}」, 分类: {classify_result['category_count']} 组 {classify_result['item_count']} 个"
    )


# ==================== 页面级 API (Phase 3) ====================


@router.get("/{document_id}/pages/{page_number}/image", summary="获取页面图片")
async def get_page_image(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    page_number: int,
    db: AsyncSession = Depends(get_db),
):
    """
    获取文档指定页面的 PNG 图片

    无需登录认证: 页面 ID (UUID) 不可猜测, 通过 URL 中的 course_id/document_id/page_number
    三重验证足以保证安全性。图片用于 <img> 标签直接加载, 无法携带 JWT 头。

    缓存: 响应头 Cache-Control: private, max-age=86400 (浏览器缓存 1 天)
    """
    # 通过 document 和 course 关系验证页面存在且属于该课程
    stmt = (
        select(DocumentPage)
        .join(Document, DocumentPage.document_id == Document.id)
        .where(
            DocumentPage.document_id == document_id,
            DocumentPage.page_number == page_number,
            Document.course_id == course_id,
        )
    )
    result = await db.execute(stmt)
    page = result.scalar_one_or_none()

    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    # 检查图片文件是否存在
    if not os.path.exists(page.image_path):
        raise HTTPException(status_code=404, detail="页面图片文件不存在")

    # 返回图片文件, 设置缓存头
    return FileResponse(
        page.image_path,
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=86400",
        },
    )


@router.put("/pages/{page_id}/link-kp", response_model=ApiResponse, summary="关联页面到知识点")
async def link_page_to_kp(
    course_id: uuid.UUID,
    page_id: uuid.UUID,
    body: PageKnowledgePointLinkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    将文档页面关联到已有知识点 (用户手动关联或确认 LLM 的自动提取结果)

    会先清除页面现有的知识点关联, 再创建新的关联
    """
    await _verify_course_owner(course_id, current_user, db)

    # 确认页面存在
    page = await db.get(DocumentPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    # 确认页面所属文档属于该课程
    stmt = select(Document).where(
        Document.id == page.document_id,
        Document.course_id == course_id,
    )
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="页面不属于该课程")

    # 验证所有知识点存在
    kp_ids = body.knowledge_point_ids
    kp_stmt = select(KnowledgePoint).where(KnowledgePoint.id.in_(kp_ids))
    kp_result = await db.execute(kp_stmt)
    existing_kps = kp_result.scalars().all()
    if len(existing_kps) != len(kp_ids):
        raise HTTPException(status_code=400, detail="部分知识点不存在")

    # 清除页面现有的关联
    del_stmt = select(PageKnowledgePoint).where(
        PageKnowledgePoint.document_page_id == page_id
    )
    del_result = await db.execute(del_stmt)
    for existing_link in del_result.scalars().all():
        await db.delete(existing_link)

    # 创建新的关联
    for kp_id in kp_ids:
        link = PageKnowledgePoint(
            document_page_id=page_id,
            knowledge_point_id=kp_id,
        )
        db.add(link)

    await db.commit()
    return ApiResponse(message=f"页面已关联到 {len(kp_ids)} 个知识点")


@router.post("/{document_id}/extract-kp", response_model=ApiResponse[dict], summary="从文档自动提取知识点")
async def extract_kp_from_document(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    chapter_id: uuid.UUID = Query(..., description="目标章节 ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _verify_course_owner(course_id, current_user, db)
    """
    LLM 读取文档切片内容, 自动识别并提取结构化知识点
    提取结果包含知识点名称、描述、难度和关联的切片列表
    前端可展示预览让用户确认后再批量创建
    """
    # 确认文档存在且属于该课程
    document = await db.get(Document, document_id)
    if not document or document.course_id != course_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    if document.chunk_count == 0:
        raise HTTPException(status_code=400, detail="文档尚未完成解析, 无切片可用")

    try:
        kp_list = await extract_knowledge_points(
            document_id=document_id,
            chapter_id=chapter_id,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return ApiResponse(
        data={"kp_list": kp_list, "chapter_id": str(chapter_id)},
        message=f"提取完成, 共识别 {len(kp_list)} 个知识点",
    )


@router.post("/{document_id}/create-kp", response_model=ApiResponse[dict], summary="批量创建提取的知识点")
async def create_extracted_kp(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _verify_course_owner(course_id, current_user, db)
    """
    将用户确认后的知识点批量写入数据库, 并自动关联切片
    Body: {"chapter_id": "uuid", "kp_list": [{title, description, difficulty, chunk_ids}]}
    """
    chapter_id = uuid.UUID(body["chapter_id"])
    kp_list = body.get("kp_list", [])

    if not kp_list:
        raise HTTPException(status_code=400, detail="知识点列表为空")

    created = await batch_create_knowledge_points(chapter_id, kp_list, db)
    return ApiResponse(
        data={"created_count": len(created)},
        message=f"成功创建 {len(created)} 个知识点并关联切片",
    )


@router.post("/{document_id}/reprocess", response_model=ApiResponse[dict], summary="重新向量化文档")
async def reprocess_document(
    course_id: uuid.UUID,
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    对解析完成但向量化失败的文档 (chunked/failed 状态) 重新执行向量化

    适用于: 配置好 Embedding API Key 后, 对之前因 API 配置错误而卡在
    「待向量化」状态的文档进行补救, 无需删除和重新上传。

    处理逻辑:
    - chunked 文档: 读取已有切片, 重新调用 embedding → 写入 Chroma → 状态更新为 done
    - failed 文档: 同上
    - 其他状态: 返回 400 错误
    """
    await _verify_course_owner(course_id, current_user, db)

    document = await db.get(Document, document_id)
    if not document or document.course_id != course_id:
        raise HTTPException(status_code=404, detail="文档不存在")

    if document.parse_status not in ("chunked", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"文档当前状态为「{document.parse_status}」，无需重新向量化。仅 chunked 或 failed 状态的文档可重试。",
        )

    # 根据文档类型加载数据
    if document.file_type.lower() in ("txt", "docx", "md"):
        # 切片型文档: 加载已有切片重新向量化
        stmt = select(DocumentChunk).where(DocumentChunk.document_id == document_id).order_by(DocumentChunk.chunk_index)
        result = await db.execute(stmt)
        chunks = result.scalars().all()

        if not chunks:
            raise HTTPException(status_code=400, detail="文档无可用切片，请重新上传")

        chunk_texts = [chunk.content for chunk in chunks]
        chunk_ids = [chunk.id for chunk in chunks]
        chunk_metadatas = [chunk.chunk_metadata or {} for chunk in chunks]

        try:
            from app.services.embedder import embedder
            from app.services.vector_store import vector_store

            # 先移除旧的向量数据 (如果存在)
            try:
                vector_store.remove_chunks(course_id, chunk_ids)
            except Exception:
                pass  # 旧数据可能不存在, 忽略

            # 重新生成 embedding 并写入 Chroma
            embeddings = await embedder.embed_texts(chunk_texts)
            vector_store.add_chunks(
                course_id=course_id,
                chunk_ids=chunk_ids,
                embeddings=embeddings,
                contents=chunk_texts,
                metadatas=chunk_metadatas,
            )

            # 嵌入成功后 → 自动提取知识点 (对齐主上传流程)
            kp_count = 0
            try:
                from app.services.config_service import get_config_value
                from app.services.kp_extractor import (
                    extract_knowledge_points, batch_create_knowledge_points,
                    classify_knowledge_points, batch_create_tree_knowledge_points,
                )

                llm_api_key = get_config_value("llm_api_key")
                if llm_api_key:
                    # 确定目标章节
                    target_chapter_id = document.chapter_id
                    if not target_chapter_id:
                        from app.models.course import Chapter
                        ch_stmt = select(Chapter).where(
                            Chapter.course_id == course_id, Chapter.title == "自动提取"
                        )
                        ch_result = await db.execute(ch_stmt)
                        default_ch = ch_result.scalar_one_or_none()
                        if default_ch:
                            target_chapter_id = default_ch.id

                    if target_chapter_id:
                        kp_list = await extract_knowledge_points(document.id, target_chapter_id, db)
                        logger.info(f"文档重新处理: 提取到 {len(kp_list)} 个知识点")

                        if kp_list:
                            created_kps = await batch_create_knowledge_points(
                                target_chapter_id, kp_list, db
                            )
                            kp_count = len(created_kps)

                            # 树形分类
                            if kp_count > 1:
                                try:
                                    from app.models.course import KnowledgePoint as KPModel
                                    kp_stmt = select(KPModel).where(
                                        KPModel.chapter_id == target_chapter_id
                                    )
                                    kp_result = await db.execute(kp_stmt)
                                    flat_kps = list(kp_result.scalars().all())
                                    if len(flat_kps) >= 2:
                                        kp_dicts = [
                                            {"title": k.title, "description": k.description or "",
                                             "difficulty": k.difficulty}
                                            for k in flat_kps
                                        ]
                                        classified = await classify_knowledge_points(kp_dicts)
                                        if classified:
                                            await batch_create_tree_knowledge_points(
                                                target_chapter_id, classified, db
                                            )
                                except Exception as tree_err:
                                    logger.warning(f"知识树构建失败: {tree_err}")
                else:
                    logger.info(f"文档重新处理: 未配置 LLM, 跳过知识点提取")
            except Exception as kp_err:
                logger.warning(f"文档重新处理: 知识点提取失败: {kp_err}")

            document.parse_status = "done"
            document.kp_count = kp_count
            document.error_message = None
            await db.commit()
            logger.info(f"文档重新向量化成功: {document_id}, 切片数={len(chunks)}, 知识点数={kp_count}")

            return ApiResponse(
                data={"parse_status": "done", "chunk_count": len(chunks), "kp_count": kp_count},
                message=f"向量化成功，{len(chunks)} 个切片已写入向量数据库，提取 {kp_count} 个知识点",
            )

        except Exception as embed_err:
            await db.rollback()
            error_msg = str(embed_err)
            logger.error(f"文档重新向量化失败: {document_id}, 原因={error_msg}")

            # 更新错误信息但不改变状态
            document = await db.get(Document, document_id)
            if document:
                if "api" in error_msg.lower() or "key" in error_msg.lower() or "auth" in error_msg.lower() or "connection" in error_msg.lower():
                    document.error_message = (
                        f"向量化失败: {error_msg}。"
                        f"请在「设置」页面检查 Embedding API Key / API 地址 / 模型名称 是否正确配置。"
                    )
                else:
                    document.error_message = f"向量化失败: {error_msg}"
                await db.commit()

            raise HTTPException(status_code=502, detail=f"向量化失败: {error_msg}")

    elif document.file_type.lower() in ("pdf", "pptx"):
        # 页面型文档: 暂不支持单独重试, 提示用户重新上传
        raise HTTPException(
            status_code=400,
            detail="PDF/PPTX 文档暂不支持单独重试向量化，请删除后重新上传。",
        )
    else:
        raise HTTPException(status_code=400, detail=f"不支持的文档类型: {document.file_type}")
