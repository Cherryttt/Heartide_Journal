"""Pydantic 数据模型"""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=40)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str


# --- 情绪分析 ---
class EmotionItem(BaseModel):
    mood: str
    probability: float
    color: str


class EmotionAnalysis(BaseModel):
    emotions: list[EmotionItem]
    valence: float
    arousal: float
    tags: list[str]
    colors: list[str]
    imagery: list[str]
    confidence: float = 0.0
    model_source: str = "unknown"
    calibrated: bool = False
    risk_level: str = "none"
    safety_message: Optional[str] = None


# --- 记录 ---
class RecordCreate(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    record_type: str = Field(default="此刻", max_length=40)  # 吃喝 | 书摘 | 灵感 | 此刻
    image_url: Optional[str] = Field(default=None, max_length=2048)
    manual_mood: Optional[str] = Field(default=None, max_length=40)


class RecordResponse(BaseModel):
    id: str
    text: str
    record_type: str
    emotions: list[EmotionItem]
    valence: float
    arousal: float
    tags: list[str]
    colors: list[str]
    imagery: list[str]
    manual_mood: Optional[str] = None
    image_url: Optional[str] = None
    created_at: str
    confidence: float = 0.0
    model_source: str = "unknown"
    calibrated: bool = False
    risk_level: str = "none"
    safety_message: Optional[str] = None


# --- Agent 对话 ---
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    persona_key: str = Field(default="加缪", max_length=80)
    history: list[dict] = Field(default_factory=list, max_length=30)  # [{role, text}]


class ChatResponse(BaseModel):
    reply: str
    source: Optional[str] = None
    recommendation: Optional[dict] = None  # {quote, book}


# --- 拼贴诗 ---
class PoemGenerateRequest(BaseModel):
    style: str = Field(default="随机", max_length=80)  # 海子 | 村上 | 聂鲁达 | 泰戈尔 | ...
    records: Optional[list[str]] = Field(default=None, max_length=50)  # 关联的记录 ID 列表


class PoemResponse(BaseModel):
    poem_text: str
    style: str
    source_records: list[str]


class FragmentRewriteRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=50)
    style: str = Field(default="保留原声", max_length=80)


class FragmentRewriteResponse(BaseModel):
    lines: list[str]


class JournalImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


# --- 书摘导入 ---
class QuoteImport(BaseModel):
    quote_text: str = Field(min_length=1, max_length=10000)
    book_title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=200)
    note: Optional[str] = Field(default=None, max_length=5000)
    highlight_color: Optional[str] = Field(default=None, max_length=50)


class QuoteTextImport(BaseModel):
    text: str = Field(min_length=1, max_length=500000)


# --- 拾词 ---
class WordFindRequest(BaseModel):
    feeling_text: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    avoid_words: list[str] = Field(default_factory=list, max_length=30)


class WordResponse(BaseModel):
    word: str
    language: str
    roman: str
    meaning: str
    literal: str
    is_coined: bool
    reason: str


class WordSaveRequest(WordResponse):
    source_record_id: Optional[str] = None


# --- 动态阅读推荐 ---
class ReadingFeedbackRequest(BaseModel):
    item_id: str
    action: str
    book_title: str
    author: str = ""
    category: str = ""
    tags: list[str] = Field(default_factory=list)


class ReadingRecommendationItem(BaseModel):
    id: str
    quote: str
    book: str
    author: str
    cover: str
    reason: str
    bg_color: str
    text_color: str
    passage: str
    tags: list[str]
    score: float


class ReadingRecommendationResponse(BaseModel):
    items: list[ReadingRecommendationItem]
    profile_summary: list[str]


# --- 账号云同步 ---
class UserStatePayload(BaseModel):
    books: list[dict[str, Any]] = Field(default_factory=list)
    seen_book_ids: list[str] = Field(default_factory=list)
    journal_materials: list[dict[str, Any]] = Field(default_factory=list)
    journals: dict[str, dict[str, Any]] = Field(default_factory=dict)
    reading_feedback: dict[str, dict[str, int]] = Field(default_factory=dict)
    updated_at: Optional[str] = None
