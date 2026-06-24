"""
艾宾浩斯复习提醒 API 路由
提供学习记录、获取待复习列表、标记已复习等功能
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.schemas.common import ApiResponse
from app.api.deps import get_current_user
from app.services.review_service import (
    record_learning,
    get_pending_reviews,
    get_upcoming_reviews,
    mark_reviewed,
    mark_all_reviewed,
)
from pydantic import BaseModel, Field
from typing import Optional


router = APIRouter(prefix="/review", tags=["复习提醒"])


class RecordLearningRequest(BaseModel):
    """ 记录学习事件请求 """
    content_type: str = Field(..., description="内容类型: course_view / chapter_view / kp_view / chat / exercise / resource")
    content_title: str = Field(..., description="内容标题")
    course_id: Optional[uuid.UUID] = Field(default=None, description="关联课程 ID")
    knowledge_point_id: Optional[uuid.UUID] = Field(default=None, description="关联知识点 ID")
    duration_seconds: Optional[int] = Field(default=None, description="学习时长(秒)")


class MarkReviewRequest(BaseModel):
    """ 标记复习完成请求 """
    schedule_id: uuid.UUID = Field(..., description="复习计划 ID")


class ReviewItem(BaseModel):
    """ 单条复习提醒 """
    id: uuid.UUID
    content_title: str
    content_type: str
    interval_index: int
    interval_days: int
    review_at: str
    status: str
    reminded: bool

    model_config = {"from_attributes": True}


class ReviewPendingResponse(BaseModel):
    """ 待复习提醒响应 """
    pending: list[ReviewItem]
    upcoming: list[ReviewItem]
    total_pending: int
    total_upcoming: int


@router.post("/record", response_model=ApiResponse[dict], summary="记录学习行为")
async def api_record_learning(
    body: RecordLearningRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    记录一次学习活动并自动生成艾宾浩斯复习计划
    前端在以下场景调用:
      - 打开课程详情页 (content_type=course_view)
      - 浏览知识点弹窗 (content_type=kp_view)
      - 完成 AI 对话 (content_type=chat)
      - 做练习题 (content_type=exercise)
    """
    record = await record_learning(
        user_id=current_user.id,
        content_type=body.content_type,
        content_title=body.content_title,
        db=db,
        course_id=body.course_id,
        knowledge_point_id=body.knowledge_point_id,
        duration_seconds=body.duration_seconds,
    )
    return ApiResponse(
        data={"record_id": str(record.id), "schedules_count": 5},
        message="学习已记录, 复习计划已生成",
    )


@router.get("/pending", response_model=ApiResponse[ReviewPendingResponse], summary="获取待复习提醒")
async def api_get_pending(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取当前到期的复习提醒和即将到期的预告
    前端首页/登录后调用此接口判断是否需要弹窗
    """
    from app.models.review import EBBINGHAUS_INTERVALS

    pending = await get_pending_reviews(current_user.id, db)
    upcoming = await get_upcoming_reviews(current_user.id, db)

    def to_item(rv) -> ReviewItem:
        return ReviewItem(
            id=rv.id,
            content_title=rv.content_title,
            content_type=rv.content_type,
            interval_index=rv.interval_index,
            interval_days=EBBINGHAUS_INTERVALS[rv.interval_index],
            review_at=rv.review_at.isoformat(),
            status=rv.status,
            reminded=rv.reminded,
        )

    return ApiResponse(
        data=ReviewPendingResponse(
            pending=[to_item(r) for r in pending],
            upcoming=[to_item(r) for r in upcoming],
            total_pending=len(pending),
            total_upcoming=len(upcoming),
        ),
        message="获取成功",
    )


@router.post("/complete", response_model=ApiResponse[dict], summary="标记复习完成")
async def api_mark_reviewed(
    body: MarkReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """标记单条复习提醒为已完成"""
    result = await mark_reviewed(body.schedule_id, current_user.id, db)
    if not result:
        raise HTTPException(status_code=404, detail="提醒不存在或不属于当前用户")
    return ApiResponse(data={"schedule_id": str(result.id)}, message="已标记完成")


@router.post("/complete-all", response_model=ApiResponse[dict], summary="一键完成所有提醒")
async def api_mark_all(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """一键标记所有到期提醒为已完成"""
    count = await mark_all_reviewed(current_user.id, db)
    return ApiResponse(data={"count": count}, message=f"已标记 {count} 条提醒完成")
