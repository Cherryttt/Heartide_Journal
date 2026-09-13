from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from prepare_data import LABEL_ORDER  # noqa: E402
from train_classical import (  # noqa: E402
    C_VALUES,
    CLASS_WEIGHTS,
    ClassicalConfig,
    FEATURE_MODES,
    build_configs,
    compute_balanced_weights,
    make_classifier,
    serializable_config,
    select_best_validation_model,
    write_ablation_results,
)


def test_build_configs_matches_fixed_search_budget() -> None:
    configs = build_configs()

    assert len(configs) == 36
    assert {config.classifier for config in configs} == {"logreg", "linearsvc"}
    assert {config.feature_mode for config in configs} == set(FEATURE_MODES)
    assert {config.c for config in configs} == set(C_VALUES)
    assert {config.class_weight for config in configs} == set(CLASS_WEIGHTS)
    assert configs[0].config_id == "001_logreg_word_c0.1_weightnone"


def test_compute_balanced_weights_uses_train_labels_only() -> None:
    weights = compute_balanced_weights(["happy", "happy", "sad", "fear"])

    assert weights["happy"] == 4 / (3 * 2)
    assert weights["sad"] == 4 / (3 * 1)
    assert weights["fear"] == 4 / (3 * 1)
    assert "neutral" not in weights


def test_logreg_classifier_fits_multiclass_sparse_input() -> None:
    from scipy.sparse import csr_matrix

    config = ClassicalConfig(
        config_order=1,
        config_id="test",
        classifier="logreg",
        feature_mode="word",
        c=0.1,
        class_weight="none",
    )
    x_train = csr_matrix(
        [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
            [1, 1, 0],
            [0, 1, 1],
            [1, 0, 1],
        ]
    )
    y_train = ["happy", "sad", "fear", "happy", "sad", "fear"]

    clf = make_classifier(config)
    clf.fit(x_train, y_train)

    assert set(clf.predict(x_train)) <= {"happy", "sad", "fear"}


def test_serializable_config_is_plain_dict_not_dataclass_instance() -> None:
    config = ClassicalConfig(
        config_order=1,
        config_id="test",
        classifier="logreg",
        feature_mode="word",
        c=0.1,
        class_weight="none",
    )

    payload = serializable_config(config)

    assert payload == {
        "config_order": 1,
        "config_id": "test",
        "classifier": "logreg",
        "feature_mode": "word",
        "c": 0.1,
        "class_weight": "none",
    }
    assert payload.__class__ is dict


def test_select_best_validation_model_uses_macro_f1_then_accuracy_then_order() -> None:
    rows = [
        {"config_id": "002", "validation_macro_f1": "0.7", "validation_accuracy": "0.9", "config_order": "2"},
        {"config_id": "001", "validation_macro_f1": "0.7", "validation_accuracy": "0.9", "config_order": "1"},
        {"config_id": "003", "validation_macro_f1": "0.7", "validation_accuracy": "0.8", "config_order": "3"},
        {"config_id": "004", "validation_macro_f1": "0.6", "validation_accuracy": "1.0", "config_order": "4"},
    ]

    assert select_best_validation_model(rows)["config_id"] == "001"


def test_write_ablation_results_reuses_fixed_search_rows(tmp_path: Path) -> None:
    rows = []
    for feature in FEATURE_MODES:
        rows.append(
            {
                "config_id": f"logreg-{feature}",
                "classifier": "logreg",
                "feature_mode": feature,
                "c": "1",
                "class_weight": "none",
                "validation_accuracy": "0.5",
                "validation_macro_f1": "0.4",
            }
        )
    for weight in CLASS_WEIGHTS:
        rows.append(
            {
                "config_id": f"logreg-word_char-{weight}",
                "classifier": "logreg",
                "feature_mode": "word_char",
                "c": "1",
                "class_weight": weight,
                "validation_accuracy": "0.6",
                "validation_macro_f1": "0.5",
            }
        )

    output = tmp_path / "ablation.csv"
    write_ablation_results(rows, output)

    with output.open("r", encoding="utf-8", newline="") as file:
        ablation_rows = list(csv.DictReader(file))

    assert {row["ablation"] for row in ablation_rows} == {"feature_mode", "class_weight"}
    assert len([row for row in ablation_rows if row["ablation"] == "feature_mode"]) == 3
    assert len([row for row in ablation_rows if row["ablation"] == "class_weight"]) == 2
    assert all(row["label_order"] == "|".join(LABEL_ORDER) for row in ablation_rows)
