"""
RAG 检索 API 路由
提供基于课程知识库的语义搜索接口
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.common import ApiResponse
from app.schemas.retrieval import RetrievalRequest, RetrievalResultItem, RetrievalResponse
from app.services.retriever import retrieve

router = APIRouter(prefix="/retrieval", tags=["RAG 检索"])


@router.post("/search", response_model=ApiResponse[RetrievalResponse], summary="语义检索")
async def search_knowledge(
    body: RetrievalRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    RAG 语义检索接口
    在指定课程的知识库中进行语义匹配, 返回最相关的文档切片
    每條结果包含: 切片内容、来源文档、相似度分数、元数据
    """
    # 执行 RAG 检索
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
