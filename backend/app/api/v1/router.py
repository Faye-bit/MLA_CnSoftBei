"""
API v1 路由聚合
将所有子路由注册到统一的 APIRouter 上
"""

from fastapi import APIRouter
from app.api.v1.courses import router as courses_router
from app.api.v1.documents import router as documents_router
from app.api.v1.retrieval import router as retrieval_router

# 创建 v1 版本聚合路由
api_v1_router = APIRouter(prefix="/api/v1")

# 注册子路由
api_v1_router.include_router(courses_router)
api_v1_router.include_router(documents_router)
api_v1_router.include_router(retrieval_router)
