"""情绪分类器（训练模型 + 规则版 + 智谱兜底）"""
import os
import json
from typing import Optional
import joblib
from llm_client import llm_client
from config import settings
from safety import detect_crisis
from transformer_emotion import TransformerEmotionModel, resolve_model_path

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ml", "model.pkl")
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


# 12 种心情词 → 颜色映射
MOOD_COLORS = {
    "开心": "#f0a040",
    "期待": "#c0a040",
    "激动": "#e06060",
    "治愈": "#8ab84a",
    "平静": "#6fa9c4",
    "放松": "#7fb0c4",
    "忧郁": "#6a8a9a",
    "焦虑": "#a080b0",
    "疲惫": "#8a7a6a",
    "孤独": "#5a6a8a",
    "空白": "#a0a0a0",
    "安静": "#4a5a7a",
}

# 心情词 → (效价, 唤醒) 坐标
MOOD_VA = {
    "开心": (0.85, 0.7),
    "期待": (0.7, 0.6),
    "激动": (0.8, 0.9),
    "治愈": (0.75, 0.35),
    "平静": (0.65, 0.2),
    "放松": (0.7, 0.25),
    "忧郁": (0.35, 0.3),
    "焦虑": (0.3, 0.75),
    "疲惫": (0.3, 0.2),
    "孤独": (0.25, 0.35),
    "空白": (0.5, 0.1),
    "安静": (0.55, 0.15),
}

BASE_TO_PRODUCT = {
    "开心": {"开心": 0.58, "期待": 0.24, "激动": 0.18},
    "平静": {"平静": 0.34, "治愈": 0.24, "放松": 0.20, "安静": 0.16, "空白": 0.06},
    "忧郁": {"忧郁": 0.56, "孤独": 0.29, "空白": 0.15},
    "焦虑": {"焦虑": 0.75, "激动": 0.10, "孤独": 0.10, "空白": 0.05},
    "疲惫": {"疲惫": 0.70, "空白": 0.18, "安静": 0.12},
}

PRODUCT_CUES = {
    "期待": ["期待", "盼望", "快要", "明天", "等不及", "希望"],
    "激动": ["激动", "兴奋", "热血", "心跳", "澎湃", "燃"],
    "治愈": ["治愈", "温暖", "被接住", "柔软", "安心", "感动"],
    "放松": ["放松", "轻松", "惬意", "自在", "松下来", "舒服"],
    "孤独": ["孤独", "孤单", "一个人", "没人", "空荡荡", "落寞"],
    "空白": ["空白", "茫然", "放空", "没感觉", "什么都不想", "发呆"],
    "安静": ["安静", "宁静", "无声", "沉默", "静静", "独处"],
}

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


def bridge_base_probabilities(base_probs: dict[str, float], text: str) -> list[dict]:
    """把五类基础模型概率桥接到产品十二类，并用非否定语义线索细分。"""
    product_scores = {mood: 0.0 for mood in MOOD_COLORS}
    for base_mood, probability in base_probs.items():
        for mood, weight in BASE_TO_PRODUCT.get(str(base_mood), {str(base_mood): 1.0}).items():
            product_scores[mood] += float(probability) * weight
    for mood, keywords in PRODUCT_CUES.items():
        matches = sum(1 for keyword in keywords if _contains_non_negated(text, keyword))
        if matches:
            product_scores[mood] += min(0.16, 0.06 * matches)
    for mood, keywords in EmotionClassifier.KEYWORDS.items():
        matches = sum(1 for keyword in keywords if _contains_non_negated(text, keyword))
        if matches:
            product_scores[mood] += min(0.72, 0.48 + 0.08 * (matches - 1))
        if any(_contains_negated(text, keyword) for keyword in keywords) and not any(_contains_non_negated(text, keyword) for keyword in keywords):
            product_scores[mood] *= 0.2
    total = sum(product_scores.values()) or 1.0
    ranked = sorted(product_scores.items(), key=lambda item: item[1], reverse=True)
    return [
        {"mood": mood, "probability": round(score / total, 3), "color": MOOD_COLORS[mood]}
        for mood, score in ranked[:3] if score > 0
    ]


