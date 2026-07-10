import time
from prometheus_client import Counter, Histogram, make_asgi_app
from starlette.middleware.base import BaseHTTPMiddleware

REQUESTS = Counter("moodgarden_http_requests_total", "HTTP requests", ["method", "path", "status"])
LATENCY = Histogram("moodgarden_http_request_duration_seconds", "HTTP request latency", ["method", "path"])
EMOTION_INFERENCES = Counter("moodgarden_emotion_inferences_total", "Emotion inference results", ["source", "mood", "risk"])
EMOTION_CONFIDENCE = Histogram("moodgarden_emotion_confidence", "Top emotion confidence", buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
EMOTION_FALLBACKS = Counter("moodgarden_emotion_llm_fallbacks_total", "Low-confidence emotion fallbacks")
CRISIS_SIGNALS = Counter("moodgarden_crisis_signals_total", "Detected crisis signals", ["surface", "level"])
RECOMMENDATION_EVENTS = Counter("moodgarden_reading_feedback_total", "Reading recommendation feedback", ["action"])


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        REQUESTS.labels(request.method, path, response.status_code).inc()
        LATENCY.labels(request.method, path).observe(time.perf_counter() - started)
        return response


def observe_emotion(result: dict):
    top = (result.get("emotions") or [{}])[0]
    EMOTION_INFERENCES.labels(
        result.get("model_source", "unknown"),
        str(top.get("mood", "unknown")),
        result.get("risk_level", "none"),
    ).inc()
    EMOTION_CONFIDENCE.observe(float(result.get("confidence", top.get("probability", 0.0)) or 0.0))


def observe_emotion_fallback():
    EMOTION_FALLBACKS.inc()


def observe_crisis(surface: str, level: str):
    if level != "none":
        CRISIS_SIGNALS.labels(surface, level).inc()


def observe_recommendation_feedback(action: str):
    RECOMMENDATION_EVENTS.labels(action).inc()


metrics_app = make_asgi_app()
