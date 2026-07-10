"""
MoodGarden 后端 API 服务
FastAPI + SQLite + Chroma + 智谱 LLM
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text
from PIL import Image
import httpx
import base64
import json
from io import BytesIO

from config import settings
from database import init_db, init_chroma, SessionLocal, Record, Quote, Book, Poem, Word, User, ReadingFeedback, UserState
from models import (
    RecordCreate, RecordResponse, EmotionAnalysis,
    ChatRequest, ChatResponse,
    PoemGenerateRequest, PoemResponse,
    FragmentRewriteRequest, FragmentRewriteResponse, JournalImageRequest,
    QuoteImport, QuoteTextImport, WordFindRequest, WordResponse, WordSaveRequest,
    RegisterRequest, LoginRequest, DeleteAccountRequest, TokenResponse, UserResponse,
    ReadingFeedbackRequest, ReadingRecommendationResponse, UserStatePayload,
)
from auth import hash_password, verify_password, create_access_token, get_current_user
from storage import upload_file, delete_user_assets, storage_configured
from rate_limit import RateLimitMiddleware, RequestSizeLimitMiddleware
from monitoring import MetricsMiddleware, metrics_app, observe_crisis, observe_emotion, observe_emotion_fallback, observe_recommendation_feedback
from llm_client import llm_client
from emotion_classifier import classifier
from rag import rag_service
from wechat_read_api import get_wechat_read_client
from wechat_read import parse_wechat_read_export, import_quotes_to_db, export_wechat_read_guide
from safety import detect_crisis, crisis_response
from reading_recommender import recommend_for_user


# ============================================================
# 应用生命周期
# ============================================================
def validate_production_settings():
    if settings.debug:
        return
    problems = []
    if settings.jwt_secret == "change-me-before-production" or len(settings.jwt_secret) < 32:
        problems.append("JWT_SECRET 必须是至少 32 位的随机字符串")
    if not settings.database_url.startswith(("postgresql://", "postgresql+")):
        problems.append("生产环境必须配置 PostgreSQL DATABASE_URL")
    if settings.weread_api_key and not settings.weread_owner_email:
        problems.append("配置 WEREAD_API_KEY 时必须同时配置 WEREAD_OWNER_EMAIL")
    if problems:
        raise RuntimeError("生产配置不完整：" + "；".join(problems))


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🌱 MoodGarden 后端启动中...")
    validate_production_settings()
    init_db()
    init_chroma()
    print("✅ 数据库初始化完成")
    print(f"   API 密钥: {'已配置' if settings.zhipu_api_key else '❌ 未配置（.env 中设置 ZHIPU_API_KEY）'}")
    yield
    print("👋 MoodGarden 后端关闭")


app = FastAPI(
    title="MoodGarden API",
    description="智能情绪疗愈手帐系统后端",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(MetricsMiddleware)
app.mount("/metrics", metrics_app)
app.mount("/uploads", StaticFiles(directory="data/uploads", check_dir=False), name="uploads")


# ============================================================
# 辅助
# ============================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def resolve_emotion(text: str) -> dict:
    result = classifier.classify(text)
    if result.get("needs_llm_fallback"):
        observe_emotion_fallback()
        result = await classifier.classify_with_llm(text, fallback=result)
    observe_emotion(result)
    observe_crisis("emotion", result.get("risk_level", "none"))
    return result


async def make_displayable_image_url(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        return url
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "MoodGarden/0.2"})
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/png").split(";")[0].strip()
            content = response.content
            if not content_type.startswith("image/"):
                return url
            try:
                image = Image.open(BytesIO(content))
                image.thumbnail((1400, 1400))
                if image.mode not in ("RGB", "RGBA"):
                    image = image.convert("RGB")
                output = BytesIO()
                image.save(output, format="WEBP", quality=82, method=4)
                encoded = base64.b64encode(output.getvalue()).decode("ascii")
                return f"data:image/webp;base64,{encoded}"
            except Exception:
                if len(content) <= 6 * 1024 * 1024:
                    encoded = base64.b64encode(content).decode("ascii")
                    return f"data:{content_type};base64,{encoded}"
                return url
    except Exception:
        return url


@app.get("/api/weather/approx")
async def approximate_weather(current_user: User = Depends(get_current_user)):
    """HTTP 页面无法使用浏览器定位时，由后端按公网 IP 查询城市级天气。"""
    async with httpx.AsyncClient(timeout=12, follow_redirects=True, trust_env=False) as client:
        location = None
        for url in ("https://ipwho.is/", "https://ipapi.co/json/"):
            try:
                response = await client.get(url, headers={"User-Agent": "MoodGarden/0.2"})
                data = response.json()
                latitude = data.get("latitude")
                longitude = data.get("longitude")
                if response.is_success and latitude is not None and longitude is not None:
                    location = {"latitude": latitude, "longitude": longitude, "city": data.get("city") or ""}
                    break
            except Exception:
                continue
        if not location:
            raise HTTPException(503, "暂时无法获取城市位置")
        try:
            response = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": location["latitude"],
                    "longitude": location["longitude"],
                    "current": "weather_code,temperature_2m",
                    "timezone": "auto",
                },
            )
            response.raise_for_status()
            current = response.json().get("current") or {}
            return {
                "city": location["city"],
                "weather_code": current.get("weather_code"),
                "temperature": current.get("temperature_2m"),
            }
        except Exception as exc:
            raise HTTPException(503, "暂时无法获取城市天气") from exc


# ============================================================
# 登录鉴权
# ============================================================
@app.post("/api/auth/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "该邮箱已注册")
    user = User(email=email, password_hash=hash_password(req.password), display_name=req.display_name.strip())
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id))


@app.post("/api/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email.strip().lower()).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "邮箱或密码错误")
    return TokenResponse(access_token=create_access_token(user.id))


@app.get("/api/auth/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return UserResponse(id=current_user.id, email=current_user.email, display_name=current_user.display_name)


@app.delete("/api/auth/account")
async def delete_account(
    req: DeleteAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(req.password, current_user.password_hash):
        raise HTTPException(403, "密码错误，账号未注销")

    record_ids = [row[0] for row in db.query(Record.id).filter(Record.user_id == current_user.id).all()]
    quote_ids = [row[0] for row in db.query(Quote.id).filter(Quote.user_id == current_user.id).all()]
    word_ids = [row[0] for row in db.query(Word.id).filter(Word.user_id == current_user.id).all()]
    try:
        delete_user_assets(current_user.id)
    except Exception as exc:
        raise HTTPException(503, "上传图片删除失败，账号尚未注销，请稍后重试") from exc

    for model in (Record, Quote, Poem, Word, ReadingFeedback, UserState):
        db.query(model).filter(model.user_id == current_user.id).delete(synchronize_session=False)
    db.query(User).filter(User.id == current_user.id).delete(synchronize_session=False)
    db.commit()

    import database
    if database.record_collection is not None:
        database.record_collection.delete(record_ids)
    if database.quote_collection is not None:
        database.quote_collection.delete(quote_ids)
    if database.word_collection is not None:
        database.word_collection.delete(word_ids)
    return {"deleted": True}


def normalize_user_state(payload: UserStatePayload) -> dict:
    """限制同步文档体积，避免异常客户端无限写入。"""
    state = payload.model_dump(exclude={"updated_at"})
    state["books"] = state["books"][:500]
    state["seen_book_ids"] = list(dict.fromkeys(state["seen_book_ids"]))[:2000]
    state["journal_materials"] = state["journal_materials"][:500]
    state["journals"] = dict(list(state["journals"].items())[-1000:])
    state["reading_feedback"] = dict(list(state["reading_feedback"].items())[-2000:])
    if len(json.dumps(state, ensure_ascii=False)) > 2 * 1024 * 1024:
        raise HTTPException(413, "同步数据不能超过 2MB")
    return state


@app.get("/api/sync/state")
async def get_sync_state(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(UserState).filter(UserState.user_id == current_user.id).first()
    state = row.state if row else UserStatePayload().model_dump()
    return {**state, "updated_at": row.updated_at if row else None}


@app.put("/api/sync/state")
async def put_sync_state(
    payload: UserStatePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    state = normalize_user_state(payload)
    row = db.query(UserState).filter(UserState.user_id == current_user.id).first()
    if row:
        if payload.updated_at != row.updated_at:
            raise HTTPException(409, {"message": "另一台设备刚刚更新了数据，请重新合并", "updated_at": row.updated_at})
        row.state = state
    else:
        row = UserState(user_id=current_user.id, state=state)
        db.add(row)
    db.commit()
    db.refresh(row)
    return {**state, "updated_at": row.updated_at}


@app.post("/api/assets/upload")
async def upload_asset(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    return {"url": upload_file(file, current_user.id)}


@app.post("/api/images/describe")
async def describe_image(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """直接读取照片氛围，供拾词页面把图像转成感受描述。"""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "请选择图片文件")
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(413, "图片不能超过 8MB")
    image_url = f"data:{file.content_type};base64,{base64.b64encode(content).decode('ascii')}"
    try:
        return {"description": await llm_client.describe_image(image_url)}
    except Exception as exc:
        raise HTTPException(502, "图片理解服务暂时不可用") from exc


# ============================================================
# 情绪分析
# ============================================================
@app.get("/api/analyze", response_model=EmotionAnalysis)
async def analyze_emotion(text: str = "", current_user: User = Depends(get_current_user)):
    """分析文本情绪（规则优先，LLM 兜底）"""
    if not text:
        raise HTTPException(400, "请提供文本内容")

    return await resolve_emotion(text)


# ============================================================
# 记录 CRUD
# ============================================================
@app.post("/api/records", response_model=RecordResponse)
async def create_record(req: RecordCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """创建一条情绪记录"""
    # 情绪分析
    emo_result = await resolve_emotion(req.text)

    # 存入 SQLite
    record = Record(
        user_id=current_user.id,
        content_text=req.text,
        record_type=req.record_type,
        image_url=req.image_url,
        emotion_dist=emo_result["emotions"],
        valence=emo_result["valence"],
        arousal=emo_result["arousal"],
        tags=emo_result["tags"],
        colors=emo_result["colors"],
        imagery_tags=emo_result["imagery"],
        manual_mood=req.manual_mood,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # 存入向量库
    rag_service.add_record(
        record.id,
        req.text,
        metadata={"type": req.record_type, "mood": req.manual_mood or "", "user_id": current_user.id},
    )

    return RecordResponse(
        id=record.id,
        text=req.text,
        record_type=req.record_type,
        emotions=emo_result["emotions"],
        valence=emo_result["valence"],
        arousal=emo_result["arousal"],
        tags=emo_result["tags"],
        colors=emo_result["colors"],
        imagery=emo_result["imagery"],
        manual_mood=req.manual_mood,
        image_url=record.image_url,
        created_at=record.created_at,
        confidence=emo_result.get("confidence", 0.0),
        model_source=emo_result.get("model_source", "unknown"),
        calibrated=emo_result.get("calibrated", False),
        risk_level=emo_result.get("risk_level", "none"),
        safety_message=emo_result.get("safety_message"),
    )


@app.get("/api/records")
async def list_records(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取所有记录"""
    records = db.query(Record).filter(Record.user_id == current_user.id).order_by(Record.created_at.desc()).limit(50).all()
    return [
        RecordResponse(
            id=r.id,
            text=r.content_text,
            record_type=r.record_type,
            emotions=r.emotion_dist or [],
            valence=r.valence or 0.5,
            arousal=r.arousal or 0.3,
            tags=r.tags or [],
            colors=r.colors or [],
            imagery=r.imagery_tags or [],
            manual_mood=r.manual_mood,
            image_url=r.image_url,
            created_at=r.created_at,
        )
        for r in records
    ]


