"""
学生画像服务
提供记忆提取、描述式画像重建和画像管理功能

架构设计 (模仿 ChatGPT 记忆机制):
1. 每次对话后, 后台异步提取用户信息为「记忆片段」(自然语言)
2. 记忆积累到一定量后, LLM 将记忆按 6 个维度归类合成为「描述文本」
3. 画像的每个维度是一段自然语言描述, 而非填空式字段, 适应多元信息
"""

import uuid
import json
from typing import Optional
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.conversation import Conversation, Message
from app.models.profile import StudentProfile
from app.services.config_service import get_config_value
from loguru import logger

# ============================================================================
# 画像维度配置 (6 个维度)
# ============================================================================

PROFILE_DIMENSIONS = [
    "academic_background",
    "knowledge_basis",
    "learning_goals",
    "learning_preferences",
    "weak_areas",
    "interests",
]

DIMENSION_LABELS = {
    "academic_background": "专业背景",
    "knowledge_basis": "知识基础",
    "learning_goals": "学习目标",
    "learning_preferences": "学习偏好",
    "weak_areas": "薄弱知识点",
    "interests": "兴趣方向",
}


# ============================================================================
# 画像重建 System Prompt (记忆 -> 描述式维度文本)
# ============================================================================

PROFILE_REBUILD_PROMPT = """你是一个学生画像构建助手。请根据以下关于学生的记忆片段, 生成一份简洁的学习画像。

对以下 6 个维度, 各自生成一段自然的描述文本 (1-3句话即可):
1. academic_background: 专业背景 (专业、年级、学历层次等)
2. knowledge_basis: 知识基础 (已学知识、当前水平等)
3. learning_goals: 学习目标 (考试/项目/科研/就业/当前在学内容等)
4. learning_preferences: 学习偏好 (喜欢什么资源、什么学习方式/节奏等)
5. weak_areas: 薄弱知识点 (哪些概念有困难、易错点等)
6. interests: 兴趣方向 (感兴趣的应用方向、行业、拓展主题等)

规则:
- 每个维度只基于记忆片段中的信息编写, 没有相关信息则填空字符串 ""
- 用自然语言叙述, 不编造、不推测未提及的信息
- 如果某个维度的信息已存在于「已有画像」中, 请将新旧信息融合为一段连贯的描述
- 描述要简洁、可直接作为画像展示文本

输出格式: 严格的 JSON, 包含 6 个维度字段, 外加 summary:
{
  "academic_background": "描述文本或空字符串",
  "knowledge_basis": "描述文本或空字符串",
  "learning_goals": "描述文本或空字符串",
  "learning_preferences": "描述文本或空字符串",
  "weak_areas": "描述文本或空字符串",
  "interests": "描述文本或空字符串",
  "summary": "一段简洁的画像摘要"
}

只返回 JSON, 不要包含其他文本。"""


# ============================================================================
# 记忆提取 (ChatGPT 式后台记忆)
# ============================================================================

MEMORY_EXTRACTION_PROMPT = """你是一个学生信息识别助手。分析以下对话片段中的学生发言, 判断是否包含值得记录的、关于学生个人的信息。

可识别的信息类型:
- 专业背景: 专业、年级、学历层次
- 知识基础: 已学知识、当前水平
- 学习目标: 考试、项目、科研、就业、当前在学内容
- 学习偏好: 喜欢的资源类型、学习方式
- 薄弱知识点: 遇到的困难、不理解的概念
- 兴趣方向: 感兴趣的应用方向、行业

如果有值得记录的新信息, 提取为不超过 2 条简短的记忆片段, 用自然语言表达。
例如:
- "学生是计算机科学专业大三学生"
- "学生对反向传播算法的推导有困难"
- "学生每周可投入大约 10 小时学习"

如果学生消息中没有值得记录的个人信息, 直接回复: SKIP

只回复记忆片段(每条一行)或SKIP, 不要包含其他任何内容。"""


