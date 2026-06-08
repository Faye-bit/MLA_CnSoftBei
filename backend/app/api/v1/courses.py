"""
课程管理 API 路由
提供课程、章节、知识点的 CRUD 操作接口
所有接口均做用户隔离: 普通用户仅可操作自己的课程
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
from app.models.user import User
from app.schemas.common import PaginatedResponse, ApiResponse
from app.schemas.course import (
    CourseCreate, CourseUpdate, CourseResponse, CourseDetailResponse,
    ChapterCreate, ChapterUpdate, ChapterResponse,
    KnowledgePointCreate, KnowledgePointUpdate, KnowledgePointResponse,
)
from app.api.deps import get_current_user

router = APIRouter(prefix="/courses", tags=["课程管理"])


async def _get_owned_course(
    course_id: uuid.UUID, user: User, db: AsyncSession,
) -> Course:
    """
    获取课程并校验所有权: 课程不存在或不属于当前用户均返回 404
    (统一返回 404 防止通过错误码泄露课程存在性)
    """
    course = await db.get(Course, course_id)
    if not course or course.created_by != user.id:
        raise HTTPException(status_code=404, detail="课程不存在")
    return course


async def _get_owned_chapter(
    chapter_id: uuid.UUID, user: User, db: AsyncSession,
) -> Chapter:
    """ 获取章节并通过其课程校验所有权 """
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    # 通过课程校验所有权
    await _get_owned_course(chapter.course_id, user, db)
    return chapter


# ==================== 课程 (Course) CRUD ====================

@router.post("/", response_model=ApiResponse[CourseResponse], summary="创建课程")
async def create_course(
    body: CourseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 创建一门新课程, 自动关联当前用户 """
    course = Course(
        name=body.name,
        description=body.description,
        cover_image=body.cover_image,
        created_by=current_user.id,
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
    current_user: User = Depends(get_current_user),
):
    """ 分页查询当前用户的课程列表, 支持关键词搜索 """
    # 构建查询 — 仅查当前用户的课程
    base_query = select(Course).where(Course.created_by == current_user.id)
    count_query = select(func.count(Course.id)).where(Course.created_by == current_user.id)

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
        chapter_count_result = await db.execute(
            select(func.count(Chapter.id)).where(Chapter.course_id == c.id)
        )
        chapter_count = chapter_count_result.scalar() or 0
        doc_count_result = await db.execute(
            select(func.count(Document.id)).where(Document.course_id == c.id)
        )
        doc_count = doc_count_result.scalar() or 0
        items.append(CourseResponse(
            id=c.id, name=c.name, description=c.description,
            cover_image=c.cover_image, created_by=c.created_by,
            chapter_count=chapter_count, document_count=doc_count,
            created_at=c.created_at, updated_at=c.updated_at,
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
    current_user: User = Depends(get_current_user),
):
    """ 获取课程详情, 仅所有者可访问 """
    course = await _get_owned_course(course_id, current_user, db)

    stmt = select(Course).where(Course.id == course_id).options(
        selectinload(Course.chapters).selectinload(Chapter.knowledge_points)
    )
    result = await db.execute(stmt)
    course = result.scalar_one()

    doc_count_result = await db.execute(
        select(func.count(Document.id)).where(Document.course_id == course.id)
    )
    doc_count = doc_count_result.scalar() or 0

    chapter_responses: list[ChapterResponse] = []
    for ch in course.chapters:
        chapter_responses.append(ChapterResponse(
            id=ch.id, course_id=ch.course_id, title=ch.title,
            description=ch.description, order_index=ch.order_index,
            knowledge_point_count=len(ch.knowledge_points), created_at=ch.created_at,
        ))

    detail = CourseDetailResponse(
        id=course.id, name=course.name, description=course.description,
        cover_image=course.cover_image, created_by=course.created_by,
        chapter_count=len(course.chapters), document_count=doc_count,
        chapters=chapter_responses, created_at=course.created_at, updated_at=course.updated_at,
    )
    return ApiResponse(data=detail)


@router.put("/{course_id}", response_model=ApiResponse[CourseResponse], summary="更新课程")
async def update_course(
    course_id: uuid.UUID,
    body: CourseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 更新课程信息, 仅所有者可操作 """
    course = await _get_owned_course(course_id, current_user, db)

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
    current_user: User = Depends(get_current_user),
):
    """ 删除课程及关联数据, 仅所有者可操作 """
    from app.services.vector_store import vector_store

    course = await _get_owned_course(course_id, current_user, db)

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
    current_user: User = Depends(get_current_user),
):
    """ 为指定课程创建新章节, 仅课程所有者可操作 """
    await _get_owned_course(course_id, current_user, db)

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
        id=chapter.id, course_id=chapter.course_id,
        title=chapter.title, description=chapter.description,
        order_index=chapter.order_index, knowledge_point_count=0,
        created_at=chapter.created_at,
    )
    return ApiResponse(data=response, message="章节创建成功")


@router.get("/{course_id}/chapters", response_model=ApiResponse[list[ChapterResponse]], summary="章节列表")
async def list_chapters(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 获取课程章节列表, 仅课程所有者可访问 """
    await _get_owned_course(course_id, current_user, db)

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
            id=ch.id, course_id=ch.course_id, title=ch.title,
            description=ch.description, order_index=ch.order_index,
            knowledge_point_count=len(ch.knowledge_points), created_at=ch.created_at,
        ))
    return ApiResponse(data=items)


