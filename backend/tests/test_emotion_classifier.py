from emotion_classifier import classifier


def test_classifier_outputs_six_class_label_space():
    result = classifier.classify("今天有点焦虑，也有点害怕")
    assert result["emotions"]
    assert {item["mood"] for item in result["emotions"]} <= {"无情绪", "积极", "悲伤", "愤怒", "恐惧", "惊奇"}


def test_explicit_fear_keyword_is_prioritized():
    result = classifier.classify("今天有点害怕，心里发慌")
    assert result["emotions"][0]["mood"] == "恐惧"
    assert result["confidence"] >= 0.6


def test_positive_keyword_stays_positive():
    result = classifier.classify("今天很开心，事情终于有了好结果")
    assert result["emotions"][0]["mood"] == "积极"


def test_model_result_has_confidence_and_fallback_decision():
    result = classifier.classify("一些没有明确情绪方向的零散句子和数字 12345")
    assert 0 <= result["confidence"] <= 1
    assert result["model_source"] in {
        "calibrated_ml",
        "uncalibrated_ml",
        "calibrated_ml+rules",
        "uncalibrated_ml+rules",
        "v2_classical_ml",
        "v2_classical_ml+rules",
        "rules",
    }
    assert isinstance(result["needs_llm_fallback"], bool)


def test_crisis_text_is_flagged_even_when_emotion_prediction_runs():
    result = classifier.classify("我真的不想活了，想结束这一切")
    assert result["risk_level"] == "high"
    assert result["safety_message"]
