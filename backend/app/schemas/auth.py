"""
认证相关 Schema
包含注册、登录、验证码、密码重置的请求和响应 Pydantic 模型
"""

from typing import Optional
from pydantic import BaseModel, Field, EmailStr
from app.schemas.user import UserResponse


# ==================== 验证码 ====================

class SendCodeRequest(BaseModel):
    """发送验证码请求: 邮箱 + 用途"""
    email: EmailStr = Field(..., description="邮箱地址")
    purpose: str = Field(
        ..., pattern="^(register|reset_password)$",
        description="用途: register(注册) 或 reset_password(重置密码)"
    )


class VerifyCodeRequest(BaseModel):
    """验证邮箱验证码请求"""
    email: EmailStr = Field(..., description="邮箱地址")
    code: str = Field(..., min_length=6, max_length=6, description="6位数字验证码")
    purpose: str = Field(
        ..., pattern="^(register|reset_password)$",
        description="验证码用途"
    )


# ==================== 注册 ====================

class RegisterRequest(BaseModel):
    """用户注册请求: 邮箱+密码+基本信息+验证码"""
    email: EmailStr = Field(..., description="邮箱地址 (QQ邮箱)")
    username: str = Field(..., min_length=3, max_length=50, description="用户名, 3-50字符")
    password: str = Field(..., min_length=6, max_length=128, description="登录密码, 6-128字符")
    full_name: Optional[str] = Field(default=None, max_length=50, description="真实姓名")
    school: Optional[str] = Field(default=None, max_length=100, description="学校/学院")
    major: Optional[str] = Field(default=None, max_length=100, description="专业")
    grade: Optional[str] = Field(default=None, max_length=20, description="年级")
    education_level: Optional[str] = Field(default=None, max_length=20, description="学历层次")
    role: str = Field(
        default="student",
        pattern="^(student|teacher)$",
        description="角色: student(学生) 或 teacher(教师)"
    )
    verification_code: str = Field(..., min_length=6, max_length=6, description="6位邮箱验证码")


# ==================== 登录 ====================

class LoginRequest(BaseModel):
    """登录请求: 邮箱+密码"""
    email: EmailStr = Field(..., description="邮箱地址")
    password: str = Field(..., min_length=6, max_length=128, description="登录密码")


class TokenResponse(BaseModel):
    """JWT Token 响应: 包含 access_token 和用户信息"""
    access_token: str = Field(..., description="JWT 访问令牌")
    token_type: str = Field(default="bearer", description="令牌类型")
    user: UserResponse = Field(..., description="当前用户信息")


# ==================== 密码重置 ====================

class ResetPasswordRequest(BaseModel):
    """重置密码请求: 邮箱+验证码+新密码"""
    email: EmailStr = Field(..., description="邮箱地址")
    verification_code: str = Field(..., min_length=6, max_length=6, description="6位邮箱验证码")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码, 6-128字符")


# ==================== 消息响应 ====================

class MessageResponse(BaseModel):
    """通用消息响应"""
    message: str = Field(..., description="操作结果消息")
