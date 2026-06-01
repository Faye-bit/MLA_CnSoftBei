"""
向量存储服务
基于 Chroma 管理文档切片的向量索引, 按课程隔离 collection
"""

import uuid
from typing import List, Optional
import chromadb
from chromadb.config import Settings as ChromaSettings
from app.core.config import settings
from loguru import logger


class VectorStore:
    """
    Chroma 向量数据库封装
    提供 collection 管理、向量写入和相似度检索功能
    """

    def __init__(self):
        """ 初始化 Chroma 持久化客户端 """
        self.client = chromadb.PersistentClient(
            path=settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )

    def _collection_name(self, course_id: uuid.UUID) -> str:
        """
        生成 collection 名称, 按课程隔离
        :param course_id: 课程 ID
        :return: collection 名称, 格式: course_{course_id}
        """
        return f"course_{course_id}"

    def get_or_create_collection(self, course_id: uuid.UUID):
        """
        获取或创建课程的 collection
        :param course_id: 课程 ID
        :return: Chroma Collection 对象
        """
        name = self._collection_name(course_id)
        return self.client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},  # 使用余弦相似度
        )

    def delete_collection(self, course_id: uuid.UUID):
        """
        删除课程的 collection (删除课程时调用)
        :param course_id: 课程 ID
        """
        name = self._collection_name(course_id)
        try:
            self.client.delete_collection(name)
            logger.info(f"已删除向量集合: {name}")
        except Exception as e:
            logger.warning(f"删除向量集合失败 (可能不存在): {e}")

    def add_chunks(
        self,
        course_id: uuid.UUID,
        chunk_ids: List[uuid.UUID],
        embeddings: List[List[float]],
        contents: List[str],
        metadatas: List[dict],
    ):
        """
        批量写入切片向量到 Chroma
        :param course_id: 课程 ID
        :param chunk_ids: 切片 ID 列表 (用作 Chroma document id)
        :param embeddings: 嵌入向量列表
        :param contents: 切片文本内容列表
        :param metadatas: 切片元数据列表
        """
        if not chunk_ids:
            return

        collection = self.get_or_create_collection(course_id)
        collection.add(
            ids=[str(cid) for cid in chunk_ids],
            embeddings=embeddings,
            documents=contents,
            metadatas=metadatas,
        )
        logger.info(f"向量写入完成: 课程={course_id}, 切片数={len(chunk_ids)}")

    def remove_chunks(self, course_id: uuid.UUID, chunk_ids: List[uuid.UUID]):
        """
        从 Chroma 中删除指定切片
        :param course_id: 课程 ID
        :param chunk_ids: 待删除的切片 ID 列表
        """
        if not chunk_ids:
            return
        collection = self.get_or_create_collection(course_id)
        collection.delete(ids=[str(cid) for cid in chunk_ids])
        logger.info(f"向量删除完成: 课程={course_id}, 切片数={len(chunk_ids)}")

    def search(
        self,
        course_id: uuid.UUID,
        query_embedding: List[float],
        top_k: int = 5,
    ) -> List[dict]:
        """
        在课程向量空间中检索最相似的切片
        :param course_id: 课程 ID
        :param query_embedding: 查询向量
        :param top_k: 返回结果数
        :return: 检索结果列表 [{id, content, metadata, score}, ...]
        """
        collection = self.get_or_create_collection(course_id)
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

        # 将 Chroma 的返回格式转换为更易使用的结果列表
        items: list[dict] = []
        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                distance = results["distances"][0][i] if results["distances"] else 0.0
                # 余弦距离 → 相似度分数 (余弦距离范围 [0, 2], 转换为 [0, 1] 相似度)
                similarity = 1.0 - (distance / 2.0)
                items.append({
                    "id": doc_id,
                    "content": results["documents"][0][i] if results["documents"] else "",
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "score": round(similarity, 4),
                })

        logger.info(f"向量检索完成: 查询词长度={len(query_embedding)}, 结果数={len(items)}")
        return items


# 全局向量存储单例
vector_store = VectorStore()
