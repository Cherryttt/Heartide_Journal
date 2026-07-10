from collections import Counter, defaultdict
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, Book, Quote, UserState
from reading_recommender import build_real_candidates, build_user_profile, rank_catalog, recommend_for_user


def blank_profile():
    return {
        "today_tags": Counter(),
        "history_tags": Counter(),
        "shelf_authors": Counter(),
        "shelf_categories": Counter(),
        "feedback_by_item": defaultdict(float),
        "feedback_tags": Counter(),
        "feedback_authors": Counter(),
        "feedback_books": Counter(),
        "crisis_level": "none",
    }


def test_today_emotion_changes_ranking_and_reason():
    profile = blank_profile()
    profile["today_tags"]["焦虑"] = 3
    items, summary = rank_catalog(profile, count=3)
    assert "焦虑" in items[0]["tags"]
    assert "今天" in items[0]["reason"]
    assert summary == ["今日情绪：焦虑"]


def test_dislike_reduces_same_item_score():
    profile = blank_profile()
    baseline, _ = rank_catalog(profile, count=20)
    disliked_id = baseline[0]["id"]
    profile["feedback_by_item"][disliked_id] = -20
    reranked, _ = rank_catalog(profile, count=20)
    assert reranked[0]["id"] != disliked_id


def test_shelf_author_creates_truthful_reason():
    profile = blank_profile()
    profile["shelf_authors"]["史铁生"] = 2
    items, _ = rank_catalog(profile, count=1)
    assert items[0]["author"] == "史铁生"
    assert "书架" in items[0]["reason"]


def test_crisis_profile_avoids_sensitive_passages():
    profile = blank_profile()
    profile["crisis_level"] = "high"
    items, _ = rank_catalog(profile, count=5)
    assert all("死" not in item["quote"] for item in items)


def test_real_quotes_and_synced_shelf_join_candidate_pool():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(Book(id="book-1", title="真实的书", author="真实作者", category="散文", cover="#123456"))
    db.add(Quote(id="quote-1", user_id="user-1", book_id="book-1", quote_text="这是用户真实保存的句子。", tags=["平静"]))
    db.add(UserState(user_id="user-1", state={"books": [{
        "id": "local-1",
        "title": "本地书架",
        "author": "本地作者",
        "category": "文学",
        "sampleQuote": "这是从本地书架同步来的句子。",
        "sampleTags": ["治愈"],
    }]}))
    db.commit()

    candidates = build_real_candidates(db, "user-1")
    assert {item["id"] for item in candidates} == {"quote-quote-1", "shelf-local-1"}
    assert any(item["quote"] == "这是用户真实保存的句子。" for item in candidates)
    assert build_user_profile(db, "user-1")["shelf_authors"]["本地作者"] == 1

    recommendations, _ = recommend_for_user(db, "user-1", count=20)
    assert any(item["id"] == "quote-quote-1" for item in recommendations)
    assert any(item["id"] == "shelf-local-1" for item in recommendations)



def test_rank_catalog_dedupes_same_book_author_quote():
    profile = blank_profile()
    candidates = [
        {"id": "real-1", "quote": "same quote", "book": "same book", "author": "same author", "cover": "#111", "bg_color": "#eee", "text_color": "#333", "passage": "same quote", "tags": ["calm"], "base_score": 3},
        {"id": "catalog-1", "quote": "same quote", "book": "same book", "author": "same author", "cover": "#222", "bg_color": "#eee", "text_color": "#333", "passage": "same quote", "tags": ["calm"], "base_score": 1},
    ]
    items, _ = rank_catalog(profile, count=5, candidates=candidates)
    assert [item["id"] for item in items] == ["real-1"]


def test_book_feedback_changes_related_book_score():
    profile = blank_profile()
    profile["feedback_books"]["沉思录"] = 12
    items, _ = rank_catalog(profile, count=1)
    assert items[0]["book"] == "沉思录"


def test_dislike_feedback_hides_exact_item_even_when_mood_matches():
    profile = blank_profile()
    profile["today_tags"]["焦虑"] = 5
    profile["feedback_by_item"]["meditations-1"] = -16
    items, _ = rank_catalog(profile, count=5)
    assert all(item["id"] != "meditations-1" for item in items[:3])
