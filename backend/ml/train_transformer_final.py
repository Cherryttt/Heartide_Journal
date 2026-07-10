"""Train and export a deployable MacBERT emotion checkpoint.

Example:
    python ml/train_transformer_final.py --model-name hfl/chinese-macbert-base --epochs 1 --max-samples 10000 --batch-size 8 --eval-batch-size 16 --max-length 128

The exported directory can be enabled with:
    EMOTION_TRANSFORMER_ENABLED=true
    EMOTION_TRANSFORMER_MODEL_PATH=./ml/macbert_emotion
"""
from __future__ import annotations

import argparse
import json
import os
import random
import time
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import accuracy_score, classification_report, f1_score
from torch.utils.data import DataLoader
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from transformer_cv import EmotionDataset, ID_TO_LABEL, LABELS, LABEL_TO_ID, limit_rows, load_rows, make_optimizer, set_seed


HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "macbert_emotion"
REPORT_PATH = HERE.parent / "data" / "TRANSFORMER_FINAL_REPORT.md"
METRICS_PATH = HERE.parent / "data" / "transformer_final_metrics.json"


def evaluate(model, loader, device) -> tuple[float, float, str]:
    model.eval()
    predictions: list[int] = []
    gold: list[int] = []
    with torch.no_grad():
        for batch in loader:
            labels = batch.pop("labels")
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(**batch).logits.detach().cpu()
            predictions.extend(torch.argmax(logits, dim=-1).tolist())
            gold.extend(labels.tolist())
    accuracy = accuracy_score(gold, predictions)
    macro_f1 = f1_score(gold, predictions, average="macro")
    report = classification_report(gold, predictions, target_names=LABELS, zero_division=0)
    return float(accuracy), float(macro_f1), report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-name", default="hfl/chinese-macbert-base")
    parser.add_argument("--output-dir", default=str(OUT_DIR))
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--eval-batch-size", type=int, default=16)
    parser.add_argument("--max-length", type=int, default=128)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--warmup-ratio", type=float, default=0.06)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-samples", type=int, default=0, help="Optional stratified train subset for faster export.")
    parser.add_argument("--eval-samples", type=int, default=1000, help="Stratified validation size from the selected rows.")
    parser.add_argument("--log-every", type=int, default=50)
    args = parser.parse_args()

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    set_seed(args.seed)

    texts, labels = load_rows()
    texts, labels = limit_rows(texts, labels, args.max_samples or None, args.seed)
    combined = list(zip(texts, labels))
    rng = random.Random(args.seed)
    rng.shuffle(combined)
    texts = [text for text, _ in combined]
    labels = [label for _, label in combined]

    by_label: dict[str, list[int]] = {label: [] for label in LABELS}
    for index, label in enumerate(labels):
        by_label[label].append(index)
    per_label_eval = max(1, args.eval_samples // len(LABELS)) if args.eval_samples else 0
    eval_indices: set[int] = set()
    for label, indices in by_label.items():
        eval_indices.update(indices[: min(per_label_eval, len(indices) // 3 if len(indices) > 2 else 1)])
    train_indices = [index for index in range(len(labels)) if index not in eval_indices]
    eval_indices = sorted(eval_indices)

    train_texts = [texts[index] for index in train_indices]
    train_labels = [LABEL_TO_ID[labels[index]] for index in train_indices]
    eval_texts = [texts[index] for index in eval_indices]
    eval_labels = [LABEL_TO_ID[labels[index]] for index in eval_indices]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(args.model_name)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_name,
        num_labels=len(LABELS),
        id2label=ID_TO_LABEL,
        label2id=LABEL_TO_ID,
    ).to(device)

    train_loader = DataLoader(EmotionDataset(train_texts, train_labels, tokenizer, args.max_length), batch_size=args.batch_size, shuffle=True, num_workers=0)
    eval_loader = DataLoader(EmotionDataset(eval_texts, eval_labels, tokenizer, args.max_length), batch_size=args.eval_batch_size, shuffle=False, num_workers=0)
    optimizer = make_optimizer(model, args.lr, args.weight_decay)
    total_steps = max(1, len(train_loader) * args.epochs)
    warmup_steps = int(total_steps * args.warmup_ratio)
    scheduler = get_linear_schedule_with_warmup(optimizer, warmup_steps, total_steps)

    start = time.time()
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
                print(f"epoch={epoch + 1}/{args.epochs} step={step}/{len(train_loader)} loss={running_loss / step:.4f}", flush=True)

    accuracy, macro_f1, class_report = evaluate(model, eval_loader, device)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    payload = {
        "model_name": args.model_name,
        "output_dir": str(output_dir),
        "device": device_name,
        "epochs": args.epochs,
        "max_samples": args.max_samples or None,
        "train_size": len(train_labels),
        "eval_size": len(eval_labels),
        "max_length": args.max_length,
        "batch_size": args.batch_size,
        "accuracy": accuracy,
        "macro_f1": macro_f1,
        "seconds": time.time() - start,
        "labels": LABELS,
    }
    METRICS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT_PATH.write_text(
        "\n".join([
            "# Transformer final export report",
            "",
            f"- Model: `{args.model_name}`",
            f"- Output: `{output_dir}`",
            f"- Device: `{device_name}`",
            f"- Train size: {len(train_labels)}",
            f"- Eval size: {len(eval_labels)}",
            f"- Accuracy: {accuracy:.4f}",
            f"- Macro-F1: {macro_f1:.4f}",
            "",
            "## Classification report",
            "",
            "```text",
            class_report,
            "```",
        ]) + "\n",
        encoding="utf-8",
    )
    print(f"Saved checkpoint: {output_dir}")
    print(f"Saved report: {REPORT_PATH}")
    print(f"Saved metrics: {METRICS_PATH}")


if __name__ == "__main__":
    main()
