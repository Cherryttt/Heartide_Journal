from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from prepare_data import LABEL_ORDER  # noqa: E402
from train_macbert import (  # noqa: E402
    choose_max_length,
    compute_gradient_accumulation,
    load_train_validation,
)


def write_split(path: Path, rows: list[tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["sample_id", "label", "normalized_text"])
        writer.writeheader()
        for index, (label, text) in enumerate(rows, start=1):
            writer.writerow({"sample_id": f"id-{index}", "label": label, "normalized_text": text})


def test_load_train_validation_never_reads_test_csv(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    write_split(data_dir / "train.csv", [("happy", "train text")])
    write_split(data_dir / "validation.csv", [("sad", "validation text")])
    write_split(data_dir / "test.csv", [("fear", "test text must stay sealed")])

    train_rows, validation_rows = load_train_validation(tmp_path)

    all_text = " ".join(row["text"] for row in train_rows + validation_rows)
    assert "test text" not in all_text
    assert [row["label"] for row in train_rows] == ["happy"]
    assert [row["label_id"] for row in validation_rows] == [LABEL_ORDER.index("sad")]


def test_compute_gradient_accumulation_preserves_effective_batch() -> None:
    assert compute_gradient_accumulation(per_device_batch_size=8, effective_batch_size=32) == 4
    assert compute_gradient_accumulation(per_device_batch_size=32, effective_batch_size=32) == 1


def test_choose_max_length_uses_smallest_protocol_bucket_covering_99_percent() -> None:
    assert choose_max_length([10] * 99 + [128]) == 128
    assert choose_max_length([10] * 98 + [200] * 2) == 256
    assert choose_max_length([10] * 98 + [400] * 2) == 512