@app.delete("/api/records/{record_id}")
async def delete_record(record_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """删除一条记录"""
    record = db.query(Record).filter(Record.id == record_id, Record.user_id == current_user.id).first()
    if not record:
        raise HTTPException(404, "记录不存在")
    db.delete(record)
    db.commit()
    rag_service.remove_record(record_id)
    return {"ok": True}


# ============================================================
# Agent 对话
# ============================================================
@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, current_user: User = Depends(get_current_user)):
    """Agent 对话（带 RAG 检索）"""
    crisis = detect_crisis(req.message)
    if crisis["risk_level"] != "none":
        observe_crisis("chat", crisis["risk_level"])
        return ChatResponse(reply=crisis_response(crisis["risk_level"]), source="安全优先回应")
    # 先检索知识库
    context = await rag_service.context_for_agent(req.message, current_user.id)

    # 调用 LLM
    result = await llm_client.agent_chat(
        persona_key=req.persona_key,
        message=req.message,
        history=req.history,
        context=context,
    )

    return ChatResponse(
        reply=result["reply"],
        source="知识库 + LLM" if context else "LLM",
    )


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest, current_user: User = Depends(get_current_user)):
    crisis = detect_crisis(req.message)
    if crisis["risk_level"] != "none":
        observe_crisis("chat_stream", crisis["risk_level"])

        async def safety_stream():
            yield crisis_response(crisis["risk_level"])

        return StreamingResponse(safety_stream(), media_type="text/plain; charset=utf-8")
    context = await rag_service.context_for_agent(req.message, current_user.id)
    return StreamingResponse(
        llm_client.agent_chat_stream(req.persona_key, req.message, req.history, context),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ============================================================
# 动态阅读推荐
# ============================================================
@app.get("/api/recommendations/reading", response_model=ReadingRecommendationResponse)
async def reading_recommendations(
    count: int = 12,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, profile_summary = recommend_for_user(db, current_user.id, min(max(count, 1), 30), max(offset, 0))
    return {"items": items, "profile_summary": profile_summary}


@app.post("/api/recommendations/reading/feedback")
async def reading_recommendation_feedback(
    req: ReadingFeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if req.action not in {"favorite", "highlight", "dislike"}:
        raise HTTPException(400, "不支持的反馈动作")
    db.add(ReadingFeedback(
        user_id=current_user.id,
        item_id=req.item_id,
        action=req.action,
        book_title=req.book_title,
        author=req.author,
        category=req.category,
        tags=req.tags,
    ))
    db.commit()
    observe_recommendation_feedback(req.action)
    return {"saved": True}


# ============================================================
# 拼贴诗
# ============================================================
@app.post("/api/poem/generate", response_model=PoemResponse)
async def generate_poem(req: PoemGenerateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """生成拼贴诗"""
    # 收集素材
    if req.records:
        records = (
            db.query(Record)
            .filter(Record.id.in_(req.records), Record.user_id == current_user.id)
            .all()
        )
        text = "\n".join(r.content_text for r in records)
    else:
        # 取最近记录
        recent = db.query(Record).filter(Record.user_id == current_user.id).order_by(Record.created_at.desc()).limit(5).all()
        text = "\n".join(r.content_text for r in recent)

    if not text.strip():
        raise HTTPException(400, "没有可用的素材记录")

    poem_text = await llm_client.generate_poem(text, req.style)

    # 保存到数据库
    poem = Poem(
        user_id=current_user.id,
        poem_text=poem_text,
        source_record_ids=req.records or [],
        author_style=req.style,
    )
    db.add(poem)
    db.commit()

    return PoemResponse(
        poem_text=poem_text,
        style=req.style,
        source_records=req.records or [],
    )


@app.post("/api/journal/rewrite-fragments", response_model=FragmentRewriteResponse)
async def rewrite_journal_fragments(req: FragmentRewriteRequest, current_user: User = Depends(get_current_user)):
    return FragmentRewriteResponse(lines=await llm_client.rewrite_fragments(req.texts, req.style))


@app.post("/api/journal/image")
async def generate_journal_image(req: JournalImageRequest, current_user: User = Depends(get_current_user)):
    try:
        url = await llm_client.generate_journal_image(req.prompt)
        return {"url": await make_displayable_image_url(url)}
    except Exception as exc:
        raise HTTPException(503, f"生成图片失败: {exc}") from exc


# ============================================================
# 拾词
# ============================================================
@app.post("/api/word/find", response_model=WordResponse)
async def find_word(req: WordFindRequest, current_user: User = Depends(get_current_user)):
    """为感受找/造一个词"""
    # 本地词库只作为“避重复”参考，不再直接复用旧词。
    # 否则相近情绪会反复命中同一个收藏词（例如“潮隙”），削弱拾词的新鲜感。
    matches = await rag_service.search_words(req.feeling_text, current_user.id, top_k=5)
    avoid_words = list(dict.fromkeys([
        *[word for word in req.avoid_words if word],
        *[m.get("text", "") for m in matches if m.get("text")],
    ]))

    result = await llm_client.find_word(req.feeling_text, avoid_words=avoid_words)
    return WordResponse(**result)


@app.post("/api/words")
async def save_word(req: WordSaveRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """收藏拾到的词，并关联来源记录。"""
    existing = db.query(Word).filter(Word.word == req.word, Word.user_id == current_user.id).first()
    if existing:
        if req.source_record_id and not existing.source_record_id:
            existing.source_record_id = req.source_record_id
            db.commit()
        return {"id": existing.id, "saved": False}

    word = Word(
        user_id=current_user.id,
        word=req.word,
        language=req.language,
        roman=req.roman,
        meaning=req.meaning,
        literal=req.literal,
        is_coined=int(req.is_coined),
        source_record_id=req.source_record_id,
    )
    db.add(word)
    db.commit()
    db.refresh(word)
    try:
        rag_service.add_word(
            word.id,
            word.word,
            metadata={
                "user_id": current_user.id,
                "language": word.language or "",
                "roman": word.roman or "",
                "meaning": word.meaning or "",
                "literal": word.literal or "",
                "reason": req.reason,
            },
        )
    except Exception as exc:
        print(f"⚠️ 拾词已保存，但向量词库同步失败: {exc}")
    return {"id": word.id, "saved": True}


@app.get("/api/words")
async def list_words(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取当前用户的私人情绪词典。"""
    words = db.query(Word).filter(Word.user_id == current_user.id).order_by(Word.created_at.desc()).all()
    return [
        {
            "id": item.id,
            "word": item.word,
            "language": item.language or "",
            "roman": item.roman or "",
            "meaning": item.meaning or "",
            "literal": item.literal or "",
            "is_coined": bool(item.is_coined),
            "reason": "",
            "created_at": item.created_at,
        }
        for item in words
    ]


# ============================================================
# 书摘导入（微信读书）
# ============================================================
@app.get("/api/quotes/import-guide")
async def import_guide():
    """获取微信读书导出指南"""
    return {"guide": export_wechat_read_guide()}


@app.post("/api/quotes/import-text")
async def import_quotes_text(req: QuoteTextImport, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """导入微信读书导出的文本格式"""
    quotes = parse_wechat_read_export(req.text)
    if not quotes:
        return {"imported": 0, "message": "未识别到书摘内容，请检查格式"}

    result = import_quotes_to_db(quotes, current_user.id)

    # 同步到向量库
    all_quotes = db.query(Quote).filter(Quote.user_id == current_user.id).order_by(Quote.created_at.desc()).limit(result["imported"]).all()
    for q in all_quotes:
        rag_service.add_quote(
            q.id,
            q.quote_text,
            metadata={"book": q.book_id, "source": q.source, "user_id": current_user.id},
        )

    return result


@app.post("/api/quotes/import-json")
async def import_quotes_json(req: list[QuoteImport], db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """导入 JSON 格式书摘"""
    imported = 0
    for item in req:
        book = db.query(Book).filter(Book.title == item.book_title, Book.author == item.author).first()
        if not book:
            book = Book(title=item.book_title, author=item.author, category="")
            db.add(book)
            db.flush()
        quote = Quote(
            user_id=current_user.id,
            book_id=book.id,
            quote_text=item.quote_text,
            note=item.note,
            highlight_color=item.highlight_color,
            source="微信读书导入",
        )
        db.add(quote)
        db.flush()
        rag_service.add_quote(
            quote.id,
            quote.quote_text,
            metadata={"book": book.id, "source": quote.source, "user_id": current_user.id},
        )
        imported += 1
    db.commit()

    return {"imported": imported}


@app.get("/api/quotes")
async def list_quotes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取所有书摘"""
    quotes = db.query(Quote).filter(Quote.user_id == current_user.id).order_by(Quote.created_at.desc()).limit(100).all()
    return [
        {
            "id": q.id,
            "text": q.quote_text,
            "book": q.book_id,
            "note": q.note,
            "color": q.highlight_color,
            "created_at": q.created_at,
        }
        for q in quotes
    ]


@app.get("/api/library/search")
async def search_library(keyword: str = "", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """按关键词检索书名、作者、书摘与批注。"""
    keyword = keyword.strip()
    if not keyword:
        return {"books": [], "quotes": []}

    like = f"%{keyword}%"
    user_book_ids = db.query(Quote.book_id).filter(Quote.user_id == current_user.id, Quote.book_id.is_not(None))
    books = (
        db.query(Book)
        .filter(
            Book.id.in_(user_book_ids),
            (Book.title.ilike(like)) | (Book.author.ilike(like)) | (Book.category.ilike(like)),
        )
        .limit(20)
        .all()
    )
    quotes = (
        db.query(Quote)
        .filter(
            Quote.user_id == current_user.id,
            (
                (Quote.quote_text.ilike(like))
                | (Quote.note.ilike(like))
                | (Quote.source.ilike(like))
                | (Quote.book_id.in_([book.id for book in books]))
            ),
        )
        .limit(30)
        .all()
    )
    quote_book_ids = list({quote.book_id for quote in quotes if quote.book_id})
    book_map = {
        book.id: book
        for book in db.query(Book).filter(Book.id.in_(quote_book_ids)).all()
    } if quote_book_ids else {}
    return {
        "books": [
            {
                "id": book.id,
                "title": book.title,
                "author": book.author or "",
                "category": book.category or "",
                "cover": book.cover or "",
                "collect_count": book.collect_count or 0,
            }
            for book in books
        ],
        "quotes": [
            {
                "id": quote.id,
                "text": quote.quote_text,
                "note": quote.note or "",
                "source": quote.source or "",
                "book_id": quote.book_id or "",
                "book_title": book_map.get(quote.book_id).title if quote.book_id in book_map else "",
                "author": book_map.get(quote.book_id).author if quote.book_id in book_map else "",
            }
            for quote in quotes
        ],
    }


# ============================================================
# 微信读书 API 直连（需要 WEREAD_API_KEY）
# ============================================================
def ensure_wechat_read_access(current_user: User):
    owner_email = settings.weread_owner_email.strip().lower()
    if not owner_email:
        raise HTTPException(503, "请配置 WEREAD_OWNER_EMAIL，避免多用户共享同一微信读书账号")
    if current_user.email.strip().lower() != owner_email:
        raise HTTPException(403, "当前账号未绑定微信读书")


@app.get("/api/wechat-read/status")
async def wechat_read_status(current_user: User = Depends(get_current_user)):
    """检查微信读书 API 连接状态"""
    try:
        ensure_wechat_read_access(current_user)
    except HTTPException as exc:
        return {"connected": False, "message": exc.detail}
    try:
        client = get_wechat_read_client()
        client.get_shelf()
        return {"connected": True, "message": "微信读书 API 已连接"}
    except RuntimeError as e:
        return {"connected": False, "message": str(e)}
    except Exception as e:
        return {"connected": False, "message": f"连接失败: {e}"}


@app.get("/api/wechat-read/shelf")
async def wechat_read_shelf(current_user: User = Depends(get_current_user)):
    """获取微信读书书架"""
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        return client.get_shelf()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"获取书架失败: {e}")


@app.get("/api/wechat-read/book/{book_id}")
async def wechat_read_book(book_id: str, current_user: User = Depends(get_current_user)):
    """获取书籍详情"""
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        info = client.get_book_info(book_id)
        progress = client.get_progress(book_id)
        chapters = client.get_chapter_info(book_id)
        return {"book": info, "progress": progress, "chapters": chapters}
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"获取书籍失败: {e}")


@app.get("/api/wechat-read/book/{book_id}/bookmarks")
async def wechat_read_bookmarks(book_id: str, current_user: User = Depends(get_current_user)):
    """获取书籍划线"""
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        return client.get_bookmarks(book_id)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"获取划线失败: {e}")


@app.get("/api/wechat-read/read-data")
async def wechat_read_stats(mode: str = "monthly", current_user: User = Depends(get_current_user)):
    """获取阅读统计"""
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        data = client.get_read_data(mode)
        # 格式化输出（时长从秒转为可读格式）
        total_seconds = data.get("totalReadTime", 0)
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        return {
            **data,
            "totalReadTime_formatted": f"{hours}小时{minutes}分钟",
            "readDays": data.get("readDays", 0),
            "mode": mode,
        }
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"获取统计失败: {e}")


@app.get("/api/wechat-read/search")
async def wechat_read_search(
    keyword: str = "",
    scope: int = 0,
    max_idx: int = 0,
    count: int = 20,
    current_user: User = Depends(get_current_user),
):
    """搜索微信读书书城"""
    if not keyword:
        raise HTTPException(400, "请提供搜索关键词")
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        return client.search(keyword, scope, max_idx, count)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"搜索失败: {e}")


@app.get("/api/wechat-read/recommend")
async def wechat_read_recommend(current_user: User = Depends(get_current_user)):
    """获取推荐书籍"""
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        return client.get_recommendations()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"获取推荐失败: {e}")


@app.post("/api/wechat-read/sync-to-moodgarden")
async def wechat_read_sync_to_moodgarden(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """同步微信读书划线到 MoodGarden

    调用微信读书 API，获取所有书籍的划线，
    导入到本地数据库和向量库。
    """
    ensure_wechat_read_access(current_user)
    try:
        client = get_wechat_read_client()
        shelf = client.get_shelf()
        books = shelf.get("books", [])
        total_imported = 0

        for book in books:
            book_id = book.get("bookId")
            if not book_id:
                continue
            try:
                bookmarks = client.get_bookmarks(book_id)
                for mark in bookmarks.get("marks", []):
                    quote_text = mark.get("markText", "").strip()
                    if not quote_text:
                        continue

                    existing = db.query(Quote).filter(Quote.quote_text == quote_text, Quote.user_id == current_user.id).first()
                    if existing:
                        continue

                    # 查找或创建书籍
                    book_record = (
                        db.query(Book)
                        .filter(Book.title == book.get("title", ""))
                        .first()
                    )
                    if not book_record:
                        book_record = Book(
                            title=book.get("title", ""),
                            author=book.get("author", ""),
                            cover=book.get("cover", ""),
                        )
                        db.add(book_record)
                        db.flush()

                    quote = Quote(
                        user_id=current_user.id,
                        quote_text=quote_text,
                        book_id=book_record.id,
                        note=mark.get("note", ""),
                        source=f"微信读书同步 · {book.get('title', '')}",
                    )
                    db.add(quote)
                    db.flush()
                    total_imported += 1

                    # 同步到向量库
                    rag_service.add_quote(
                        quote.id,
                        quote_text,
                        metadata={"book": book.get("title", ""), "source": "微信读书", "user_id": current_user.id},
                    )
            except Exception:
                continue

        db.commit()
        return {"imported": total_imported, "total_books": len(books)}
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"同步失败: {e}")


# ============================================================
# 健康检查
# ============================================================
@app.get("/api/health")
async def health():
    database_ok = True
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        database_ok = False
    return {
        "status": "ok" if database_ok else "degraded",
        "version": "0.2.0",
        "database": "ok" if database_ok else "error",
        "database_backend": "postgresql" if settings.database_url.startswith("postgresql") else "sqlite",
        "llm_configured": bool(settings.zhipu_api_key),
        "image_generation_configured": bool(settings.zhipu_api_key and settings.glm_image_model),
        "image_model": settings.glm_image_model,
        "weread_configured": bool(settings.weread_api_key and settings.weread_api_base_url),
        "object_storage_configured": storage_configured(),
        "embedding_model": settings.embedding_model,
        "emotion_model_loaded": classifier.model is not None,
        "emotion_model_calibrated": bool(classifier.model and hasattr(classifier.model.get("clf"), "predict_proba")),
        "emotion_model_metrics": classifier.model.get("metrics", {}) if classifier.model else {},
    }


# ============================================================
# 启动入口
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
