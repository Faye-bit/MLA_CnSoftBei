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
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.conversation import Conversation, Message
from app.models.course import Course, KnowledgePoint
from app.core.database import async_session_factory
from app.services.config_service import get_config_value
from app.services.retriever import retrieve, RetrievedChunk
from app.services.profile_service import get_user_memories, extract_memories_from_exchange
from app.services.llm_utils import create_llm_client, sse_event
from loguru import logger

# 从 chat_prompts.py 导入所有 System Prompt 和辅助函数
from app.services.chat_prompts import (
    RAG_CHAT_SYSTEM_PROMPT,
    QUICK_ASK_SYSTEM_PROMPT,
    WEB_SEARCH_CONTEXT_TEMPLATE,
    build_quick_ask_context,
    _format_memories,
    TITLE_GENERATION_PROMPT,
    CONDENSE_EXPLANATION_PROMPT,
)
from app.services.web_search import search_web, build_chat_search_query


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

        client = create_llm_client()
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
# SSE 流式对话生成
# ============================================================================

async def chat_stream(
    conversation_id: uuid.UUID,
    user_message: str,
    course_id: Optional[uuid.UUID],
    db: AsyncSession,
    system_prompt: Optional[str] = None,
    quick_ask_context: Optional[dict] = None,
    web_search_enabled: bool = False,
) -> AsyncGenerator[str, None]:
    """
    SSE 流式对话生成器
    处理完整对话流程: 保存用户消息 → RAG 检索 → (可选) 联网搜索 → LLM 生成 → SSE 流式输出 → 保存 AI 回复 → 后台提取记忆

    SSE 事件类型:
    - content: AI 回复的文本片段 (逐 token)
    - sources: 知识库引用来源列表
    - web_links: 联网搜索结果链接列表 (仅在 web_search_enabled=True 时发送)
    - done: 生成完成, 附带 message_id
    - error: 错误信息

    :param quick_ask_context: 快问AI上下文 (source_type, kp_id, context_text 等)
    :param web_search_enabled: 是否开启联网搜索
    """
    # 1. 获取对话信息
    conversation = await db.get(Conversation, conversation_id)
    if not conversation:
        yield sse_event("error", {"message": "对话不存在"})
        return

    # 2. 保存用户消息到数据库 (附带快问AI上下文元数据)
    user_msg_metadata: Optional[dict] = None
    if quick_ask_context:
        user_msg_metadata = {
            "quick_ask_source": quick_ask_context.get("source_type"),
            "kp_id": quick_ask_context.get("kp_id"),
            "course_id": quick_ask_context.get("course_id"),
            "chapter_id": quick_ask_context.get("chapter_id"),
            "document_id": quick_ask_context.get("document_id"),
            "context_text": quick_ask_context.get("context_text", "")[:500],
        }
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_message,
        message_metadata=user_msg_metadata,
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

    # 3.5. 联网搜索 (仅在知识库对话模式下, 用户主动开启时执行)
    web_links: list[dict] = []
    web_search_section: str = ""
    if web_search_enabled and conversation.conversation_type == "chat":
        try:
            search_query = build_chat_search_query(user_message)
            search_results = await search_web(search_query, count=8)
            if search_results:
                # 构建搜索结果文本注入 System Prompt
                search_parts = []
                for i, r in enumerate(search_results):
                    platform_tag = f"[{r.get('source_platform', '网页')}]"
                    search_parts.append(
                        f"[网{i + 1}] {platform_tag} {r.get('title', '')}\n"
                        f"    URL: {r.get('url', '')}\n"
                        f"    摘要: {r.get('content', '')[:200]}"
                    )
                formatted_results = "\n\n".join(search_parts)
                web_search_section = WEB_SEARCH_CONTEXT_TEMPLATE.format(
                    search_results=formatted_results
                )
                # 构建前端展示用的链接列表 (保留原始搜索结果的所有字段)
                web_links = [
                    {
                        "url": r.get("url", ""),
                        "title": r.get("title", ""),
                        "description": r.get("content", "")[:200],
                        "source_platform": r.get("source_platform", "网页"),
                        "favicon": r.get("favicon", ""),
                        "image": r.get("image", ""),
                    }
                    for r in search_results
                    if r.get("url") and r.get("title")
                ]
                logger.info(f"联网搜索: 获取 {len(web_links)} 条结果, 已注入 System Prompt")
            else:
                logger.info("联网搜索: 无结果, 使用常规回答")
        except Exception as e:
            logger.warning(f"联网搜索失败 (已忽略, 降级为常规回答): {e}")

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
    elif quick_ask_context:
        # 快问AI模式: 使用快问专用系统提示词, 注入上下文
        context_section = build_quick_ask_context(quick_ask_context)
        if rag_context:
            system_prompt_text = QUICK_ASK_SYSTEM_PROMPT.format(
                context_section=context_section,
                memories_section=memories_section,
                web_search_section=web_search_section,
            ) + f"\n\n知识库参考资料:\n{rag_context}"
        else:
            system_prompt_text = QUICK_ASK_SYSTEM_PROMPT.format(
                context_section=context_section,
                memories_section=memories_section,
                web_search_section=web_search_section,
            )
        system_prompt = system_prompt_text  # 保持一致性
    else:
        if rag_context:
            system_prompt = RAG_CHAT_SYSTEM_PROMPT.format(
                memories_section=memories_section,
                web_search_section=web_search_section,
            ) + f"\n\n知识库参考资料:\n{rag_context}"
        else:
            system_prompt = RAG_CHAT_SYSTEM_PROMPT.format(
                memories_section=memories_section,
                web_search_section=web_search_section,
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
        client = create_llm_client()
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
            yield sse_event("sources", {"sources": sources})

        # 发送联网搜索结果链接 (在 content 之前发送, 前端可提前渲染卡片)
        if web_links:
            yield sse_event("web_links", {"links": web_links})

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                full_content += delta.content
                yield sse_event("content", {"content": delta.content})

        # 7. 保存 AI 回复到数据库
        assistant_msg_metadata = {
            "model": model,
            "token_count": len(full_content),
        }
        if web_links:
            assistant_msg_metadata["web_links"] = web_links
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=full_content,
            sources=sources if sources else None,
            message_metadata=assistant_msg_metadata,
        )
        db.add(assistant_msg)
        await db.commit()
        await db.refresh(assistant_msg)

        # 8. 立即发送完成事件 — 不等待标题/记忆的后台处理
        yield sse_event("done", {"message_id": str(assistant_msg.id)})

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
        yield sse_event("error", {"message": error_msg, "message_id": str(error_msg_obj.id)})


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


