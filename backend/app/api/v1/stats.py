"""
仪表盘统计 API
提供首页仪表盘所需的汇总数据
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.course import Course
from app.models.document import Document, DocumentChunk
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/stats", tags=["仪表盘统计"])


@router.get("/", response_model=ApiResponse[dict], summary="仪表盘统计数据")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    返回仪表盘首页需要的汇总统计数据:
    - course_count: 课程总数
    - document_count: 文档总数
    - chunk_count: 切片总数 (从 document_chunks 表直接聚合)
    """
    # 课程总数
    course_count_result = await db.execute(select(func.count(Course.id)))
    course_count = course_count_result.scalar() or 0

    # 文档总数
    doc_count_result = await db.execute(select(func.count(Document.id)))
    document_count = doc_count_result.scalar() or 0

    # 切片总数: 从 document_chunks 表直接 COUNT, 避免用 documents.chunk_count 求和
    chunk_count_result = await db.execute(select(func.count(DocumentChunk.id)))
    chunk_count = chunk_count_result.scalar() or 0

    return ApiResponse(
        data={
            "course_count": course_count,
            "document_count": document_count,
            "chunk_count": chunk_count,
        }
    )
