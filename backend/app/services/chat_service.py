"""
AI 对话服务
提供 RAG 知识库对话、SSE 流式生成和画像收集对话功能

RAG 对话流程:
1. 保存用户消息到数据库
2. 执行 RAG 检索获取知识库上下文
3. 读取用户已有记忆, 注入 System Prompt
4. 获取最近 N 轮历史消息作为上下文
5. 调用 LLM 流式生成回复
6. 逐 token SSE 推送给前端
7. 保存完整 AI 回复到数据库
8. 立即发送 done SSE 事件 (通知前端流式已结束)
9. 后台异步: 自动生成标题 + 提取用户信息记忆 (不阻塞 done)
"""

import uuid
import json
import asyncio
from typing import AsyncGenerator, Optional, List
from openai import AsyncOpenAI
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.conversation import Conversation, Message
from app.models.course import Course
from app.core.database import async_session_factory
from app.services.config_service import get_config_value
from app.services.retriever import retrieve, RetrievedChunk
from app.services.profile_service import get_user_memories, extract_memories_from_exchange
from loguru import logger

# ============================================================================
# RAG 知识库对话 System Prompt
# ============================================================================

RAG_CHAT_SYSTEM_PROMPT = """你是 MLA (Multiple Learning Agent) 智学引擎的虚拟助教，一个专业的课程学习助手，专门为高校学生提供课程辅导。

你的身份:
- 你的名字是 Haru

重要规则:
1. 回答必须优先基于提供的「知识库参考资料」。如果知识库中有相关内容，请引用来回答。
2. 如果知识库中没有相关内容，请基于你的通用知识来回答。
3. 回答末尾列出引用的知识库来源编号，格式: 参考来源: [1] 文件名 - 切片#序号/页面#页号
4. 如果学生的问题与课程无关，请友好地引导他们回到学习主题。
5. 回答使用 Markdown 格式，支持标题、列表、代码块、表格等。
6. 保持回答简洁、准确、有条理，适合学生学习阅读。

{memories_section}"""


# ============================================================================
# 虚拟形象伙伴对话 System Prompt (Live2D 聊天)
# ============================================================================

COMPANION_SYSTEM_PROMPT = """你是 MLA 多学助手的虚拟学习伙伴，以亲切友好的方式和学生互动。

你的身份:
- 你的名字叫 Haru，是学生的 AI 学习伙伴

重要规则:
1. 用轻松自然的语气，像朋友一样交谈，多说鼓励的话。
2. 最多回复 2-3 句话，保持简短。
3. 不要用 Markdown 格式，用纯文本。
4. 可以适当使用语气词 (呢、啦、哦、呀) 和表情 (^_^, ~, !)。
5. 如果学生问学习相关的问题，给出简洁实用的建议而非长篇解释。
6. 如果学生闲聊或表达情绪，用共情的方式回应。
7. 多夸夸学生，关心他们的学习状态。

{memories_section}"""


# ============================================================================
# 画像收集 System Prompt 模板 (专用收集模式，暂时保留)
# ============================================================================

PROFILE_COLLECTION_SYSTEM_PROMPT = """你是一个友好、专业的学生画像收集助手，名为 MLA (Multiple Learning Agent) 智学引擎。
你的任务是通过自然对话的方式了解学生的学习情况，逐步收集以下信息用于构建个性化学习画像。

需要收集的 6 个维度:
1. 专业背景: 专业、年级、学历层次
2. 知识基础: 已学知识、当前知识水平
3. 学习目标: 应试/项目实践/科研入门/竞赛/就业技能等，当前在学内容
4. 学习偏好: 内容偏好 (喜欢什么类型的学习资源)、风格偏好 (喜欢什么学习方式/节奏)
5. 薄弱知识点: 易错点、卡点、困难主题
6. 兴趣方向: 应用方向、行业场景、拓展主题

对话规则:
1. 以友好、自然的方式与用户交流，不要像填表一样机械提问。
2. 每次对话聚焦 1-2 个维度，循序渐进，不要一次性问太多问题。
3. 当用户回答后，给予积极的反馈和共情，然后自然地过渡到下一个话题。
4. 如果用户表示不清楚或不想回答某个问题，不要强求，记录为缺失。
5. 对话中适时总结已了解到的信息，让用户感受到被理解。

{stage_hint}

已收集到的信息:
{collected_info}

请继续自然、友好地与学生对话。"""


# ============================================================================
# 画像收集阶段配置 (6 个阶段)
# ============================================================================

