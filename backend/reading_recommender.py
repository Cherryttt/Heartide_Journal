"""基于今日情绪、历史记录、书架和行为反馈的动态阅读推荐。"""

from collections import Counter, defaultdict
from datetime import datetime

from database import Book, Quote, ReadingFeedback, Record, UserState
from safety import detect_crisis


CATALOG = [
    {"id": "bird-1", "quote": "世界以痛吻我，要我报之以歌。", "book": "飞鸟集", "author": "泰戈尔", "cover": "#c0a040", "bg_color": "#e8f0f2", "text_color": "#3a5a6a", "passage": "世界以痛吻我，要我报之以歌。", "tags": ["积极", "诗歌", "温柔", "悲伤"]},
    {"id": "ditan-1", "quote": "死是一件不必急于求成的事。", "book": "我与地坛", "author": "史铁生", "cover": "#6a8a5e", "bg_color": "#eaf1e8", "text_color": "#3a5a3a", "passage": "死是一件不必急于求成的事，死是一个必然会降临的节日。", "tags": ["生命", "散文", "无情绪", "成长"]},
    {"id": "forest-1", "quote": "有些黑暗你没法绕开，只能穿过它。", "book": "挪威的森林", "author": "村上春树", "cover": "#5f86a0", "bg_color": "#e8eef0", "text_color": "#3a4a5a", "passage": "有些黑暗你没法绕开，只能穿过它。穿过它之后，你会成为稍微不同的人。", "tags": ["悲伤", "文学", "成长"]},
    {"id": "sisyphus-1", "quote": "重要的不是治愈，而是带着病痛活下去。", "book": "西西弗神话", "author": "加缪", "cover": "#9a7a52", "bg_color": "#f0ece4", "text_color": "#4a3a2a", "passage": "在荒诞中保持清醒，本身就是一种反抗。", "tags": ["哲学", "恐惧", "生命", "坚韧"]},
    {"id": "haizi-1", "quote": "面朝大海，春暖花开。", "book": "海子的诗", "author": "海子", "cover": "#4a80a0", "bg_color": "#e8f0f4", "text_color": "#2a4a6a", "passage": "从明天起，做一个幸福的人。", "tags": ["海", "诗歌", "自由", "积极"]},
    {"id": "prince-1", "quote": "真正重要的东西，用眼睛是看不见的。", "book": "小王子", "author": "圣埃克苏佩里", "cover": "#c08840", "bg_color": "#f4eddf", "text_color": "#6d5432", "passage": "正因为你为你的玫瑰花费了时间，它才变得如此重要。", "tags": ["童心", "温柔", "文学", "积极"]},
    {"id": "food-1", "quote": "自由就是成为自己的可能。", "book": "人间食粮", "author": "纪德", "cover": "#8a9a6a", "bg_color": "#edf0e5", "text_color": "#48523d", "passage": "自由并不是逃离，而是成为自己的可能。", "tags": ["自由", "散文", "成长", "积极"]},
    {"id": "meditations-1", "quote": "困扰人的不是事情本身，而是人们对事情的看法。", "book": "沉思录", "author": "马可·奥勒留", "cover": "#7a6a5a", "bg_color": "#ebe8e2", "text_color": "#50483e", "passage": "你可以在任何时刻回到自己的内心。", "tags": ["哲学", "恐惧", "无情绪", "自我"]},
    {"id": "walden-1", "quote": "我愿意深深地扎入生活。", "book": "瓦尔登湖", "author": "梭罗", "cover": "#708a68", "bg_color": "#e8efe6", "text_color": "#3d523d", "passage": "我愿意深深地扎入生活，吸取生命中所有的精华。", "tags": ["自然", "无情绪", "散文"]},
    {"id": "moon-1", "quote": "满地都是六便士，他却抬头看见了月亮。", "book": "月亮与六便士", "author": "毛姆", "cover": "#74658a", "bg_color": "#ece9f2", "text_color": "#4b405d", "passage": "人们随时随地生活在自己的世界里。", "tags": ["月亮", "自由", "文学", "悲伤"]},
    {"id": "courage-1", "quote": "所谓自由，就是被别人讨厌。", "book": "被讨厌的勇气", "author": "岸见一郎", "cover": "#b07b62", "bg_color": "#f2e9e4", "text_color": "#60473b", "passage": "我们并不是为了满足别人的期待而活着。", "tags": ["成长", "恐惧", "自我", "自由"]},
    {"id": "night-1", "quote": "黑夜无论怎样悠长，白昼总会到来。", "book": "麦克白", "author": "莎士比亚", "cover": "#48556c", "bg_color": "#e4e8ee", "text_color": "#344052", "passage": "黑夜无论怎样悠长，白昼总会到来。", "tags": ["夜", "悲伤", "惊奇", "文学"]},
]


ACTION_WEIGHT = {"favorite": 5.0, "highlight": 3.0, "dislike": -16.0}
REAL_ITEM_PALETTE = [
    ("#718a76", "#edf2ed", "#405047"),
    ("#8c7767", "#f2ece7", "#54463d"),
    ("#667f94", "#eaf0f4", "#3c5060"),
    ("#8b7894", "#f0ebf2", "#51445a"),
]


