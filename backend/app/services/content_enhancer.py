"""
检索结果 LLM 增强服务
对 RAG 检索返回的切片进行二次加工:
- 提取每个切片的核心观点 (一句话摘要)
- 标注 2-4 个关键词
- 识别语义重复的切片 (去重合并)
完全复用 kp_extractor.py 的 LLM 调用模式

Phase 2 修复:
- 动态计算 max_tokens, 避免 LLM 输出被截断导致部分切片丢失
- 添加 HTTP 超时控制 (AsyncOpenAI timeout + asyncio.wait_for)
- LLM 返回不完整时自动为缺失切片生成降级增强 (关键词匹配)
"""

import asyncio
import json
from typing import List, Optional
from openai import AsyncOpenAI
from httpx import Timeout
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.config_service import get_config_value
from loguru import logger


# 检索结果增强 System Prompt (优化版: 明确要求覆盖所有切片)
ENHANCE_SYSTEM_PROMPT = """你是一个专业的知识检索结果分析助手。你的任务是对给定的文档检索结果进行二次加工, 帮助学生更高效地理解检索结果。

严格要求:
1. 仔细阅读用户的查询问题 (query) 和检索返回的文档切片列表 (chunks)
2. **必须为每一个切片都生成结果**, 不要跳过任何一个
3. 对每个切片, 提取:
   - viewpoint: 该切片与查询问题相关的核心观点 (一句话概括, 不超过50字)
   - keywords: 2-4 个关键词 (每个关键词不超过10字)
4. 识别语义高度重复的切片:
   - 如果多个切片内容几乎相同或表达同一个核心观点, 标注其中相似度分数较低的为重复
   - 在 is_duplicate_of 字段中填写主切片的 chunk_id (相似度最高的那个)
   - 不要标注主切片本身有 is_duplicate_of 字段
5. 如果切片与查询问题完全无关, viewpoint 和 keywords 可以为空字符串
6. 只根据提供的切片内容进行分析, 不要编造信息

输出格式: 严格的 JSON 数组, 不要包含任何解释文字, 不要用 markdown 代码块包裹:
[{"chunk_id": "切片ID", "viewpoint": "核心观点(50字以内)", "keywords": ["关键词1", "关键词2"], "is_duplicate_of": ""}]"""

# LLM 调用超时配置 (秒)
LLM_CONNECT_TIMEOUT = 8.0   # 建立连接超时
LLM_READ_TIMEOUT = 30.0     # 读取响应超时
LLM_WRITE_TIMEOUT = 15.0    # 写入请求超时
LLM_TOTAL_TIMEOUT = 35.0    # asyncio.wait_for 总超时 (留余量给重试)

# 每个切片预估需要的输出 token 数 (JSON 格式化开销 + viewpoint + keywords)
TOKENS_PER_CHUNK = 350
# 最少输出 token 数
MIN_OUTPUT_TOKENS = 1000
# 最多输出 token 数
MAX_OUTPUT_TOKENS = 6000


def _estimate_output_tokens(chunk_count: int) -> int:
    """
    根据切片数量动态计算需要的 max_tokens
    保证 LLM 有足够的输出空间覆盖所有切片
    :param chunk_count: 切片数量
    :return: 建议的 max_tokens 值
    """
    estimated = chunk_count * TOKENS_PER_CHUNK
    return max(MIN_OUTPUT_TOKENS, min(estimated, MAX_OUTPUT_TOKENS))


