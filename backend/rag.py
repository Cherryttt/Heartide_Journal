"""RAG 向量检索 + Embedding"""
import numpy as np
from sentence_transformers import SentenceTransformer
import database
from config import settings


class EmbeddingService:
    """本地 Embedding 服务（不消耗 API 额度）"""

    def __init__(self):
        self.model = None
        self.model_name = settings.embedding_model

    def _load_model(self):
        if self.model is None:
            print(f"正在加载 embedding 模型: {self.model_name}...")
            self.model = SentenceTransformer(self.model_name)
            print("embedding 模型加载完成")
        return self.model

    def encode(self, texts: list[str]) -> list[list[float]]:
        model = self._load_model()
        embeddings = model.encode(texts, normalize_embeddings=True)
        return embeddings.tolist()

    def encode_single(self, text: str) -> list[float]:
        return self.encode([text])[0]


# 全局单例
embedding_service = EmbeddingService()


class RAGService:
    """RAG 检索服务"""

    async def search_quotes(self, query: str, user_id: str, top_k: int = 5) -> list[dict]:
        """搜索相关书摘"""
        if database.quote_collection is None:
            return []
        query_emb = embedding_service.encode_single(query)
        results = database.quote_collection.query(
            query_embeddings=[query_emb],
            n_results=100,
        )
        items = self._format_results(results, "书摘")
        with database.SessionLocal() as db:
            allowed_ids = {
                row[0] for row in db.query(database.Quote.id)
                .filter(database.Quote.user_id == user_id, database.Quote.id.in_([item["id"] for item in items]))
                .all()
            }
        return [item for item in items if item["id"] in allowed_ids][:top_k]

    async def search_records(self, query: str, user_id: str, top_k: int = 5) -> list[dict]:
        """搜索用户历史记录"""
        if database.record_collection is None:
            return []
        query_emb = embedding_service.encode_single(query)
        results = database.record_collection.query(
            query_embeddings=[query_emb],
            n_results=100,
        )
        items = self._format_results(results, "记录")
        with database.SessionLocal() as db:
            allowed_ids = {
                row[0] for row in db.query(database.Record.id)
                .filter(database.Record.user_id == user_id, database.Record.id.in_([item["id"] for item in items]))
                .all()
            }
        return [item for item in items if item["id"] in allowed_ids][:top_k]

    async def search_words(self, query: str, user_id: str, top_k: int = 5) -> list[dict]:
        """搜索不可译情绪词"""
        if database.word_collection is None:
            return []
        query_emb = embedding_service.encode_single(query)
        results = database.word_collection.query(
            query_embeddings=[query_emb],
            n_results=100,
        )
        items = self._format_results(results, "词库")
        with database.SessionLocal() as db:
            allowed_ids = {
                row[0] for row in db.query(database.Word.id)
                .filter(database.Word.user_id == user_id, database.Word.id.in_([item["id"] for item in items]))
                .all()
            }
        return [item for item in items if item["id"] in allowed_ids][:top_k]

    async def context_for_agent(self, query: str, user_id: str) -> str:
        """为 Agent 聚合多知识库检索结果"""
        quotes = await self.search_quotes(query, user_id, top_k=3)
        records = await self.search_records(query, user_id, top_k=2)

        parts = []
        if quotes:
            parts.append("【相关书摘】\n" + "\n".join(
                f"- {q['text']} (来源: {q.get('source', '未知')})" for q in quotes
            ))
        if records:
            parts.append("【你的历史记录】\n" + "\n".join(
                f"- {r['text']}" for r in records
            ))

        return "\n\n".join(parts) if parts else ""

    def _format_results(self, results: dict, source_type: str) -> list[dict]:
        if not results or not results.get("ids") or not results["ids"][0]:
            return []

        formatted = []
        ids = results["ids"][0]
        metadatas = results.get("metadatas", [[]])[0]
        documents = results.get("documents", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for i in range(len(ids)):
            meta = metadatas[i] if i < len(metadatas) else {}
            formatted.append({
                "id": ids[i],
                "text": documents[i] if i < len(documents) else "",
                "source": source_type,
                "distance": distances[i] if i < len(distances) else 1.0,
                **meta,
            })
        return formatted

    def add_quote(self, quote_id: str, text: str, metadata: dict = None):
        """向向量库添加书摘"""
        if database.quote_collection is None:
            return
        emb = embedding_service.encode_single(text)
        database.quote_collection.add(
            ids=[quote_id],
            embeddings=[emb],
            documents=[text],
            metadatas=[metadata or {}],
        )

    def add_record(self, record_id: str, text: str, metadata: dict = None):
        """向向量库添加用户记录"""
        if database.record_collection is None:
            return
        emb = embedding_service.encode_single(text)
        database.record_collection.add(
            ids=[record_id],
            embeddings=[emb],
            documents=[text],
            metadatas=[metadata or {}],
        )

    def remove_record(self, record_id: str):
        if database.record_collection is not None:
            database.record_collection.delete([record_id])

    def add_word(self, word_id: str, word: str, metadata: dict = None):
        """向不可译词库添加已收藏词。"""
        if database.word_collection is None:
            return
        emb = embedding_service.encode_single(" ".join([
            word,
            (metadata or {}).get("meaning", ""),
            (metadata or {}).get("reason", ""),
        ]))
        database.word_collection.add(
            ids=[word_id],
            embeddings=[emb],
            documents=[word],
            metadatas=[metadata or {}],
        )


# 全局单例
rag_service = RAGService()