def _emotion_tags(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [str(key) for key, score in value.items() if score]
    if isinstance(value, list):
        result = []
        for item in value:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, dict) and item.get("mood"):
                result.append(str(item["mood"]))
        return result
    return []


def _tags(value) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return []


def _norm(value) -> str:
    return ''.join(str(value or '').split()).lower()


def _item_identity(item: dict) -> tuple[str, str, str]:
    return (_norm(item.get('book')), _norm(item.get('author')), _norm(item.get('quote')))


def _dedupe_candidates(candidates: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for item in candidates:
        key = _item_identity(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def build_real_candidates(db, user_id: str) -> list[dict]:
    """把用户保存/同步的真实书摘加入候选池，而不是只依赖演示目录。"""
    candidates = []
    seen = set()
    quote_rows = (
        db.query(Quote, Book)
        .outerjoin(Book, Quote.book_id == Book.id)
        .filter(Quote.user_id == user_id)
        .order_by(Quote.created_at.desc())
        .limit(80)
        .all()
    )
    for index, (quote, book) in enumerate(quote_rows):
        text = (quote.quote_text or "").strip()
        if not text:
            continue
        title = (book.title if book else "") or "我的摘录"
        author = (book.author if book else "") or ""
        key = (text, title, author)
        if key in seen:
            continue
        seen.add(key)
        cover, bg_color, text_color = REAL_ITEM_PALETTE[index % len(REAL_ITEM_PALETTE)]
        if book and isinstance(book.cover, str) and book.cover.startswith("#"):
            cover = book.cover
        tags = list(dict.fromkeys([
            *_tags(quote.tags),
            *_emotion_tags(quote.emotion_when_saved),
            *([book.category] if book and book.category else []),
        ]))
        candidates.append({
            "id": f"quote-{quote.id}",
            "quote": text,
            "book": title,
            "author": author,
            "cover": cover,
            "bg_color": bg_color,
            "text_color": text_color,
            "passage": (quote.note or text).strip(),
            "tags": tags or ["个人书摘"],
            "base_score": 2.5,
            "base_reason": "来自你保存的真实书摘",
        })

    state_row = db.query(UserState).filter(UserState.user_id == user_id).first()
    state_books = (state_row.state or {}).get("books", []) if state_row and isinstance(state_row.state, dict) else []
    for index, book in enumerate(state_books):
        if not isinstance(book, dict):
            continue
        text = str(book.get("sampleQuote") or "").strip()
        if not text:
            continue
        title = str(book.get("title") or "我的书架")
        author = str(book.get("author") or "")
        key = (text, title, author)
        if key in seen:
            continue
        seen.add(key)
        cover, bg_color, text_color = REAL_ITEM_PALETTE[(index + len(candidates)) % len(REAL_ITEM_PALETTE)]
        if isinstance(book.get("bookColor"), str) and book["bookColor"].startswith("#"):
            cover = book["bookColor"]
        candidates.append({
            "id": f"shelf-{book.get('id') or index}",
            "quote": text,
            "book": title,
            "author": author,
            "cover": cover,
            "bg_color": bg_color,
            "text_color": text_color,
            "passage": text,
            "tags": list(dict.fromkeys([*_tags(book.get("sampleTags")), book.get("category") or "书架"])),
            "base_score": 1.5,
            "base_reason": "来自你收藏的书架",
        })
    return candidates


def build_user_profile(db, user_id: str) -> dict:
    records = db.query(Record).filter(Record.user_id == user_id).order_by(Record.created_at.desc()).limit(100).all()
    today = datetime.now().date().isoformat()
    today_tags = Counter()
    history_tags = Counter()
    for record in records:
        tags = list(record.tags or []) + list(record.imagery_tags or []) + [item.get("mood") for item in (record.emotion_dist or []) if item.get("mood")]
        for tag in filter(None, tags):
            history_tags[tag] += 1
            if str(record.created_at).startswith(today):
                today_tags[tag] += 1
    crisis_levels = [detect_crisis(record.content_text).get("risk_level", "none") for record in records[:10]]
    crisis_level = "high" if "high" in crisis_levels else "elevated" if "elevated" in crisis_levels else "none"

    quote_rows = (
        db.query(Quote, Book)
        .outerjoin(Book, Quote.book_id == Book.id)
        .filter(Quote.user_id == user_id)
        .order_by(Quote.created_at.desc())
        .limit(100)
        .all()
    )
    shelf_authors = Counter(book.author for _, book in quote_rows if book and book.author)
    shelf_categories = Counter(book.category for _, book in quote_rows if book and book.category)
    state_row = db.query(UserState).filter(UserState.user_id == user_id).first()
    state_books = (state_row.state or {}).get("books", []) if state_row and isinstance(state_row.state, dict) else []
    for book in state_books:
        if not isinstance(book, dict):
            continue
        if book.get("author"):
            shelf_authors[str(book["author"])] += 1
        if book.get("category"):
            shelf_categories[str(book["category"])] += 1

    feedback_rows = db.query(ReadingFeedback).filter(ReadingFeedback.user_id == user_id).all()
    feedback_by_item = defaultdict(float)
    feedback_tags = Counter()
    feedback_authors = Counter()
    feedback_books = Counter()
    for row in feedback_rows:
        weight = ACTION_WEIGHT.get(row.action, 0.0)
        feedback_by_item[row.item_id] += weight
        for tag in row.tags or []:
            feedback_tags[tag] += weight
        if row.author:
            feedback_authors[row.author] += weight
        if row.book_title:
            feedback_books[row.book_title] += weight

    return {
        "today_tags": today_tags,
        "history_tags": history_tags,
        "shelf_authors": shelf_authors,
        "shelf_categories": shelf_categories,
        "feedback_by_item": feedback_by_item,
        "feedback_tags": feedback_tags,
        "feedback_authors": feedback_authors,
        "feedback_books": feedback_books,
        "crisis_level": crisis_level,
    }


def rank_catalog(profile: dict, count: int = 12, offset: int = 0, candidates: list[dict] | None = None) -> tuple[list[dict], list[str]]:
    candidates = _dedupe_candidates(candidates or CATALOG)
    ranked = []
    for index, item in enumerate(candidates):
        exact_feedback = profile["feedback_by_item"].get(item["id"], 0.0)
        score = exact_feedback + item.get("base_score", 0.0)
        if exact_feedback <= ACTION_WEIGHT["dislike"]:
            score -= 40.0
        reasons = []
        if profile.get("crisis_level") != "none":
            if any(word in f"{item['quote']}{item['passage']}" for word in ("死", "病痛", "绝望")):
                score -= 100.0
            if set(item["tags"]) & {"积极", "无情绪", "温柔"}:
                score += 15.0
                reasons.append((15.0, "此刻先给你更平稳、温柔的文字"))
        for tag in item["tags"]:
            if profile["today_tags"].get(tag):
                value = 4.0 * profile["today_tags"][tag]
                score += value
                reasons.append((value, f"贴合你今天的「{tag}」"))
            if profile["history_tags"].get(tag):
                value = min(3.0, 0.45 * profile["history_tags"][tag])
                score += value
                reasons.append((value, f"你最近常写到「{tag}」"))
            if profile["feedback_tags"].get(tag):
                value = 0.8 * profile["feedback_tags"][tag]
                score += value
                reasons.append((value, f"你对「{tag}」内容有过回应"))
        if profile["shelf_authors"].get(item["author"]):
            value = 4.0 + profile["shelf_authors"][item["author"]]
            score += value
            reasons.append((value, f"你的书架里有 {item['author']}"))
        if profile["feedback_authors"].get(item["author"]):
            value = profile["feedback_authors"][item["author"]]
            score += value
            reasons.append((value, f"\u4f60\u66fe\u6536\u85cf\u8fc7 {item['author']}" if value > 0 else f"\u5df2\u51cf\u5c11 {item['author']} \u7684\u76f8\u4f3c\u63a8\u8350"))
        if profile.get("feedback_books", {}).get(item["book"]):
            value = 1.2 * profile["feedback_books"][item["book"]]
            score += value
            reasons.append((value, f"\u4f60\u5bf9\u300a{item['book']}\u300b\u6709\u8fc7\u56de\u5e94" if value > 0 else f"\u5df2\u51cf\u5c11\u300a{item['book']}\u300b\u7684\u91cd\u590d\u63a8\u8350"))
        score += ((index + offset * 3) % len(candidates)) * 0.001
        reason = max(reasons, default=(0, item.get("base_reason", "为你留一页新的偶遇")), key=lambda pair: pair[0])[1]
        ranked.append({key: value for key, value in item.items() if not key.startswith("base_")} | {"score": round(score, 3), "reason": reason})

    ranked.sort(key=lambda item: item["score"], reverse=True)
    if ranked and offset:
        shift = offset % len(ranked)
        ranked = ranked[shift:] + ranked[:shift]

    summary = []
    if profile["today_tags"]:
        summary.append(f"今日情绪：{profile['today_tags'].most_common(1)[0][0]}")
    if profile["history_tags"]:
        summary.append(f"近期意象：{profile['history_tags'].most_common(1)[0][0]}")
    if profile["shelf_authors"]:
        summary.append(f"书架偏好：{profile['shelf_authors'].most_common(1)[0][0]}")
    if profile["feedback_tags"]:
        positive = [item for item in profile["feedback_tags"].most_common() if item[1] > 0]
        if positive:
            summary.append(f"行为偏好：{positive[0][0]}")
    return _dedupe_candidates(ranked)[:count], summary


def recommend_for_user(db, user_id: str, count: int = 12, offset: int = 0) -> tuple[list[dict], list[str]]:
    candidates = build_real_candidates(db, user_id) + CATALOG
    return rank_catalog(build_user_profile(db, user_id), count, offset, candidates)
