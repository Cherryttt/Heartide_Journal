"""Train seeds 13/2026, reuse seed 42, then evaluate and summarize all three.

Run in the original GPU environment. --check-only performs no training/inference.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import statistics
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SEEDS = (42, 13, 2026)
CONFIG = {
    "model_name": "hfl/chinese-macbert-base",
    "lr": 1e-5,
    "epochs": 5,
    "batch_size": 16,
    "effective_batch_size": 32,
    "eval_batch_size": 16,
    "max_length": 256,
    "weight_decay": 0.01,
    "warmup_ratio": 0.06,
    "max_grad_norm": 1.0,
    "patience": 2,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verify_data(exp_dir: Path) -> dict[str, str]:
    manifest_path = exp_dir / "data" / "split_manifest.json"
    if not manifest_path.is_file():
        manifest_path = SCRIPTS.parent / "protocol" / "split_manifest.json"
    expected = read_json(manifest_path)["output_hashes_sha256"]
    actual = {}
    for name in ("train.csv", "validation.csv", "test.csv"):
        actual[name] = sha256(exp_dir / "data" / name)
        if actual[name] != expected[name]:
            raise ValueError(f"Frozen data hash mismatch: {name}. Restore the frozen file.")
    return actual


def validate_metrics(metrics: dict, seed: int) -> None:
    expected = {
        "seed": seed, "model_name": CONFIG["model_name"], "lr": CONFIG["lr"],
        "started_from_pretrained": True, "epochs_requested": CONFIG["epochs"],
        "max_length": CONFIG["max_length"], "batch_size": CONFIG["batch_size"],
        "effective_batch_size": CONFIG["effective_batch_size"],
        "gradient_accumulation_steps": 2, "train_size": 33844,
        "validation_size": 3712, "test_access": "not_used",
    }
    for key, value in expected.items():
        if metrics.get(key) != value:
            raise ValueError(f"seed={seed}: {key}={metrics.get(key)!r}; expected {value!r}")
    history = metrics.get("metrics", [])
    if not history or not all(math.isfinite(float(row["validation_macro_f1"])) for row in history):
        raise ValueError(f"seed={seed}: missing or invalid validation history")
    best = max(history, key=lambda row: float(row["validation_macro_f1"]))
    if metrics.get("best_epoch") != best["epoch"]:
        raise ValueError(f"seed={seed}: best_epoch does not match validation-best checkpoint")
    if not math.isclose(float(metrics["best_validation_macro_f1"]), float(best["validation_macro_f1"]), abs_tol=1e-10):
        raise ValueError(f"seed={seed}: best_validation_macro_f1 is inconsistent")


def validate_checkpoint(run_dir: Path, seed: int) -> dict:
    metrics = read_json(run_dir / "metrics.json")
    validate_metrics(metrics, seed)
    checkpoint = run_dir / "best_checkpoint"
    config = read_json(checkpoint / "config.json")
    from prepare_data import LABEL_ORDER
    actual_labels = {int(k): v for k, v in config["id2label"].items()}
    if actual_labels != dict(enumerate(LABEL_ORDER)):
        raise ValueError(f"seed={seed}: checkpoint label mapping differs from the frozen task")
    if not list(checkpoint.glob("*.safetensors")) and not list(checkpoint.glob("pytorch_model*.bin")):
        raise FileNotFoundError(f"Missing model weights: {checkpoint}")
    return metrics


def training_command(exp_dir: Path, seed: int) -> list[str]:
    command = [sys.executable, "-u", str(SCRIPTS / "train_macbert.py"),
               "--exp-dir", str(exp_dir), "--run-id", f"macbert_lr1e-5_seed{seed}_multiseed",
               "--seed", str(seed)]
    for key, value in CONFIG.items():
        command.extend(["--" + key.replace("_", "-"), str(value)])
    return command


def summarize(rows: list[dict]) -> dict:
    if len(rows) != 3 or {int(row["seed"]) for row in rows} != set(SEEDS):
        raise ValueError("Require exactly one result for each of seeds 42, 13, 2026")
    support = {int(row["support"]) for row in rows}
    if len(support) != 1 or next(iter(support)) <= 0:
        raise ValueError("Test support must be positive and identical across all seeds")
    result = {"seeds": list(SEEDS), "n_seeds": 3, "support_per_seed": next(iter(support)),
              "std_ddof": 1, "note": "Mean of individual-run metrics; no seed selection or ensembling. SD is not a confidence interval."}
    for name in ("accuracy", "macro_f1"):
        values = [float(row[name]) for row in rows]
        if not all(math.isfinite(value) and 0 <= value <= 1 for value in values):
            raise ValueError(f"Invalid {name} score")
        result[name + "_mean"] = statistics.mean(values)
        result[name + "_sample_std"] = statistics.stdev(values)
    return result


def freeze_protocol(output: Path, protocol: dict) -> None:
    path = output / "protocol.json"
    if path.exists() and read_json(path) != protocol:
        raise ValueError(f"Protocol differs from {path}. Do not mix runs from different configurations.")
    if not path.exists():
        write_json(path, protocol)


def train_missing(exp_dir: Path, run_dirs: dict[int, Path], protocol: dict) -> None:
    for seed in SEEDS[1:]:
        run_dir = run_dirs[seed]
        config_path = run_dir / "multiseed_config.json"
        run_config = {"seed": seed, "training_config": CONFIG,
                      "data_sha256": protocol["data_sha256"],
                      "script_sha256": protocol["script_sha256"]}
        if (run_dir / "metrics.json").is_file():
            if not config_path.exists() or read_json(config_path) != run_config:
                raise ValueError(f"Existing run has a different/missing config: {run_dir}")
            validate_checkpoint(run_dir, seed)
            print(f"Reuse completed seed {seed}: {run_dir}", flush=True)
            continue
        if run_dir.exists():
            raise FileExistsError(f"Incomplete run exists: {run_dir}. Preserve/rename it before restarting; no checkpoint will be overwritten.")
        write_json(config_path, run_config)
        command = training_command(exp_dir, seed)
        print(f"\nTraining seed {seed}; log: {run_dir / 'console.log'}", flush=True)
        with (run_dir / "console.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, encoding="utf-8", errors="replace")
            assert process.stdout is not None
            for line in process.stdout:
                print(line, end="", flush=True)
                log.write(line)
                log.flush()
            code = process.wait()
        if code:
            raise RuntimeError(f"Seed {seed} failed with exit code {code}; see {run_dir / 'console.log'}")
        validate_checkpoint(run_dir, seed)


def evaluate_all(exp_dir: Path, run_dirs: dict[int, Path], output: Path, batch_size: int, device: str) -> None:
    # Validate ALL checkpoints before opening test text or producing any result.
    runs = {seed: validate_checkpoint(path, seed) for seed, path in run_dirs.items()}
    from evaluate_final import (domain_metrics, evaluate_predictions, load_csv,
                                predict_macbert, write_confusion_outputs, write_csv)
    from prepare_data import LABEL_ORDER
    import torch

    test = load_csv(exp_dir / "data" / "test.csv")
    if len(test) != 7719 or len({row["sample_id"] for row in test}) != len(test):
        raise ValueError("Expected 7,719 uniquely identified frozen test samples")
    gold = [row["label"] for row in test]
    texts = [row.get("normalized_text") or row["text"] for row in test]
    results, per_class, domains = [], [], []
    for seed in SEEDS:
        run_dir = run_dirs[seed]
        model_id = runs[seed]["run_id"]
        print(f"Evaluating seed {seed}, validation-best epoch {runs[seed]['best_epoch']}...", flush=True)
        predictions, scores, used_device = predict_macbert(
            run_dir / "best_checkpoint", texts, batch_size, device, CONFIG["max_length"])
        if len(predictions) != len(test) or not set(predictions).issubset(LABEL_ORDER):
            raise ValueError(f"seed={seed}: invalid test predictions")
        metrics = evaluate_predictions(model_id, gold, predictions)
        result = {"seed": seed, "model_id": model_id, "best_epoch": runs[seed]["best_epoch"],
                  "validation_macro_f1": runs[seed]["best_validation_macro_f1"],
                  "accuracy": metrics["accuracy"], "macro_f1": metrics["macro_f1"],
                  "support": metrics["support"], "evaluation_device": used_device}
        results.append(result)
        for label, values in metrics["per_class"].items():
            per_class.append({"seed": seed, "model_id": model_id, "label": label,
                              "precision": values["precision"], "recall": values["recall"],
                              "f1": values["f1-score"], "support": int(values["support"])})
        domains.extend({"seed": seed, **row} for row in domain_metrics(test, predictions, model_id))
        prediction_rows = [{"seed": seed, "sample_id": row["sample_id"], "true_label": gold[i],
                            "predicted_label": predictions[i], "domain": row.get("domain", ""),
                            "scores_json": scores[i]} for i, row in enumerate(test)]
        write_csv(output / "predictions" / f"seed_{seed}_test_predictions.csv", prediction_rows,
                  ["seed", "sample_id", "true_label", "predicted_label", "domain", "scores_json"])
        write_confusion_outputs(output, f"seed_{seed}", gold, predictions)
        write_json(output / f"seed_{seed}_metrics.json", result)
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    summary = summarize(results)
    write_csv(output / "test_results.csv", results, list(results[0]))
    write_csv(output / "per_class_metrics.csv", per_class, list(per_class[0]))
    write_csv(output / "domain_results.csv", domains, list(domains[0]))
    write_json(output / "summary.json", summary)
    lines = ["# MacBERT multi-seed evaluation", "",
             "Seeds: 42, 13, 2026. Learning rate: 1e-5. Test samples per seed: 7,719.",
             "Each checkpoint is selected by its own validation Macro-F1. All seeds are reported.", "",
             "| Seed | Best epoch | Validation Macro-F1 | Test Accuracy | Test Macro-F1 |",
             "| --- | ---: | ---: | ---: | ---: |"]
    for row in results:
        lines.append(f"| {row['seed']} | {row['best_epoch']} | {row['validation_macro_f1']:.6f} | {row['accuracy']:.6f} | {row['macro_f1']:.6f} |")
    lines.extend(["", f"Test Macro-F1 = {summary['macro_f1_mean']:.4f} +/- {summary['macro_f1_sample_std']:.4f}",
                  f"Test Accuracy = {summary['accuracy_mean']:.4f} +/- {summary['accuracy_sample_std']:.4f}", "",
                  "The +/- term is sample SD across three seeds (ddof=1), not a confidence interval.",
                  "The split has historical exposure; it is not claimed as historically untouched.",
                  "Seed 42 previously informed learning-rate selection. These repeats assess the selected configuration.",
                  "Seed 42 is reevaluated on the same device as the two new seeds; minor device-related differences from prior CPU scores are possible."])
    (output / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nMacro-F1: {summary['macro_f1_mean']:.4f} +/- {summary['macro_f1_sample_std']:.4f}", flush=True)
    print(f"Saved: {output / 'REPORT.md'}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exp-dir", type=Path, required=True)
    parser.add_argument("--seed42-run", type=Path, help="Existing seed-42 run; defaults to EXP/runs/macbert/macbert_lr1e-5_seed42_4090")
    parser.add_argument("--stage", choices=("train", "evaluate", "all"), default="all")
    parser.add_argument("--eval-device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--eval-batch-size", type=int, default=32)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    exp_dir = args.exp_dir.resolve()
    reference = (args.seed42_run or exp_dir / "runs/macbert/macbert_lr1e-5_seed42_4090").resolve()
    run_dirs = {42: reference, **{seed: exp_dir / "runs/macbert" / f"macbert_lr1e-5_seed{seed}_multiseed" for seed in SEEDS[1:]}}
    data_hashes = verify_data(exp_dir)
    reference_metrics = validate_checkpoint(reference, 42)
    if args.eval_batch_size <= 0:
        raise ValueError("Evaluation batch size must be positive")
    print(f"Frozen data hashes verified. Reuse seed 42: {reference}", flush=True)
    if args.check_only:
        for seed in SEEDS[1:]:
            print("Command argv:", json.dumps(training_command(exp_dir, seed)))
        print("Read-only checks passed. No training or test inference was started.")
        return
    import torch
    if (args.stage in ("train", "all") or args.eval_device == "cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Activate the original 4090 Python environment; CPU training fallback is disabled.")
    output = exp_dir / "results/multiseed_42_13_2026"
    script_hashes = {name: sha256(SCRIPTS / name) for name in
                     ("run_multiseed.py", "train_macbert.py", "prepare_data.py", "evaluate_final.py", "train_classical.py")}
    protocol = {"seeds": list(SEEDS), "config": CONFIG, "data_sha256": data_hashes,
                "script_sha256": script_hashes, "reference_metrics_sha256": sha256(reference / "metrics.json"),
                "reference_run_id": reference_metrics["run_id"],
                "evaluation_device": args.eval_device, "evaluation_batch_size": args.eval_batch_size,
                "selection": "validation-best per seed; no seed selection on test",
                "legacy_note": "Seed42 metrics omit weight decay, warmup and patience; repeats explicitly use existing trainer defaults."}
    freeze_protocol(output, protocol)
    write_json(output / "environment.json", {"python": sys.version, "platform": platform.platform(),
               "torch": torch.__version__, "cuda": torch.version.cuda,
               "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None})
    if args.stage in ("train", "all"):
        train_missing(exp_dir, run_dirs, protocol)
    if args.stage in ("evaluate", "all"):
        for seed in SEEDS[1:]:
            saved = read_json(run_dirs[seed] / "multiseed_config.json")
            if saved != {"seed": seed, "training_config": CONFIG,
                         "data_sha256": data_hashes, "script_sha256": script_hashes}:
                raise ValueError(f"Seed {seed} does not match this frozen protocol")
        evaluate_all(exp_dir, run_dirs, output, args.eval_batch_size, args.eval_device)


if __name__ == "__main__":
    main()
