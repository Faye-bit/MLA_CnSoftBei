"""
嵌入向量生成服务
调用 Embedding API (OpenAI 兼容接口) 将文本转换为向量
支持 OpenAI、Ollama、智谱、通义千问等所有兼容接口
"""

from typing import List
from openai import AsyncOpenAI
from app.core.config import settings
from loguru import logger


class Embedder:
    """
    文本嵌入向量生成器
    使用独立的 Embedding API 配置, 可与 LLM 使用不同服务商
    例如: LLM 用 DeepSeek, Embedding 用 OpenAI 或本地 Ollama
    """

    def __init__(self):
        """ 初始化 Embedding 专用 OpenAI 兼容客户端 """
        self.client = AsyncOpenAI(
            api_key=settings.embedding_api_key,
            base_url=settings.embedding_api_base,
        )
        self.model = settings.embedding_model

    async def embed_text(self, text: str) -> List[float]:
        """
        为单条文本生成嵌入向量
        :param text: 输入文本
        :return: 嵌入向量列表 (维度取决于模型)
        """
        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成嵌入向量 (减少 API 调用次数, 提升效率)
        :param texts: 文本列表
        :return: 嵌入向量列表的列表
        """
        if not texts:
            return []

        response = await self.client.embeddings.create(
            model=self.model,
            input=texts,
        )
        # 按索引排序以确保嵌入向量与输入文本顺序一致
        sorted_data = sorted(response.data, key=lambda x: x.index)
        embeddings = [item.embedding for item in sorted_data]
        logger.info(f"批量嵌入完成: {len(texts)} 条文本 → {len(embeddings)} 个向量")
        return embeddings

    async def embed_query(self, query: str) -> List[float]:
        """
        为查询文本生成嵌入向量
        语义上与 embed_text 相同, 但标记为 query 用途以便后续可能的优化
        :param query: 查询文本
        :return: 嵌入向量
        """
        return await self.embed_text(query)


# 全局嵌入器单例
embedder = Embedder()
