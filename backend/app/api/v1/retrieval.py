"""
RAG 检索 API 路由
提供基于课程知识库的语义搜索接口, 仅可检索用户自己的课程
Phase 2: 支持 LLM 增强检索 (提取核心观点、关键词、去重合并)
Phase 3: 支持页面级检索 (PDF/PPTX 文档返回页面图片 + 知识点标签)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.models.course import Course
from app.models.user import User
from app.schemas.common import ApiResponse
from app.schemas.retrieval import (
    RetrievalRequest, RetrievalResultItem, RetrievalResponse, PageRetrievalResultItem,
)
from app.services.retriever import retrieve, apply_threshold, enhance_retrieve, retrieve_pages
from app.api.deps import get_current_user

router = APIRouter(prefix="/retrieval", tags=["RAG 检索"])


@router.post("/search", response_model=ApiResponse[RetrievalResponse], summary="语义检索")
async def search_knowledge(
    body: RetrievalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    RAG 语义检索: 仅在用户自己的课程中进行语义匹配

    Phase 3: 同时检索文本切片 (chunk) 和页面 (page), 返回混合结果
      - 页面级结果 (PDF/PPTX): 返回页面图片 URL + 知识点标签
      - 切片级结果 (DOCX/MD/TXT): 返回文本片段

    Phase 2 增强模式 (body.enhance=True):
    - 文本清洗: 去除 PDF 解析残留 (页码、断行、空白)
    - LLM 二次加工: 提取每个切片的核心观点和关键词
    - 智能去重: 自动识别并合并语义重复的结果
    - 关键词高亮: 标注查询词在文本中的位置
    - 来源关联: 返回切片所属章节和知识点信息

    基础模式 (body.enhance=False, 默认):
    - 快速返回原始检索结果, 低延迟
    """
    # 验证课程属于当前用户 (body.course_id 已是 UUID 对象, 无需转换)
    course = await db.get(Course, body.course_id)
    if not course or course.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="课程不存在")

    # Phase 3: 同时检索页面和切片
    page_results = await retrieve_pages(
        query=body.query,
        course_id=body.course_id,
        db=db,
        top_k=body.top_k,
    )

    # 构建页面级检索结果 item
    def _page_image_url(page_result) -> str:
        return (
            f"/api/v1/courses/{body.course_id}/documents/"
            f"{page_result.document_id}/pages/{page_result.page_number}/image"
        )

    page_items = [
        PageRetrievalResultItem(
            result_type="page",
            page_id=r.page_id,
            document_id=r.document_id,
            document_name=r.document_name,
            page_number=r.page_number,
            image_url=_page_image_url(r),
            summary=r.summary,
            score=r.score,
            knowledge_points=r.knowledge_points,
        )
        for r in page_results
    ]

    # Phase 2: 根据 enhance 标志选择切片检索路径
    if body.enhance:
        # 增强模式: LLM 二次加工 + 阈值过滤 + 文本清洗 + 去重合并
        enhanced_results, dedup_count = await enhance_retrieve(
            query=body.query,
            course_id=body.course_id,
            db=db,
            top_k=body.top_k,
            similarity_threshold=body.similarity_threshold,
        )

        items = [
            RetrievalResultItem(
                # 基础字段
                chunk_id=r.chunk_id,
                document_id=r.document_id,
                document_filename=r.document_filename,
                content=r.content,  # 已清洗
                score=r.score,
                chunk_index=r.chunk_index,
                metadata=r.metadata,
                # 来源上下文
                chapter_title=r.chapter_title,
                chapter_id=r.chapter_id,
                knowledge_point_title=r.knowledge_point_title,
                knowledge_point_id=r.knowledge_point_id,
                # LLM 增强
                enhanced_summary=r.enhanced_summary,
                keywords=r.keywords,
                highlights=r.highlights,
            )
            for r in enhanced_results
        ]

        response = RetrievalResponse(
            query=body.query,
            course_id=body.course_id,
            results=items,
            total=len(items),
            enhanced=True,
            deduplicated_count=dedup_count,
            page_results=page_items,
            page_total=len(page_items),
        )
        total_count = len(items) + len(page_items)
        return ApiResponse(
            data=response,
            message=f"AI 增强检索完成，找到 {total_count} 条结果"
                    + (f"（已合并 {dedup_count} 条重复）" if dedup_count > 0 else "")
                    + (f"（含 {len(page_items)} 条页面结果）" if page_items else "")
        )

    else:
        # 基础模式: 原始 RAG 检索 + 可选的阈值过滤
        results = await retrieve(
            query=body.query,
            course_id=body.course_id,
            db=db,
            top_k=body.top_k,
        )

        # 应用阈值过滤
        results = apply_threshold(results, body.similarity_threshold)

        items = [
            RetrievalResultItem(
                chunk_id=r.chunk_id,
                document_id=r.document_id,
                document_filename=r.document_filename,
                content=r.content,
                score=r.score,
                chunk_index=r.chunk_index,
                metadata=r.metadata,
                # 基础模式也返回来源上下文 (SQL 已包含 JOIN)
                chapter_title=r.chapter_title,
                chapter_id=r.chapter_id,
                knowledge_point_title=r.knowledge_point_title,
                knowledge_point_id=r.knowledge_point_id,
            )
            for r in results
        ]

        response = RetrievalResponse(
            query=body.query,
            course_id=body.course_id,
            results=items,
            total=len(items),
            enhanced=False,
            deduplicated_count=0,
            page_results=page_items,
            page_total=len(page_items),
        )
        total_count = len(items) + len(page_items)
        return ApiResponse(
            data=response,
            message=f"检索完成，找到 {total_count} 条相关结果"
                    + (f"（含 {len(page_items)} 条页面结果）" if page_items else "")
        )
