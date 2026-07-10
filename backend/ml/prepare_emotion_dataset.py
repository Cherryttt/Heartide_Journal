"""Prepare a cleaned and expanded emotion dataset for MoodGarden.

Outputs:
- backend/data/emotion_train.csv
- backend/data/emotion_test.csv
- backend/data/DATASET_REPORT.md
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

from sklearn.model_selection import train_test_split


HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "data"
SOURCE_DIR = DATA_DIR / "smp2020" / "clean"
TRAIN_CSV = DATA_DIR / "emotion_train.csv"
TEST_CSV = DATA_DIR / "emotion_test.csv"
REPORT_MD = DATA_DIR / "DATASET_REPORT.md"
GENERATED_CSV = HERE / "generated_data.csv"

BASE_URL = "https://raw.githubusercontent.com/BrownSweater/BERT_SMP2020-EWECT/main/data/clean"
USUAL_FILES = ["usual_train.txt", "usual_eval_labeled.txt", "usual_test_labeled.txt"]
VIRUS_FILES = ["virus_train.txt", "virus_eval_labeled.txt", "virus_test_labeled.txt"]

LABEL_MAP = {
    "happy": "开心",
    "surprise": "开心",
    "neutral": "平静",
    "sad": "忧郁",
    "fear": "焦虑",
    "angry": "焦虑",
}

EMOTION_CUES = {
    "开心": ["开心", "快乐", "高兴", "幸福", "美滋滋", "好棒", "太好了", "喜欢", "惊喜", "期待", "笑"],
    "平静": ["平静", "安静", "放松", "舒服", "自在", "慢慢", "治愈", "温柔", "安心", "宁静"],
    "忧郁": ["难过", "伤心", "低落", "孤独", "委屈", "失落", "哭", "悲伤", "空落", "心酸"],
    "焦虑": ["焦虑", "紧张", "害怕", "担心", "压力", "慌", "烦", "气死", "崩溃", "喘不过气"],
    "疲惫": ["累", "疲惫", "困", "没力气", "耗尽", "撑不住", "想睡", "躺着", "倦", "乏"],
}
ALL_CUES = [cue for cues in EMOTION_CUES.values() for cue in cues]
SUBJECTIVE_CUES = [
    "我", "俺", "自己", "今天", "昨天", "今晚", "最近", "终于", "真的", "感觉", "觉得", "心里",
    "想", "希望", "讨厌", "喜欢", "不想", "只想", "好像", "有点", "太", "啊", "呀", "吧",
]
OBJECTIVE_CUES = [
    "据", "报道", "显示", "事实", "证实", "期间", "组织", "国家", "使用", "公司", "相关",
    "主要", "系统", "技术", "数据", "研究", "会议", "部门", "进行", "发展", "建设",
]


def download_sources(include_virus: bool) -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    for filename in USUAL_FILES + (VIRUS_FILES if include_virus else []):
        target = SOURCE_DIR / filename
        if target.exists():
            continue
        url = f"{BASE_URL}/{filename}"
        print(f"Downloading {url}")
        urllib.request.urlretrieve(url, target)


def normalize_text(text: str) -> str:
    text = str(text or "").strip()
    text = re.sub(r"https?://\S+|www\.\S+", " ", text)
    text = re.sub(r"@\S+", " ", text)
    text = re.sub(r"#([^#]+)#", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fingerprint(text: str) -> str:
    normalized = re.sub(r"[\s，。！？!?,.;；：:\"'“”‘’、~…（）()【】\[\]<>《》]", "", text.lower())
    return hashlib.md5(normalized.encode("utf-8")).hexdigest()


def has_chinese(text: str, minimum: int = 2) -> bool:
    return len(re.findall(r"[\u4e00-\u9fff]", text)) >= minimum


def has_expressive_signal(text: str, label: str) -> bool:
    return (
        any(cue in text for cue in ALL_CUES)
        or any(cue in text for cue in SUBJECTIVE_CUES)
        or bool(re.search(r"[!?！？~～…]{1,}|[哈哈呜呜嘻嘿哇]{2,}", text))
        or any(cue in text for cue in EMOTION_CUES.get(label, []))
    )


def should_keep(text: str, label: str) -> tuple[bool, str]:
    if not has_chinese(text):
        return False, "too_little_chinese"
    if len(text) < 4:
        return False, "too_short"
    if len(text) > 160:
        return False, "too_long"
    ascii_ratio = sum(1 for char in text if ord(char) < 128) / max(len(text), 1)
    if ascii_ratio > 0.65 and not any(cue in text for cue in ALL_CUES):
        return False, "too_much_ascii"
    if not has_expressive_signal(text, label):
        return False, "no_emotion_signal"
    if (
        label == "平静"
        and len(text) > 18
        and not any(cue in text for cue in SUBJECTIVE_CUES + EMOTION_CUES["平静"])
        and sum(1 for cue in OBJECTIVE_CUES if cue in text) >= 2
    ):
        return False, "objective_neutral_noise"
    return True, "kept"


def read_smp_file(path: Path, source_name: str) -> list[dict[str, str]]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    output = []
    for item in rows:
        label = LABEL_MAP.get(item.get("label"))
        text = normalize_text(item.get("content", ""))
        if label and text:
            output.append({"text": text, "label": label, "source": source_name})
    return output


def load_public_rows(include_virus: bool) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for filename in USUAL_FILES:
        rows.extend(read_smp_file(SOURCE_DIR / filename, f"smp2020_usual/{filename}"))
    if include_virus:
        for filename in VIRUS_FILES:
            rows.extend(read_smp_file(SOURCE_DIR / filename, f"smp2020_virus/{filename}"))
    return rows


def load_existing_fatigue() -> list[str]:
    if not GENERATED_CSV.exists():
        return []
    rows = []
    with GENERATED_CSV.open("r", encoding="utf-8", newline="") as file:
        for row in csv.reader(file):
            if len(row) >= 2 and row[1].strip() == "疲惫":
                rows.append(normalize_text(row[0]))
    return [text for text in rows if text]


def generate_fatigue_samples(total: int, seed: int) -> list[dict[str, str]]:
    rng = random.Random(seed)
    contexts = [
        "上完一整天课", "连续改了好几版方案", "通宵赶完作业", "开了一下午会", "跑完实验数据",
        "挤完晚高峰地铁", "整理完一堆资料", "连续几天睡不好", "做完小组汇报", "复习到深夜",
        "处理完琐碎消息", "忙完整个周末", "赶完ddl", "训练结束后", "搬完宿舍东西",
        "跟进完项目需求", "写完报告", "盯了一天电脑", "做完问卷清洗", "背完一大段材料",
    ]
    body_states = [
        "脑袋像糊住了一样", "眼皮一直往下掉", "肩膀酸得抬不起来", "整个人像被抽空",
        "一点力气都没有", "只想把手机关掉", "连说话都嫌累", "反应慢了半拍",
        "心里空空的", "手脚都软下来", "困得快睁不开眼", "胃口也没什么",
        "整个人轻飘飘的", "像电量只剩百分之一", "连开心都懒得开心",
    ]
    wishes = [
        "现在只想躺着不动", "想直接睡到明天", "希望今晚谁也别找我", "想安静地发一会儿呆",
        "只想洗个热水澡就睡", "感觉需要一整天恢复", "想把所有计划都暂停一下",
        "只想钻进被窝", "不想再处理任何消息", "想给自己放个空白假",
    ]
    tones = ["真的", "有点", "已经", "突然", "好像", "整个人", "今天", "这几天", "刚刚", "现在"]
    endings = ["。", "……", "，先缓一缓。", "，明天再说吧。", "，感觉快没电了。", "，只想静音。"]
    templates = [
        "{context}之后，{tone}{state}，{wish}{ending}",
        "{tone}{state}，{context}以后{wish}{ending}",
        "{context}，{state}，{wish}{ending}",
        "{tone}撑到现在，{state}，{wish}{ending}",
        "{context}后才发现自己{state}，{wish}{ending}",
    ]

    samples = set(load_existing_fatigue())
    attempts = 0
    while len(samples) < total and attempts < total * 20:
        attempts += 1
        text = rng.choice(templates).format(
            context=rng.choice(contexts),
            tone=rng.choice(tones),
            state=rng.choice(body_states),
            wish=rng.choice(wishes),
            ending=rng.choice(endings),
        )
        samples.add(normalize_text(text))
    return [{"text": text, "label": "疲惫", "source": "fatigue_template_aug"} for text in sorted(samples)[:total]]


def clean_and_dedupe(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], Counter]:
    seen = set()
    kept = []
    removed: Counter = Counter()
    for row in rows:
        text = normalize_text(row["text"])
        label = row["label"]
        keep, reason = should_keep(text, label)
        if not keep:
            removed[reason] += 1
            continue
        key = fingerprint(text)
        if key in seen:
            removed["duplicate"] += 1
            continue
        seen.add(key)
        kept.append({"text": text, "label": label, "source": row["source"]})
    return kept, removed


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["text", "label", "source"])
        writer.writeheader()
        writer.writerows(rows)


def write_report(
    before_counts: Counter,
    clean_counts: Counter,
    train_counts: Counter,
    test_counts: Counter,
    removed: Counter,
    include_virus: bool,
    fatigue_total: int,
) -> None:
    lines = [
        "# Emotion dataset report",
        "",
        "- Preparation date: 2026-06-23",
        "- Public source: SMP2020-EWECT usual-domain train/eval/test splits",
        f"- Additional virus-domain splits included: {'yes' if include_virus else 'no'}",
        f"- Fatigue augmentation target: {fatigue_total}",
        "- Cleaning: URL/mention normalization, duplicate removal, length/language filters, expressive-signal filtering, objective-neutral noise filtering",
        "",
        "## Counts before cleaning",
        "",
        "| Label | Rows |",
        "|---|---:|",
    ]
    for label, count in sorted(before_counts.items()):
        lines.append(f"| {label} | {count} |")
    lines.extend(["", "## Removed rows", "", "| Reason | Rows |", "|---|---:|"])
    for reason, count in removed.most_common():
        lines.append(f"| {reason} | {count} |")
    lines.extend(["", "## Counts after cleaning", "", "| Label | Clean total | Train | Test |", "|---|---:|---:|---:|"])
    for label in sorted(clean_counts):
        lines.append(f"| {label} | {clean_counts[label]} | {train_counts[label]} | {test_counts[label]} |")
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-virus", action="store_true", help="Include SMP2020 virus-domain train/eval/test splits.")
    parser.add_argument("--fatigue-total", type=int, default=2500, help="Target number of fatigue samples after augmentation.")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    download_sources(include_virus=args.include_virus)
    public_rows = load_public_rows(include_virus=args.include_virus)
    fatigue_rows = generate_fatigue_samples(total=args.fatigue_total, seed=args.seed)
    all_rows = public_rows + fatigue_rows
    before_counts = Counter(row["label"] for row in all_rows)
    clean_rows, removed = clean_and_dedupe(all_rows)
    clean_counts = Counter(row["label"] for row in clean_rows)

    train_rows, test_rows = train_test_split(
        clean_rows,
        test_size=args.test_size,
        random_state=args.seed,
        stratify=[row["label"] for row in clean_rows],
    )
    train_rows = sorted(train_rows, key=lambda row: (row["label"], row["source"], row["text"]))
    test_rows = sorted(test_rows, key=lambda row: (row["label"], row["source"], row["text"]))

    write_csv(TRAIN_CSV, train_rows)
    write_csv(TEST_CSV, test_rows)
    write_report(
        before_counts=before_counts,
        clean_counts=clean_counts,
        train_counts=Counter(row["label"] for row in train_rows),
        test_counts=Counter(row["label"] for row in test_rows),
        removed=removed,
        include_virus=args.include_virus,
        fatigue_total=args.fatigue_total,
    )

    print(f"Saved train: {TRAIN_CSV} {dict(Counter(row['label'] for row in train_rows))}")
    print(f"Saved test : {TEST_CSV} {dict(Counter(row['label'] for row in test_rows))}")
    print(f"Saved report: {REPORT_MD}")


if __name__ == "__main__":
    main()