class EmotionClassifier:
    """情绪分类器:训练好的 TF-IDF+分类器(优先) → 规则匹配 → 智谱兜底"""

    def __init__(self):
        self.transformer_model = None
        if settings.emotion_transformer_enabled:
            transformer_path = resolve_model_path(BACKEND_DIR, settings.emotion_transformer_model_path)
            if transformer_path:
                self.transformer_model = TransformerEmotionModel(
                    transformer_path,
                    max_length=settings.emotion_transformer_max_length,
                    device=settings.emotion_transformer_device,
                )
                if self.transformer_model.available:
                    print(f"✅ 已加载 Transformer 情绪模型: {transformer_path}")
                else:
                    print(f"⚠️ Transformer 情绪模型不可用,回退轻量模型: {self.transformer_model.load_error}")
            else:
                print(f"⚠️ Transformer 情绪模型路径不存在,回退轻量模型: {settings.emotion_transformer_model_path}")
        self.model = None
        try:
            if os.path.exists(MODEL_PATH):
                self.model = joblib.load(MODEL_PATH)
                print(f"✅ 已加载训练情绪模型: {MODEL_PATH}")
        except Exception as e:
            print(f"⚠️ 情绪模型加载失败,回退规则版: {e}")

    # 关键词 → 心情词映射（规则匹配,作为模型不可用时的兜底）
    KEYWORDS = {
        "开心": ["开心", "快乐", "高兴", "笑", "喜悦", "幸福", "嗨", "太好了"],
        "期待": ["期待", "盼望", "希望", "等不及", "憧憬", "未来"],
        "激动": ["激动", "兴奋", "热血", "燃", "刺激", "澎湃"],
        "治愈": ["治愈", "温暖", "花", "阳光", "美好", "温柔", "柔软", "感动"],
        "平静": ["平静", "安静", "慢慢", "徐徐", "静静", "淡淡", "平和"],
        "放松": ["放松", "舒服", "舒适", "惬意", "自在", "轻松", "自由"],
        "忧郁": ["忧郁", "难过", "悲伤", "伤心", "哭", "低落", "不开心"],
        "焦虑": ["焦虑", "紧张", "不安", "担心", "害怕", "恐慌", "压力", "心慌", "喘不过气", "事情太多", "压得慌"],
        "疲惫": ["疲惫", "累", "困", "倦", "乏", "累死", "没力气"],
        "孤独": ["孤独", "寂寞", "一个人", "孤单", "空荡荡", "落寞"],
        "空白": ["空白", "空", "茫然", "发呆", "放空", "不知道"],
        "安静": ["安静", "宁静", "静谧", "无声", "沉默"],
    }

    # 意象关键词
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

    # 颜色关键词
    COLOR_MAP = {
        "绿色": ["绿色", "绿", "翠绿", "草绿"],
        "蓝色": ["蓝色", "蓝", "湛蓝", "深海蓝"],
        "橙色": ["橙色", "橙", "橘色", "晚霞"],
        "粉色": ["粉色", "粉", "粉红", "桃花"],
        "灰色": ["灰色", "灰", "灰蒙蒙"],
        "金色": ["金色", "金", "金黄", "金色"],
        "白色": ["白色", "白", "洁白", "纯白"],
        "紫色": ["紫色", "紫", "淡紫", "薰衣草"],
    }

    def classify(self, text: str) -> dict:
        """分类文本情绪:训练模型优先,失败回退规则,再低置信交 LLM 兜底"""
        if not text.strip():
            return self._with_safety(self._empty_result(), text)

        # 1. 可选 Transformer 模型(有 checkpoint 时优先)
        if self.transformer_model is not None and self.transformer_model.available:
            try:
                return self._with_safety(self._transformer_classify(text), text)
            except Exception as e:
                print(f"⚠️ Transformer 推理失败,回退轻量模型: {e}")

        # 2. 训练好的模型(多维情绪分布)
        if self.model is not None:
            try:
                return self._with_safety(self._model_classify(text), text)
            except Exception as e:
                print(f"⚠️ 模型推理失败,回退规则: {e}")

        # 3. 规则匹配
        result = self._rule_based_classify(text)
        if not result["emotions"] or result["emotions"][0]["probability"] < 0.3:
            result["needs_llm_fallback"] = True
        return self._with_safety(result, text)

    def _transformer_classify(self, text: str) -> dict:
        base_probs = self.transformer_model.predict_base_probabilities(text)
        return self._result_from_base_probabilities(text, base_probs, "macbert_transformer", False)

    def _model_classify(self, text: str) -> dict:
        """用训练好的 TF-IDF+分类器预测情绪分布(取 top-3),意象/颜色仍用规则抽取"""
        import jieba
        import numpy as np
        vec = self.model["vectorizer"]
        clf = self.model["clf"]
        X = vec.transform([" ".join(jieba.cut(text))])
        classes = [str(item) for item in clf.classes_]
        calibrated = hasattr(clf, "predict_proba")
        if hasattr(clf, "predict_proba"):
            probs = clf.predict_proba(X)[0]
        else:
            s = np.atleast_1d(clf.decision_function(X)[0])
            e = np.exp(s - s.max())
            probs = e / e.sum()
        base_probs = {classes[index]: float(probs[index]) for index in range(len(classes))}
        return self._result_from_base_probabilities(
            text,
            base_probs,
            "calibrated_ml" if calibrated else "uncalibrated_ml",
            calibrated,
        )

    def _result_from_base_probabilities(self, text: str, base_probs: dict, source: str, calibrated: bool) -> dict:
        ordered_probs = sorted((float(value) for value in base_probs.values()), reverse=True)
        emotions = bridge_base_probabilities(base_probs, text)
        confidence = ordered_probs[0] if ordered_probs else 0.0
        margin = confidence - ordered_probs[1] if len(ordered_probs) > 1 else confidence
        rule = self._rule_based_classify(text)
        rule_confident = False
        if rule["emotions"] and emotions:
            rule_top = rule["emotions"][0]
            if rule_top["probability"] >= 0.44:
                promoted = {"mood": rule_top["mood"], "probability": 0.62, "color": MOOD_COLORS[rule_top["mood"]]}
                rest = [item for item in emotions if item["mood"] != rule_top["mood"]][:2]
                remaining = max(0.0, 1.0 - promoted["probability"])
                rest_total = sum(item["probability"] for item in rest) or 1.0
                for item in rest:
                    item["probability"] = round(item["probability"] / rest_total * remaining, 3)
                emotions = [promoted, *rest]
                confidence = max(confidence, promoted["probability"])
                rule_confident = True
        confidence = max(confidence, emotions[0]["probability"] if emotions else 0.0)
        ambiguous_blank = any(cue in text for cue in ("没感觉", "什么感觉都没有", "没有感觉", "麻木", "空空的"))
        valence = round(sum(MOOD_VA[mood["mood"]][0] * mood["probability"] for mood in emotions), 3)
        arousal = round(sum(MOOD_VA[mood["mood"]][1] * mood["probability"] for mood in emotions), 3)
        return {
            "emotions": emotions, "valence": valence, "arousal": arousal,
            "tags": [emotions[0]["mood"]] + rule["imagery"][:3],
            "colors": rule["colors"], "imagery": rule["imagery"],
            "confidence": round(confidence, 3),
            "model_source": f"{source}+rules" if rule["emotions"] else source,
            "calibrated": calibrated,
            "needs_llm_fallback": False if rule_confident else ambiguous_blank or confidence < settings.emotion_confidence_threshold or margin < settings.emotion_margin_threshold,
        }

    async def classify_with_llm(self, text: str, fallback: Optional[dict] = None) -> dict:
        """LLM 兜底分类"""
        result = await llm_client.analyze_emotion(text)
        emotions = []
        for item in result.get("emotions", []):
            mood = str(item.get("mood", ""))
            if mood in MOOD_COLORS:
                emotions.append({
                    "mood": mood,
                    "probability": max(0.0, float(item.get("probability", 0.0))),
                    "color": MOOD_COLORS[mood],
                })
        total = sum(item["probability"] for item in emotions)
        if not emotions or total <= 0:
            return fallback or self.classify(text)
        emotions = sorted(emotions, key=lambda item: item["probability"], reverse=True)[:3]
        total = sum(item["probability"] for item in emotions) or 1.0
        for item in emotions:
            item["probability"] = round(item["probability"] / total, 3)
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
        """基于关键词规则的情绪分类"""
        emotions = []
        lower = text.lower()

        for mood, keywords in self.KEYWORDS.items():
            count = sum(1 for kw in keywords if _contains_non_negated(lower, kw))
            if count > 0:
                prob = min(0.3 + count * 0.15, 0.9)
                emotions.append(
                    {
                        "mood": mood,
                        "probability": prob,
                        "color": MOOD_COLORS[mood],
                    }
                )

        emotions.sort(key=lambda x: x["probability"], reverse=True)

        # 提取意象
        imagery = []
        for img, keywords in self.IMAGERY_MAP.items():
            if any(kw in lower for kw in keywords):
                imagery.append(img)

        # 提取颜色
        colors = []
        for color_name, keywords in self.COLOR_MAP.items():
            if any(kw in lower for kw in keywords):
                colors.append(self._color_name_to_hex(color_name))

        # 提取标签
        tags = []
        if emotions:
            tags.append(emotions[0]["mood"])
        tags.extend(imagery[:3])

        # 计算 V-A 坐标
        if emotions:
            top = emotions[0]
            va = MOOD_VA.get(top["mood"], (0.5, 0.5))
            valence = va[0] * top["probability"] + 0.5 * (1 - top["probability"])
            arousal = va[1] * top["probability"] + 0.3 * (1 - top["probability"])
        else:
            valence = 0.5
            arousal = 0.3

        return {
            "emotions": emotions[:3],
            "valence": round(valence, 3),
            "arousal": round(arousal, 3),
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


# 全局单例
classifier = EmotionClassifier()
