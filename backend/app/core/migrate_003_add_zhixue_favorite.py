"""
数据库迁移: zhixue_sessions 表新增 is_favorited 字段

新增字段:
  - is_favorited (BOOLEAN) — 用户是否收藏此智学会话, 默认 False

执行方式:
  cd backend && PYTHONPATH=. python -m app.core.migrate_003_add_zhixue_favorite

幂等: 字段添加前先检测是否存在, 已存在则跳过
"""

import asyncio
from app.core.database import async_session_factory
from sqlalchemy import text


NEW_COLUMNS = [
    ("is_favorited", "BOOLEAN NOT NULL DEFAULT FALSE"),
]


async def migrate():
    async with async_session_factory() as session:
        for col_name, col_def in NEW_COLUMNS:
            # 检查字段是否已存在
            check_sql = text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'zhixue_sessions' AND column_name = :col"
            )
            result = await session.execute(check_sql, {"col": col_name})
            if result.scalar():
                print(f"[SKIP] 字段 {col_name} 已存在, 跳过")
                continue

            # 添加字段
            add_sql = text(
                f"ALTER TABLE zhixue_sessions ADD COLUMN {col_name} {col_def}"
            )
            await session.execute(add_sql)
            await session.commit()
            print(f"[OK] 字段 {col_name} 添加成功")


if __name__ == "__main__":
    asyncio.run(migrate())
