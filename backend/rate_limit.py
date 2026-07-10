from collections import deque
from dataclasses import dataclass
from hashlib import sha256
from math import ceil
from threading import Lock
from time import monotonic

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from config import settings


@dataclass(frozen=True)
class RatePolicy:
    limit: int
    window_seconds: int


RATE_POLICIES: dict[tuple[str, str], RatePolicy] = {
    ("POST", "/api/auth/register"): RatePolicy(5, 300),
    ("POST", "/api/auth/login"): RatePolicy(10, 60),
    ("DELETE", "/api/auth/account"): RatePolicy(5, 300),
    ("POST", "/api/assets/upload"): RatePolicy(20, 600),
    ("POST", "/api/images/describe"): RatePolicy(10, 300),
    ("GET", "/api/analyze"): RatePolicy(60, 60),
    ("GET", "/api/weather/approx"): RatePolicy(10, 600),
    ("POST", "/api/chat"): RatePolicy(30, 300),
    ("POST", "/api/chat/stream"): RatePolicy(30, 300),
    ("POST", "/api/poem/generate"): RatePolicy(15, 300),
    ("POST", "/api/journal/rewrite-fragments"): RatePolicy(20, 300),
    ("POST", "/api/journal/image"): RatePolicy(10, 600),
    ("POST", "/api/word/find"): RatePolicy(30, 300),
    ("POST", "/api/wechat-read/sync-to-moodgarden"): RatePolicy(6, 600),
}


class InMemoryRateLimiter:
    def __init__(self):
        self._buckets: dict[tuple[str, str, str], deque[float]] = {}
        self._lock = Lock()
        self._last_cleanup = monotonic()

    def reset(self):
        with self._lock:
            self._buckets.clear()
            self._last_cleanup = monotonic()

    def consume(self, method: str, path: str, identifier: str) -> tuple[RatePolicy | None, int, int]:
        policy = RATE_POLICIES.get((method.upper(), path))
        if policy is None:
            return None, 0, 0

        now = monotonic()
        bucket_key = (method.upper(), path, identifier)
        with self._lock:
            if now - self._last_cleanup > 600:
                self._cleanup(now)
            bucket = self._buckets.setdefault(bucket_key, deque())
            cutoff = now - policy.window_seconds
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= policy.limit:
                retry_after = max(1, ceil(policy.window_seconds - (now - bucket[0])))
                return policy, 0, retry_after
            bucket.append(now)
            return policy, max(0, policy.limit - len(bucket)), 0

    def _cleanup(self, now: float):
        stale_keys = []
        for key, bucket in self._buckets.items():
            policy = RATE_POLICIES.get((key[0], key[1]))
            if not policy or not bucket or bucket[-1] <= now - policy.window_seconds:
                stale_keys.append(key)
        for key in stale_keys:
            self._buckets.pop(key, None)
        self._last_cleanup = now


rate_limiter = InMemoryRateLimiter()


def request_identifier(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    if authorization:
        return f"token:{sha256(authorization.encode('utf-8')).hexdigest()[:24]}"
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    client_host = forwarded_for or (request.client.host if request.client else "unknown")
    return f"ip:{client_host}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.rate_limit_enabled:
            return await call_next(request)
        policy, remaining, retry_after = rate_limiter.consume(
            request.method,
            request.url.path,
            request_identifier(request),
        )
        if policy and retry_after:
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试"},
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(policy.limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
        response = await call_next(request)
        if policy:
            response.headers["X-RateLimit-Limit"] = str(policy.limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.max_request_bytes:
                    return JSONResponse(status_code=413, content={"detail": "请求内容过大"})
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "无效的 Content-Length"})
        return await call_next(request)