async def enhance_retrieval_results(
    query: str,
    chunks: List[dict],
    db: Optional[AsyncSession] = None,
) -> List[dict]:
    """
    调用 LLM 对检索结果进行增强处理: 提取核心观点、关键词、识别重复
    修复: 动态 max_tokens + 超时控制 + 缺失切片降级增强
    :param query: 用户的原始查询文本
    :param chunks: 检索结果列表 [{id, content, score, chunk_index}, ...]
    :param db: 数据库会话 (保留参数, 遵循项目模式)
    :return: 增强信息列表 [{chunk_id, viewpoint, keywords, is_duplicate_of}, ...]
    """
    if not chunks:
        return []

    # 构建发送给 LLM 的切片摘要 (带编号, 控制每个切片的长度)
    chunks_text = ""
    for i, chunk in enumerate(chunks):
        # 截断过长内容, 减少 token 消耗 (保留更多内容让 LLM 理解)
        content = chunk.get("content", "")[:500]
        chunks_text += (
            f"[切片{i+1}] chunk_id={chunk['id']} "
            f"score={chunk.get('score', 0):.2f}\n"
            f"内容: {content}\n\n"
        )

    if not chunks_text.strip():
        return []

    # 获取 LLM 配置 (遵循 kp_extractor.py 模式)
    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    model = get_config_value("llm_model")

    if not api_key:
        logger.warning("LLM API Key 未配置, 跳过检索结果增强")
        return _fallback_enhancement(chunks, query)

    # 创建 OpenAI 兼容客户端 (配置 HTTP 超时)
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=api_base,
        timeout=Timeout(
            connect=LLM_CONNECT_TIMEOUT,
            read=LLM_READ_TIMEOUT,
            write=LLM_WRITE_TIMEOUT,
            pool=LLM_CONNECT_TIMEOUT,
        ),
        max_retries=1,  # 只重试一次, 避免累积等待
    )

    # 动态计算 max_tokens: 确保有足够空间覆盖所有切片
    output_tokens = _estimate_output_tokens(len(chunks))

    user_prompt = (
        f"查询问题: {query}\n\n"
        f"检索到的文档切片 (共 {len(chunks)} 条, 请对每一条都生成结果):\n"
        f"{chunks_text}\n"
        f"请对以上 {len(chunks)} 个切片逐一分析, 提取核心观点、关键词, 并识别重复内容。"
        f"必须为每个切片生成一条结果。"
        f"注意: 只分析给定的内容, 不要编造信息。"
    )

    logger.info(
        f"LLM 检索增强开始: {len(chunks)} 个切片, "
        f"max_tokens={output_tokens}, timeout={LLM_TOTAL_TIMEOUT}s"
    )

    try:
        # 使用 asyncio.wait_for 作为双重超时保护
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": ENHANCE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=output_tokens,
            ),
            timeout=LLM_TOTAL_TIMEOUT,
        )
        raw_output = response.choices[0].message.content or ""
        logger.info(f"LLM 检索增强完成: {len(raw_output)} 字符")

    except asyncio.TimeoutError:
        logger.error(f"LLM 增强调用超时 (>{LLM_TOTAL_TIMEOUT}s), 降级为本地增强")
        return _fallback_enhancement(chunks, query)
    except Exception as e:
        logger.error(f"LLM 增强调用失败: {e}, 降级为本地增强")
        return _fallback_enhancement(chunks, query)

    # 解析 LLM 输出
    enhanced_list = _parse_enhance_output(raw_output)

    # 验证和清理: 确保所有 chunk_id 都在原始输入中
    valid_ids = {c["id"] for c in chunks}
    valid_enhanced: list[dict] = []
    for item in enhanced_list:
        cid = item.get("chunk_id", "")
        if cid in valid_ids:
            valid_enhanced.append(item)
        else:
            logger.warning(f"LLM 返回了无效的 chunk_id: {cid}, 已跳过")

    # 检查覆盖率: LLM 是否漏掉了某些切片
    enhanced_ids = {item["chunk_id"] for item in valid_enhanced}
    missing_ids = valid_ids - enhanced_ids

    if missing_ids:
        logger.warning(
            f"LLM 未覆盖 {len(missing_ids)}/{len(chunks)} 个切片 "
            f"(coverage={len(valid_enhanced)}/{len(chunks)}), "
            f"缺失 ID: {list(missing_ids)[:3]}... 将为缺失切片生成降级增强"
        )
        # 为缺失的切片生成降级增强 (基于关键词匹配)
        missing_chunks = [c for c in chunks if c["id"] in missing_ids]
        fallback = _fallback_enhancement(missing_chunks, query)
        valid_enhanced.extend(fallback)

    logger.info(
        f"检索增强完成: 有效 {len(valid_enhanced)} 条 "
        f"(LLM {len(enhanced_ids)} 条 + 降级 {len(missing_ids)} 条)"
    )
    return valid_enhanced


