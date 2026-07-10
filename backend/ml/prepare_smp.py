"""Convert SMP2020-EWECT JSON data into MoodGarden's five-label training CSV."""
import csv
import json
import os
from collections import Counter


HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
SOURCE = os.path.join(DATA_DIR, "smp_usual_train.txt")
SYNTHETIC = os.path.join(HERE, "generated_data.csv")
TARGET = os.path.join(DATA_DIR, "emotion_train.csv")

LABEL_MAP = {
    "happy": "开心",
    "surprise": "开心",
    "neutral": "平静",
    "sad": "忧郁",
    "fear": "焦虑",
    "angry": "焦虑",
}


def main():
    with open(SOURCE, "r", encoding="utf-8") as source_file:
        source_rows = json.load(source_file)

    rows = []
    for item in source_rows:
        label = LABEL_MAP.get(item.get("label"))
        text = str(item.get("content", "")).strip()
        if text and label:
            rows.append((text, label))

    if os.path.exists(SYNTHETIC):
        with open(SYNTHETIC, "r", encoding="utf-8") as synthetic_file:
            for text, label in csv.reader(synthetic_file):
                if label == "疲惫" and text.strip():
                    rows.append((text.strip(), label))

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TARGET, "w", encoding="utf-8", newline="") as target_file:
        writer = csv.writer(target_file)
        writer.writerow(["text", "label"])
        writer.writerows(rows)

    print(f"Prepared {len(rows)} rows: {dict(Counter(label for _, label in rows))}")
    print(f"Saved to {TARGET}")


if __name__ == "__main__":
    main()
