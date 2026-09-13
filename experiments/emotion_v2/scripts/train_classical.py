from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import jieba
import joblib
from scipy.sparse import hstack
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.multiclass import OneVsRestClassifier
from sklearn.svm import LinearSVC

from prepare_data import LABEL_ORDER

C_VALUES = [0.1, 1, 10]
FEATURE_MODES = ["word", "char", "word_char"]
CLASS_WEIGHTS = ["none", "balanced"]
CLASSIFIERS = ["logreg", "linearsvc"]
RESULT_FIELDS = [
    "config_order",
    "config_id",
    "classifier",
    "feature_mode",
    "c",
    "class_weight",
    "train_size",
    "validation_size",
    "feature_dim",
    "fit_seconds",
    "validation_accuracy",
    "validation_macro_f1",
    "is_best_classical",
    "label_order",
    "per_class_json",
]


@dataclass(frozen=True)
class ClassicalConfig:
    config_order: int
    config_id: str
    classifier: str
    feature_mode: str
    c: float
    class_weight: str


def serializable_config(config: ClassicalConfig) -> dict[str, Any]:
    return asdict(config)


def format_c(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def build_configs() -> list[ClassicalConfig]:
    configs: list[ClassicalConfig] = []
    order = 1
    for classifier in CLASSIFIERS:
        for feature_mode in FEATURE_MODES:
            for c in C_VALUES:
                for class_weight in CLASS_WEIGHTS:
                    config_id = f"{order:03d}_{classifier}_{feature_mode}_c{format_c(c)}_weight{class_weight}"
                    configs.append(
                        ClassicalConfig(
                            config_order=order,
                            config_id=config_id,
                            classifier=classifier,
                            feature_mode=feature_mode,
                            c=c,
                            class_weight=class_weight,
                        )
                    )
                    order += 1
    return configs


def compute_balanced_weights(labels: list[str]) -> dict[str, float]:
    counts = Counter(labels)
    total = len(labels)
    class_count = len(counts)
    return {label: total / (class_count * count) for label, count in sorted(counts.items())}


def load_split(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def tokenize_for_word(text: str) -> str:
    return " ".join(token for token in jieba.cut(text) if token.strip())


def fit_feature_spaces(train_texts: list[str], validation_texts: list[str]) -> dict[str, dict[str, Any]]:
    print("Tokenizing train/validation text for word TF-IDF...", flush=True)
    train_words = [tokenize_for_word(text) for text in train_texts]
    validation_words = [tokenize_for_word(text) for text in validation_texts]

    word_vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=20_000,
        min_df=2,
        sublinear_tf=True,
        norm="l2",
        token_pattern=r"(?u)\b\w+\b",
    )
    char_vectorizer = TfidfVectorizer(
        analyzer="char",
        ngram_range=(1, 4),
        max_features=80_000,
        min_df=2,
        sublinear_tf=True,
        norm="l2",
    )

    print("Fitting word TF-IDF on train only...", flush=True)
    x_train_word = word_vectorizer.fit_transform(train_words)
    x_validation_word = word_vectorizer.transform(validation_words)
    print("Fitting char TF-IDF on train only...", flush=True)
    x_train_char = char_vectorizer.fit_transform(train_texts)
    x_validation_char = char_vectorizer.transform(validation_texts)

    return {
        "word": {
            "vectorizers": {"word": word_vectorizer},
            "x_train": x_train_word,
            "x_validation": x_validation_word,
        },
        "char": {
            "vectorizers": {"char": char_vectorizer},
            "x_train": x_train_char,
            "x_validation": x_validation_char,
        },
        "word_char": {
            "vectorizers": {"word": word_vectorizer, "char": char_vectorizer},
            "x_train": hstack([x_train_word, x_train_char]).tocsr(),
            "x_validation": hstack([x_validation_word, x_validation_char]).tocsr(),
        },
    }


def make_classifier(config: ClassicalConfig):
    class_weight = None if config.class_weight == "none" else "balanced"
    if config.classifier == "logreg":
        return OneVsRestClassifier(
            LogisticRegression(
                C=config.c,
                class_weight=class_weight,
                solver="liblinear",
                max_iter=2000,
                random_state=42,
            )
        )
    if config.classifier == "linearsvc":
        return LinearSVC(C=config.c, class_weight=class_weight, max_iter=5000, random_state=42)
    raise ValueError(f"Unknown classifier: {config.classifier}")


def metric_row(
    *,
    config_order: int,
    config_id: str,
    classifier: str,
    feature_mode: str,
    c: str,
    class_weight: str,
    train_size: int,
    validation_size: int,
    feature_dim: int,
    fit_seconds: float,
    y_true: list[str],
    y_pred: list[str],
) -> dict[str, str]:
    report = classification_report(y_true, y_pred, labels=LABEL_ORDER, output_dict=True, zero_division=0)
    return {
        "config_order": str(config_order),
        "config_id": config_id,
        "classifier": classifier,
        "feature_mode": feature_mode,
        "c": c,
        "class_weight": class_weight,
        "train_size": str(train_size),
        "validation_size": str(validation_size),
        "feature_dim": str(feature_dim),
        "fit_seconds": f"{fit_seconds:.3f}",
        "validation_accuracy": f"{accuracy_score(y_true, y_pred):.8f}",
        "validation_macro_f1": f"{f1_score(y_true, y_pred, labels=LABEL_ORDER, average='macro', zero_division=0):.8f}",
        "is_best_classical": "false",
        "label_order": "|".join(LABEL_ORDER),
        "per_class_json": json.dumps({label: report[label] for label in LABEL_ORDER}, ensure_ascii=False, sort_keys=True),
    }


def select_best_validation_model(rows: list[dict[str, str]]) -> dict[str, str]:
    candidates = [row for row in rows if row.get("classifier") in set(CLASSIFIERS)]
    if not candidates:
        candidates = rows
    return sorted(
        candidates,
        key=lambda row: (
            -float(row["validation_macro_f1"]),
            -float(row["validation_accuracy"]),
            int(row["config_order"]),
        ),
    )[0]


def write_rows(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_ablation_results(rows: list[dict[str, str]], output: Path) -> None:
    ablations: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        row = {"label_order": "|".join(LABEL_ORDER), **row}
        if row["classifier"] == "logreg" and row["c"] in {"1", "1.0"} and row["class_weight"] == "none":
            key = ("feature_mode", row["feature_mode"])
            if key not in seen:
                seen.add(key)
                ablations.append({"ablation": "feature_mode", **row})
        if row["classifier"] == "logreg" and row["c"] in {"1", "1.0"} and row["feature_mode"] == "word_char":
            key = ("class_weight", row["class_weight"])
            if key not in seen:
                seen.add(key)
                ablations.append({"ablation": "class_weight", **row})
    fields = ["ablation"] + RESULT_FIELDS
    write_rows(output, ablations, fields)


def train(exp_dir: Path) -> None:
    data_dir = exp_dir / "data"
    results_dir = exp_dir / "results"
    run_dir = exp_dir / "runs" / "classical"
    run_dir.mkdir(parents=True, exist_ok=True)

    train_rows = load_split(data_dir / "train.csv")
    validation_rows = load_split(data_dir / "validation.csv")
    train_texts = [row["normalized_text"] for row in train_rows]
    y_train = [row["label"] for row in train_rows]
    validation_texts = [row["normalized_text"] for row in validation_rows]
    y_validation = [row["label"] for row in validation_rows]

    spaces = fit_feature_spaces(train_texts, validation_texts)
    rows: list[dict[str, str]] = []

    dummy = DummyClassifier(strategy="most_frequent")
    start = time.time()
    dummy.fit([[0]] * len(y_train), y_train)
    dummy_pred = dummy.predict([[0]] * len(y_validation)).tolist()
    rows.append(
        metric_row(
            config_order=0,
            config_id="000_dummy_most_frequent",
            classifier="dummy",
            feature_mode="none",
            c="",
            class_weight="none",
            train_size=len(y_train),
            validation_size=len(y_validation),
            feature_dim=0,
            fit_seconds=time.time() - start,
            y_true=y_validation,
            y_pred=dummy_pred,
        )
    )

    configs = build_configs()
    for config in configs:
        space = spaces[config.feature_mode]
        x_train = space["x_train"]
        x_validation = space["x_validation"]
        clf = make_classifier(config)
        print(f"Training {config.config_id}...", flush=True)
        start = time.time()
        clf.fit(x_train, y_train)
        y_pred = clf.predict(x_validation).tolist()
        seconds = time.time() - start
        row = metric_row(
            config_order=config.config_order,
            config_id=config.config_id,
            classifier=config.classifier,
            feature_mode=config.feature_mode,
            c=format_c(config.c),
            class_weight=config.class_weight,
            train_size=len(y_train),
            validation_size=len(y_validation),
            feature_dim=x_train.shape[1],
            fit_seconds=seconds,
            y_true=y_validation,
            y_pred=y_pred,
        )
        rows.append(row)
        artifact = {
            "config": serializable_config(config),
            "label_order": LABEL_ORDER,
            "feature_mode": config.feature_mode,
            "vectorizers": space["vectorizers"],
            "classifier": clf,
            "validation_metrics": {
                "accuracy": float(row["validation_accuracy"]),
                "macro_f1": float(row["validation_macro_f1"]),
            },
        }
        joblib.dump(artifact, run_dir / f"{config.config_id}.joblib", compress=3)

    best = select_best_validation_model(rows)
    for row in rows:
        if row["config_id"] == best["config_id"]:
            row["is_best_classical"] = "true"
    write_rows(results_dir / "validation_results.csv", rows, RESULT_FIELDS)
    write_ablation_results(rows, results_dir / "ablation_results.csv")
    (results_dir / "best_classical.json").write_text(json.dumps(best, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Best classical: {best['config_id']} macro_f1={best['validation_macro_f1']} accuracy={best['validation_accuracy']}",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exp-dir", type=Path, required=True)
    args = parser.parse_args()
    train(args.exp_dir)


if __name__ == "__main__":
    main()