PROFILE_STAGES = [
    {"key": "academic_background", "label": "专业背景", "hint": "请了解学生的专业、年级和学历层次等背景信息。"},
    {"key": "knowledge_basis", "label": "知识基础", "hint": "请了解学生目前已掌握的知识、已学知识和当前水平。"},
    {"key": "learning_goals", "label": "学习目标", "hint": "请了解学生的学习目标: 是为了考试、做项目、科研还是就业? 目前在学什么?"},
    {"key": "learning_preferences", "label": "学习偏好", "hint": "请了解学生喜欢什么类型的学习资源和学习方式/节奏。"},
    {"key": "weak_areas", "label": "薄弱知识点", "hint": "请了解学生在哪些知识点上感到困难，有哪些易错点。"},
    {"key": "interests", "label": "兴趣方向", "hint": "请了解学生对哪些应用方向、行业或拓展主题感兴趣。"},
]


def get_stage_hint(current_stage: Optional[str]) -> str:
    """根据当前收集阶段生成引导提示"""
    if current_stage is None or current_stage == "done":
        first = PROFILE_STAGES[0]
        return f"请从「{first['label']}」开始了解学生情况。{first['hint']}"

    for i, stage in enumerate(PROFILE_STAGES):
        if stage["key"] == current_stage:
            if i + 1 < len(PROFILE_STAGES):
                next_stage = PROFILE_STAGES[i + 1]
                return (
                    f"上一个维度「{stage['label']}」已基本了解。现在请过渡到下一个维度「{next_stage['label']}」。"
                    f"{next_stage['hint']}"
                )
            else:
                return "所有维度的信息都已基本收集完毕。请告诉用户画像信息已足够。"

    first = PROFILE_STAGES[0]
    return f"请从「{first['label']}」开始了解学生情况。{first['hint']}"


def format_collected_info(profile_data: dict) -> str:
    """将已收集的画像数据格式化为可读文本 (描述式)"""
    if not profile_data:
        return "（尚未收集到任何信息）"

    lines: list[str] = []
    dim_labels = {s["key"]: s["label"] for s in PROFILE_STAGES}
    for key, label in dim_labels.items():
        val = profile_data.get(key, "")
        if isinstance(val, str) and val.strip():
            lines.append(f"- {label}: {val}")
        elif isinstance(val, dict) and any(v for v in val.values() if v):
            # 兼容旧填空式数据
            lines.append(f"- {label}: {json.dumps(val, ensure_ascii=False)}")
    if not lines:
        return "（尚未收集到任何信息）"
    return "\n".join(lines)


# ============================================================================
# 记忆格式化 (注入 System Prompt)
# ============================================================================

def _format_memories(memories: list[str]) -> str:
    """
    将记忆列表格式化为 System Prompt 片段
    :param memories: 记忆片段字符串列表
    :return: 格式化后的记忆上下文, 无记忆时返回空字符串
    """
    if not memories:
        return ""

    lines = ["你对这位学生的了解 (基于之前的对话，帮助你更好地个性化辅导):"]
    for i, mem in enumerate(memories):
        lines.append(f"- {mem}")
    lines.append("")

    return "\n".join(lines)


# ============================================================================
# 对话标题自动生成
# ============================================================================

TITLE_GENERATION_PROMPT = """请用不超过 15 个字概括以下对话的核心主题。直接回复标题文本, 不要加引号、标点或任何前缀。"""


async def generate_conversation_title(
    conversation_id: uuid.UUID,
    first_user_message: str,
    db: AsyncSession,
):
    """
    根据用户的首条消息自动生成对话标题 (模仿 ChatGPT 做法)
    优先用 LLM 生成, 失败时降级为用户消息截断

    关键约束:
    - 仅当对话中只有 1 条用户消息 (即本次) 时才生成 → 每个对话只生成一次
    - 仅当标题仍为默认值"新对话"时才覆盖 → 双重保护, 防止重复生成

    :param conversation_id: 对话 ID
    :param first_user_message: 用户的第一条消息 (用于概括)
    :param db: 数据库会话
    """
    # 先确认对话存在且标题需要更新
    conversation = await db.get(Conversation, conversation_id)
    if not conversation or conversation.title not in ("新对话", "快速问答"):
        return

    title = ""
    try:
        # 严格校验: 只有第一条用户消息才触发标题生成
        user_msg_count = await db.scalar(
            select(func.count()).select_from(Message).where(
                Message.conversation_id == conversation_id,
                Message.role == "user",
            )
        )
        if user_msg_count is None or user_msg_count > 1:
            logger.debug(f"标题生成跳过: 已有 {user_msg_count} 条用户消息, 非首次对话")
            return

        client = _create_llm_client()
        model = get_config_value("llm_model")

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TITLE_GENERATION_PROMPT},
                {"role": "user", "content": first_user_message},
            ],
            temperature=0.5,
            max_tokens=30,
        )
        title = (response.choices[0].message.content or "").strip()
        title = title.strip('"\'').strip()
        if title and len(title) <= 50:
            conversation = await db.get(Conversation, conversation_id)
            if conversation and conversation.title in ("新对话", "快速问答"):
                conversation.title = title
                await db.commit()
                logger.info(f"对话标题已自动生成 (来自首条消息): {title}")

    except Exception as e:
        logger.warning(f"LLM 标题生成失败, 降级为消息截断: {e}")

    # 降级: LLM 失败或返回空时, 用消息前 15 字
    if not title or len(title) > 50:
        clean = first_user_message.strip().replace("\n", " ")
        title = clean[:15] + ("…" if len(clean) > 15 else "")

    if title:
        conversation.title = title
        await db.commit()
        logger.info(f"对话标题已更新: {title}")


