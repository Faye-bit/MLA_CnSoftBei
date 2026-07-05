"""
AI智学 会话服务
管理 ZhiXueSession 的创建、查询、更新操作
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.zhixue import ZhiXueSession
from loguru import logger


async def create_zhixue_session(
    user_id: str,
    course_id: str,
    selected_materials: list[str],
    scouting_enabled: bool,
    db: AsyncSession,
) -> ZhiXueSession:
    """
    创建新的智学会话

    :param user_id: 用户 ID
    :param course_id: 课程 ID
    :param selected_materials: 用户选择的材料类型
    :param scouting_enabled: 是否开启采风
    :param db: 数据库会话
    :return: 新创建的 ZhiXueSession 实例
    """
    import uuid

    session = ZhiXueSession(
        id=uuid.uuid4(),
        user_id=uuid.UUID(user_id),
        course_id=uuid.UUID(course_id),
        status="idle",
        current_stage_index=0,
        selected_materials=selected_materials,
        scouting_enabled=scouting_enabled,
        difficulty_adjustment=0.5,
        checkpoint_thread_id=str(uuid.uuid4()),
        session_metadata={"phase": "init"},
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info(
        f"智学会话创建: id={session.id}, "
        f"user={user_id}, course={course_id}, "
        f"materials={selected_materials}"
    )
    return session


async def get_zhixue_session(
    session_id: str,
    db: AsyncSession,
) -> Optional[ZhiXueSession]:
    """获取智学会话"""
    import uuid
    return await db.get(ZhiXueSession, uuid.UUID(session_id))
