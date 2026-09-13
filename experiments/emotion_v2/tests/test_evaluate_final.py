from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from evaluate_final import majority_label, percentile, row_normalize_confusion, sample_error_rows, select_best_macbert_run  # noqa: E402


def test_majority_label_uses_train_labels_only() -> None:
    assert majority_label(["happy", "sad", "happy", "fear"]) == "happy"


def test_row_normalize_confusion_handles_empty_rows() -> None:
    normalized = row_normalize_confusion([[2, 2], [0, 0]])

    assert normalized == [[0.5, 0.5], [0.0, 0.0]]


def test_percentile_uses_nearest_rank() -> None:
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.50) == 2.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.95) == 4.0


def test_sample_error_rows_is_stratified_by_true_label() -> None:
    rows = [
        {"sample_id": "a", "label": "happy", "normalized_text": "a"},
        {"sample_id": "b", "label": "happy", "normalized_text": "b"},
        {"sample_id": "c", "label": "sad", "normalized_text": "c"},
    ]
    predictions = ["sad", "happy", "happy"]

    sampled = sample_error_rows(rows, predictions, max_per_class=1, seed=1)

    assert [(row["sample_id"], row["true_label"], row["predicted_label"]) for row in sampled] == [
        ("a", "happy", "sad"),
        ("c", "sad", "happy"),
    ]


def test_select_best_macbert_run_uses_validation_macro_f1(tmp_path: Path) -> None:
    low = tmp_path / "macbert_lr3e-5_seed42_4090"
    high = tmp_path / "macbert_lr1e-5_seed42_4090"
    low.mkdir()
    high.mkdir()
    (low / "metrics.json").write_text(
        '{"run_id":"macbert_lr3e-5_seed42_4090","best_validation_macro_f1":0.712377,"best_epoch":2}',
        encoding="utf-8",
    )
    (high / "metrics.json").write_text(
        '{"run_id":"macbert_lr1e-5_seed42_4090","best_validation_macro_f1":0.718885,"best_epoch":3}',
        encoding="utf-8",
    )

    selected = select_best_macbert_run(tmp_path)

    assert selected["run_id"] == "macbert_lr1e-5_seed42_4090"
    assert selected["best_epoch"] == 3
    assert selected["run_dir"] == high
