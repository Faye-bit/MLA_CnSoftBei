"""
嵌入向量生成服务
调用 OpenAI Embedding API (或兼容接口) 将文本转换为向量
"""

from typing import List
from openai import AsyncOpenAI
from app.core.config import settings
from loguru import logger


class Embedder:
    """
    文本嵌入向量生成器
    支持 OpenAI 及其兼容 API (如通义千问、智谱、DeepSeek 等)
    """

    def __init__(self):
        """ 初始化 OpenAI 客户端 """
        self.client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_api_base,
        )
        self.model = settings.embedding_model

    async def embed_text(self, text: str) -> List[float]:
        """
        为单条文本生成嵌入向量
        :param text: 输入文本
        :return: 嵌入向量列表
        """
        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成嵌入向量 (提升效率)
        :param texts: 文本列表
        :return: 嵌入向量列表
        """
        if not texts:
            return []

        response = await self.client.embeddings.create(
            model=self.model,
            input=texts,
        )
        # 按索引排序以确保顺序一致
        sorted_data = sorted(response.data, key=lambda x: x.index)
        embeddings = [item.embedding for item in sorted_data]
        logger.info(f"批量嵌入完成: {len(texts)} 条文本 → {len(embeddings)} 个向量")
        return embeddings

    async def embed_query(self, query: str) -> List[float]:
        """
        为查询文本生成嵌入向量 (与 embed_text 相同, 但语义上区分查询和文档)
        :param query: 查询文本
        :return: 嵌入向量
        """
        return await self.embed_text(query)


# 全局嵌入器单例
embedder = Embedder()
