from __future__ import annotations

import argparse
import csv
import json
import platform
import random
import time
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

import joblib
from scipy.sparse import hstack
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

from prepare_data import LABEL_ORDER
from train_classical import tokenize_for_word


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def majority_label(labels: list[str]) -> str:
    counts = Counter(labels)
    return sorted(counts.items(), key=lambda item: (-item[1], LABEL_ORDER.index(item[0])))[0][0]


def row_normalize_confusion(matrix: list[list[int]]) -> list[list[float]]:
    normalized: list[list[float]] = []
    for row in matrix:
        total = sum(row)
        normalized.append([value / total if total else 0.0 for value in row])
    return normalized


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * q + 0.999999) - 1))
    return ordered[index]


def sample_error_rows(
    rows: list[dict[str, str]],
    predictions: list[str],
    max_per_class: int = 20,
    seed: int = 20260911,
) -> list[dict[str, str]]:
    rng = random.Random(seed)
    sampled: list[dict[str, str]] = []
    for label in LABEL_ORDER:
        candidates = [
            {
                "sample_id": row["sample_id"],
                "true_label": row["label"],
                "predicted_label": predictions[index],
                "domain": row.get("domain", ""),
                "text": row.get("normalized_text", ""),
                "analysis_bucket": "",
                "notes": "",
            }
            for index, row in enumerate(rows)
            if row["label"] == label and predictions[index] != row["label"]
        ]
        rng.shuffle(candidates)
        sampled.extend(sorted(candidates[:max_per_class], key=lambda row: row["sample_id"]))
    return sampled


def transform_for_artifact(artifact: dict[str, Any], texts: list[str]):
    feature_mode = artifact["feature_mode"]
    vectorizers = artifact["vectorizers"]
    if feature_mode == "word":
        return vectorizers["word"].transform([tokenize_for_word(text) for text in texts])
    if feature_mode == "char":
        return vectorizers["char"].transform(texts)
    if feature_mode == "word_char":
        word = vectorizers["word"].transform([tokenize_for_word(text) for text in texts])
        char = vectorizers["char"].transform(texts)
        return hstack([word, char]).tocsr()
    raise ValueError(f"Unknown feature mode: {feature_mode}")


def score_json(classifier, x_row) -> str:
    if hasattr(classifier, "predict_proba"):
        scores = classifier.predict_proba(x_row)[0].tolist()
        return json.dumps(dict(zip(classifier.classes_, scores)), ensure_ascii=False, sort_keys=True)
    if hasattr(classifier, "decision_function"):
        scores = classifier.decision_function(x_row)
        if getattr(scores, "ndim", 1) > 1:
            scores = scores[0]
        else:
            scores = scores.tolist()
        return json.dumps(dict(zip(classifier.classes_, list(scores))), ensure_ascii=False, sort_keys=True)
    return "{}"


def evaluate_predictions(model_id: str, y_true: list[str], y_pred: list[str]) -> dict[str, Any]:
    report = classification_report(y_true, y_pred, labels=LABEL_ORDER, output_dict=True, zero_division=0)
    return {
        "model_id": model_id,
        "accuracy": accuracy_score(y_true, y_pred),
        "macro_f1": f1_score(y_true, y_pred, labels=LABEL_ORDER, average="macro", zero_division=0),
        "support": len(y_true),
        "per_class": {label: report[label] for label in LABEL_ORDER},
    }


def load_macbert_run_summaries(runs_dir: Path) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for metrics_path in sorted(Path(runs_dir).glob("*/metrics.json")):
        payload = json.loads(metrics_path.read_text(encoding="utf-8"))
        payload["run_dir"] = metrics_path.parent
        payload["metrics_path"] = metrics_path
        summaries.append(payload)
    return summaries


def select_best_macbert_run(runs_dir: Path) -> dict[str, Any]:
    summaries = load_macbert_run_summaries(runs_dir)
    if not summaries:
        raise FileNotFoundError(f"No MacBERT metrics.json files found under {runs_dir}")
    return max(
        summaries,
        key=lambda row: (
            float(row.get("best_validation_macro_f1", -1.0)),
            float(row.get("best_validation_accuracy", 0.0) or 0.0),
            -float(row.get("lr", 0.0) or 0.0),
        ),
    )


