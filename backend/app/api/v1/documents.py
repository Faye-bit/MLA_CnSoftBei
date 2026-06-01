"""
文档管理 API 路由
提供课程资料的上传、列表、详情、删除接口
上传后自动触发文档解析流水线
"""

import uuid
import os
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.models.course import Course
from app.models.document import Document, DocumentChunk
from app.schemas.common import PaginatedResponse, ApiResponse
from app.schemas.document import (
    DocumentResponse,
    DocumentDetailResponse,
    DocumentChunkResponse,
    DocumentUploadResponse,
)
from app.services.document_parser import detect_file_type
from app.services.retriever import process_document

router = APIRouter(prefix="/courses/{course_id}/documents", tags=["文档管理"])


@router.post("/upload", response_model=ApiResponse[DocumentUploadResponse], summary="上传文档")
async def upload_document(
    course_id: uuid.UUID,
    file: UploadFile = File(..., description="课程资料文件 (PDF/DOCX/PPTX/MD/TXT)"),
    db: AsyncSession = Depends(get_db),
):
    """
    上传课程资料文件并触发异步解析流水线
    支持格式: PDF, DOCX, PPTX, Markdown, TXT
    最大文件大小由 MAX_UPLOAD_SIZE_MB 配置控制
    """
    # 1. 确认课程存在
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

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
        filename=file.filename,
        file_type=file_type,
        file_size=len(content),
        file_path=file_path,
        parse_status="pending",
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    # 7. 同步触发文档处理流水线 (解析 → 切片 → 嵌入)
    await process_document(
        document_id=document.id,
        course_id=course_id,
        file_path=file_path,
        file_type=file_type,
        db=db,
    )

    # 重新获取更新后的文档状态
    await db.refresh(document)

    response = DocumentUploadResponse(
        document_id=document.id,
        filename=document.filename,
        file_type=document.file_type,
        file_size=document.file_size,
        parse_status=document.parse_status,
    )
    return ApiResponse(data=response, message="文件上传成功")


@router.get("/", response_model=ApiResponse[PaginatedResponse[DocumentResponse]], summary="文档列表")
async def list_documents(
    course_id: uuid.UUID,
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
):
    """ 分页查询课程下的文档列表, 显示解析状态 """
    # 确认课程存在
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

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
):
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
):
    """ 获取文档详情, 包含切片列表 """
    stmt = (
        select(Document)
        .where(Document.id == document_id, Document.course_id == course_id)
        .options(selectinload(Document.chunks))
    )
    result = await db.execute(stmt)
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")

    detail = DocumentDetailResponse(
        id=document.id,
        course_id=document.course_id,
        filename=document.filename,
        file_type=document.file_type,
        file_size=document.file_size,
        file_path=document.file_path,
        parse_status=document.parse_status,
        chunk_count=document.chunk_count,
        error_message=document.error_message,
        chunks=[DocumentChunkResponse.model_validate(chunk) for chunk in document.chunks],
        created_at=document.created_at,
        updated_at=document.updated_at,
    )
    return ApiResponse(data=detail)


@router.put("/chunks/{chunk_id}/link", response_model=ApiResponse, summary="关联切片到知识点")
async def link_chunk_to_kp(
    course_id: uuid.UUID,
    chunk_id: uuid.UUID,
    knowledge_point_id: uuid.UUID = Query(..., description="知识点 ID"),
    db: AsyncSession = Depends(get_db),
):
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
):
    """
    删除文档及其关联的切片和向量数据
    同时清理本地存储文件
    """
    from app.services.vector_store import vector_store

    document = await db.get(Document, document_id)
    if not document or document.course_id != course_id:
        raise HTTPException(status_code=404, detail="文档不存在")

    # 收集切片 ID 用于删除向量
    stmt = select(DocumentChunk.id).where(DocumentChunk.document_id == document_id)
    result = await db.execute(stmt)
    chunk_ids = [row[0] for row in result.all()]

    # 删除 Chroma 中的向量
    if chunk_ids:
        vector_store.remove_chunks(course_id, chunk_ids)

    # 删除本地文件
    if os.path.exists(document.file_path):
        os.remove(document.file_path)

    # 删除数据库记录 (级联删除切片)
    await db.delete(document)
    await db.commit()
    return ApiResponse(message="文档已删除, 关联切片和向量数据已清理")
