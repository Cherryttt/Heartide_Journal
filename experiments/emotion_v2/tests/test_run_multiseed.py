from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load_runner():
    path = SCRIPTS / "run_multiseed.py"
    assert path.is_file(), "The multi-seed runner has not been implemented"
    spec = importlib.util.spec_from_file_location("run_multiseed_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def scores():
    return [
        {"seed": seed, "accuracy": accuracy, "macro_f1": f1, "support": 100}
        for seed, accuracy, f1 in [(42, .8, .70), (13, .81, .73), (2026, .82, .76)]
    ]


def reference_metrics():
    return {
        "seed": 42, "lr": 1e-5, "model_name": "hfl/chinese-macbert-base",
        "started_from_pretrained": True, "epochs_requested": 5,
        "max_length": 256, "batch_size": 16, "effective_batch_size": 32,
        "gradient_accumulation_steps": 2, "train_size": 33844,
        "validation_size": 3712, "test_access": "not_used",
        "best_epoch": 2, "best_validation_macro_f1": .72,
        "metrics": [{"epoch": 1, "validation_macro_f1": .70},
                    {"epoch": 2, "validation_macro_f1": .72},
                    {"epoch": 3, "validation_macro_f1": .71}],
    }


def test_summary_reports_mean_and_sample_std_not_best_seed():
    runner = load_runner()
    result = runner.summarize(scores())
    assert result["seeds"] == [42, 13, 2026]
    assert result["macro_f1_mean"] == pytest.approx(.73)
    assert result["macro_f1_sample_std"] == pytest.approx(.03)
    assert result["accuracy_mean"] == pytest.approx(.81)
    assert result["accuracy_sample_std"] == pytest.approx(.01)
    assert result["support_per_seed"] == 100


@pytest.mark.parametrize("rows", [scores()[:2], [scores()[0], scores()[0], scores()[2]]])
def test_missing_or_repeated_seed_is_not_reported_as_three_runs(rows):
    runner = load_runner()
    with pytest.raises(ValueError, match="42, 13, 2026"):
        runner.summarize(rows)


def test_mismatched_test_sample_count_is_rejected():
    runner = load_runner()
    rows = scores()
    rows[1]["support"] = 99
    with pytest.raises(ValueError, match="support"):
        runner.summarize(rows)


def test_reference_must_match_final_training_configuration():
    runner = load_runner()
    metrics = reference_metrics()
    runner.validate_metrics(metrics, 42)
    metrics["lr"] = 2e-5
    with pytest.raises(ValueError, match="lr"):
        runner.validate_metrics(metrics, 42)


def test_checkpoint_must_be_validation_best_not_last_epoch():
    runner = load_runner()
    metrics = reference_metrics()
    metrics["best_epoch"] = 3
    with pytest.raises(ValueError, match="best_epoch"):
        runner.validate_metrics(metrics, 42)


def test_training_command_keeps_final_config_and_starts_from_pretraining(tmp_path):
    runner = load_runner()
    command = runner.training_command(tmp_path, 13)
    assert command[command.index("--seed") + 1] == "13"
    assert command[command.index("--model-name") + 1] == "hfl/chinese-macbert-base"
    for name, expected in [("--lr", "1e-05"), ("--epochs", "5"),
                           ("--batch-size", "16"), ("--effective-batch-size", "32"),
                           ("--max-length", "256"), ("--patience", "2")]:
        assert command[command.index(name) + 1] == expected
    assert "best_checkpoint" not in " ".join(command)


def test_data_hashes_detect_a_changed_test_file(tmp_path):
    runner = load_runner()
    data = tmp_path / "data"
    data.mkdir()
    hashes = {}
    for name in ["train.csv", "validation.csv", "test.csv"]:
        path = data / name
        path.write_text("original " + name, encoding="utf-8")
        hashes[name] = runner.sha256(path)
    (data / "split_manifest.json").write_text(json.dumps({"output_hashes_sha256": hashes}), encoding="utf-8")
    assert runner.verify_data(tmp_path) == hashes
    (data / "test.csv").write_text("changed", encoding="utf-8")
    with pytest.raises(ValueError, match="test.csv"):
        runner.verify_data(tmp_path)
