"""
API v1 路由聚合
将所有子路由注册到统一的 APIRouter 上
"""

from fastapi import APIRouter
from app.api.v1.courses import router as courses_router
from app.api.v1.documents import router as documents_router
from app.api.v1.retrieval import router as retrieval_router
from app.api.v1.config import router as config_router
from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router
from app.api.v1.audit_logs import router as audit_logs_router
from app.api.v1.stats import router as stats_router
from app.api.v1.chat import router as chat_router
from app.api.v1.profile import router as profile_router
from app.api.v1.learning import router as learning_router
from app.api.v1.todos import router as todos_router
from app.api.v1.tts import router as tts_router

# 创建 v1 版本聚合路由
api_v1_router = APIRouter(prefix="/api/v1")

# 注册子路由
api_v1_router.include_router(courses_router)
api_v1_router.include_router(documents_router)
api_v1_router.include_router(retrieval_router)
api_v1_router.include_router(config_router)
api_v1_router.include_router(auth_router)
api_v1_router.include_router(users_router)
api_v1_router.include_router(audit_logs_router)
api_v1_router.include_router(stats_router)
api_v1_router.include_router(chat_router)
api_v1_router.include_router(profile_router)
api_v1_router.include_router(learning_router)
api_v1_router.include_router(todos_router)
api_v1_router.include_router(tts_router)
