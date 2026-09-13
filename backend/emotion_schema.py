"""Shared six-class emotion taxonomy for Heartide/MoodGarden."""
from __future__ import annotations

from typing import Mapping


CANONICAL_EMOTION_LABELS = ("无情绪", "积极", "悲伤", "愤怒", "恐惧", "惊奇")

RAW_TO_CANONICAL = {
    "neutral": "无情绪",
    "happy": "积极",
    "sad": "悲伤",
    "angry": "愤怒",
    "fear": "恐惧",
    "surprise": "惊奇",
    **{label: label for label in CANONICAL_EMOTION_LABELS},
}

EMOTION_COLORS = {
    "无情绪": "#8d9398",
    "积极": "#d79b45",
    "悲伤": "#6f86a6",
    "愤怒": "#c85f4a",
    "恐惧": "#8b78a6",
    "惊奇": "#5f9fb4",
}

EMOTION_VA = {
    "无情绪": (0.50, 0.18),
    "积极": (0.82, 0.62),
    "悲伤": (0.28, 0.30),
    "愤怒": (0.22, 0.82),
    "恐惧": (0.25, 0.76),
    "惊奇": (0.62, 0.74),
}


def normalize_emotion_label(label: object) -> str | None:
    value = str(label or "").strip()
    return RAW_TO_CANONICAL.get(value)


def normalize_emotion_scores(scores: Mapping[object, object], top_k: int = 3) -> list[dict]:
    totals = {label: 0.0 for label in CANONICAL_EMOTION_LABELS}
    for raw_label, raw_score in scores.items():
        label = normalize_emotion_label(raw_label)
        if label is None:
            continue
        try:
            score = max(0.0, float(raw_score))
        except (TypeError, ValueError):
            continue
        totals[label] += score
    total = sum(totals.values())
    if total <= 0:
        return []
    ranked = sorted(totals.items(), key=lambda item: item[1], reverse=True)
    return [
        {"mood": label, "probability": round(score / total, 3), "color": EMOTION_COLORS[label]}
        for label, score in ranked[:top_k]
        if score > 0
    ]
