"""
用户相关 Schema
包含用户信息展示、资料更新、头像上传、管理员操作用户等 Pydantic 模型
"""

from typing import Optional
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class UserResponse(BaseModel):
    """
    用户信息响应 (不含密码哈希, 对外安全暴露)
    所有字段均来自 User ORM 模型, 使用 from_attributes=True 自动映射
    """
    id: uuid.UUID
    username: str
    email: str
    full_name: Optional[str] = None
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    school: Optional[str] = None
    major: Optional[str] = None
    grade: Optional[str] = None
    education_level: Optional[str] = None
    role: str
    email_verified: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserProfileUpdate(BaseModel):
    """
    用户个人资料更新请求
    仅允许修改本人可编辑的字段 (不包含角色、邮箱等敏感字段)
    """
    full_name: Optional[str] = Field(default=None, max_length=50, description="真实姓名")
    nickname: Optional[str] = Field(default=None, max_length=50, description="显示昵称")
    school: Optional[str] = Field(default=None, max_length=100, description="学校/学院")
    major: Optional[str] = Field(default=None, max_length=100, description="专业")
    grade: Optional[str] = Field(default=None, max_length=20, description="年级")
    education_level: Optional[str] = Field(default=None, max_length=20, description="学历层次")


class AvatarUploadResponse(BaseModel):
    """头像上传响应"""
    avatar_url: str = Field(..., description="头像访问 URL")
    message: str = Field(default="头像上传成功", description="操作结果")


class UserAdminUpdate(BaseModel):
    """
    管理员更新用户请求
    管理员可修改用户角色和邮箱验证状态等信息
    """
    full_name: Optional[str] = Field(default=None, max_length=50, description="真实姓名")
    nickname: Optional[str] = Field(default=None, max_length=50, description="显示昵称")
    school: Optional[str] = Field(default=None, max_length=100, description="学校/学院")
    major: Optional[str] = Field(default=None, max_length=100, description="专业")
    grade: Optional[str] = Field(default=None, max_length=20, description="年级")
    education_level: Optional[str] = Field(default=None, max_length=20, description="学历层次")
    role: Optional[str] = Field(
        default=None, pattern="^(student|teacher|admin)$",
        description="角色: student(学生) / teacher(教师) / admin(管理员)"
    )
    email_verified: Optional[bool] = Field(default=None, description="邮箱是否已验证")
