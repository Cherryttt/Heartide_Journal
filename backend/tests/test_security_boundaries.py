from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth import get_current_user
from auth import hash_password
from database import Base, Book, Poem, Quote, ReadingFeedback, Record, User, UserState, Word
from main import app, ensure_wechat_read_access, get_db, validate_production_settings
from rate_limit import rate_limiter


def test_costly_public_endpoints_require_authentication():
    client = TestClient(app)
    assert client.get("/api/analyze", params={"text": "今天很开心"}).status_code == 401
    assert client.get("/api/weather/approx").status_code == 401


def test_request_size_and_model_limits_are_enforced():
    from config import settings

    client = TestClient(app)
    oversized = client.post(
        "/api/auth/login",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": str(settings.max_request_bytes + 1)},
    )
    assert oversized.status_code == 413
    invalid = client.post("/api/auth/login", json={"email": "x" * 255, "password": "password123"})
    assert invalid.status_code == 422


def test_production_mode_rejects_local_or_incomplete_configuration(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "jwt_secret", "short")
    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "weread_api_key", "configured")
    monkeypatch.setattr(settings, "weread_owner_email", "")
    try:
        validate_production_settings()
        assert False, "incomplete production settings must be rejected"
    except RuntimeError as exc:
        message = str(exc)
        assert "JWT_SECRET" in message
        assert "PostgreSQL" in message
        assert "WEREAD_OWNER_EMAIL" in message

    monkeypatch.setattr(settings, "jwt_secret", "a-secure-random-secret-with-32-plus-characters")
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg://example")
    monkeypatch.setattr(settings, "weread_owner_email", "owner@example.com")
    validate_production_settings()


def test_library_search_does_not_leak_other_users_book_titles():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    local_session = sessionmaker(bind=engine, expire_on_commit=False)
    user_a = User(id="user-a", email="a@example.com", password_hash="x", display_name="A")
    user_b = User(id="user-b", email="b@example.com", password_hash="x", display_name="B")
    with local_session() as db:
        db.add(Book(id="private-book", title="仅用户A可见的书名", author="私人作者"))
        db.add(Quote(id="private-quote", user_id=user_a.id, book_id="private-book", quote_text="私密句子"))
        db.commit()

    def override_db():
        db = local_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_b
    try:
        result = TestClient(app).get("/api/library/search", params={"keyword": "仅用户A"})
        assert result.status_code == 200
        assert result.json() == {"books": [], "quotes": []}
    finally:
        app.dependency_overrides.clear()


def test_weread_global_key_is_restricted_to_configured_owner(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "weread_owner_email", "owner@example.com")
    ensure_wechat_read_access(User(id="owner", email="owner@example.com", password_hash="x", display_name="Owner"))
    try:
        ensure_wechat_read_access(User(id="other", email="other@example.com", password_hash="x", display_name="Other"))
        assert False, "other accounts must not access the global WeRead key"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403


def test_rate_limit_rejects_repeated_login_attempts():
    rate_limiter.reset()
    try:
        client = TestClient(app)
        for _ in range(10):
            response = client.post("/api/auth/login", json={"email": "missing@example.com", "password": "not-the-password"})
            assert response.status_code == 401
        limited = client.post("/api/auth/login", json={"email": "missing@example.com", "password": "not-the-password"})
        assert limited.status_code == 429
        assert int(limited.headers["retry-after"]) > 0
    finally:
        rate_limiter.reset()


def test_account_deletion_removes_owned_data(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    local_session = sessionmaker(bind=engine, expire_on_commit=False)
    user = User(id="delete-user", email="delete@example.com", password_hash=hash_password("password123"), display_name="Delete")
    with local_session() as db:
        db.add_all([
            user,
            Record(id="record", user_id=user.id, content_text="private"),
            Quote(id="quote", user_id=user.id, quote_text="private"),
            Poem(id="poem", user_id=user.id, poem_text="private"),
            Word(id="word", user_id=user.id, word="private"),
            ReadingFeedback(id="feedback", user_id=user.id, item_id="item", action="favorite"),
            UserState(user_id=user.id, state={"books": []}),
        ])
        db.commit()

    def override_db():
        db = local_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr("main.delete_user_assets", lambda _user_id: None)
    monkeypatch.setattr("database.record_collection", None)
    monkeypatch.setattr("database.quote_collection", None)
    monkeypatch.setattr("database.word_collection", None)
    try:
        client = TestClient(app)
        assert client.request("DELETE", "/api/auth/account", json={"password": "wrong-password"}).status_code == 403
        assert client.request("DELETE", "/api/auth/account", json={"password": "password123"}).status_code == 200
        with local_session() as db:
            assert db.query(User).count() == 0
            assert db.query(Record).count() == 0
            assert db.query(Quote).count() == 0
            assert db.query(Poem).count() == 0
            assert db.query(Word).count() == 0
            assert db.query(ReadingFeedback).count() == 0
            assert db.query(UserState).count() == 0
    finally:
        app.dependency_overrides.clear()
