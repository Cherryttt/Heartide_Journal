from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from prepare_data import (  # noqa: E402
    LABEL_ORDER,
    SPLIT_PRIORITY,
    freeze_rows,
    normalize_text,
    read_source_file,
    write_outputs,
)


def write_source(path: Path, rows: list[dict]) -> None:
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def test_label_order_matches_protocol() -> None:
    assert LABEL_ORDER == ["neutral", "happy", "sad", "angry", "fear", "surprise"]
    assert SPLIT_PRIORITY == {"train": 0, "validation": 1, "test": 2}


def test_normalize_text_preserves_emotion_punctuation_and_masks_urls_mentions() -> None:
    text = normalize_text("  @someone 我今天真的太开心了！！！ https://example.com/a  ")

    assert "@someone" not in text
    assert "https://" not in text
    assert "<URL>" in text
    assert "！！！" in text
    assert text == "<USER> 我今天真的太开心了！！！ <URL>"


def test_read_source_file_keeps_valid_labels_and_records_invalid_rows(tmp_path: Path) -> None:
    source = tmp_path / "usual_train.txt"
    write_source(
        source,
        [
            {"id": 1, "label": "happy", "content": "今天阳光很好"},
            {"id": 2, "label": "fatigue", "content": "我真的很累"},
            {"id": 3, "label": "sad", "content": "   "},
        ],
    )

    rows, excluded = read_source_file(source, split="train", domain="usual")

    assert [row["label"] for row in rows] == ["happy"]
    assert rows[0]["sample_id"] == "usual_train.txt:1"
    assert {row["reason"] for row in excluded} == {"invalid_label", "empty_text"}


def test_freeze_rows_removes_cross_split_duplicates_with_test_priority() -> None:
    rows = [
        {
            "sample_id": "usual_train.txt:1",
            "split": "train",
            "domain": "usual",
            "source_file": "usual_train.txt",
            "source_id": "1",
            "label": "happy",
            "text": "同一条微博",
            "normalized_text": "同一条微博",
        },
        {
            "sample_id": "usual_eval_labeled.txt:1",
            "split": "validation",
            "domain": "usual",
            "source_file": "usual_eval_labeled.txt",
            "source_id": "1",
            "label": "happy",
            "text": "验证集独有",
            "normalized_text": "验证集独有",
        },
        {
            "sample_id": "usual_test_labeled.txt:1",
            "split": "test",
            "domain": "usual",
            "source_file": "usual_test_labeled.txt",
            "source_id": "1",
            "label": "happy",
            "text": "同一条微博",
            "normalized_text": "同一条微博",
        },
    ]

    frozen, excluded = freeze_rows(rows)

    assert [row["sample_id"] for row in frozen] == [
        "usual_eval_labeled.txt:1",
        "usual_test_labeled.txt:1",
    ]
    duplicate = next(row for row in excluded if row["reason"] == "duplicate_lower_priority")
    assert duplicate["sample_id"] == "usual_train.txt:1"
    kept_test = next(row for row in frozen if row["sample_id"] == "usual_test_labeled.txt:1")
    assert kept_test["duplicate_group_id"] == duplicate["duplicate_group_id"]


def test_write_outputs_records_manifest_history_note(tmp_path: Path) -> None:
    frozen = [
        {
            "sample_id": f"usual_train.txt:{idx}",
            "split": split,
            "domain": "usual",
            "source_file": f"usual_{split}.txt",
            "source_id": str(idx),
            "label": label,
            "text": f"text {idx}",
            "normalized_text": f"text {idx}",
            "text_hash": f"hash-{idx}",
            "duplicate_group_id": f"group-{idx}",
        }
        for idx, (split, label) in enumerate(
            [("train", "neutral"), ("validation", "happy"), ("test", "sad")],
            start=1,
        )
    ]

    write_outputs(
        exp_dir=tmp_path,
        frozen_rows=frozen,
        excluded_rows=[],
        source_hashes={"usual_train.txt": "abc"},
        source_counts={"usual_train.txt": 1},
    )

    manifest = json.loads((tmp_path / "data" / "split_manifest.json").read_text(encoding="utf-8"))
    assert manifest["label_order"] == LABEL_ORDER
    assert "本轮未参与训练和模型选择" in manifest["historical_exposure_note"]
    assert "历史上从未接触" not in manifest["historical_exposure_note"]
    assert (tmp_path / "data" / "train.csv").exists()
    assert (tmp_path / "data_audit.md").exists()
