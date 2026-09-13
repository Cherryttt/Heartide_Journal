from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any

LABEL_ORDER = ["neutral", "happy", "sad", "angry", "fear", "surprise"]
LABEL_SET = set(LABEL_ORDER)
SPLIT_PRIORITY = {"train": 0, "validation": 1, "test": 2}
SPLIT_FILES = {
    "train": ["usual_train.txt", "virus_train.txt"],
    "validation": ["usual_eval_labeled.txt", "virus_eval_labeled.txt"],
    "test": ["usual_test_labeled.txt", "virus_test_labeled.txt"],
}
CSV_FIELDS = [
    "sample_id",
    "split",
    "domain",
    "source_file",
    "source_id",
    "label",
    "text",
    "normalized_text",
    "text_hash",
    "duplicate_group_id",
]
EXCLUDED_FIELDS = CSV_FIELDS + ["reason", "kept_sample_id", "conflict_label"]
HISTORICAL_EXPOSURE_NOTE = (
    "源 test 在项目历史实验中可能已有部分文本进入过训练或开发；"
    "本轮未参与训练和模型选择的保留测试集会从本实验开始冻结使用，"
    "但不能表述为全新独立测试集。"
)


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", str(text or "")).strip()
    text = re.sub(r"https?://\S+|www\.\S+", " <URL> ", text)
    text = re.sub(r"@\S+", " <USER> ", text)
    text = re.sub(r"#([^#]+)#", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def text_hash(text: str) -> str:
    compact = re.sub(r"\s+", "", normalize_text(text).lower())
    return hashlib.sha256(compact.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def domain_from_filename(filename: str) -> str:
    if filename.startswith("usual_"):
        return "usual"
    if filename.startswith("virus_"):
        return "virus"
    return "unknown"


def source_id_for(item: dict[str, Any], index: int) -> str:
    for key in ("id", "sid", "微博id", "weibo_id"):
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return str(index)


def read_source_file(path: Path, split: str, domain: str | None = None) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    domain = domain or domain_from_filename(path.name)
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict[str, str]] = []
    excluded: list[dict[str, str]] = []

    for index, item in enumerate(raw, start=1):
        source_id = source_id_for(item, index)
        sample_id = f"{path.name}:{source_id}"
        label = str(item.get("label", "")).strip()
        original_text = str(item.get("content", "") or "")
        normalized = normalize_text(original_text)
        base = {
            "sample_id": sample_id,
            "split": split,
            "domain": domain,
            "source_file": path.name,
            "source_id": source_id,
            "label": label,
            "text": original_text.strip(),
            "normalized_text": normalized,
            "text_hash": "",
            "duplicate_group_id": "",
        }
        if label not in LABEL_SET:
            excluded.append({**base, "reason": "invalid_label", "kept_sample_id": "", "conflict_label": ""})
            continue
        if not normalized:
            excluded.append({**base, "reason": "empty_text", "kept_sample_id": "", "conflict_label": ""})
            continue
        row = {**base, "text": original_text.strip(), "normalized_text": normalized, "text_hash": text_hash(normalized)}
        rows.append(row)
    return rows, excluded


def duplicate_sort_key(row: dict[str, str]) -> tuple[int, str, str]:
    return (-SPLIT_PRIORITY[row["split"]], row["source_file"], row["source_id"])


def output_sort_key(row: dict[str, str]) -> tuple[int, str, str]:
    return (SPLIT_PRIORITY[row["split"]], row["source_file"], row["source_id"])


def freeze_rows(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    by_hash: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        row = {**row, "text_hash": row.get("text_hash") or text_hash(row["normalized_text"])}
        by_hash[row["text_hash"]].append(row)

    frozen: list[dict[str, str]] = []
    excluded: list[dict[str, str]] = []
    duplicate_index = 0
    for _, group in sorted(by_hash.items(), key=lambda item: min(row["sample_id"] for row in item[1])):
        duplicate_index += 1
        group_id = f"dup_{duplicate_index:06d}"
        ranked = sorted(group, key=duplicate_sort_key)
        kept = {**ranked[0], "duplicate_group_id": group_id}
        frozen.append(kept)
        for duplicate in ranked[1:]:
            same_priority = SPLIT_PRIORITY[duplicate["split"]] == SPLIT_PRIORITY[kept["split"]]
            reason = "duplicate_same_priority" if same_priority else "duplicate_lower_priority"
            conflict_label = kept["label"] if duplicate["label"] != kept["label"] else ""
            excluded.append(
                {
                    **duplicate,
                    "duplicate_group_id": group_id,
                    "reason": reason,
                    "kept_sample_id": kept["sample_id"],
                    "conflict_label": conflict_label,
                }
            )
    return sorted(frozen, key=output_sort_key), sorted(excluded, key=lambda row: (row["reason"], row["sample_id"]))


def count_by(rows: list[dict[str, str]], key: str) -> dict[str, int]:
    return dict(sorted(Counter(row[key] for row in rows).items()))


def count_split_label(rows: list[dict[str, str]]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for split in SPLIT_PRIORITY:
        split_rows = [row for row in rows if row["split"] == split]
        result[split] = {label: sum(1 for row in split_rows if row["label"] == label) for label in LABEL_ORDER}
    return result


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_label_schema(exp_dir: Path) -> None:
    payload = {
        "task": "smp2020_original_six_class",
        "label_order": LABEL_ORDER,
        "labels": [
            {"id": 0, "name": "neutral", "zh": "无情绪"},
            {"id": 1, "name": "happy", "zh": "积极"},
            {"id": 2, "name": "sad", "zh": "悲伤"},
            {"id": 3, "name": "angry", "zh": "愤怒"},
            {"id": 4, "name": "fear", "zh": "恐惧"},
            {"id": 5, "name": "surprise", "zh": "惊奇"},
        ],
    }
    (exp_dir / "label_schema.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_outputs(
    exp_dir: Path,
    frozen_rows: list[dict[str, str]],
    excluded_rows: list[dict[str, str]],
    source_hashes: dict[str, str],
    source_counts: dict[str, int],
) -> None:
    data_dir = exp_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for split in SPLIT_PRIORITY:
        write_csv(data_dir / f"{split}.csv", [row for row in frozen_rows if row["split"] == split], CSV_FIELDS)
    write_csv(data_dir / "excluded_rows.csv", excluded_rows, EXCLUDED_FIELDS)
    write_label_schema(exp_dir)

    csv_hashes = {path.name: file_sha256(path) for path in sorted(data_dir.glob("*.csv"))}
    manifest = {
        "experiment": "emotion_v2",
        "created_date": date.today().isoformat(),
        "task": "SMP2020-EWECT original six-class emotion classification",
        "label_order": LABEL_ORDER,
        "split_priority_for_duplicates": "test > validation > train",
        "cleaning_rules": [
            "Unicode NFKC normalization",
            "URL masking to <URL>",
            "mention masking to <USER>",
            "whitespace normalization",
            "reject empty text and labels outside the original six classes only",
        ],
        "historical_exposure_note": HISTORICAL_EXPOSURE_NOTE,
        "source_hashes_sha256": source_hashes,
        "source_raw_counts": source_counts,
        "frozen_counts_by_split": count_by(frozen_rows, "split"),
        "frozen_counts_by_label": count_by(frozen_rows, "label"),
        "frozen_counts_by_split_label": count_split_label(frozen_rows),
        "frozen_counts_by_domain": count_by(frozen_rows, "domain"),
        "excluded_counts_by_reason": count_by(excluded_rows, "reason"),
        "output_hashes_sha256": csv_hashes,
    }
    (data_dir / "split_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_audit(exp_dir / "data_audit.md", manifest)


def write_audit(path: Path, manifest: dict[str, Any]) -> None:
    lines = [
        "# Heartide Emotion V2 Data Audit",
        "",
        f"- Created: {manifest['created_date']}",
        "- Route: original six-class SMP2020 labels.",
        "- Source test policy: frozen for final evaluation only in this experiment.",
        f"- Historical exposure note: {manifest['historical_exposure_note']}",
        "",
        "## Frozen Counts By Split",
        "",
        "| Split | Rows |",
        "|---|---:|",
    ]
    for split, count in manifest["frozen_counts_by_split"].items():
        lines.append(f"| {split} | {count} |")
    lines.extend(["", "## Frozen Counts By Label", "", "| Label | Rows |", "|---|---:|"])
    for label in LABEL_ORDER:
        lines.append(f"| {label} | {manifest['frozen_counts_by_label'].get(label, 0)} |")
    lines.extend(["", "## Excluded Rows", "", "| Reason | Rows |", "|---|---:|"])
    for reason, count in manifest["excluded_counts_by_reason"].items():
        lines.append(f"| {reason} | {count} |")
    lines.extend(["", "## Source Hashes", "", "| File | SHA-256 |", "|---|---|"])
    for filename, digest in manifest["source_hashes_sha256"].items():
        lines.append(f"| `{filename}` | `{digest}` |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def prepare(source_dir: Path, exp_dir: Path) -> None:
    all_rows: list[dict[str, str]] = []
    all_excluded: list[dict[str, str]] = []
    source_hashes: dict[str, str] = {}
    source_counts: dict[str, int] = {}
    for split, filenames in SPLIT_FILES.items():
        for filename in filenames:
            path = source_dir / filename
            if not path.exists():
                raise FileNotFoundError(path)
            source_hashes[filename] = file_sha256(path)
            raw_count = len(json.loads(path.read_text(encoding="utf-8")))
            source_counts[filename] = raw_count
            rows, excluded = read_source_file(path, split=split, domain=domain_from_filename(filename))
            all_rows.extend(rows)
            all_excluded.extend(excluded)
    frozen_rows, duplicate_excluded = freeze_rows(all_rows)
    all_excluded.extend(duplicate_excluded)
    write_outputs(exp_dir=exp_dir, frozen_rows=frozen_rows, excluded_rows=all_excluded, source_hashes=source_hashes, source_counts=source_counts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source_dir, args.out_dir)


if __name__ == "__main__":
    main()