async def extract_memories_from_exchange(
    user_id: uuid.UUID,
    user_message: str,
    db: AsyncSession,
):
    """
    从单轮对话中异步提取用户信息记忆
    提取失败静默忽略, 新增记忆后自动触发画像重建

    :param user_id: 用户 ID
    :param user_message: 学生发送的消息
    :param db: 数据库会话
    """
    if len(user_message.strip()) < 10:
        return

    try:
        api_key = get_config_value("llm_api_key")
        api_base = get_config_value("llm_api_base")
        model = get_config_value("llm_model")

        client = AsyncOpenAI(api_key=api_key, base_url=api_base)

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": MEMORY_EXTRACTION_PROMPT},
                {"role": "user", "content": f"学生消息:\n{user_message}"},
            ],
            temperature=0.2,
            max_tokens=200,
        )
        raw = (response.choices[0].message.content or "").strip()

        if not raw or raw.upper() == "SKIP":
            return

        new_memories = [line.strip("- ").strip() for line in raw.split("\n") if line.strip() and line.strip().upper() != "SKIP"]
        if not new_memories:
            return

        # 获取或创建画像
        stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
        result = await db.execute(stmt)
        profile = result.scalar_one_or_none()

        if not profile:
            profile = StudentProfile(user_id=user_id, memories=[])
            db.add(profile)

        # 去重
        existing = set(profile.memories or [])
        added = 0
        for mem in new_memories:
            mem = mem[:200]
            is_dup = any(mem in em or em in mem for em in existing)
            if not is_dup:
                existing.add(mem)
                added += 1

        if added > 0:
            profile.memories = list(existing)[-30:]
            await db.commit()
            logger.info(f"记忆已更新: user_id={user_id}, 新增 {added} 条, 总计 {len(profile.memories)} 条")

            # 自动触发画像重建
            try:
                await rebuild_profile_from_memories(user_id, db)
            except Exception as e:
                logger.warning(f"自动画像重建失败: {e}")

    except Exception as e:
        logger.debug(f"记忆提取失败 (静默): {e}")


# ============================================================================
# 画像重建 (记忆 -> 描述式维度文本)
# ============================================================================

async def rebuild_profile_from_memories(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> StudentProfile:
    """
    从用户的所有记忆片段重建描述式画像
    调用 LLM 将记忆按 6 个维度归类并合成为自然语言描述

    :param user_id: 用户 ID
    :param db: 数据库会话
    :return: 更新后的画像
    """
    profile = await get_or_create_profile(user_id, db)
    memories = profile.memories or []

    if not memories:
        return profile

    # 构建已有画像文本 (供 LLM 融合)
    existing_text = ""
    if profile.profile_data:
        existing_parts = []
        for dim_key in PROFILE_DIMENSIONS:
            val = profile.profile_data.get(dim_key, "")
            if isinstance(val, str) and val.strip():
                existing_parts.append(f"- {DIMENSION_LABELS.get(dim_key, dim_key)}: {val}")
        if existing_parts:
            existing_text = "\n已有画像:\n" + "\n".join(existing_parts) + "\n"

    memory_text = "\n".join(f"- {m}" for m in memories)

    try:
        api_key = get_config_value("llm_api_key")
        api_base = get_config_value("llm_api_base")
        model = get_config_value("llm_model")

        client = AsyncOpenAI(api_key=api_key, base_url=api_base)

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": PROFILE_REBUILD_PROMPT},
                {"role": "user", "content": f"记忆片段:\n{memory_text}\n{existing_text}\n请基于以上记忆片段生成画像。"},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw = (response.choices[0].message.content or "").strip()
        logger.info(f"画像重建 LLM 输出: {len(raw)} 字符")
    except Exception as e:
        logger.error(f"画像重建 LLM 调用失败: {e}")
        return profile

    # 解析 JSON 输出
    new_data, summary = _parse_rebuild_output(raw)

    # 合并: 构建新 dict 再整体赋值, 避免 SQLAlchemy JSONB 原地变异检测失效
    merged = {}
    for dim_key in PROFILE_DIMENSIONS:
        new_val = new_data.get(dim_key, "")
        if isinstance(new_val, str) and new_val.strip():
            merged[dim_key] = new_val.strip()
        else:
            # 新数据为空, 保留旧描述 (如果旧描述是有效字符串)
            old_val = profile.profile_data.get(dim_key, "")
            merged[dim_key] = old_val if isinstance(old_val, str) and old_val.strip() else ""
    profile.profile_data = merged

    if summary:
        profile.summary = summary[:1000]

    profile.missing_fields = identify_missing_fields(profile.profile_data)
    profile.version = profile.version + 1

    await db.commit()
    await db.refresh(profile)
    logger.info(f"画像已重建: user_id={user_id}, version={profile.version}")
    return profile


def _parse_rebuild_output(raw: str) -> tuple[dict, Optional[str]]:
    """解析画像重建的 JSON 输出"""
    empty = {k: "" for k in PROFILE_DIMENSIONS}

    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1])

    bracket_start = text.find("{")
    bracket_end = text.rfind("}")
    if bracket_start == -1 or bracket_end == -1:
        logger.warning(f"画像重建: 未找到 JSON: {text[:200]}")
        return empty, None

    text = text[bracket_start:bracket_end + 1]

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning(f"画像重建 JSON 解析失败: {e}")
        return empty, None

    summary = data.pop("summary", None) if "summary" in data else None
    if summary and not isinstance(summary, str):
        summary = None

    result = dict(empty)
    for key in PROFILE_DIMENSIONS:
        val = data.get(key, "")
        if isinstance(val, str):
            result[key] = val.strip()

    return result, summary


def _map_old_dim_to_new(old_dim: str) -> str:
    """将旧维度 key 映射到新维度 key"""
    mapping = {
        "cognitive_style": "learning_preferences",
        "learning_rhythm": "learning_preferences",
        "resource_preferences": "learning_preferences",
    }
    return mapping.get(old_dim, "learning_preferences")