def _fallback_enhancement(chunks: List[dict], query: str) -> List[dict]:
    """
    降级增强: 当 LLM 不可用或超时时, 基于文本匹配生成本地增强结果
    确保每个切片都有基本的增强信息, 避免前端出现"有的有、有的没有"的不一致状态
    修复: 先清洗文本再生成摘要, 使用智能断句避免截断在句子中间
    :param chunks: 切片列表
    :param query: 查询文本
    :return: 降级增强信息列表
    """
    from app.services.text_normalizer import (
        extract_query_terms,
        normalize_chunk_text,
        truncate_at_sentence_boundary,
    )

    logger.info(f"使用降级增强: {len(chunks)} 个切片, query='{query[:30]}...'")

    # 从查询中提取关键词
    query_terms = extract_query_terms(query)

    result: list[dict] = []
    for chunk in chunks:
        raw_content = chunk.get("content", "")
        cid = chunk.get("id", "")

        # 先清洗: 去除 PDF 残留 (页码标记、断行等)
        cleaned = normalize_chunk_text(raw_content)

        # 从清洗后的内容中匹配查询关键词
        matched_keywords: list[str] = []
        content_lower = cleaned.lower()
        for term in query_terms:
            if term.lower() in content_lower:
                matched_keywords.append(term)

        # 如果没有匹配到查询关键词, 取内容中频率最高的非停用词
        if not matched_keywords and cleaned:
            import re
            words = re.findall(r'[一-鿿]{2,4}', cleaned)
            word_freq: dict[str, int] = {}
            for w in words:
                word_freq[w] = word_freq.get(w, 0) + 1
            sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
            matched_keywords = [w for w, _ in sorted_words[:3]]

        # 生成摘要: 在句子边界处智能截断, 避免 mid-sentence cutoff
        # 摘要长度: 120-150 字, 足以表达一个完整观点
        summary = truncate_at_sentence_boundary(cleaned, 150)

        result.append({
            "chunk_id": cid,
            "viewpoint": summary,
            "keywords": matched_keywords[:4],
            "is_duplicate_of": "",
        })

    return result


def _parse_enhance_output(raw: str) -> list[dict]:
    """
    解析 LLM 输出的 JSON 增强结果
    兼容各种可能的格式问题 (markdown 代码块包裹, 尾逗号, 截断等)
    :param raw: LLM 原始输出文本
    :return: 解析后的增强信息列表
    """
    if not raw or not raw.strip():
        return []

    text = raw.strip()

    # 去掉 markdown 代码块包裹
    if text.startswith("```"):
        lines = text.split("\n")
        # 去掉 ```json 和结尾 ```
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    # 尝试查找 JSON 数组
    bracket_start = text.find("[")
    bracket_end = text.rfind("]")
    if bracket_start != -1 and bracket_end != -1:
        text = text[bracket_start:bracket_end + 1]

    # 尝试修复 LLM 输出被截断的情况: 补全缺失的 ]
    if text.endswith(",") or (text.endswith("}") and not text.endswith("]")):
        text = text.rstrip(",") + "]"

    try:
        items = json.loads(text)
        if not isinstance(items, list):
            if isinstance(items, dict):
                items = [items]
            else:
                logger.warning(f"LLM 增强输出非数组也非对象: {type(items)}")
                return []
    except json.JSONDecodeError:
        # 尝试修复常见格式问题
        try:
            text_fixed = text.replace(",]", "]").replace(",}", "}").replace("}\n]", "}]")
            items = json.loads(text_fixed)
            if not isinstance(items, list):
                if isinstance(items, dict):
                    items = [items]
                else:
                    return []
        except json.JSONDecodeError:
            # 最后尝试: 逐行解析, 忽略无法解析的行
            logger.warning(f"LLM 增强输出 JSON 整体解析失败, 尝试逐项修复: {text[:200]}")
            items = _parse_json_fragment(text)
            if not items:
                return []

    # 标准化字段
    from app.services.text_normalizer import truncate_at_sentence_boundary

    result: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        chunk_id = str(item.get("chunk_id", "")).strip()
        if not chunk_id:
            continue

        viewpoint = str(item.get("viewpoint", "")).strip()
        keywords = item.get("keywords", [])
        if not isinstance(keywords, list):
            keywords = [str(keywords)] if keywords else []
        keywords = [str(k).strip()[:10] for k in keywords if k][:4]

        is_dup_of = str(item.get("is_duplicate_of", "")).strip()

        # 使用智能断句截断: 在句末标点处自然结束, 不硬切
        if len(viewpoint) > 150:
            viewpoint = truncate_at_sentence_boundary(viewpoint, 150)

        result.append({
            "chunk_id": chunk_id,
            "viewpoint": viewpoint,
            "keywords": keywords,
            "is_duplicate_of": is_dup_of,
        })

    return result


def _parse_json_fragment(text: str) -> list[dict]:
    """
    当 JSON 整体解析失败时, 尝试逐个提取对象
    用于处理 LLM 输出被截断但前几个对象完整的情况
    :param text: 疑似 JSON 片段
    :return: 解析出的对象列表
    """
    import re
    items: list[dict] = []

    # 用正则匹配每个 {...} 对象
    # 简单的平衡括号匹配
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                obj_str = text[start:i + 1]
                try:
                    obj = json.loads(obj_str)
                    if isinstance(obj, dict):
                        items.append(obj)
                except json.JSONDecodeError:
                    pass
                start = -1

    if items:
        logger.info(f"逐项解析恢复: {len(items)} 个对象")
    return items
