"""
文本清洗与规范化服务
对检索结果中的文本进行清洗, 去除 PDF 解析残留, 规范化空白,
并生成查询关键词的高亮位置信息供前端使用
"""

import re
from typing import List


# 中文句末标点字符集
CJK_SENTENCE_END = set("。！？…—")
# 英文句末标点字符集
EN_SENTENCE_END = set(".!?")
# 所有句末标点
ALL_SENTENCE_END = CJK_SENTENCE_END | EN_SENTENCE_END


def normalize_chunk_text(text: str) -> str:
    """
    清洗文本中的 PDF 解析残留, 规范化空白和断行
    处理步骤:
    1. 去除孤立的页码标记 (纯数字行, 行首/行尾的页码数字)
    2. 合并断行: 不以句末标点结尾的行与下一行合并
    3. 规范化空白: 折叠多余空格、制表符、换行符
    4. 去除页眉页脚残留 (过短的重复行)
    :param text: 原始文本
    :return: 清洗后的文本
    """
    if not text or not text.strip():
        return text or ""

    # Step 1: 去除页码标记 (多种变体)
    # 1a. 独立成行的纯数字 (1-4 位)
    text = re.sub(r'(?m)^\s*\d{1,4}\s*$', '', text)
    # 1b. 独立成行的 "第X页" / "Page X"
    text = re.sub(r'(?m)^\s*(第\s*\d+\s*页|Page\s+\d+)\s*$', '', text, flags=re.IGNORECASE)
    # 1c. 方括号/圆括号包裹的页码标记: [第39页]、[P39]、[Page 39]、(第5页) 等
    text = re.sub(r'[\[\(（]\s*(第\s*\d+\s*页|P(?:age)?\s*\d+)\s*[\]\)）]', '', text, flags=re.IGNORECASE)
    # 1d. 行首的 "[数字]" 格式页码残留: [39]、[1] 等
    text = re.sub(r'(?m)^\s*\[\d{1,4}\]\s*', '', text)

    # Step 2: 合并断行 — 如果一行不以句末标点结尾, 则与下一行用空格合并
    lines = text.split("\n")
    merged_lines: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue

        # 检查当前行是否以句末标点结尾
        last_char = line[-1] if line else ""
        if last_char in ALL_SENTENCE_END:
            # 以句末标点结尾, 保持独立
            merged_lines.append(line)
        else:
            # 不以句末标点结尾, 尝试与后续非空行合并
            combined = line
            j = i + 1
            while j < len(lines):
                next_line = lines[j].strip()
                if not next_line:
                    j += 1
                    continue
                # 检查下一行是否以句末标点开头 (说明是真正的断句)
                if next_line and next_line[0] in ALL_SENTENCE_END:
                    break
                # 合并且继续
                combined += " " + next_line
                j += 1
                # 如果合并后的行以句末标点结尾, 停止合并
                if combined and combined[-1] in ALL_SENTENCE_END:
                    break
            merged_lines.append(combined)
            i = j
            continue
        i += 1

    text = "\n".join(merged_lines)

    # Step 3: 规范化空白
    # 将多个空格/制表符合并为单个空格
    text = re.sub(r'[ \t]+', ' ', text)
    # 将 3 个及以上的连续换行合并为 2 个换行 (保留段落间距)
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 去除行首行尾空格
    text = text.strip()
    # 去除行尾多余空格
    text = re.sub(r' +$', '', text, flags=re.MULTILINE)

    # Step 4: 去除页眉页脚残留 — 在所有行中出现 2 次以上的短行 (<=30字, 可能是页眉)
    lines = text.split("\n")
    if len(lines) >= 3:
        short_lines: dict[str, int] = {}
        for line in lines:
            stripped = line.strip()
            if 2 <= len(stripped) <= 30:
                short_lines[stripped] = short_lines.get(stripped, 0) + 1
        # 删除出现次数 >= ceil(n/5) 的重复短行 (页眉页脚特征)
        threshold = max(2, len(lines) // 5 + 1)
        repetitive_short = {k for k, v in short_lines.items() if v >= threshold}
        if repetitive_short:
            text = "\n".join(
                line for line in lines
                if line.strip() not in repetitive_short
            )

    return text.strip()


def truncate_at_sentence_boundary(text: str, max_chars: int) -> str:
    """
    在句子边界处智能截断文本, 避免在句子中间截断
    优先在句末标点（。！？.!?）处截断, 次优在逗号/分号处截断
    :param text: 待截断的文本
    :param max_chars: 最大字符数
    :return: 截断后的文本, 保证在自然断句处结束
    """
    if not text or len(text) <= max_chars:
        return text or ""

    # 在 max_chars 范围内找最后一个句末标点
    window = text[:max_chars]
    # 从句末标点中找最靠后的位置
    sentence_ends = ["。", "！", "？", ".", "!", "?"]
    best_pos = -1
    for sep in sentence_ends:
        pos = window.rfind(sep)
        if pos > best_pos:
            best_pos = pos

    # 如果找到句末标点, 在其后截断
    if best_pos > max_chars * 0.4:  # 至少在前 40% 之后, 避免太短的截断
        return text[:best_pos + 1]

    # 次优: 在逗号、分号处截断
    secondary_ends = ["，", "；", ",", ";", "、"]
    for sep in secondary_ends:
        pos = window.rfind(sep)
        if pos > max_chars * 0.5:
            return text[:pos + 1] + "…"

    # 最后手段: 在 max_chars 处截断, 加省略号
    return text[:max_chars].rstrip() + "…"


def extract_query_terms(query: str) -> List[str]:
    """
    从查询文本中提取有意义的关键词列表
    中文按字符级分词, 英文按空格分词
    过滤掉过短或无意义的词汇
    :param query: 查询文本
    :return: 去重后的关键词列表
    """
    if not query or not query.strip():
        return []

    # 常见中文停用词
    stop_words = {
        "的", "了", "是", "在", "和", "也", "就", "都", "而", "及",
        "与", "着", "或", "一个", "没有", "我们", "你们", "他们",
        "它们", "自己", "什么", "哪", "那", "这", "吗", "呢", "吧",
        "啊", "但", "不", "还", "得", "个", "从", "以", "对", "将",
        "可以", "这个", "那个", "这些", "那些", "如何", "怎么",
        "怎样", "因为", "所以", "如果", "虽然", "但是", "然后",
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "can", "shall",
        "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "or", "and", "not", "no", "this", "that", "it", "its",
    }

    terms: list[str] = []

    # 按空格和标点拆分
    raw_terms = re.split(r'[\s,，。！？、；：""''（）\(\)\[\]【】/\\|@#$%^&*+=<>]+', query)

    for term in raw_terms:
        term = term.strip().lower()
        if not term:
            continue
        # 过滤停用词
        if term in stop_words:
            continue
        # 中文词汇: 至少1个中文字符
        if re.search(r'[一-鿿]', term):
            if len(term) >= 1:
                terms.append(term)
        # 英文词汇: 至少3个字符
        elif len(term) >= 3:
            terms.append(term)
        # 数字: 保留
        elif term.isdigit() and len(term) >= 2:
            terms.append(term)

    # 去重, 保持原顺序
    seen: set[str] = set()
    unique_terms: list[str] = []
    for t in terms:
        if t not in seen:
            seen.add(t)
            unique_terms.append(t)

    return unique_terms


def generate_keyword_highlights(text: str, query: str) -> List[dict]:
    """
    在文本中查找查询关键词的所有出现位置
    返回高亮位置列表供前端渲染
    :param text: 待高亮的文本
    :param query: 原始查询文本
    :return: [{keyword, positions: [[start, end], ...]}, ...]
    """
    if not text or not query:
        return []

    terms = extract_query_terms(query)
    if not terms:
        return []

    highlights: list[dict] = []
    text_lower = text.lower()

    for term in terms:
        positions: list[list[int]] = []
        term_lower = term.lower()
        start = 0

        while start < len(text_lower):
            pos = text_lower.find(term_lower, start)
            if pos == -1:
                break
            positions.append([pos, pos + len(term)])
            start = pos + 1

        if positions:
            highlights.append({
                "keyword": term,
                "positions": positions,
            })

    return highlights