@router.put("/chapters/{chapter_id}", response_model=ApiResponse[ChapterResponse], summary="更新章节")
async def update_chapter(
    chapter_id: uuid.UUID,
    body: ChapterUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 更新章节信息, 仅章节所属课程的所有者可操作 """
    chapter = await _get_owned_chapter(chapter_id, current_user, db)

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
    current_user: User = Depends(get_current_user),
):
    """ 删除章节及关联知识点, 仅章节所属课程的所有者可操作 """
    chapter = await _get_owned_chapter(chapter_id, current_user, db)
    await db.delete(chapter)
    await db.flush()
    return ApiResponse(message="章节已删除")


# ==================== 知识点 (KnowledgePoint) CRUD ====================

async def _get_owned_kp(
    kp_id: uuid.UUID, user: User, db: AsyncSession,
) -> KnowledgePoint:
    """ 获取知识点并通过其章节的课程校验所有权 """
    kp = await db.get(KnowledgePoint, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="知识点不存在")
    # 通过章节的课程校验所有权
    await _get_owned_chapter(kp.chapter_id, user, db)
    return kp


@router.post("/chapters/{chapter_id}/knowledge-points", response_model=ApiResponse[KnowledgePointResponse], summary="创建知识点")
async def create_knowledge_point(
    chapter_id: uuid.UUID,
    body: KnowledgePointCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 为指定章节创建新知识点, 仅章节所属课程的所有者可操作 """
    await _get_owned_chapter(chapter_id, current_user, db)

    kp = KnowledgePoint(
        chapter_id=chapter_id, title=body.title, description=body.description,
        content=body.content, prerequisite_kp_id=body.prerequisite_kp_id,
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
    current_user: User = Depends(get_current_user),
):
    """ 获取知识点列表, 仅章节所属课程的所有者可访问 """
    await _get_owned_chapter(chapter_id, current_user, db)

    stmt = select(KnowledgePoint).where(KnowledgePoint.chapter_id == chapter_id)
    result = await db.execute(stmt)
    kps = result.scalars().all()
    return ApiResponse(data=list(kps))


@router.put("/knowledge-points/{kp_id}", response_model=ApiResponse[KnowledgePointResponse], summary="更新知识点")
async def update_knowledge_point(
    kp_id: uuid.UUID,
    body: KnowledgePointUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ 更新知识点信息, 仅知识点所属课程的所有者可操作 """
    kp = await _get_owned_kp(kp_id, current_user, db)

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
    current_user: User = Depends(get_current_user),
):
    """ 删除知识点, 仅知识点所属课程的所有者可操作 """
    kp = await _get_owned_kp(kp_id, current_user, db)
    await db.delete(kp)
    await db.flush()
    return ApiResponse(message="知识点已删除")
