import json
from pathlib import Path

import pytest

from emotion_classifier import classifier


CASES = json.loads((Path(__file__).parent / "counterexamples.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[f"case-{index + 1}" for index in range(len(CASES))])
def test_emotion_counterexamples(case):
    result = classifier.classify(case["text"])
    top_moods = [item["mood"] for item in result["emotions"]]
    if case.get("forbidden_top"):
        assert top_moods[0] != case["forbidden_top"]
    if case.get("expected_any"):
        assert set(top_moods) & set(case["expected_any"])
    if "expect_fallback" in case:
        assert result["needs_llm_fallback"] is case["expect_fallback"]
    assert result["risk_level"] == case["risk_level"]
