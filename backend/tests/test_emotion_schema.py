from emotion_schema import (
    CANONICAL_EMOTION_LABELS,
    EMOTION_COLORS,
    normalize_emotion_label,
    normalize_emotion_scores,
)


def test_raw_smp_labels_normalize_to_canonical_chinese_labels():
    assert normalize_emotion_label("neutral") == "无情绪"
    assert normalize_emotion_label("happy") == "积极"
    assert normalize_emotion_label("sad") == "悲伤"
    assert normalize_emotion_label("angry") == "愤怒"
    assert normalize_emotion_label("fear") == "恐惧"
    assert normalize_emotion_label("surprise") == "惊奇"


def test_display_surprise_is_neutral_surprise_not_positive_delight():
    assert normalize_emotion_label("surprise") == "惊奇"
    assert "惊喜" not in CANONICAL_EMOTION_LABELS


def test_legacy_product_moods_are_not_valid_v2_labels():
    for label in ["开心", "平静", "忧郁", "焦虑", "疲惫", "治愈", "放松", "孤独", "空白", "安静"]:
        assert normalize_emotion_label(label) is None


def test_normalize_emotion_scores_keeps_only_v2_labels_and_renormalizes():
    scores = normalize_emotion_scores({"happy": 0.2, "fear": 0.3, "焦虑": 0.5})
    assert {item["mood"] for item in scores} == {"积极", "恐惧"}
    assert scores[0]["mood"] == "恐惧"
    assert round(sum(item["probability"] for item in scores), 6) == 1
    assert all(item["color"] == EMOTION_COLORS[item["mood"]] for item in scores)
