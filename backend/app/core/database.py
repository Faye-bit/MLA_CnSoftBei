"""
数据库连接模块
使用 SQLAlchemy 2.0 异步引擎管理 PostgreSQL 连接
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings


# 创建异步数据库引擎
# echo=settings.debug: 调试模式下打印 SQL 语句
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=10,        # 连接池大小
    max_overflow=20,     # 最大溢出连接数
)

# 异步会话工厂
# expire_on_commit=False: 提交后不使对象过期, 便于在事务外访问属性
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """
    SQLAlchemy 声明式基类
    所有 ORM 模型继承此类以统一元数据管理
    """
    pass


async def get_db() -> AsyncSession:
    """
    FastAPI 依赖注入: 获取数据库会话
    用法: db: AsyncSession = Depends(get_db)
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """
    初始化数据库: 创建所有 ORM 模型对应的表
    应在应用启动时调用一次
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    """ 关闭数据库引擎, 释放连接池资源 """
    await engine.dispose()