# ============================================================================
# RAG 上下文构建
# ============================================================================

async def build_rag_context(
    query: str,
    course_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 5,
) -> tuple[str, list[dict]]:
    """构建 RAG 检索上下文和来源列表"""
    try:
        results: List[RetrievedChunk] = await retrieve(query, course_id, db, top_k)
    except Exception as e:
        logger.warning(f"RAG 检索失败: {e}")
        return "", []

    if not results:
        return "", []

    context_parts: list[str] = []
    sources: list[dict] = []

    for i, r in enumerate(results):
        content = r.content[:800] if len(r.content) > 800 else r.content

        # 判断结果类型: page (PDF/PPTX 页面) 或 chunk (DOCX/MD/TXT 切片)
        is_page = r.metadata.get("type") == "document_page"

        if is_page:
            # 页面级结果: 标签用页码, 内容保留摘要+知识点文本
            page_number = r.metadata.get("page_number", r.chunk_index)
            context_parts.append(
                f"[参考资料{i + 1}] (来源: {r.document_filename}, 第{page_number}页)\n{content}"
            )
            sources.append({
                "chunk_id": str(r.chunk_id),
                "document_id": str(r.document_id),
                "document_filename": r.document_filename,
                "content": content,
                "score": r.score,
                "chunk_index": r.chunk_index,
                "result_type": "page",
                "page_number": page_number,
            })
        else:
            context_parts.append(
                f"[参考资料{i + 1}] (来源: {r.document_filename}, 切片#{r.chunk_index})\n{content}"
            )
            sources.append({
                "chunk_id": str(r.chunk_id),
                "document_id": str(r.document_id),
                "document_filename": r.document_filename,
                "content": content,
                "score": r.score,
                "chunk_index": r.chunk_index,
            })

    context = "\n\n---\n\n".join(context_parts)
    logger.info(f"RAG 上下文构建完成: {len(sources)} 条来源")
    return context, sources


# ============================================================================
# 对话历史获取
# ============================================================================

async def get_recent_messages(
    conversation_id: uuid.UUID,
    db: AsyncSession,
    max_messages: int = 20,
) -> List[Message]:
    """获取最近的对话历史消息"""
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(max_messages)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()
    return list(reversed(messages))


# ============================================================================
# LLM 客户端创建
# ============================================================================

def _create_llm_client() -> AsyncOpenAI:
    """根据运行时配置创建 OpenAI 兼容客户端"""
    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    return AsyncOpenAI(api_key=api_key, base_url=api_base)


# ============================================================================
# SSE 流式对话生成
# ============================================================================

