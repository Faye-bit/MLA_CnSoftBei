"""
课程管理 API 路由
提供课程、章节、知识点的 CRUD 操作接口
"""

import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.course import Course, Chapter, KnowledgePoint
from app.models.document import Document
from app.schemas.common import PaginatedResponse, ApiResponse
from app.schemas.course import (
    CourseCreate, CourseUpdate, CourseResponse, CourseDetailResponse,
    ChapterCreate, ChapterUpdate, ChapterResponse,
    KnowledgePointCreate, KnowledgePointUpdate, KnowledgePointResponse,
)

router = APIRouter(prefix="/courses", tags=["课程管理"])


# ==================== 课程 (Course) CRUD ====================

@router.post("/", response_model=ApiResponse[CourseResponse], summary="创建课程")
async def create_course(
    body: CourseCreate,
    db: AsyncSession = Depends(get_db),
):
    """ 创建一门新课程, 返回课程详情 """
    course = Course(
        name=body.name,
        description=body.description,
        cover_image=body.cover_image,
    )
    db.add(course)
    await db.flush()
    await db.refresh(course)
    return ApiResponse(data=course, message="课程创建成功")


@router.get("/", response_model=ApiResponse[PaginatedResponse[CourseResponse]], summary="课程列表")
async def list_courses(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    keyword: Optional[str] = Query(default=None, description="搜索关键词"),
    db: AsyncSession = Depends(get_db),
):
    """ 分页查询课程列表, 支持关键词搜索 """
    # 构建查询
    base_query = select(Course)
    count_query = select(func.count(Course.id))

    if keyword:
        filter_clause = Course.name.ilike(f"%{keyword}%")
        base_query = base_query.where(filter_clause)
        count_query = count_query.where(filter_clause)

    # 统计总数
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 分页查询
    offset = (page - 1) * page_size
    base_query = base_query.order_by(Course.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(base_query)
    courses = result.scalars().all()

    # 为每个课程附加章节数和文档数
    items: list[CourseResponse] = []
    for c in courses:
        # 统计章节数
        chapter_count_result = await db.execute(
            select(func.count(Chapter.id)).where(Chapter.course_id == c.id)
        )
        chapter_count = chapter_count_result.scalar() or 0
        # 统计文档数
        doc_count_result = await db.execute(
            select(func.count(Document.id)).where(Document.course_id == c.id)
        )
        doc_count = doc_count_result.scalar() or 0
        items.append(CourseResponse(
            id=c.id,
            name=c.name,
            description=c.description,
            cover_image=c.cover_image,
            created_by=c.created_by,
            chapter_count=chapter_count,
            document_count=doc_count,
            created_at=c.created_at,
            updated_at=c.updated_at,
        ))

    total_pages = (total + page_size - 1) // page_size
    paginated = PaginatedResponse(
        items=items, total=total, page=page, page_size=page_size, total_pages=total_pages
    )
    return ApiResponse(data=paginated)


@router.get("/{course_id}", response_model=ApiResponse[CourseDetailResponse], summary="课程详情")
async def get_course(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """ 获取课程详情, 包含章节列表 """
    # 预加载章节和文档数量
    stmt = select(Course).where(Course.id == course_id).options(
        selectinload(Course.chapters).selectinload(Chapter.knowledge_points)
    )
    result = await db.execute(stmt)
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    # 统计文档数
    doc_count_result = await db.execute(
        select(func.count(Document.id)).where(Document.course_id == course.id)
    )
    doc_count = doc_count_result.scalar() or 0

    # 构建章节响应
    chapter_responses: list[ChapterResponse] = []
    for ch in course.chapters:
        chapter_responses.append(ChapterResponse(
            id=ch.id,
            course_id=ch.course_id,
            title=ch.title,
            description=ch.description,
            order_index=ch.order_index,
            knowledge_point_count=len(ch.knowledge_points),
            created_at=ch.created_at,
        ))

    detail = CourseDetailResponse(
        id=course.id,
        name=course.name,
        description=course.description,
        cover_image=course.cover_image,
        created_by=course.created_by,
        chapter_count=len(course.chapters),
        document_count=doc_count,
        chapters=chapter_responses,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )
    return ApiResponse(data=detail)


@router.put("/{course_id}", response_model=ApiResponse[CourseResponse], summary="更新课程")
async def update_course(
    course_id: uuid.UUID,
    body: CourseUpdate,
    db: AsyncSession = Depends(get_db),
):
    """ 更新课程的基本信息 """
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    if body.name is not None:
        course.name = body.name
    if body.description is not None:
        course.description = body.description
    if body.cover_image is not None:
        course.cover_image = body.cover_image

    await db.flush()
    await db.refresh(course)
    return ApiResponse(data=course, message="课程更新成功")


@router.delete("/{course_id}", response_model=ApiResponse, summary="删除课程")
async def delete_course(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """ 删除课程及其关联的所有章节、知识点和文档 """
    from app.services.vector_store import vector_store

    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    # 删除 Chroma 向量数据
    vector_store.delete_collection(course_id)

    await db.delete(course)
    await db.flush()
    return ApiResponse(message="课程已删除")


# ==================== 章节 (Chapter) CRUD ====================

@router.post("/{course_id}/chapters", response_model=ApiResponse[ChapterResponse], summary="创建章节")
async def create_chapter(
    course_id: uuid.UUID,
    body: ChapterCreate,
    db: AsyncSession = Depends(get_db),
):
    """ 为指定课程创建新章节 """
    # 确认课程存在
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    chapter = Chapter(
        course_id=course_id,
        title=body.title,
        description=body.description,
        order_index=body.order_index,
    )
    db.add(chapter)
    await db.flush()
    await db.refresh(chapter)

    response = ChapterResponse(
        id=chapter.id,
        course_id=chapter.course_id,
        title=chapter.title,
        description=chapter.description,
        order_index=chapter.order_index,
        knowledge_point_count=0,
        created_at=chapter.created_at,
    )
    return ApiResponse(data=response, message="章节创建成功")


@router.get("/{course_id}/chapters", response_model=ApiResponse[list[ChapterResponse]], summary="章节列表")
async def list_chapters(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """ 获取指定课程的所有章节, 按 order_index 排序 """
    stmt = (
        select(Chapter)
        .where(Chapter.course_id == course_id)
        .options(selectinload(Chapter.knowledge_points))
        .order_by(Chapter.order_index)
    )
    result = await db.execute(stmt)
    chapters = result.scalars().all()

    items: list[ChapterResponse] = []
    for ch in chapters:
        items.append(ChapterResponse(
            id=ch.id,
            course_id=ch.course_id,
            title=ch.title,
            description=ch.description,
            order_index=ch.order_index,
            knowledge_point_count=len(ch.knowledge_points),
            created_at=ch.created_at,
        ))
    return ApiResponse(data=items)


@router.put("/chapters/{chapter_id}", response_model=ApiResponse[ChapterResponse], summary="更新章节")
async def update_chapter(
    chapter_id: uuid.UUID,
    body: ChapterUpdate,
    db: AsyncSession = Depends(get_db),
):
    """ 更新章节信息 """
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    if body.title is not None:
        chapter.title = body.title
    if body.description is not None:
        chapter.description = body.description
    if body.order_index is not None:
        chapter.order_index = body.order_index

    await db.flush()
    await db.refresh(chapter)
    return ApiResponse(data=chapter, message="章节更新成功")


@router.delete("/chapters/{chapter_id}", response_model=ApiResponse, summary="删除章节")
async def delete_chapter(
    chapter_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """ 删除章节及其关联的知识点 """
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    await db.delete(chapter)
    await db.flush()
    return ApiResponse(message="章节已删除")


# ==================== 知识点 (KnowledgePoint) CRUD ====================

@router.post("/chapters/{chapter_id}/knowledge-points", response_model=ApiResponse[KnowledgePointResponse], summary="创建知识点")
async def create_knowledge_point(
    chapter_id: uuid.UUID,
    body: KnowledgePointCreate,
    db: AsyncSession = Depends(get_db),
):
    """ 为指定章节创建新知识点 """
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    kp = KnowledgePoint(
        chapter_id=chapter_id,
        title=body.title,
        description=body.description,
        content=body.content,
        prerequisite_kp_id=body.prerequisite_kp_id,
        difficulty=body.difficulty,
    )
    db.add(kp)
    await db.flush()
    await db.refresh(kp)
    return ApiResponse(data=kp, message="知识点创建成功")


@router.get("/chapters/{chapter_id}/knowledge-points", response_model=ApiResponse[list[KnowledgePointResponse]], summary="知识点列表")
async def list_knowledge_points(
    chapter_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """ 获取指定章节的所有知识点 """
    stmt = select(KnowledgePoint).where(KnowledgePoint.chapter_id == chapter_id)
    result = await db.execute(stmt)
    kps = result.scalars().all()
    return ApiResponse(data=list(kps))


@router.put("/knowledge-points/{kp_id}", response_model=ApiResponse[KnowledgePointResponse], summary="更新知识点")
async def update_knowledge_point(
    kp_id: uuid.UUID,
    body: KnowledgePointUpdate,
    db: AsyncSession = Depends(get_db),
):
    """ 更新知识点信息 """
    kp = await db.get(KnowledgePoint, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="知识点不存在")

    if body.title is not None:
        kp.title = body.title
    if body.description is not None:
        kp.description = body.description
    if body.content is not None:
        kp.content = body.content
    if body.prerequisite_kp_id is not None:
        kp.prerequisite_kp_id = body.prerequisite_kp_id
    if body.difficulty is not None:
        kp.difficulty = body.difficulty

    await db.flush()
    await db.refresh(kp)
    return ApiResponse(data=kp, message="知识点更新成功")


@router.delete("/knowledge-points/{kp_id}", response_model=ApiResponse, summary="删除知识点")
async def delete_knowledge_point(
    kp_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """ 删除知识点 """
    kp = await db.get(KnowledgePoint, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="知识点不存在")
    await db.delete(kp)
    await db.flush()
    return ApiResponse(message="知识点已删除")
