"""
文本切片服务
将长文本按语义边界递归切分为适合向量检索的小块
"""

import re
from typing import List
from loguru import logger


class RecursiveTextSplitter:
    """
    递归文本切片器
    按优先级递减的分隔符列表递归切分文本:
    先尝试双换行 → 单换行 → 句号 → 逗号 → 空格 → 单字符拆分
    每个切片保持 chunk_size 大小, 相邻切片有 chunk_overlap 重叠
    """

    # 分隔符优先级列表: 从粗粒度到细粒度
    SEPARATORS = ["\n\n", "\n", "。", ".", "，", ",", " ", ""]

    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 50):
        """
        初始化切片器
        :param chunk_size: 每个切片的 token 数上限 (近似值)
        :param chunk_overlap: 相邻切片之间的重叠 token 数
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def _estimate_tokens(self, text: str) -> int:
        """
        估算文本的 token 数
        中文按字符数, 英文按空格分词数
        :param text: 输入文本
        :return: 估算的 token 数
        """
        # 简化估算: 中文字符 ≈ 1 token, 英文单词 ≈ 1.3 token
        chinese_chars = len(re.findall(r'[一-鿿]', text))
        other_text = re.sub(r'[一-鿿]', '', text)
        english_words = len(other_text.split())
        return chinese_chars + int(english_words * 1.3)

    def split_text(self, text: str) -> List[str]:
        """
        将文本切分为指定大小的切片列表
        :param text: 输入文本
        :return: 切片文本列表
        """
        if not text or not text.strip():
            return []

        # 估算总 token 数, 如果已经小于 chunk_size 则直接返回
        if self._estimate_tokens(text) <= self.chunk_size:
            return [text.strip()]

        # 递归切分
        chunks = self._split_recursive(text, self.SEPARATORS)
        # 合并过短的切片到前一个切片
        chunks = self._merge_short_chunks(chunks)
        logger.info(f"文本切片完成: 共 {len(chunks)} 个切片")
        return chunks

    def _split_recursive(self, text: str, separators: List[str]) -> List[str]:
        """
        递归切分文本
        :param text: 当前待切分文本
        :param separators: 剩余分隔符列表
        :return: 切片列表
        """
        # 如果文本已经足够小, 直接返回
        if self._estimate_tokens(text) <= self.chunk_size:
            return [text.strip()] if text.strip() else []

        # 没有更多分隔符可用时, 强制按字符切分
        if not separators:
            return self._force_split(text)

        separator = separators[0]
        remaining_separators = separators[1:]

        # 当前分隔符无法切分时, 使用下一级分隔符
        if separator and separator not in text:
            return self._split_recursive(text, remaining_separators)

        if not separator:  # 空分隔符 → 逐字符切分
            return self._force_split(text)

        # 按分隔符切分
        splits = text.split(separator)
        chunks: list[str] = []
        current_chunk: str = ""

        for split in splits:
            # 尝试将 split 加入当前块
            candidate = current_chunk + (separator if current_chunk else "") + split
            if self._estimate_tokens(candidate) <= self.chunk_size:
                current_chunk = candidate
            else:
                # 当前块已满, 保存并开始新块
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())

                # 如果 split 本身超过 chunk_size, 递归切分
                if self._estimate_tokens(split) > self.chunk_size:
                    sub_chunks = self._split_recursive(split, remaining_separators)
                    # 最后一个子块作为新块的开始 (保证 overlap)
                    if sub_chunks:
                        chunks.extend(sub_chunks[:-1])
                        current_chunk = sub_chunks[-1]
                    else:
                        current_chunk = ""
                else:
                    current_chunk = split

        # 添加最后一个块
        if current_chunk.strip():
            chunks.append(current_chunk.strip())

        return chunks

    def _force_split(self, text: str) -> List[str]:
        """
        强制按 chunk_size 逐字符切分文本 (最后手段)
        :param text: 待切分文本
        :return: 按固定大小切分后的列表
        """
        chunks: list[str] = []
        step = self.chunk_size - self.chunk_overlap
        start = 0
        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            chunks.append(text[start:end].strip())
            if end >= len(text):
                break
            start += step
        return chunks

    def _merge_short_chunks(self, chunks: List[str]) -> List[str]:
        """
        合并过短的切片到前一个切片, 避免碎片化
        :param chunks: 原始切片列表
        :return: 合并后的切片列表
        """
        if not chunks:
            return chunks

        min_size = self.chunk_size // 4  # 最小切片大小为 chunk_size 的 1/4
        merged: list[str] = []

        for chunk in chunks:
            if merged and self._estimate_tokens(chunk) < min_size:
                # 过短切片合并到前一个
                merged[-1] = merged[-1] + "\n" + chunk
            else:
                merged.append(chunk)

        return merged


def estimate_token_count(text: str) -> int:
    """
    估算文本 token 数的工具函数
    :param text: 输入文本
    :return: 估算的 token 数量
    """
    splitter = RecursiveTextSplitter()
    return splitter._estimate_tokens(text)
