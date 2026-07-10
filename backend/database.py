"""数据库层：SQLite + Chroma 向量库"""
import uuid
import os
import json
import threading
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Float, Text, Integer, DateTime, JSON
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import numpy as np
from config import settings


# ============================================================
# SQLite
# ============================================================
database_url = settings.database_url or f"sqlite:///{settings.sqlite_path}"
engine_options = {"connect_args": {"check_same_thread": False}} if database_url.startswith("sqlite") else {"pool_pre_ping": True}
engine = create_engine(database_url, echo=False, **engine_options)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    created_at = Column(String, default=lambda: datetime.now().isoformat())


class Record(Base):
    __tablename__ = "records"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, default="default")
    content_text = Column(Text, nullable=False)
    image_url = Column(String)
    record_type = Column(String, default="此刻")
    emotion_dist = Column(JSON)  # 情绪分布
    valence = Column(Float)
    arousal = Column(Float)
    tags = Column(JSON)
    colors = Column(JSON)
    imagery_tags = Column(JSON)
    manual_mood = Column(String)
    created_at = Column(String, default=lambda: datetime.now().isoformat())


class Quote(Base):
    __tablename__ = "quotes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, default="default")
    book_id = Column(String)
    quote_text = Column(Text, nullable=False)
    highlight_color = Column(String)
    note = Column(Text)
    tags = Column(JSON)
    emotion_when_saved = Column(JSON)
    is_collected = Column(Integer, default=0)
    source = Column(Text)
    in_collage = Column(Integer, default=0)
    created_at = Column(String, default=lambda: datetime.now().isoformat())


class Book(Base):
    __tablename__ = "books"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    author = Column(String)
    cover = Column(String)
    category = Column(Text)
    collect_count = Column(Integer, default=0)
    last_read = Column(String)


class Poem(Base):
    __tablename__ = "poems"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, default="default")
    poem_text = Column(Text)
    source_record_ids = Column(JSON)
    author_style = Column(String)
    layout = Column(JSON)
    is_collected = Column(Integer, default=0)
    created_at = Column(String, default=lambda: datetime.now().isoformat())


class Word(Base):
    __tablename__ = "words"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, default="default")
    word = Column(String, nullable=False)
    language = Column(String)
    roman = Column(String)
    meaning = Column(Text)
    literal = Column(Text)
    is_coined = Column(Integer, default=0)
    valence = Column(Float)
    arousal = Column(Float)
    source_record_id = Column(String)
    created_at = Column(String, default=lambda: datetime.now().isoformat())


class ReadingFeedback(Base):
    __tablename__ = "reading_feedback"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    item_id = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False)
    book_title = Column(String)
    author = Column(String)
    category = Column(String)
    tags = Column(JSON)
    created_at = Column(String, default=lambda: datetime.now().isoformat())


class UserState(Base):
    __tablename__ = "user_states"

    user_id = Column(String, primary_key=True)
    state = Column(JSON, nullable=False, default=dict)
    updated_at = Column(String, default=lambda: datetime.now().isoformat(), onupdate=lambda: datetime.now().isoformat())


def init_db():
    """初始化数据库表"""
    Base.metadata.create_all(engine)


# ============================================================
# 轻量向量库(纯 Python + numpy,无需编译 hnswlib/chromadb)
# 用归一化向量的余弦相似度检索,接口兼容原 chroma 用法
# ============================================================
class SimpleVectorCollection:
    def __init__(self, name: str, path: str):
        self.name = name
        self.file = os.path.join(path, f"vec_{name}.json")
        self.ids: list[str] = []
        self.embs: list[list[float]] = []
        self.docs: list[str] = []
        self.metas: list[dict] = []
        self.lock = threading.RLock()
        self._load()

    def _load(self):
        if os.path.exists(self.file):
            try:
                with open(self.file, "r", encoding="utf-8") as f:
                    d = json.load(f)
                self.ids, self.embs = d.get("ids", []), d.get("embs", [])
                self.docs, self.metas = d.get("docs", []), d.get("metas", [])
            except Exception:
                pass

    def _save(self):
        temporary_file = f"{self.file}.tmp"
        with open(temporary_file, "w", encoding="utf-8") as f:
            json.dump(
                {"ids": self.ids, "embs": self.embs, "docs": self.docs, "metas": self.metas},
                f, ensure_ascii=False,
            )
        os.replace(temporary_file, self.file)

    def add(self, ids, embeddings, documents, metadatas):
        with self.lock:
            for i, e, doc, m in zip(ids, embeddings, documents, metadatas):
                if i in self.ids:
                    k = self.ids.index(i)
                    self.embs[k], self.docs[k], self.metas[k] = e, doc, m
                else:
                    self.ids.append(i); self.embs.append(e)
                    self.docs.append(doc); self.metas.append(m)
            self._save()

    def delete(self, ids):
        with self.lock:
            indexes = sorted((self.ids.index(item_id) for item_id in ids if item_id in self.ids), reverse=True)
            for index in indexes:
                self.ids.pop(index); self.embs.pop(index)
                self.docs.pop(index); self.metas.pop(index)
            if indexes:
                self._save()

    def query(self, query_embeddings, n_results: int = 5):
        with self.lock:
            if not self.embs:
                return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}
            q = np.asarray(query_embeddings[0], dtype=np.float32)
            M = np.asarray(self.embs, dtype=np.float32)
            sims = M @ q  # 向量已归一化,点积即余弦相似度
            order = list(np.argsort(-sims)[:n_results])
            return {
                "ids": [[self.ids[i] for i in order]],
                "documents": [[self.docs[i] for i in order]],
                "metadatas": [[self.metas[i] for i in order]],
                "distances": [[float(1.0 - sims[i]) for i in order]],
            }


quote_collection = None   # 书摘向量库
record_collection = None  # 用户记录向量库
word_collection = None    # 不可译词库


def init_chroma():
    """初始化向量集合(轻量纯 Python 实现)"""
    global quote_collection, record_collection, word_collection
    os.makedirs(settings.chroma_path, exist_ok=True)
    quote_collection = SimpleVectorCollection("quotes", settings.chroma_path)
    record_collection = SimpleVectorCollection("records", settings.chroma_path)
    word_collection = SimpleVectorCollection("words", settings.chroma_path)
