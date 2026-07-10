from safety import detect_crisis


def test_high_risk_signal():
    assert detect_crisis("我想死，真的撑不下去了")["risk_level"] == "high"


def test_elevated_signal():
    assert detect_crisis("我只想消失一会儿")["risk_level"] == "elevated"


def test_negated_signal_is_not_escalated():
    assert detect_crisis("我不会自杀，只是最近很难过")["risk_level"] == "none"
