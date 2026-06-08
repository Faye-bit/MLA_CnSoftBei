"""
RAG 检索 API 路由
提供基于课程知识库的语义搜索接口, 仅可检索用户自己的课程
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.course import Course
from app.models.user import User
from app.schemas.common import ApiResponse
from app.schemas.retrieval import RetrievalRequest, RetrievalResultItem, RetrievalResponse
from app.services.retriever import retrieve
from app.api.deps import get_current_user

router = APIRouter(prefix="/retrieval", tags=["RAG 检索"])


@router.post("/search", response_model=ApiResponse[RetrievalResponse], summary="语义检索")
async def search_knowledge(
    body: RetrievalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    RAG 语义检索: 仅可在用户自己的课程中进行语义匹配
    """
    # 验证课程属于当前用户 (body.course_id 已是 UUID 对象, 无需转换)
    course = await db.get(Course, body.course_id)
    if not course or course.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="课程不存在")

    results = await retrieve(
        query=body.query,
        course_id=body.course_id,
        db=db,
        top_k=body.top_k,
    )

    # 构建响应
    items = [
        RetrievalResultItem(
            chunk_id=r.chunk_id,
            document_id=r.document_id,
            document_filename=r.document_filename,
            content=r.content,
            score=r.score,
            chunk_index=r.chunk_index,
            metadata=r.metadata,
        )
        for r in results
    ]

    response = RetrievalResponse(
        query=body.query,
        course_id=body.course_id,
        results=items,
        total=len(items),
    )
    return ApiResponse(data=response, message=f"检索完成，找到 {len(items)} 条相关结果")