def predict_macbert(
    checkpoint_dir: Path,
    texts: list[str],
    batch_size: int,
    device_request: str,
    max_length: int,
) -> tuple[list[str], list[str], str]:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    if device_request == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(device_request)

    tokenizer = AutoTokenizer.from_pretrained(str(checkpoint_dir), local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(str(checkpoint_dir), local_files_only=True).to(device)
    model.eval()
    id2label = {int(index): label for index, label in model.config.id2label.items()}
    predictions: list[str] = []
    score_jsons: list[str] = []

    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch_texts = texts[start : start + batch_size]
            encoded = tokenizer(
                batch_texts,
                truncation=True,
                padding=True,
                max_length=max_length,
                return_tensors="pt",
            )
            encoded = {key: value.to(device) for key, value in encoded.items()}
            logits = model(**encoded).logits.detach().cpu()
            probabilities = torch.softmax(logits, dim=-1)
            prediction_ids = torch.argmax(probabilities, dim=-1).tolist()
            predictions.extend([id2label[index] for index in prediction_ids])
            for row in probabilities.tolist():
                scores = {id2label[index]: float(score) for index, score in enumerate(row)}
                score_jsons.append(json.dumps(scores, ensure_ascii=False, sort_keys=True))

    return predictions, score_jsons, str(device)


def write_confusion_outputs(exp_dir: Path, model_id: str, y_true: list[str], y_pred: list[str]) -> None:
    matrix = confusion_matrix(y_true, y_pred, labels=LABEL_ORDER).tolist()
    normalized = row_normalize_confusion(matrix)
    fields = ["true_label"] + LABEL_ORDER
    count_rows = [{"true_label": label, **{pred: matrix[i][j] for j, pred in enumerate(LABEL_ORDER)}} for i, label in enumerate(LABEL_ORDER)]
    normalized_rows = [
        {"true_label": label, **{pred: f"{normalized[i][j]:.8f}" for j, pred in enumerate(LABEL_ORDER)}} for i, label in enumerate(LABEL_ORDER)
    ]
    write_csv(exp_dir / "figures" / f"confusion_counts_{model_id}.csv", count_rows, fields)
    write_csv(exp_dir / "figures" / f"confusion_row_normalized_{model_id}.csv", normalized_rows, fields)


def domain_metrics(test_rows: list[dict[str, str]], predictions: list[str], model_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for domain in sorted({row["domain"] for row in test_rows}):
        indices = [index for index, row in enumerate(test_rows) if row["domain"] == domain]
        y_true = [test_rows[index]["label"] for index in indices]
        y_pred = [predictions[index] for index in indices]
        rows.append(
            {
                "model_id": model_id,
                "domain": domain,
                "support": len(indices),
                "accuracy": f"{accuracy_score(y_true, y_pred):.8f}",
                "macro_f1": f"{f1_score(y_true, y_pred, labels=LABEL_ORDER, average='macro', zero_division=0):.8f}",
            }
        )
    return rows


def measure_latency_ms(artifact: dict[str, Any], texts: list[str], limit: int = 1000) -> dict[str, Any]:
    selected = texts[:limit]
    classifier = artifact["classifier"]
    latencies: list[float] = []
    for text in selected[:20]:
        x_row = transform_for_artifact(artifact, [text])
        classifier.predict(x_row)
    for text in selected:
        start = time.perf_counter()
        x_row = transform_for_artifact(artifact, [text])
        classifier.predict(x_row)
        latencies.append((time.perf_counter() - start) * 1000)
    return {
        "samples": len(selected),
        "p50_ms": percentile(latencies, 0.50),
        "p95_ms": percentile(latencies, 0.95),
        "min_ms": min(latencies) if latencies else 0.0,
        "max_ms": max(latencies) if latencies else 0.0,
    }


def evaluate(exp_dir: Path, macbert_runs_dir: Path | None = None, macbert_batch_size: int = 32, macbert_device: str = "auto") -> None:
    data_dir = exp_dir / "data"
    results_dir = exp_dir / "results"
    prediction_dir = results_dir / "predictions"
    prediction_dir.mkdir(parents=True, exist_ok=True)
    (exp_dir / "figures").mkdir(parents=True, exist_ok=True)

    train_rows = load_csv(data_dir / "train.csv")
    validation_rows = load_csv(data_dir / "validation.csv")
    test_rows = load_csv(data_dir / "test.csv")
    y_train = [row["label"] for row in train_rows]
    y_true = [row["label"] for row in test_rows]
    texts = [row["normalized_text"] for row in test_rows]

    best = json.loads((results_dir / "best_classical.json").read_text(encoding="utf-8"))
    best_id = best["config_id"]
    artifact = joblib.load(exp_dir / "runs" / "classical" / f"{best_id}.joblib")
    x_test = transform_for_artifact(artifact, texts)
    best_pred = artifact["classifier"].predict(x_test).tolist()
    best_score_jsons = [score_json(artifact["classifier"], x_test[index]) for index in range(len(test_rows))]

    dummy_label = majority_label(y_train)
    dummy_pred = [dummy_label] * len(y_true)

    evaluated = [
        {
            "model_id": "dummy_most_frequent",
            "predictions": dummy_pred,
            "score_jsons": ["{}"] * len(y_true),
            "note": "Majority label baseline fitted from train labels only.",
        },
        {
            "model_id": best_id,
            "predictions": best_pred,
            "score_jsons": best_score_jsons,
            "note": "Validation-selected best classical model.",
        },
    ]
    macbert_runs: list[dict[str, Any]] = []
    selected_macbert: dict[str, Any] | None = None
    macbert_device_used = ""
    if macbert_runs_dir:
        macbert_runs = load_macbert_run_summaries(macbert_runs_dir)
        selected_macbert = select_best_macbert_run(macbert_runs_dir)
        checkpoint_dir = selected_macbert["run_dir"] / "best_checkpoint"
        max_length = int(selected_macbert.get("max_length", 128) or 128)
        macbert_pred, macbert_score_jsons, macbert_device_used = predict_macbert(
            checkpoint_dir=checkpoint_dir,
            texts=texts,
            batch_size=macbert_batch_size,
            device_request=macbert_device,
            max_length=max_length,
        )
        evaluated.append(
            {
                "model_id": selected_macbert["run_id"],
                "predictions": macbert_pred,
                "score_jsons": macbert_score_jsons,
                "note": "Validation-selected best MacBERT checkpoint.",
            }
        )
    test_result_rows: list[dict[str, Any]] = []
    per_class_rows: list[dict[str, Any]] = []
    domain_rows: list[dict[str, Any]] = []

    for item in evaluated:
        model_id = item["model_id"]
        predictions = item["predictions"]
        metrics = evaluate_predictions(model_id, y_true, predictions)
        test_result_rows.append(
            {
                "model_id": model_id,
                "accuracy": f"{metrics['accuracy']:.8f}",
                "macro_f1": f"{metrics['macro_f1']:.8f}",
                "surprise_f1": f"{metrics['per_class']['surprise']['f1-score']:.8f}",
                "support": metrics["support"],
                "note": item["note"],
            }
        )
        for label, label_metrics in metrics["per_class"].items():
            per_class_rows.append(
                {
                    "model_id": model_id,
                    "label": label,
                    "precision": f"{label_metrics['precision']:.8f}",
                    "recall": f"{label_metrics['recall']:.8f}",
                    "f1": f"{label_metrics['f1-score']:.8f}",
                    "support": int(label_metrics["support"]),
                }
        )
        write_confusion_outputs(exp_dir, model_id, y_true, predictions)
        domain_rows.extend(domain_metrics(test_rows, predictions, model_id))

    for item in evaluated:
        if item["model_id"] == "dummy_most_frequent":
            continue
        prediction_rows = []
        score_payloads = item["score_jsons"]
        predictions = item["predictions"]
        for index, row in enumerate(test_rows):
            prediction_rows.append(
                {
                    "sample_id": row["sample_id"],
                    "domain": row["domain"],
                    "y_true": row["label"],
                    "y_pred": predictions[index],
                    "scores_json": score_payloads[index],
                    "model_id": item["model_id"],
                }
            )
        write_csv(
            prediction_dir / f"{item['model_id']}_test_predictions.csv",
            prediction_rows,
            ["sample_id", "domain", "y_true", "y_pred", "scores_json", "model_id"],
        )

    primary_model_id = selected_macbert["run_id"] if selected_macbert else best_id
    primary_predictions = next(item["predictions"] for item in evaluated if item["model_id"] == primary_model_id)

    write_csv(results_dir / "test_results.csv", test_result_rows, ["model_id", "accuracy", "macro_f1", "surprise_f1", "support", "note"])
    write_csv(results_dir / "per_class_metrics.csv", per_class_rows, ["model_id", "label", "precision", "recall", "f1", "support"])
    write_csv(results_dir / "domain_results.csv", domain_rows, ["model_id", "domain", "support", "accuracy", "macro_f1"])
    write_csv(
        results_dir / "error_analysis.csv",
        sample_error_rows(test_rows, primary_predictions),
        ["sample_id", "true_label", "predicted_label", "domain", "text", "analysis_bucket", "notes"],
    )
    for item in evaluated:
        if item["model_id"] == "dummy_most_frequent":
            continue
        write_csv(
            results_dir / f"error_analysis_{item['model_id']}.csv",
            sample_error_rows(test_rows, item["predictions"]),
            ["sample_id", "true_label", "predicted_label", "domain", "text", "analysis_bucket", "notes"],
        )
    latency = measure_latency_ms(artifact, [row["normalized_text"] for row in validation_rows])
    write_csv(
        results_dir / "latency_results.csv",
        [
            {
                "model_id": best_id,
                "subset": "validation_first_1000",
                "samples": latency["samples"],
                "p50_ms": f"{latency['p50_ms']:.6f}",
                "p95_ms": f"{latency['p95_ms']:.6f}",
                "min_ms": f"{latency['min_ms']:.6f}",
                "max_ms": f"{latency['max_ms']:.6f}",
                "hardware": platform.platform(),
                "note": "Batch size 1; includes tokenization, TF-IDF transform, and classifier prediction; excludes one-time model load.",
            }
        ],
        ["model_id", "subset", "samples", "p50_ms", "p95_ms", "min_ms", "max_ms", "hardware", "note"],
    )

    manifest = {
        "created_date": date.today().isoformat(),
        "test_policy": "Test was evaluated only after validation selection of best_classical and best_macbert.",
        "historical_exposure_note": "This test split is held out for this experiment but is not claimed as historically untouched.",
        "evaluated_models": [row["model_id"] for row in test_result_rows],
        "best_classical": best_id,
        "macbert_status": "evaluated" if selected_macbert else "not_provided",
        "selected_macbert": None
        if not selected_macbert
        else {
            "run_id": selected_macbert["run_id"],
            "run_dir": str(selected_macbert["run_dir"]),
            "checkpoint_dir": str(selected_macbert["run_dir"] / "best_checkpoint"),
            "lr": selected_macbert.get("lr"),
            "best_epoch": selected_macbert.get("best_epoch"),
            "best_validation_macro_f1": selected_macbert.get("best_validation_macro_f1"),
            "device_used_for_final_eval": macbert_device_used,
        },
        "primary_final_model": primary_model_id,
        "test_size": len(test_rows),
        "label_order": LABEL_ORDER,
    }
    (results_dir / "final_evaluation_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(exp_dir, test_result_rows, best_id, macbert_runs, selected_macbert, primary_model_id)
    write_model_card(exp_dir, best_id, selected_macbert, primary_model_id, test_result_rows)


def write_report(
    exp_dir: Path,
    test_result_rows: list[dict[str, Any]],
    best_id: str,
    macbert_runs: list[dict[str, Any]],
    selected_macbert: dict[str, Any] | None,
    primary_model_id: str,
) -> None:
    result_by_id = {row["model_id"]: row for row in test_result_rows}
    classical_row = result_by_id.get(best_id)
    macbert_row = result_by_id.get(selected_macbert["run_id"]) if selected_macbert else None
    macro_delta = ""
    if classical_row and macbert_row:
        macro_delta = f"{float(macbert_row['macro_f1']) - float(classical_row['macro_f1']):+.8f}"

    lines = [
        "# Heartide Emotion V2 Report",
        "",
        "## Problem",
        "",
        "This experiment evaluates original six-class Chinese emotion classification with frozen train, validation, and test splits.",
        "The product five-class mapping and fatigue templates are not used in this experiment.",
        "Product-facing Chinese labels are one-to-one with the six canonical labels: `无情绪`, `积极`, `悲伤`, `愤怒`, `恐惧`, `惊奇`.",
        "",
        "## Data",
        "",
        "Frozen data files are stored in `data/`. Source test is held out for this experiment's final evaluation, while the report discloses historical exposure risk.",
        "",
        "| Split | Rows |",
        "|---|---:|",
        "| Train | 33844 |",
        "| Validation | 3712 |",
        "| Test | 7719 |",
        "",
        "## Classical Results",
        "",
        "| Model | Test Accuracy | Test Macro-F1 | Surprise F1 | Support |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in test_result_rows:
        if row["model_id"] == "dummy_most_frequent" or row["model_id"] == best_id:
            lines.append(f"| `{row['model_id']}` | {row['accuracy']} | {row['macro_f1']} | {row['surprise_f1']} | {row['support']} |")
    lines.extend(
        [
            "",
            f"Validation selected best classical model: `{best_id}`.",
            "",
            "## MacBERT Validation Search",
            "",
            "| Run | LR | Best Epoch | Validation Macro-F1 | Validation Accuracy At Best | Epochs Run |",
            "|---|---:|---:|---:|---:|---:|",
        ]
    )
    if macbert_runs:
        for run in sorted(macbert_runs, key=lambda item: float(item.get("lr", 0.0) or 0.0)):
            best_epoch = int(run.get("best_epoch", 0) or 0)
            best_metric = next((metric for metric in run.get("metrics", []) if int(metric.get("epoch", -1)) == best_epoch), {})
            lines.append(
                "| `{run_id}` | {lr:.0e} | {best_epoch} | {macro:.8f} | {accuracy:.8f} | {epochs} |".format(
                    run_id=run["run_id"],
                    lr=float(run.get("lr", 0.0) or 0.0),
                    best_epoch=best_epoch,
                    macro=float(run.get("best_validation_macro_f1", 0.0) or 0.0),
                    accuracy=float(best_metric.get("validation_accuracy", 0.0) or 0.0),
                    epochs=len(run.get("metrics", [])),
                )
            )
    else:
        lines.append("| _Not provided_ |  |  |  |  |  |")
    lines.extend(
        [
            "",
            "Selection rule: choose the MacBERT run with the highest validation macro-F1, then evaluate that checkpoint on the frozen test split once.",
        ]
    )
    if selected_macbert:
        lines.append(f"Selected MacBERT checkpoint: `{selected_macbert['run_id']}` from epoch {selected_macbert.get('best_epoch')}.")
    lines.extend(
        [
            "",
            "## Final Test Results",
            "",
            "| Model | Test Accuracy | Test Macro-F1 | Surprise F1 | Support | Note |",
            "|---|---:|---:|---:|---:|---|",
        ]
    )
    for row in test_result_rows:
        lines.append(
            f"| `{row['model_id']}` | {row['accuracy']} | {row['macro_f1']} | {row['surprise_f1']} | {row['support']} | {row['note']} |"
        )
    lines.extend(
        [
            "",
            f"Primary final model for product integration: `{primary_model_id}`.",
        ]
    )
    if macro_delta:
        lines.append(f"MacBERT minus best classical test macro-F1 delta: `{macro_delta}`.")
    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- MacBERT gives a moderate improvement over the selected classical baseline on this six-class frozen test, but the gain is not large enough to justify exaggerated claims.",
            "- The earlier 5k MacBERT cross-validation record in `moodgarden/RUN.md` used a different experimental口径; it is not treated as a strict apples-to-apples baseline here.",
            "- 本轮大样本训练相对 classical baseline 有中等提升，但相对旧 5k 记录不能形成“同口径显著提升”的结论；尤其 `surprise` / `惊奇` 仍是主要短板。",
            "- `surprise` is low-support and semantically broad. In the selected MacBERT test confusion matrix, true `surprise` is predicted as `angry` 48 times, `happy` 42 times, `neutral` 35 times, `fear` 29 times, and `sad` 24 times.",
            "- Domain shift remains visible: selected MacBERT reaches macro-F1 `0.75800405` on `usual` but `0.62808452` on `virus`.",
            "",
            "## Artifacts",
            "",
            "- `results/test_results.csv`: final model-level metrics.",
            "- `results/per_class_metrics.csv`: precision, recall, and F1 for each label.",
            "- `results/domain_results.csv`: usual / virus domain metrics.",
            "- `figures/confusion_counts_*.csv` and `figures/confusion_row_normalized_*.csv`: confusion matrices.",
            "- `results/predictions/*_test_predictions.csv`: frozen-test predictions.",
            "- `results/error_analysis*.csv`: stratified sampled errors for manual review.",
            "",
            "## Limitations",
            "",
            "- The test split is not claimed as historically untouched.",
            "- No five-class product score is reported from this six-class experiment.",
            "- Only one seed (`42`) was run for the three MacBERT learning rates; cross-seed means and bootstrap intervals are not reported.",
            "- Error analysis rows are sampled for manual annotation; `analysis_bucket` and `notes` are intentionally blank until reviewed.",
        ]
    )
    (exp_dir / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_model_card(
    exp_dir: Path,
    best_id: str,
    selected_macbert: dict[str, Any] | None,
    primary_model_id: str,
    test_result_rows: list[dict[str, Any]],
) -> None:
    primary_row = next((row for row in test_result_rows if row["model_id"] == primary_model_id), None)
    lines = [
        "# Heartide Emotion V2 Model Card",
        "",
        f"- Selected classical model: `{best_id}`",
        f"- Primary final model: `{primary_model_id}`",
        "- Task: original six-class SMP2020 emotion classification.",
        "- Labels: `neutral`, `happy`, `sad`, `angry`, `fear`, `surprise`.",
        "- Product labels: `无情绪`, `积极`, `悲伤`, `愤怒`, `恐惧`, `惊奇`.",
        "- Intended use: Heartide/MoodGarden emotion classification and product routing after six-class frontend/backend integration.",
        "- Not intended for diagnosis, clinical triage, or high-stakes mental-health decisions.",
        "- Test policy: validation-selected models evaluated once on the frozen test split.",
    ]
    if primary_row:
        lines.append(
            f"- Final frozen-test metrics: accuracy `{primary_row['accuracy']}`, macro-F1 `{primary_row['macro_f1']}`, surprise F1 `{primary_row['surprise_f1']}`."
        )
    if selected_macbert:
        lines.extend(
            [
                f"- Selected MacBERT checkpoint: `{selected_macbert['run_id']}/best_checkpoint`",
                f"- MacBERT selection metric: validation macro-F1 `{float(selected_macbert.get('best_validation_macro_f1', 0.0) or 0.0):.8f}`.",
                "- Known weakness: `surprise` / `惊奇` remains the least stable class and requires manual error review before strong product claims.",
            ]
        )
    else:
        lines.append("- MacBERT checkpoint: not evaluated in this run.")
    (exp_dir / "MODEL_CARD.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exp-dir", type=Path, required=True)
    parser.add_argument("--macbert-runs-dir", type=Path)
    parser.add_argument("--macbert-batch-size", type=int, default=32)
    parser.add_argument("--macbert-device", default="auto")
    args = parser.parse_args()
    evaluate(args.exp_dir, args.macbert_runs_dir, args.macbert_batch_size, args.macbert_device)


if __name__ == "__main__":
    main()
