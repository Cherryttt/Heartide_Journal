"""Fine-tune a Chinese Transformer classifier with stratified cross-validation.

Examples:
    python ml/transformer_cv.py --model-name hfl/rbt3 --folds 5 --epochs 1
    python ml/transformer_cv.py --model-name hfl/chinese-macbert-base --folds 5 --epochs 2

The script intentionally uses a small custom PyTorch loop instead of Trainer so it
does not require `accelerate`.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import StratifiedKFold
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup


HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "data"
TRAIN_CSV = DATA_DIR / "emotion_train.csv"
TEST_CSV = DATA_DIR / "emotion_test.csv"
REPORT_MD = DATA_DIR / "TRANSFORMER_CV_REPORT.md"
REPORT_JSON = DATA_DIR / "transformer_cv_metrics.json"
LABELS = ["平静", "开心", "忧郁", "焦虑", "疲惫"]
LABEL_TO_ID = {label: index for index, label in enumerate(LABELS)}
ID_TO_LABEL = {index: label for label, index in LABEL_TO_ID.items()}


@dataclass
class FoldMetric:
    fold: int
    train_size: int
    test_size: int
    accuracy: float
    macro_f1: float
    seconds: float


class EmotionDataset(Dataset):
    def __init__(self, texts: list[str], labels: list[int], tokenizer, max_length: int):
        self.texts = texts
        self.labels = labels
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        encoded = self.tokenizer(
            self.texts[index],
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )
        item = {key: value.squeeze(0) for key, value in encoded.items()}
        item["labels"] = torch.tensor(self.labels[index], dtype=torch.long)
        return item


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def load_rows() -> tuple[list[str], list[str]]:
    rows: list[tuple[str, str]] = []
    for path in [TRAIN_CSV, TEST_CSV]:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8", newline="") as file:
            for row in csv.DictReader(file):
                text = (row.get("text") or "").strip()
                label = (row.get("label") or "").strip()
                if text and label in LABEL_TO_ID:
                    rows.append((text, label))
    rows = sorted(set(rows), key=lambda item: (item[1], item[0]))
    return [text for text, _ in rows], [label for _, label in rows]


def limit_rows(texts: list[str], labels: list[str], max_samples: int | None, seed: int) -> tuple[list[str], list[str]]:
    if not max_samples or max_samples >= len(labels):
        return texts, labels
    rng = random.Random(seed)
    by_label: dict[str, list[int]] = {label: [] for label in LABELS}
    for index, label in enumerate(labels):
        by_label[label].append(index)
    per_label = max(1, max_samples // len(LABELS))
    chosen: list[int] = []
    for label in LABELS:
        candidates = by_label[label]
        rng.shuffle(candidates)
        chosen.extend(candidates[: min(per_label, len(candidates))])
    if len(chosen) < max_samples:
        remaining = [index for index in range(len(labels)) if index not in set(chosen)]
        rng.shuffle(remaining)
        chosen.extend(remaining[: max_samples - len(chosen)])
    chosen = sorted(chosen)
    return [texts[index] for index in chosen], [labels[index] for index in chosen]


def make_optimizer(model, lr: float, weight_decay: float):
    no_decay = ("bias", "LayerNorm.weight")
    grouped = [
        {
            "params": [param for name, param in model.named_parameters() if not any(key in name for key in no_decay)],
            "weight_decay": weight_decay,
        },
        {
            "params": [param for name, param in model.named_parameters() if any(key in name for key in no_decay)],
            "weight_decay": 0.0,
        },
    ]
    return torch.optim.AdamW(grouped, lr=lr)


def train_one_fold(args, tokenizer, texts: list[str], label_ids: list[int], train_idx, test_idx, fold: int, device) -> FoldMetric:
    start = time.time()
    train_texts = [texts[index] for index in train_idx]
    train_labels = [label_ids[index] for index in train_idx]
    test_texts = [texts[index] for index in test_idx]
    test_labels = [label_ids[index] for index in test_idx]

    train_dataset = EmotionDataset(train_texts, train_labels, tokenizer, args.max_length)
    test_dataset = EmotionDataset(test_texts, test_labels, tokenizer, args.max_length)
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True, num_workers=0)
    test_loader = DataLoader(test_dataset, batch_size=args.eval_batch_size, shuffle=False, num_workers=0)

    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_name,
        num_labels=len(LABELS),
        id2label=ID_TO_LABEL,
        label2id=LABEL_TO_ID,
    ).to(device)
    optimizer = make_optimizer(model, args.lr, args.weight_decay)
    total_steps = max(1, len(train_loader) * args.epochs)
    warmup_steps = int(total_steps * args.warmup_ratio)
    scheduler = get_linear_schedule_with_warmup(optimizer, warmup_steps, total_steps)

    for epoch in range(args.epochs):
        model.train()
        running_loss = 0.0
        for step, batch in enumerate(train_loader, start=1):
            batch = {key: value.to(device) for key, value in batch.items()}
            output = model(**batch)
            loss = output.loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.max_grad_norm)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
            running_loss += float(loss.item())
            if args.log_every and step % args.log_every == 0:
                print(f"fold={fold} epoch={epoch + 1}/{args.epochs} step={step}/{len(train_loader)} loss={running_loss / step:.4f}", flush=True)

    model.eval()
    predictions: list[int] = []
    gold: list[int] = []
    with torch.no_grad():
        for batch in test_loader:
            labels = batch.pop("labels")
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(**batch).logits.detach().cpu()
            predictions.extend(torch.argmax(logits, dim=-1).tolist())
            gold.extend(labels.tolist())

    accuracy = accuracy_score(gold, predictions)
    macro_f1 = f1_score(gold, predictions, average="macro")
    print(f"\n===== fold {fold} =====")
    print(f"Accuracy: {accuracy:.4f}  Macro-F1: {macro_f1:.4f}")
    print(classification_report(gold, predictions, target_names=LABELS, zero_division=0))

    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return FoldMetric(
        fold=fold,
        train_size=len(train_idx),
        test_size=len(test_idx),
        accuracy=float(accuracy),
        macro_f1=float(macro_f1),
        seconds=time.time() - start,
    )


def write_report(args, metrics: list[FoldMetric], label_counts: dict[str, int], device_name: str) -> None:
    accuracies = [metric.accuracy for metric in metrics]
    macro_f1s = [metric.macro_f1 for metric in metrics]
    payload = {
        "model_name": args.model_name,
        "folds": args.folds,
        "epochs": args.epochs,
        "max_length": args.max_length,
        "batch_size": args.batch_size,
        "device": device_name,
        "label_counts": label_counts,
        "metrics": [asdict(metric) for metric in metrics],
        "accuracy_mean": float(np.mean(accuracies)),
        "accuracy_std": float(np.std(accuracies, ddof=1)) if len(accuracies) > 1 else 0.0,
        "macro_f1_mean": float(np.mean(macro_f1s)),
        "macro_f1_std": float(np.std(macro_f1s, ddof=1)) if len(macro_f1s) > 1 else 0.0,
    }
    REPORT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Transformer cross-validation report",
        "",
        f"- Model: `{args.model_name}`",
        f"- Device: `{device_name}`",
        f"- Folds: {args.folds}",
        f"- Epochs per fold: {args.epochs}",
        f"- Max length: {args.max_length}",
        f"- Batch size: {args.batch_size}",
        "",
        "## Label counts",
        "",
        "| Label | Rows |",
        "|---|---:|",
    ]
    for label, count in label_counts.items():
        lines.append(f"| {label} | {count} |")
    lines.extend([
        "",
        "## Fold metrics",
        "",
        "| Fold | Train | Test | Accuracy | Macro-F1 | Seconds |",
        "|---:|---:|---:|---:|---:|---:|",
    ])
    for metric in metrics:
        lines.append(f"| {metric.fold} | {metric.train_size} | {metric.test_size} | {metric.accuracy:.4f} | {metric.macro_f1:.4f} | {metric.seconds:.1f} |")
    lines.extend([
        "",
        "## Summary",
        "",
        f"- Accuracy: {payload['accuracy_mean']:.4f} ± {payload['accuracy_std']:.4f}",
        f"- Macro-F1: {payload['macro_f1_mean']:.4f} ± {payload['macro_f1_std']:.4f}",
    ])
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-name", default="hfl/rbt3")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--eval-batch-size", type=int, default=32)
    parser.add_argument("--max-length", type=int, default=96)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--warmup-ratio", type=float, default=0.06)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-samples", type=int, default=0, help="Optional stratified subset for smoke tests.")
    parser.add_argument("--log-every", type=int, default=0)
    args = parser.parse_args()

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    set_seed(args.seed)
    texts, labels = load_rows()
    texts, labels = limit_rows(texts, labels, args.max_samples or None, args.seed)
    label_ids = [LABEL_TO_ID[label] for label in labels]
    label_counts = {label: labels.count(label) for label in LABELS}
    print(f"Rows: {len(labels)}  labels: {label_counts}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    print(f"Device: {device_name}")
    tokenizer = AutoTokenizer.from_pretrained(args.model_name)

    splitter = StratifiedKFold(n_splits=args.folds, shuffle=True, random_state=args.seed)
    metrics = []
    for fold, (train_idx, test_idx) in enumerate(splitter.split(texts, label_ids), start=1):
        metrics.append(train_one_fold(args, tokenizer, texts, label_ids, train_idx, test_idx, fold, device))

    write_report(args, metrics, label_counts, device_name)
    print(f"Saved report: {REPORT_MD}")
    print(f"Saved json: {REPORT_JSON}")


if __name__ == "__main__":
    main()