def _dict_to_text(data: dict) -> str:
    """将旧 dict 数据转为文本 (用于迁移)"""
    parts = []
    for k, v in data.items():
        if isinstance(v, list):
            parts.append(", ".join(str(x) for x in v if x))
        elif isinstance(v, dict):
            parts.extend(str(x) for x in v.values() if x)
        elif v:
            parts.append(str(v))
    return "; ".join(parts) if parts else ""


# ============================================================================
# 从对话历史提取画像 (手动触发 - 兼容旧 API)
# ============================================================================

async def extract_profile_from_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession,
) -> StudentProfile:
    """
    从对话历史中先提取记忆, 再重建画像
    """
    conversation = await db.get(Conversation, conversation_id)
    if not conversation:
        raise ValueError(f"对话不存在: {conversation_id}")

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()

    if not messages:
        raise ValueError("对话中没有消息")

    for msg in messages:
        if msg.role == "user":
            await extract_memories_from_exchange(conversation.user_id, msg.content, db)

    return await rebuild_profile_from_memories(conversation.user_id, db)


# ============================================================================
# 缺失字段识别
# ============================================================================

def identify_missing_fields(profile_data: dict) -> list[str]:
    """
    识别尚未收集的画像维度
    该维度的描述文本为空即为缺失
    """
    missing: list[str] = []
    for dim_key in PROFILE_DIMENSIONS:
        val = profile_data.get(dim_key, "")
        if not isinstance(val, str) or not val.strip():
            missing.append(dim_key)
    return missing


# ============================================================================
# 画像管理
# ============================================================================

async def get_user_memories(user_id: uuid.UUID, db: AsyncSession) -> list[str]:
    """获取用户的记忆片段列表"""
    stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    if profile and profile.memories:
        return profile.memories
    return []


async def get_or_create_profile(user_id: uuid.UUID, db: AsyncSession) -> StudentProfile:
    """
    获取用户画像, 不存在则创建空画像
    自动将旧填空式数据(dict)转换为描述式(string)
    """
    stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    if profile:
        # 检测并转换旧填空式数据: 构建新 dict 整体替换 (避免 JSONB 原地变异检测失效)
        needs_migration = False
        migrated = {}
        for dim_key in PROFILE_DIMENSIONS:
            val = profile.profile_data.get(dim_key)
            if isinstance(val, str):
                migrated[dim_key] = val
            else:
                migrated[dim_key] = ""
                needs_migration = True
        # 也迁移可能存在的旧 dict 数据
        for dim_key in ("cognitive_style", "learning_rhythm", "resource_preferences"):
            old_val = profile.profile_data.get(dim_key)
            if old_val and isinstance(old_val, dict) and any(v for v in old_val.values() if v):
                # 将旧 dict 数据作为自由文本追加到最相关的维度
                target = _map_old_dim_to_new(dim_key)
                existing = migrated.get(target, "")
                migrated[target] = (existing + " " + _dict_to_text(old_val)).strip() if existing else _dict_to_text(old_val)
                needs_migration = True
        if needs_migration:
            profile.profile_data = migrated
            await db.commit()
            await db.refresh(profile)
            logger.info(f"旧画像数据已自动迁移: user_id={user_id}")
        return profile

    empty_data = {k: "" for k in PROFILE_DIMENSIONS}
    profile = StudentProfile(
        user_id=user_id,
        profile_data=empty_data,
        confidence_scores={k: 0.0 for k in PROFILE_DIMENSIONS},
        missing_fields=list(PROFILE_DIMENSIONS),
        memories=[],
        version=1,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


async def update_profile_from_edits(
    user_id: uuid.UUID,
    profile_update: dict,
    db: AsyncSession,
) -> StudentProfile:
    """
    手动编辑后更新画像
    对于描述式维度, 直接用新值覆盖

    :param user_id: 用户 ID
    :param profile_update: {dim_key: "新描述文本", ...}
    :param db: 数据库会话
    :return: 更新后的画像
    """
    profile = await get_or_create_profile(user_id, db)

    # 构建新 dict 整体替换 (避免 JSONB 原地变异检测失效)
    merged = dict(profile.profile_data)
    for dim_key in PROFILE_DIMENSIONS:
        new_val = profile_update.get(dim_key, "")
        if isinstance(new_val, str) and new_val.strip():
            merged[dim_key] = new_val.strip()
    profile.profile_data = merged

    if profile_update.get("summary"):
        profile.summary = profile_update["summary"]

    profile.missing_fields = identify_missing_fields(profile.profile_data)
    profile.version = profile.version + 1

    await db.commit()
    await db.refresh(profile)
    logger.info(f"画像手动更新完成: user_id={user_id}, version={profile.version}")
    return profile
