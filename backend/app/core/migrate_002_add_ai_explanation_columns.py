"""
数据库迁移: knowledge_points 表新增 AI 解释字段 (快问AI 功能)

新增字段:
  - ai_explanation (TEXT) — AI 生成的简洁解释
  - ai_explanation_generated_at (TIMESTAMPTZ) — 生成时间
  - ai_explanation_query (TEXT) — 触发该解释的原始用户提问
  - ai_explanation_report_count (INTEGER) — 不准确报告计数
  - ai_explanation_model (VARCHAR(50)) — 生成使用的模型

执行方式:
  cd backend && PYTHONPATH=. python -m app.core.migrate_002_add_ai_explanation_columns

幂等: 每个字段添加前先检测是否存在, 已存在则跳过
"""

import asyncio
from app.core.database import async_session_factory
from sqlalchemy import text


# 新增字段定义
NEW_COLUMNS = [
    ("ai_explanation",          "TEXT"),
    ("ai_explanation_generated_at", "TIMESTAMPTZ"),
    ("ai_explanation_query",        "TEXT"),
    ("ai_explanation_report_count", "INTEGER NOT NULL DEFAULT 0"),
    ("ai_explanation_model",        "VARCHAR(50)"),
]


async def run_migration():
    """执行迁移: 为 knowledge_points 表添加 AI 解释字段 (幂等)"""
    async with async_session_factory() as db:
        for col_name, col_type in NEW_COLUMNS:
            # 检查字段是否已存在
            check = await db.execute(text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'knowledge_points' AND column_name = :col"
            ), {"col": col_name})
            if check.fetchone():
                print(f"  ⏭  字段 {col_name} 已存在, 跳过")
                continue

            # 添加字段
            await db.execute(text(
                f"ALTER TABLE knowledge_points ADD COLUMN {col_name} {col_type}"
            ))
            print(f"  ✅ 字段 {col_name} ({col_type}) 已添加")

        await db.commit()

        # 验证
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'knowledge_points' AND column_name LIKE 'ai_%' "
            "ORDER BY column_name"
        ))
        existing = [row[0] for row in result.fetchall()]
        expected = [c[0] for c in NEW_COLUMNS]
        if all(e in existing for e in expected):
            print(f"\n✅ 迁移成功: knowledge_points 表已包含 {len(existing)} 个 AI 解释字段")
            for col in existing:
                print(f"   - {col}")
        else:
            missing = [e for e in expected if e not in existing]
            print(f"\n⚠️  仍缺少字段: {missing}")


if __name__ == "__main__":
    asyncio.run(run_migration())
