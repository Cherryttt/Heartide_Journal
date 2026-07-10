"""MoodGarden 配置管理"""
import os
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.path.join(BACKEND_DIR, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
    # 智谱 API
    zhipu_api_key: str = ""
    weread_api_key: str = ""
    weread_api_base_url: str = "https://i.weread.qq.com/api/agent/gateway"
    weread_skill_version: str = "1.0.3"
    weread_owner_email: str = ""

    # 模型
    glm_vision_model: str = "glm-4v-plus"
    glm_flash_model: str = "glm-4-flash"
    glm_image_model: str = "cogview-4-250304"
    glm_image_fallback_models: str = "cogview-4,cogview-3-flash"
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    emotion_confidence_threshold: float = 0.46
    emotion_margin_threshold: float = 0.10
    emotion_transformer_enabled: bool = False
    emotion_transformer_model_path: str = "./ml/macbert_emotion"
    emotion_transformer_max_length: int = 128
    emotion_transformer_device: str = "auto"

    # 数据库
    sqlite_path: str = "./data/moodgarden.db"
    database_url: str = ""
    chroma_path: str = "./data/chroma"
    jwt_secret: str = "change-me-before-production"
    jwt_expire_minutes: int = 10080
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost,https://localhost,capacitor://localhost"

    # S3 / MinIO 对象存储
    s3_endpoint_url: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = "moodgarden"
    s3_region: str = "us-east-1"
    s3_public_url: str = ""

    # 服务
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    rate_limit_enabled: bool = True
    max_request_bytes: int = 10 * 1024 * 1024

settings = Settings()

# 确保数据目录存在
os.makedirs(os.path.dirname(settings.sqlite_path) or "./data", exist_ok=True)
os.makedirs(settings.chroma_path, exist_ok=True)
