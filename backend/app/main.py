"""
MLA (Multiple Learning Agent) 智学引擎 - FastAPI 应用入口
启动: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import init_db, close_db
from app.api.v1.router import api_v1_router
from app.models import LearningSession, LearningStage, GeneratedResource, AgentTask  # noqa: F401  确保建表
from loguru import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI 应用生命周期管理
    启动时: 初始化数据库表
    关闭时: 释放数据库连接
    """
    logger.info(f"{settings.app_name} v{settings.app_version} 启动中...")
    await init_db()
    logger.info("数据库表初始化完成")
    # 从数据库加载用户自定义配置到内存缓存
    from app.core.database import async_session_factory
    from app.services.config_service import load_config_from_db
    async with async_session_factory() as session:
        await load_config_from_db(session)
    logger.info("运行时配置加载完成")
    yield
    await close_db()
    logger.info(f"{settings.app_name} 已关闭")


app = FastAPI(
    title=f"{settings.app_name} - 智学引擎",
    description="面向高校专业课程的个性化学习资源生成与智能辅导平台",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS 跨域配置 (开发阶段允许所有来源)
# 注意: allow_credentials=True 时不能使用 allow_origins=["*"],
# 必须明确指定允许的来源，否则浏览器会拦截跨域请求。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载头像静态文件目录
avatars_dir = Path(settings.upload_dir) / "avatars"
avatars_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads/avatars", StaticFiles(directory=str(avatars_dir)), name="avatars")

# 注册 v1 API 路由
app.include_router(api_v1_router)


@app.get("/", tags=["系统"])
async def root():
    """ 根路径: 返回系统基本信息 """
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "status": "running",
    }


@app.get("/health", tags=["系统"])
async def health_check():
    """ 健康检查接口 """
    return {"status": "healthy"}
