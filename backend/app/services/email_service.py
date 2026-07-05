"""
邮箱验证码服务
使用 Python 标准库 smtplib 通过 QQ 邮箱 SMTP(SSL 465端口) 发送验证码
"""

import random
import asyncio
import smtplib
from email.header import Header
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.models.email_verification import EmailVerification
from loguru import logger


def _generate_code() -> str:
    """ 生成 6 位随机数字验证码 """
    return f"{random.randint(0, 999999):06d}"


def _send_email_sync(to_email: str, subject: str, html_body: str) -> bool:
    """
    同步发送邮件 (使用 smtplib.SMTP_SSL)
    在独立线程中运行, 避免阻塞异步事件循环
    """
    msg = MIMEMultipart("alternative")
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        # 使用 SMTP_SSL 直连 465 端口 (QQ 邮箱推荐方式)
        server = smtplib.SMTP_SSL(
            host=settings.smtp_host,
            port=settings.smtp_port,
            timeout=15,
        )
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_from, [to_email], msg.as_string())
        server.quit()
        logger.info(f"验证码邮件已发送: {to_email}")
        return True
    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP 认证失败 (请检查授权码): {e}")
        return False
    except smtplib.SMTPException as e:
        logger.error(f"SMTP 发送失败: {e}")
        return False
    except Exception as e:
        logger.error(f"邮件发送异常: {type(e).__name__}: {e}")
        return False


async def send_verification_email(to_email: str, code: str, purpose: str) -> bool:
    """
    通过 QQ SMTP 发送验证码邮件 (异步包装)
    :param to_email: 收件人邮箱地址
    :param code: 6 位验证码
    :param purpose: 验证码用途
    :return: True / False
    """
    purpose_text = "注册账号" if purpose == "register" else "重置密码"
    subject = f"[MLA] {purpose_text}验证码"

    html_body = f"""
    <div style="max-width:480px;margin:0 auto;padding:20px;font-family:Arial,sans-serif;
                border:1px solid #e0e0e0;border-radius:8px;">
        <h2 style="color:#1677ff;text-align:center;">MLA 智小学</h2>
        <p style="font-size:16px;">您正在{purpose_text}, 验证码如下：</p>
        <div style="background:#f5f5f5;padding:20px;text-align:center;border-radius:6px;margin:16px 0;">
            <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1677ff;">{code}</span>
        </div>
        <p style="color:#888;font-size:13px;">
            验证码 {settings.verification_code_expire_minutes} 分钟内有效, 请勿转发给他人。
        </p>
        <p style="color:#888;font-size:13px;">如果这不是您本人的操作, 请忽略此邮件。</p>
    </div>
    """

    # 在线程池中执行同步 SMTP 发送, 不阻塞异步事件循环
    result = await asyncio.to_thread(
        _send_email_sync, to_email, subject, html_body
    )
    return result


async def generate_and_send_code(
    db: AsyncSession, email: str, purpose: str
) -> tuple[bool, str]:
    """
    生成验证码并发送邮件 (含 60 秒冷却保护)
    :param db: 数据库会话
    :param email: 收件邮箱
    :param purpose: 用途
    :return: (是否成功, 提示消息)
    """
    # 冷却检查: 同邮箱+用途 60 秒内禁止重复发送
    cooldown_time = datetime.now(timezone.utc) - timedelta(
        seconds=settings.verification_code_cooldown_seconds
    )
    stmt = select(EmailVerification).where(
        and_(
            EmailVerification.email == email,
            EmailVerification.purpose == purpose,
            EmailVerification.created_at > cooldown_time,
        )
    )
    result = await db.execute(stmt)
    if result.scalars().first() is not None:
        return False, f"请 {settings.verification_code_cooldown_seconds} 秒后再试"

    # 生成验证码并写入数据库
    code = _generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.verification_code_expire_minutes
    )
    record = EmailVerification(
        email=email,
        code=code,
        purpose=purpose,
        expires_at=expires_at,
    )
    db.add(record)
    await db.commit()

    # 发送邮件
    success = await send_verification_email(email, code, purpose)
    if not success:
        return False, "验证码邮件发送失败, 请检查邮箱配置"

    return True, "验证码已发送"


async def verify_code(
    db: AsyncSession, email: str, code: str, purpose: str
) -> tuple[bool, str]:
    """
    校验验证码是否正确且未过期
    检查所有未使用的验证码, 任一匹配即通过 (避免连续发多条时只认最新一条)
    """
    now_utc = datetime.now(timezone.utc)

    # 查询该邮箱+用途下所有未使用的验证码, 按时间倒序
    stmt = (
        select(EmailVerification)
        .where(
            and_(
                EmailVerification.email == email,
                EmailVerification.purpose == purpose,
                EmailVerification.used == False,  # noqa: E712
            )
        )
        .order_by(EmailVerification.created_at.desc())
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    if not records:
        return False, "请先发送验证码"

    # 遍历所有记录, 任一 code 匹配且未过期即通过
    for record in records:
        if record.code == code:
            if record.expires_at.replace(tzinfo=timezone.utc) < now_utc:
                continue  # 这条已过期, 继续查下一条
            record.used = True
            await db.commit()
            return True, "验证通过"

    # 没匹配到: 可能是输错了, 也可能全部过期了
    for record in records:
        if record.expires_at.replace(tzinfo=timezone.utc) >= now_utc:
            return False, "验证码错误"

    return False, "验证码已过期, 请重新获取"
