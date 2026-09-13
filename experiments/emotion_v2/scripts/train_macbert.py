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
from typing import Any

import numpy as np
import torch
from sklearn.metrics import accuracy_score, classification_report, f1_score
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from prepare_data import LABEL_ORDER

LABEL_TO_ID = {label: index for index, label in enumerate(LABEL_ORDER)}
ID_TO_LABEL = {index: label for label, index in LABEL_TO_ID.items()}


@dataclass
class EpochMetric:
    epoch: int
    train_loss: float
    validation_accuracy: float
    validation_macro_f1: float
    seconds: float


class EmotionDataset(Dataset):
    def __init__(self, rows: list[dict[str, Any]], tokenizer, max_length: int):
        self.rows = rows
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        row = self.rows[index]
        encoded = self.tokenizer(
            row["text"],
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )
        item = {key: value.squeeze(0) for key, value in encoded.items()}
        item["labels"] = torch.tensor(row["label_id"], dtype=torch.long)
        return item


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def load_labeled_csv(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            label = row["label"]
            if label not in LABEL_TO_ID:
                raise ValueError(f"Invalid label in {path}: {label}")
            text = (row.get("normalized_text") or row.get("text") or "").strip()
            if not text:
                raise ValueError(f"Empty text in {path}: {row.get('sample_id')}")
            rows.append(
                {
                    "sample_id": row.get("sample_id", ""),
                    "label": label,
                    "label_id": LABEL_TO_ID[label],
                    "text": text,
                }
            )
    return rows


def load_train_validation(exp_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    data_dir = exp_dir / "data"
    return load_labeled_csv(data_dir / "train.csv"), load_labeled_csv(data_dir / "validation.csv")


def compute_gradient_accumulation(per_device_batch_size: int, effective_batch_size: int) -> int:
    if per_device_batch_size <= 0 or effective_batch_size <= 0:
        raise ValueError("Batch sizes must be positive")
    return max(1, math.ceil(effective_batch_size / per_device_batch_size))


def choose_max_length(token_lengths: list[int]) -> int:
    if not token_lengths:
        return 128
    ordered = sorted(token_lengths)
    index = min(len(ordered) - 1, math.ceil(0.99 * len(ordered)) - 1)
    p99 = ordered[index]
    if p99 <= 128:
        return 128
    if p99 <= 256:
        return 256
    return 512


def estimate_max_length(train_rows: list[dict[str, Any]], tokenizer, sample_size: int = 5000) -> tuple[int, dict[str, Any]]:
    rows = train_rows[:sample_size]
    lengths = [len(tokenizer(row["text"], add_special_tokens=True, truncation=False)["input_ids"]) for row in rows]
    max_length = choose_max_length(lengths)
    truncated_count = sum(1 for length in lengths if length > max_length)
    return max_length, {
        "sample_size": len(rows),
        "max_observed_length": max(lengths) if lengths else 0,
        "p99_bucket": max_length,
        "estimated_truncated_ratio": truncated_count / max(len(rows), 1),
    }


def make_optimizer(model, lr: float, weight_decay: float):
    no_decay = ("bias", "LayerNorm.weight")
    return torch.optim.AdamW(
        [
            {
                "params": [param for name, param in model.named_parameters() if not any(key in name for key in no_decay)],
                "weight_decay": weight_decay,
            },
            {
                "params": [param for name, param in model.named_parameters() if any(key in name for key in no_decay)],
                "weight_decay": 0.0,
            },
        ],
        lr=lr,
    )


def evaluate(model, loader, device) -> tuple[float, float, list[int], list[int], str]:
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
    macro_f1 = f1_score(gold, predictions, labels=list(range(len(LABEL_ORDER))), average="macro", zero_division=0)
    report = classification_report(gold, predictions, labels=list(range(len(LABEL_ORDER))), target_names=LABEL_ORDER, zero_division=0)
    return float(accuracy), float(macro_f1), gold, predictions, report


def save_checkpoint(model, tokenizer, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)


def train_one_run(args) -> dict[str, Any]:
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    set_seed(args.seed)

    exp_dir = Path(args.exp_dir)
    run_id = args.run_id or f"macbert_lr{args.lr:g}_seed{args.seed}"
    run_dir = exp_dir / "runs" / "macbert" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    train_rows, validation_rows = load_train_validation(exp_dir)
    tokenizer = AutoTokenizer.from_pretrained(args.model_name)
    max_length = args.max_length
    length_info: dict[str, Any] = {"mode": "fixed", "max_length": max_length}
    if max_length == 0:
        max_length, length_info = estimate_max_length(train_rows, tokenizer)
        length_info["mode"] = "auto_train_only"

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_name,
        num_labels=len(LABEL_ORDER),
        id2label=ID_TO_LABEL,
        label2id=LABEL_TO_ID,
    ).to(device)

    grad_accum = compute_gradient_accumulation(args.batch_size, args.effective_batch_size)
    train_loader = DataLoader(EmotionDataset(train_rows, tokenizer, max_length), batch_size=args.batch_size, shuffle=True, num_workers=0)
    validation_loader = DataLoader(EmotionDataset(validation_rows, tokenizer, max_length), batch_size=args.eval_batch_size, shuffle=False, num_workers=0)
    optimizer = make_optimizer(model, args.lr, args.weight_decay)
    updates_per_epoch = math.ceil(len(train_loader) / grad_accum)
    total_steps = max(1, updates_per_epoch * args.epochs)
    warmup_steps = int(total_steps * args.warmup_ratio)
    scheduler = get_linear_schedule_with_warmup(optimizer, warmup_steps, total_steps)

    best_macro_f1 = -1.0
    best_epoch = 0
    stale_epochs = 0
    metrics: list[EpochMetric] = []
    best_dir = run_dir / "best_checkpoint"
    start_all = time.time()

    for epoch in range(1, args.epochs + 1):
        start_epoch = time.time()
        model.train()
        running_loss = 0.0
        optimizer.zero_grad(set_to_none=True)
        for step, batch in enumerate(train_loader, start=1):
            batch = {key: value.to(device) for key, value in batch.items()}
            output = model(**batch)
            loss = output.loss / grad_accum
            loss.backward()
            running_loss += float(output.loss.item())
            if step % grad_accum == 0 or step == len(train_loader):
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.max_grad_norm)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)
            if args.log_every and step % args.log_every == 0:
                print(f"epoch={epoch}/{args.epochs} step={step}/{len(train_loader)} loss={running_loss / step:.4f}", flush=True)

        accuracy, macro_f1, _, _, report = evaluate(model, validation_loader, device)
        metric = EpochMetric(
            epoch=epoch,
            train_loss=running_loss / max(len(train_loader), 1),
            validation_accuracy=accuracy,
            validation_macro_f1=macro_f1,
            seconds=time.time() - start_epoch,
        )
        metrics.append(metric)
        (run_dir / f"validation_report_epoch_{epoch}.txt").write_text(report, encoding="utf-8")
        print(f"epoch={epoch} validation_accuracy={accuracy:.4f} validation_macro_f1={macro_f1:.4f}", flush=True)

        if macro_f1 > best_macro_f1:
            best_macro_f1 = macro_f1
            best_epoch = epoch
            stale_epochs = 0
            save_checkpoint(model, tokenizer, best_dir)
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                print(f"Early stopping after epoch {epoch}; best epoch {best_epoch}", flush=True)
                break

    payload = {
        "run_id": run_id,
        "model_name": args.model_name,
        "started_from_pretrained": True,
        "seed": args.seed,
        "lr": args.lr,
        "epochs_requested": args.epochs,
        "best_epoch": best_epoch,
        "best_validation_macro_f1": best_macro_f1,
        "device": device_name,
        "train_size": len(train_rows),
        "validation_size": len(validation_rows),
        "max_length": max_length,
        "length_info": length_info,
        "batch_size": args.batch_size,
        "effective_batch_size": args.effective_batch_size,
        "gradient_accumulation_steps": grad_accum,
        "metrics": [asdict(metric) for metric in metrics],
        "seconds": time.time() - start_all,
        "test_access": "not_used",
    }
    (run_dir / "metrics.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exp-dir", required=True)
    parser.add_argument("--model-name", default="hfl/chinese-macbert-base")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--effective-batch-size", type=int, default=32)
    parser.add_argument("--eval-batch-size", type=int, default=16)
    parser.add_argument("--max-length", type=int, default=0, help="0 means choose from train token lengths only.")
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--warmup-ratio", type=float, default=0.06)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--log-every", type=int, default=50)
    args = parser.parse_args()
    train_one_run(args)


if __name__ == "__main__":
    main()
