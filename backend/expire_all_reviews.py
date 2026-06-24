"""
一键过期所有待复习项
将所有 pending 状态的 review_schedules 设置为已过期 (昨天),
用于测试艾宾浩斯遗忘曲线弹窗和仪表盘卡片功能
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.models.review import ReviewSchedule
from app.models.user import User


async def main():
    engine = create_async_engine(settings.database_url)
    now = datetime.now(timezone.utc)

    async with AsyncSession(engine) as db:
        # 列出所有用户
        users = (await db.execute(select(User.id, User.email, User.nickname))).all()

        for uid, email, nick in users:
            # 获取该用户所有未过期的待复习项
            stmt = select(ReviewSchedule).where(
                ReviewSchedule.user_id == uid,
                ReviewSchedule.status == 'pending',
                ReviewSchedule.review_at > now,
            ).order_by(ReviewSchedule.review_at.asc())
            result = await db.execute(stmt)
            schedules = result.scalars().all()

            if schedules:
                # 只将每个内容最近的一条设为过期, 模拟真实用户场景
                seen: set[tuple] = set()
                expired = 0
                for s in schedules:
                    key = (s.content_type, s.content_title)
                    if key not in seen:
                        seen.add(key)
                        s.review_at = now - timedelta(days=1)
                        expired += 1
                await db.commit()
                print(f"[{nick or email}]: {expired} 条复习已设为过期 ✅ (共 {len(schedules)} 条, 跳过 {len(schedules) - expired} 条重复间隔)")
            else:
                print(f"[{nick or email}]: 无需处理 (没有未来待复习项)")

    await engine.dispose()
    print("\n完成! 刷新浏览器首页即可看到复习提醒卡片和弹窗。")


if __name__ == "__main__":
    asyncio.run(main())
