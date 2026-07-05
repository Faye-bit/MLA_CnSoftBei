"""
API v2 路由聚合
将 AI智学 子路由注册到统一的 v2 APIRouter 上

与 v1 完全隔离: /api/v1/learning (AI助学) vs /api/v2/zhixue (AI智学)
"""

from fastapi import APIRouter
from app.api.v2.zhixue import router as zhixue_router

# 创建 v2 版本聚合路由
api_v2_router = APIRouter(prefix="/api/v2")

# 注册子路由
api_v2_router.include_router(zhixue_router)
