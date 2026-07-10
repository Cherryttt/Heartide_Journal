from emotion_classifier import MOOD_COLORS, bridge_base_probabilities, classifier


def test_bridge_outputs_product_twelve_label_space():
    emotions = bridge_base_probabilities({"平静": 0.7, "忧郁": 0.3}, "一个人安静地看海")
    assert emotions
    assert all(item["mood"] in MOOD_COLORS for item in emotions)
    assert any(item["mood"] in {"安静", "孤独", "平静"} for item in emotions)


def test_negated_anxiety_is_not_directly_boosted():
    emotions = bridge_base_probabilities({"平静": 0.55, "焦虑": 0.45}, "我一点也不焦虑，终于做完了")
    assert emotions[0]["mood"] != "焦虑"


def test_explicit_anxiety_keyword_is_prioritized():
    result = classifier.classify("今天有点焦虑")
    assert result["emotions"][0]["mood"] == "焦虑"
    assert result["confidence"] >= 0.6


def test_model_result_has_confidence_and_fallback_decision():
    result = classifier.classify("一些没有明确情绪方向的零散句子和数字 12345")
    assert 0 <= result["confidence"] <= 1
    assert result["model_source"] in {
        "calibrated_ml",
        "uncalibrated_ml",
        "calibrated_ml+rules",
        "uncalibrated_ml+rules",
        "rules",
    }
    assert isinstance(result["needs_llm_fallback"], bool)


def test_crisis_text_is_flagged_even_when_emotion_prediction_runs():
    result = classifier.classify("我真的不想活了，想结束这一切")
    assert result["risk_level"] == "high"
    assert result["safety_message"]
