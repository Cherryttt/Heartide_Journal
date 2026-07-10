from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth import get_current_user
from database import Base, User
from main import app, get_db


def test_account_state_round_trip_and_limits():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    local_session = sessionmaker(bind=engine)
    user = User(id="sync-user", email="sync@example.com", password_hash="x", display_name="同步用户")

    def override_db():
        db = local_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        payload = {
            "books": [{"id": str(index), "title": f"书 {index}"} for index in range(510)],
            "seen_book_ids": ["same", "same", "new"],
            "journal_materials": [{"id": "material-1", "text": "一行素材"}],
            "journals": {"2026-06-15": {"updatedAt": "2026-06-15T12:00:00"}},
            "reading_feedback": {"item-1": {"favorite": 2}},
        }
        saved = client.put("/api/sync/state", json=payload)
        assert saved.status_code == 200
        assert len(saved.json()["books"]) == 500
        assert saved.json()["seen_book_ids"] == ["same", "new"]

        loaded = client.get("/api/sync/state")
        assert loaded.status_code == 200
        assert loaded.json()["journals"]["2026-06-15"]["updatedAt"] == "2026-06-15T12:00:00"
        assert loaded.json()["reading_feedback"]["item-1"]["favorite"] == 2

        next_payload = {**payload, "books": [{"id": "new", "title": "新设备内容"}], "updated_at": loaded.json()["updated_at"]}
        updated = client.put("/api/sync/state", json=next_payload)
        assert updated.status_code == 200
        stale = client.put("/api/sync/state", json={**payload, "updated_at": loaded.json()["updated_at"]})
        assert stale.status_code == 409
    finally:
        app.dependency_overrides.clear()
