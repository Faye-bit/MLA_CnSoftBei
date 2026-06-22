"""
仪表盘增强统计 Schema
定义今日待办、本周学习情况、我的收藏等个性化数据的 Pydantic 模型
"""

from typing import Optional
from pydantic import BaseModel, Field


class TodoItem(BaseModel):
    """
    统一待办项
    双源合并: learning_stage (自动生成) 和 custom (用户自定义)
    """
    source: str = Field(..., description="待办来源: learning_stage 或 custom")

    # learning_stage 专属字段
    stage_id: Optional[str] = Field(None, description="学习阶段 UUID (source=learning_stage 时)")
    session_id: Optional[str] = Field(None, description="学习会话 UUID (source=learning_stage 时)")
    course_name: Optional[str] = Field(None, description="课程名称 (source=learning_stage 时)")
    description: Optional[str] = Field(None, description="阶段描述 (source=learning_stage 时)")
    order_index: Optional[int] = Field(None, description="阶段排序序号 (source=learning_stage 时)")

    # custom 专属字段
    todo_id: Optional[str] = Field(None, description="待办 UUID (source=custom 时)")

    # 公共字段
    title: str = Field(..., description="待办标题")
    is_completed: bool = Field(default=False, description="是否已完成")


class TodayStatsResponse(BaseModel):
    """
    今日待办响应
    包含今日活动汇总和双源合并的待办列表
    """
    today_messages: int = Field(default=0, description="今日发送的消息数")
    today_completed_stages: int = Field(default=0, description="今日完成的学习阶段数")
    items: list[TodoItem] = Field(default_factory=list, description="待办项列表")


class DailyActivity(BaseModel):
    """
    单日学习活动统计
    记录某一天用户的消息数、完成阶段数和综合活动分
    """
    date: str = Field(..., description="日期 YYYY-MM-DD")
    day_name: str = Field(..., description="星期名称: 周一/周二/...")
    message_count: int = Field(default=0, description="消息数")
    stage_count: int = Field(default=0, description="完成阶段数")
    activity_score: int = Field(default=0, description="活动分 = 消息数 + 阶段数")


class WeeklyStatsResponse(BaseModel):
    """
    本周学习情况响应
    包含本周每日活动数据和周汇总
    """
    days: list[DailyActivity] = Field(default_factory=list, description="每日活动列表 (周一~周日)")
    week_total_messages: int = Field(default=0, description="本周消息总数")
    week_total_stages: int = Field(default=0, description="本周完成阶段总数")


class FavoriteItem(BaseModel):
    """
    收藏项
    用户已收藏的学习会话摘要
    """
    session_id: str = Field(..., description="学习会话 UUID")
    course_id: str = Field(..., description="课程 UUID")
    course_name: Optional[str] = Field(None, description="课程名称")
    status: str = Field(..., description="会话状态: active/completed/paused")
    current_stage_index: int = Field(default=0, description="当前阶段序号")
    total_stages: int = Field(default=0, description="总阶段数")
    completed_stages: int = Field(default=0, description="已完成阶段数")
    progress_percent: int = Field(default=0, description="进度百分比 0-100")
    updated_at: Optional[str] = Field(None, description="最后更新时间 ISO 格式")


class FavoritesResponse(BaseModel):
    """
    收藏列表响应
    """
    favorites: list[FavoriteItem] = Field(default_factory=list, description="收藏项列表")