# ============================================================================
# AI 解释浓缩并存储 (快问AI 功能 — 手动触发)
# ============================================================================

async def condense_and_store_explanation(
    kp_id: uuid.UUID,
    full_response: str,
    user_query: str,
    db: AsyncSession,
) -> str:
    """
    浓缩 AI 回复为 2-4 句话并存储到知识点的 ai_explanation 字段

    由前端"保存到知识库"按钮手动触发, 非自动执行。

    :param kp_id: 知识点 ID
    :param full_response: 完整的 AI 回复文本
    :param user_query: 触发该解释的原始用户提问
    :param db: 数据库会话
    :return: 浓缩后的解释文本 (失败时返回空字符串)
    """
    try:
        kp = await db.get(KnowledgePoint, kp_id)
        if not kp:
            logger.warning(f"浓缩解释失败: 知识点 {kp_id} 不存在")
            return ""

        # 调用 LLM 浓缩
        client = create_llm_client()
        model = get_config_value("llm_model")

        # 截断完整回复: 取前 4000 字符供浓缩
        truncated = full_response[:4000]

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": CONDENSE_EXPLANATION_PROMPT.format(
                    full_response=truncated
                )},
            ],
            temperature=0.3,
            max_tokens=300,
        )

        condensed = (response.choices[0].message.content or "").strip()

        if condensed:
            from datetime import datetime as dt, timezone
            kp.ai_explanation = condensed
            kp.ai_explanation_generated_at = dt.now(timezone.utc)
            kp.ai_explanation_query = user_query[:500]
            kp.ai_explanation_model = model
            kp.ai_explanation_report_count = 0  # 新解释重置计数
            await db.commit()
            logger.info(f"AI 解释已浓缩并存储到 KP {kp_id}: {condensed[:80]}...")
            return condensed
        else:
            logger.warning(f"LLM 浓缩返回空内容, KP {kp_id}")
            return ""

    except Exception as e:
        logger.error(f"浓缩解释失败 (KP {kp_id}): {e}")
        return ""

