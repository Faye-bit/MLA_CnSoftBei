"""
学生画像 API 路由
提供画像查看、手动编辑和从对话中提取画像的接口
"""

import uuid
import traceback
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.models.profile import StudentProfile
from app.models.conversation import Conversation
from app.schemas.common import ApiResponse
from app.schemas.profile import (
    ProfileUpdate,
    ProfileExtractionRequest,
    ProfileResponse,
    ProfileVersionResponse,
    RadarResponse,
)
from app.services.profile_service import (
    get_or_create_profile,
    update_profile_from_edits,
    extract_profile_from_conversation,
    rebuild_profile_from_memories,
)
from app.services.radar_service import get_radar_data
from app.api.deps import get_current_user
from loguru import logger

router = APIRouter(prefix="/profile", tags=["学生画像"])


@router.get("/", response_model=ApiResponse[ProfileResponse], summary="获取当前用户画像")
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取当前登录用户的画像
    如果尚未创建画像, 自动创建空画像并返回
    """
    profile = await get_or_create_profile(current_user.id, db)
    return ApiResponse(
        data=ProfileResponse(
            id=profile.id,
            user_id=profile.user_id,
            profile_data=profile.profile_data,
            missing_fields=profile.missing_fields,
            summary=profile.summary,
            memories=profile.memories,
            version=profile.version,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        ),
        message="获取成功",
    )


@router.put("/", response_model=ApiResponse[ProfileResponse], summary="手动更新画像")
async def update_my_profile(
    body: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    手动编辑画像的指定维度
    传入的字段会与现有数据做增量合并, 不会覆盖未传入的维度
    """
    update_data = {}
    if body.profile_data:
        update_data = body.profile_data
    if body.summary:
        update_data["summary"] = body.summary

    if not update_data:
        raise HTTPException(status_code=400, detail="请提供要更新的画像数据")

    profile = await update_profile_from_edits(current_user.id, update_data, db)

    return ApiResponse(
        data=ProfileResponse(
            id=profile.id,
            user_id=profile.user_id,
            profile_data=profile.profile_data,
            missing_fields=profile.missing_fields,
            summary=profile.summary,
            memories=profile.memories,
            version=profile.version,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        ),
        message="画像更新成功",
    )


@router.post("/rebuild", response_model=ApiResponse[ProfileResponse], summary="从记忆重建画像")
async def rebuild_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    基于用户已有的记忆片段重建描述式画像
    调用 LLM 将记忆按 6 个维度归类为描述文本
    """
    try:
        profile = await rebuild_profile_from_memories(current_user.id, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"画像重建失败: {str(e)}")

    return ApiResponse(
        data=ProfileResponse(
            id=profile.id,
            user_id=profile.user_id,
            profile_data=profile.profile_data,
            missing_fields=profile.missing_fields,
            summary=profile.summary,
            memories=profile.memories,
            version=profile.version,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        ),
        message="画像重建成功",
    )


@router.post("/extract", response_model=ApiResponse[ProfileResponse], summary="从对话提取画像 (兼容旧接口)")
async def extract_profile(
    body: ProfileExtractionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    从指定的对话历史中提取/更新学生画像
    使用 LLM 分析对话内容, 提取 8 个画像维度的结构化数据
    """
    # 验证对话属于当前用户
    conversation = await db.get(Conversation, body.conversation_id)
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    try:
        profile = await extract_profile_from_conversation(body.conversation_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return ApiResponse(
        data=ProfileResponse(
            id=profile.id,
            user_id=profile.user_id,
            profile_data=profile.profile_data,
            missing_fields=profile.missing_fields,
            summary=profile.summary,
            memories=profile.memories,
            version=profile.version,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        ),
        message="画像提取成功",
    )


@router.get("/versions", response_model=ApiResponse[list[ProfileVersionResponse]], summary="画像版本历史")
async def get_profile_versions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取用户画像的版本历史 (当前只返回当前版本信息)
    注: 当前版本只保留最新画像, version 号递增但不存储历史快照
    如需完整历史可扩展 profile_versions 表
    """
    profile = await get_or_create_profile(current_user.id, db)
    return ApiResponse(
        data=[
            ProfileVersionResponse(
                version=profile.version,
                created_at=profile.updated_at or profile.created_at,
                summary=profile.summary,
            )
        ],
        message="获取成功",
    )


@router.get("/radar", summary="获取学习行为雷达图")
async def get_study_radar(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取当前用户的学习行为雷达图数据
    基于近 30 天平台行为统计, 6 个维度 0-10 分
    """
    try:
        radar = await get_radar_data(current_user.id, db)
        result = {
            "dimensions": [],
            "overall_score": 0.0,
            "updated_at": "",
            "data_available": False,
        }
        for dim in radar.get("dimensions", []):
            result["dimensions"].append({
                "key": str(dim.get("key", "")),
                "label": str(dim.get("label", "")),
                "score": float(dim.get("score", 0)),
                "tooltip": str(dim.get("tooltip", "")),
                "icon": str(dim.get("icon", "")),
            })
        result["overall_score"] = float(radar.get("overall_score", 0))
        result["updated_at"] = str(radar.get("updated_at", ""))
        result["data_available"] = bool(radar.get("data_available", False))
        return ApiResponse(data=result, message="雷达图数据获取成功")
    except Exception as e:
        logger.error(f"雷达图接口异常: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"雷达图获取失败: {str(e)}")


@router.delete("/", response_model=ApiResponse[None], summary="重置画像")
async def delete_my_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    删除当前用户的画像 (重置为空)
    """
    stmt = select(StudentProfile).where(StudentProfile.user_id == current_user.id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    if profile:
        await db.delete(profile)
        await db.commit()

    return ApiResponse(data=None, message="画像已重置")
