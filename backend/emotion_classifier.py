"""Six-class emotion classifier: v2 model -> rules -> optional LLM fallback."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Optional

import joblib
from scipy.sparse import hstack

from config import settings
from emotion_schema import EMOTION_COLORS, EMOTION_VA, normalize_emotion_label, normalize_emotion_scores
from llm_client import llm_client
from safety import detect_crisis
from transformer_emotion import TransformerEmotionModel, resolve_model_path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parents[1]

# Backward-compatible names for older modules/tests. Values are now six-class.
MOOD_COLORS = EMOTION_COLORS
MOOD_VA = EMOTION_VA

NEGATIONS = ("不", "没", "没有", "并不", "不是", "无")


def _contains_non_negated(text: str, keyword: str) -> bool:
    start = text.find(keyword)
    while start >= 0:
        prefix = text[max(0, start - 3):start]
        if not any(prefix.endswith(negation) for negation in NEGATIONS):
            return True
        start = text.find(keyword, start + len(keyword))
    return False


def _contains_negated(text: str, keyword: str) -> bool:
    start = text.find(keyword)
    while start >= 0:
        prefix = text[max(0, start - 3):start]
        if any(prefix.endswith(negation) for negation in NEGATIONS):
            return True
        start = text.find(keyword, start + len(keyword))
    return False


def _softmax(values) -> list[float]:
    items = [float(value) for value in values]
    if not items:
        return []
    high = max(items)
    exp = [math.exp(value - high) for value in items]
    total = sum(exp) or 1.0
    return [value / total for value in exp]


def _tokenize_for_word(text: str) -> str:
    import jieba

    return " ".join(token for token in jieba.cut(text) if token.strip())


def _transform_v2_artifact(artifact: dict, texts: list[str]):
    feature_mode = artifact["feature_mode"]
    vectorizers = artifact["vectorizers"]
    if feature_mode == "word":
        return vectorizers["word"].transform([_tokenize_for_word(text) for text in texts])
    if feature_mode == "char":
        return vectorizers["char"].transform(texts)
    if feature_mode == "word_char":
        word = vectorizers["word"].transform([_tokenize_for_word(text) for text in texts])
        char = vectorizers["char"].transform(texts)
        return hstack([word, char]).tocsr()
    raise ValueError(f"Unknown v2 feature mode: {feature_mode}")


def _candidate_model_paths() -> list[Path]:
    paths: list[Path] = []
    env_path = os.environ.get("EMOTION_V2_MODEL_PATH", "").strip()
    if env_path:
        paths.append(Path(env_path))
    paths.append(BACKEND_DIR / "ml" / "emotion_v2_classical.joblib")
    best_file = PROJECT_ROOT / "experiments" / "emotion_v2" / "results" / "best_classical.json"
    if best_file.exists():
        try:
            best = json.loads(best_file.read_text(encoding="utf-8"))
            config_id = best.get("config_id")
            if config_id:
                paths.append(PROJECT_ROOT / "experiments" / "emotion_v2" / "runs" / "classical" / f"{config_id}.joblib")
        except (json.JSONDecodeError, OSError):
            pass
    paths.append(PROJECT_ROOT / "experiments" / "emotion_v2" / "runs" / "classical" / "016_logreg_word_char_c1_weightbalanced.joblib")
    return paths


def resolve_v2_classical_model_path() -> Path | None:
    for path in _candidate_model_paths():
        resolved = path if path.is_absolute() else BACKEND_DIR / path
        if resolved.exists():
            return resolved
    return None


def bridge_base_probabilities(base_probs: dict[str, float], text: str = "") -> list[dict]:
    """Normalize raw v2 model probabilities to canonical labels.

    Kept as a compatibility shim for older imports; it no longer bridges to the
    old product mood vocabulary.
    """
    return normalize_emotion_scores(base_probs)


class EmotionClassifier:
    """Emotion classifier: v2 checkpoint first, then six-class rules."""

    KEYWORDS = {
        "无情绪": ["无感", "没感觉", "没有感觉", "麻木", "空白", "发呆", "平静", "安静"],
        "积极": ["开心", "快乐", "高兴", "喜悦", "幸福", "顺利", "真好", "太好了", "有希望"],
        "悲伤": ["难过", "悲伤", "伤心", "哭", "低落", "失落", "不开心", "委屈"],
        "愤怒": ["愤怒", "生气", "气死", "火大", "恼火", "烦死", "讨厌", "受够了"],
        "恐惧": ["害怕", "恐惧", "恐慌", "担心", "不安", "焦虑", "紧张", "心慌", "发慌", "喘不过气"],
        "惊奇": ["惊讶", "惊奇", "意外", "没想到", "想不到", "震惊", "吓一跳", "居然"],
    }

    IMAGERY_MAP = {
        "海": ["海", "大海", "海浪", "潮汐", "海水", "海边"],
        "花": ["花", "花束", "雏菊", "玫瑰", "花瓣", "花开"],
        "雨": ["雨", "下雨", "雨天", "雨滴", "雨声", "雨点"],
        "天空": ["天空", "蓝天", "天上", "云端", "云", "晚霞"],
        "光": ["光", "阳光", "光线", "光芒", "光晕", "晨曦"],
        "风": ["风", "微风", "清风", "风铃", "风声"],
        "窗": ["窗", "窗边", "窗前", "窗外"],
        "夜": ["夜", "夜晚", "深夜", "星空", "星星", "月亮"],
        "树": ["树", "森林", "树叶", "树林", "木"],
        "书": ["书", "读书", "阅读", "书页", "文字"],
    }

    COLOR_MAP = {
        "绿色": ["绿色", "绿", "翠绿", "草绿"],
        "蓝色": ["蓝色", "蓝", "湛蓝", "深海蓝"],
        "橙色": ["橙色", "橙", "橘色", "晚霞"],
        "粉色": ["粉色", "粉", "粉红", "桃花"],
        "灰色": ["灰色", "灰", "灰蒙蒙"],
        "金色": ["金色", "金", "金黄"],
        "白色": ["白色", "白", "洁白", "纯白"],
        "紫色": ["紫色", "紫", "淡紫", "薰衣草"],
    }

    def __init__(self):
        self.transformer_model = None
        if settings.emotion_transformer_enabled:
            transformer_path = resolve_model_path(str(BACKEND_DIR), settings.emotion_transformer_model_path)
            if transformer_path:
                self.transformer_model = TransformerEmotionModel(
                    transformer_path,
                    max_length=settings.emotion_transformer_max_length,
                    device=settings.emotion_transformer_device,
                )
                if self.transformer_model.available:
                    print(f"✅ 已加载 Transformer 六分类情绪模型: {transformer_path}")
                else:
                    print(f"⚠️ Transformer 情绪模型不可用，回退轻量模型: {self.transformer_model.load_error}")
            else:
                print(f"⚠️ Transformer 情绪模型路径不存在，回退轻量模型: {settings.emotion_transformer_model_path}")

        self.model = None
        self.model_path = resolve_v2_classical_model_path()
        if self.model_path:
            try:
                self.model = joblib.load(self.model_path)
                print(f"✅ 已加载 v2 六分类情绪模型: {self.model_path}")
            except Exception as exc:
                print(f"⚠️ v2 情绪模型加载失败，回退规则版: {exc}")

    def classify(self, text: str) -> dict:
        if not text.strip():
            return self._with_safety(self._empty_result(), text)

        if self.transformer_model is not None and self.transformer_model.available:
            try:
                return self._with_safety(self._transformer_classify(text), text)
            except Exception as exc:
                print(f"⚠️ Transformer 推理失败，回退轻量模型: {exc}")

        if self.model is not None:
            try:
                return self._with_safety(self._model_classify(text), text)
            except Exception as exc:
                print(f"⚠️ 模型推理失败，回退规则: {exc}")

        result = self._rule_based_classify(text)
        if not result["emotions"] or result["emotions"][0]["probability"] < 0.3:
            result["needs_llm_fallback"] = True
        return self._with_safety(result, text)

    def _transformer_classify(self, text: str) -> dict:
        base_probs = self.transformer_model.predict_base_probabilities(text)
        return self._result_from_base_probabilities(text, base_probs, "macbert_transformer", False)

    def _model_classify(self, text: str) -> dict:
        artifact = self.model
        if isinstance(artifact, dict) and {"feature_mode", "vectorizers", "classifier"} <= set(artifact):
            clf = artifact["classifier"]
            x_row = _transform_v2_artifact(artifact, [text])
        else:
            raise ValueError("Loaded model is not a v2 emotion artifact")

        classes = [str(item) for item in clf.classes_]
        calibrated = hasattr(clf, "predict_proba")
        if calibrated:
            probs = clf.predict_proba(x_row)[0]
        else:
            probs = _softmax(clf.decision_function(x_row)[0])
        base_probs = {classes[index]: float(probs[index]) for index in range(len(classes))}
        return self._result_from_base_probabilities(text, base_probs, "v2_classical_ml", calibrated)

    def _result_from_base_probabilities(self, text: str, base_probs: dict, source: str, calibrated: bool) -> dict:
        emotions = normalize_emotion_scores(base_probs)
        rule = self._rule_based_classify(text)

        rule_confident = False
        if rule["emotions"] and rule["emotions"][0]["probability"] >= 0.6:
            rule_top = rule["emotions"][0]
            rest = [item for item in emotions if item["mood"] != rule_top["mood"]][:2]
            if emotions and emotions[0]["mood"] != rule_top["mood"]:
                remaining = 0.38
                rest_total = sum(item["probability"] for item in rest) or 1.0
                rest = [
                    {**item, "probability": round(item["probability"] / rest_total * remaining, 3)}
                    for item in rest
                ]
                emotions = [{**rule_top, "probability": 0.62}, *rest]
                rule_confident = True
        if not emotions:
            emotions = rule["emotions"]

        confidence = emotions[0]["probability"] if emotions else 0.0
        ordered_probs = sorted((item["probability"] for item in emotions), reverse=True)
        margin = ordered_probs[0] - ordered_probs[1] if len(ordered_probs) > 1 else confidence
        ambiguous_blank = any(cue in text for cue in ("没感觉", "什么感觉都没有", "没有感觉", "麻木", "空空的"))
        valence = round(sum(EMOTION_VA[item["mood"]][0] * item["probability"] for item in emotions), 3)
        arousal = round(sum(EMOTION_VA[item["mood"]][1] * item["probability"] for item in emotions), 3)
        return {
            "emotions": emotions,
            "valence": valence,
            "arousal": arousal,
            "tags": [emotions[0]["mood"]] + rule["imagery"][:3] if emotions else rule["imagery"][:3],
            "colors": rule["colors"],
            "imagery": rule["imagery"],
            "confidence": round(confidence, 3),
            "model_source": f"{source}+rules" if rule_confident else source,
            "calibrated": calibrated,
            "needs_llm_fallback": False if rule_confident else ambiguous_blank or confidence < settings.emotion_confidence_threshold or margin < settings.emotion_margin_threshold,
        }

    async def classify_with_llm(self, text: str, fallback: Optional[dict] = None) -> dict:
        result = await llm_client.analyze_emotion(text)
        raw_scores: dict[str, float] = {}
        for item in result.get("emotions", []):
            label = normalize_emotion_label(item.get("mood"))
            if label:
                raw_scores[label] = raw_scores.get(label, 0.0) + max(0.0, float(item.get("probability", 0.0)))
        emotions = normalize_emotion_scores(raw_scores)
        if not emotions:
            return fallback or self.classify(text)
        normalized = {
            "emotions": emotions,
            "valence": float(result.get("valence", 0.5)),
            "arousal": float(result.get("arousal", 0.3)),
            "tags": result.get("tags", []) or [emotions[0]["mood"]],
            "colors": result.get("colors", []),
            "imagery": result.get("imagery", []),
            "confidence": emotions[0]["probability"],
            "model_source": "llm_fallback",
            "calibrated": False,
            "needs_llm_fallback": False,
        }
        return self._with_safety(normalized, text)

    def _rule_based_classify(self, text: str) -> dict:
        emotions = []
        lower = text.lower()

        for mood, keywords in self.KEYWORDS.items():
            count = sum(1 for keyword in keywords if _contains_non_negated(lower, keyword))
            if count > 0:
                probability = min(0.35 + count * 0.15, 0.92)
                if any(_contains_negated(lower, keyword) for keyword in keywords):
                    probability *= 0.4
                emotions.append({"mood": mood, "probability": probability, "color": EMOTION_COLORS[mood]})

        emotions.sort(key=lambda item: item["probability"], reverse=True)
        if not emotions:
            emotions = [{"mood": "无情绪", "probability": 0.5, "color": EMOTION_COLORS["无情绪"]}]

        total = sum(item["probability"] for item in emotions[:3]) or 1.0
        emotions = [{**item, "probability": round(item["probability"] / total, 3)} for item in emotions[:3]]

        imagery = []
        for image, keywords in self.IMAGERY_MAP.items():
            if any(keyword in lower for keyword in keywords):
                imagery.append(image)

        colors = []
        for color_name, keywords in self.COLOR_MAP.items():
            if any(keyword in lower for keyword in keywords):
                colors.append(self._color_name_to_hex(color_name))

        tags = [emotions[0]["mood"], *imagery[:3]]
        valence = round(sum(EMOTION_VA[item["mood"]][0] * item["probability"] for item in emotions), 3)
        arousal = round(sum(EMOTION_VA[item["mood"]][1] * item["probability"] for item in emotions), 3)
        return {
            "emotions": emotions,
            "valence": valence,
            "arousal": arousal,
            "tags": tags,
            "colors": colors,
            "imagery": imagery,
            "confidence": emotions[0]["probability"] if emotions else 0.0,
            "model_source": "rules",
            "calibrated": False,
            "needs_llm_fallback": False,
        }

    def _color_name_to_hex(self, name: str) -> str:
        mapping = {
            "绿色": "#8ab84a",
            "蓝色": "#6fa9c4",
            "橙色": "#f0a060",
            "粉色": "#e0a0b0",
            "灰色": "#a0a0a0",
            "金色": "#d0a040",
            "白色": "#f0f0f0",
            "紫色": "#a080c0",
        }
        return mapping.get(name, "#a0a0a0")

    def _empty_result(self) -> dict:
        return {
            "emotions": [],
            "valence": 0.5,
            "arousal": 0.3,
            "tags": [],
            "colors": [],
            "imagery": [],
            "confidence": 0.0,
            "model_source": "empty",
            "calibrated": False,
            "needs_llm_fallback": False,
        }

    def _with_safety(self, result: dict, text: str) -> dict:
        return {**result, **detect_crisis(text)}


classifier = EmotionClassifier()
