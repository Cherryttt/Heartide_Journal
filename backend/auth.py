from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import settings
from database import SessionLocal, User

ALGORITHM = "HS256"
password_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_context.verify(password, password_hash)


def create_access_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expires}, settings.jwt_secret, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
    except JWTError as exc:
        raise HTTPException(401, "登录状态已失效") from exc
    if not user_id:
        raise HTTPException(401, "登录状态已失效")
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(401, "用户不存在")
        db.expunge(user)
        return user
    finally:
        db.close()
