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
