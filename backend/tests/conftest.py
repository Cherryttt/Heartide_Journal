import os
import sys


os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
TEST_DATA_DIR = os.path.join(os.path.dirname(__file__), ".pytest_data")
os.makedirs(TEST_DATA_DIR, exist_ok=True)
TEST_DB_PATH = os.path.join(TEST_DATA_DIR, "moodgarden_test.db").replace(os.sep, "/")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["CHROMA_PATH"] = os.path.join(TEST_DATA_DIR, "chroma")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def pytest_sessionstart(session):
    from database import Base, engine

    Base.metadata.create_all(engine)
