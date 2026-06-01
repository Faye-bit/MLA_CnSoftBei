"""
嵌入向量生成服务
调用 Embedding API (OpenAI 兼容接口) 将文本转换为向量
配置从 config_service 动态读取, 前端修改后即时生效
"""

from typing import List
from openai import AsyncOpenAI
from app.services.config_service import get_config_value
from loguru import logger


class Embedder:
    """
    文本嵌入向量生成器
    每次调用时读取最新的 API 配置, 支持运行时热切换
    """

    def _create_client(self):
        """ 根据当前配置创建 OpenAI 兼容客户端 """
        api_key = get_config_value("embedding_api_key")
        api_base = get_config_value("embedding_api_base")
        return AsyncOpenAI(api_key=api_key, base_url=api_base)

    async def embed_text(self, text: str) -> List[float]:
        """
        为单条文本生成嵌入向量
        :param text: 输入文本
        :return: 嵌入向量列表
        """
        client = self._create_client()
        model = get_config_value("embedding_model")
        response = await client.embeddings.create(model=model, input=text)
        return response.data[0].embedding

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成嵌入向量 (减少 API 调用次数, 提升效率)
        :param texts: 文本列表
        :return: 嵌入向量列表的列表
        """
        if not texts:
            return []

        client = self._create_client()
        model = get_config_value("embedding_model")
        response = await client.embeddings.create(model=model, input=texts)
        sorted_data = sorted(response.data, key=lambda x: x.index)
        embeddings = [item.embedding for item in sorted_data]
        logger.info(f"批量嵌入完成: {len(texts)} 条文本 → {len(embeddings)} 个向量")
        return embeddings

    async def embed_query(self, query: str) -> List[float]:
        """
        为查询文本生成嵌入向量
        :param query: 查询文本
        :return: 嵌入向量
        """
        return await self.embed_text(query)


# 全局嵌入器单例
embedder = Embedder()
