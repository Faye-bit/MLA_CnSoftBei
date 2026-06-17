"""
数据库迁移: 清理 LearningStage 重复行并添加唯一约束

问题背景:
  SSE 重连可能导致同一 (session_id, order_index) 存在多条 LearningStage 记录,
  使 scalar_one_or_none() 抛出 "Multiple rows were found" 错误。

执行方式:
  cd backend && PYTHONPATH=. python -m app.core.migrate_001_fix_duplicate_stages

注意:
  asyncpg 不支持 DO $$ ... END $$ 语法 ($$ 被误解析为占位符),
  因此迁移分步执行, 每步使用独立的 SQL 语句。
"""

import asyncio
from app.core.database import engine, async_session_factory
from sqlalchemy import text


async def run_migration():
    """执行迁移: 清理重复 + 创建唯一约束 (已支持幂等)"""
    async with async_session_factory() as db:
        # Step 1: 删除重复 stage (保留 created_at 最新的)
        await db.execute(text("""
            DELETE FROM learning_stages
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY session_id, order_index
                               ORDER BY created_at DESC
                           ) AS rn
                    FROM learning_stages
                ) sub
                WHERE rn > 1
            )
        """))
        print("Step 1: 重复阶段已清理")

        # Step 2: 清理孤儿资源 (父阶段已被删除)
        await db.execute(text("""
            DELETE FROM generated_resources
            WHERE stage_id NOT IN (SELECT id FROM learning_stages)
        """))
        print("Step 2: 孤儿资源已清理")

        # Step 3: 清理孤儿智能体任务
        await db.execute(text("""
            DELETE FROM agent_tasks
            WHERE resource_id NOT IN (SELECT id FROM generated_resources)
        """))
        print("Step 3: 孤儿任务已清理")

        # Step 4: 添加唯一约束 (先检测是否存在, 支持幂等)
        check = await db.execute(text(
            "SELECT 1 FROM pg_constraint WHERE conname = 'uq_learning_stage_session_order'"
        ))
        if not check.fetchone():
            await db.execute(text(
                "ALTER TABLE learning_stages "
                "ADD CONSTRAINT uq_learning_stage_session_order "
                "UNIQUE (session_id, order_index)"
            ))
            print("Step 4: 唯一约束已创建")
        else:
            print("Step 4: 唯一约束已存在, 跳过")

        await db.commit()

        # 验证
        result = await db.execute(text(
            "SELECT COUNT(*) FROM ("
            "  SELECT session_id, order_index, COUNT(*) as cnt "
            "  FROM learning_stages "
            "  GROUP BY session_id, order_index "
            "  HAVING COUNT(*) > 1"
            ") dupes"
        ))
        dupe_count = result.scalar()
        if dupe_count == 0:
            print("✅ 迁移成功: 无重复阶段, 唯一约束已生效")
        else:
            print(f"⚠️  仍有 {dupe_count} 组重复, 请手动检查")


if __name__ == "__main__":
    asyncio.run(run_migration())