async def chat_stream(
    conversation_id: uuid.UUID,
    user_message: str,
    course_id: Optional[uuid.UUID],
    db: AsyncSession,
    system_prompt: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    SSE 流式对话生成器
    处理完整对话流程: 保存用户消息 → RAG 检索 → LLM 生成 → SSE 流式输出 → 保存 AI 回复 → 后台提取记忆

    SSE 事件类型:
    - content: AI 回复的文本片段 (逐 token)
    - sources: 知识库引用来源列表
    - done: 生成完成, 附带 message_id
    - error: 错误信息
    """
    # 1. 获取对话信息
    conversation = await db.get(Conversation, conversation_id)
    if not conversation:
        yield _sse_event("error", {"message": "对话不存在"})
        return

    # 2. 保存用户消息到数据库
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_message,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    # 3. RAG 检索 (仅知识库对话模式且有课程关联时)
    rag_context = ""
    sources: list[dict] = []
    effective_course_id = course_id or conversation.course_id

    if conversation.conversation_type == "chat" and effective_course_id:
        rag_context, sources = await build_rag_context(
            query=user_message,
            course_id=effective_course_id,
            db=db,
            top_k=5,
        )
    elif conversation.conversation_type == "chat" and not effective_course_id:
        logger.info(f"知识库对话 {conversation_id} 未关联课程, 使用通用知识回答")

    # 4. 读取用户记忆 (用于个性化) — 失败不影响对话
    memories: list[str] = []
    memories_section: str = ""
    try:
        memories = await get_user_memories(conversation.user_id, db)
        memories_section = _format_memories(memories)
    except Exception as e:
        logger.warning(f"读取用户记忆失败 (已忽略): {e}")

    # 5. 构建 messages 数组 (LLM API 格式)
    llm_messages: list[dict] = []

    if system_prompt:
        # 前端传来的自定义 prompt (如 Live2D 伙伴聊天)
        system_prompt_text = system_prompt.format(memories_section=memories_section)
    elif conversation.conversation_type == "profile_collection":
        stage_hint = get_stage_hint(conversation.profile_collection_stage)
        collected_info = "（新对话, 开始收集信息）"
        system_prompt = PROFILE_COLLECTION_SYSTEM_PROMPT.format(
            stage_hint=stage_hint,
            collected_info=collected_info,
        )
    else:
        if rag_context:
            system_prompt = RAG_CHAT_SYSTEM_PROMPT.format(
                memories_section=memories_section
            ) + f"\n\n知识库参考资料:\n{rag_context}"
        else:
            system_prompt = RAG_CHAT_SYSTEM_PROMPT.format(
                memories_section=memories_section
            ) + "\n\n注意: 本次查询未在课程知识库中找到直接相关的资料，请基于通用知识回答并告知学生。"

    llm_messages.append({"role": "system", "content": system_prompt})

    # 历史消息 (最近 N 轮)
    history = await get_recent_messages(conversation_id, db, max_messages=20)
    for msg in history:
        if msg.id == user_msg.id:
            continue
        llm_messages.append({"role": msg.role, "content": msg.content})

    llm_messages.append({"role": "user", "content": user_message})

    # 6. 调用 LLM 流式生成
    try:
        client = _create_llm_client()
        model = get_config_value("llm_model")

        stream = await client.chat.completions.create(
            model=model,
            messages=llm_messages,
            temperature=0.7,
            max_tokens=4000,
            stream=True,
        )

        full_content: str = ""

        if sources:
            yield _sse_event("sources", {"sources": sources})

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                full_content += delta.content
                yield _sse_event("content", {"content": delta.content})

        # 7. 保存 AI 回复到数据库
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=full_content,
            sources=sources if sources else None,
            message_metadata={
                "model": model,
                "token_count": len(full_content),
            },
        )
        db.add(assistant_msg)
        await db.commit()
        await db.refresh(assistant_msg)

        # 8. 立即发送完成事件 — 不等待标题/记忆的后台处理
        yield _sse_event("done", {"message_id": str(assistant_msg.id)})

        # 9. 后台异步: 生成标题 + 提取用户记忆 (使用独立 DB 会话, 不阻塞 UI)
        asyncio.create_task(_postprocess_background(
            conversation_id=conversation_id,
            user_id=conversation.user_id,
            user_message=user_message,
            assistant_message=full_content,
        ))

    except Exception as e:
        error_msg = str(e)
        logger.error(f"LLM 流式生成失败: {error_msg}")
        error_msg_obj = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=f"抱歉，生成回复时出现了错误: {error_msg}。请稍后重试。",
        )
        db.add(error_msg_obj)
        await db.commit()
        await db.refresh(error_msg_obj)
        yield _sse_event("error", {"message": error_msg, "message_id": str(error_msg_obj.id)})


# ============================================================================
# 后台任务: 标题生成 + 记忆提取 — 不阻塞 done 事件
# ============================================================================

async def _postprocess_background(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    user_message: str,
    assistant_message: str,
):
    """
    流式完成后的后台处理任务
    使用独立的数据库会话, 不影响主 SSE 流的响应速度

    执行内容:
    1. 首次对话时自动生成标题 (通过 LLM 概括首条消息)
    2. 从本轮对话中提取用户信息记忆
    """
    async with async_session_factory() as db:
        try:
            # 1. 标题生成
            await generate_conversation_title(conversation_id, user_message, db)
        except Exception as e:
            logger.warning(f"后台标题生成失败 (已忽略): {e}")

    # 记忆提取也使用独立会话
    async with async_session_factory() as db:
        try:
            # 2. 提取用户信息记忆
            await extract_memories_from_exchange(
                user_id=user_id,
                user_message=user_message,
                db=db,
                assistant_message=assistant_message,
            )
        except Exception as e:
            logger.warning(f"后台记忆提取失败 (已忽略): {e}")


def _sse_event(event_type: str, data: dict) -> str:
    """将事件数据格式化为 SSE 标准格式"""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False)
    return f"data: {payload}\n\n"
