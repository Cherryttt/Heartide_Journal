"""
真·ML① 情绪分类器训练管线
jieba 分词 → TF-IDF → 逻辑回归 / 线性SVM,报告 准确率 + 宏F1 + 各类别。

数据来源(优先级):
1. backend/data/emotion_train.csv  (真实大数据集,列: text,label)—— 有就用它
2. backend/ml/generated_data.csv   (上次 GLM 生成的缓存)
3. 调用 GLM 现场生成一批带标签语料(数据增强,几次批量调用)

用法:  python ml/train.py
       python ml/train.py --regen   # 强制重新生成数据
       python ml/prepare_smp.py     # 将 SMP2020-EWECT 转换为产品五标签 CSV
"""
import os
import sys
import csv
import time
import json
import httpx
import jieba
import joblib
from collections import Counter
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, classification_report
from sklearn.pipeline import FeatureUnion

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import settings  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_CSV = os.path.join(HERE, "..", "data", "emotion_train.csv")
TEST_CSV = os.path.join(HERE, "..", "data", "emotion_test.csv")
GEN_CSV = os.path.join(HERE, "generated_data.csv")
MODEL_PATH = os.path.join(HERE, "model.pkl")

# 5 个可分的基础情绪作为分类目标(产品层再映射回 12 心情/场景 —— 标签桥接)
EMOTIONS = ["开心", "平静", "忧郁", "焦虑", "疲惫"]
GEN_SPEC = {
    "开心": "开心、愉悦、兴奋、期待等积极、高能量的情绪",
    "平静": "平静、治愈、放松、安宁、被温柔安抚的情绪",
    "忧郁": "忧郁、低落、孤独、空落落、淡淡的难过",
    "焦虑": "焦虑、紧张、不安、压力大、心神不宁",
    "疲惫": "疲惫、很累、没力气、倦怠、只想躺平",
}


# ============================================================
# 数据获取
# ============================================================
def gen_via_glm(per_class: int = 80, chunk: int = 40) -> list[tuple[str, str]]:
    """用 GLM 为每种基础情绪分批生成多样化中文短句(数据增强,类别均衡)"""
    rows: list[tuple[str, str]] = []
    headers = {"Authorization": f"Bearer {settings.zhipu_api_key}", "Content-Type": "application/json"}
    scenes = ["日常琐事", "天气", "食物", "朋友/人际", "独处/夜晚", "工作学习", "自然/风景", "回忆/旧物"]
    with httpx.Client(timeout=120) as client:
        for emo in EMOTIONS:
            spec = GEN_SPEC.get(emo, emo)
            got, ci = 0, 0
            while got < per_class:
                n = min(chunk, per_class - got)
                scene = scenes[ci % len(scenes)]
                ci += 1
                prompt = (
                    f"请生成 {n} 条表达「{spec}」的中文短句,模拟真实用户在「{scene}」场景下的随手记录/碎片日记。"
                    f"要求:口语化、长短不一、尽量多样且互不重复,不要出现直白情绪词(如开心/难过/焦虑/累)。"
                    f"只输出一个 JSON 字符串数组,不要任何解释。"
                )
                ok = False
                for attempt in range(4):
                    time.sleep(0.8)
                    try:
                        r = client.post(
                            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                            headers=headers,
                            json={"model": settings.glm_flash_model,
                                  "messages": [{"role": "user", "content": prompt}],
                                  "max_tokens": 3000, "temperature": 1.0,
                                  "thinking": {"type": "disabled"}},
                        )
                        content = r.json()["choices"][0]["message"]["content"]
                        start, end = content.find("["), content.rfind("]")
                        arr = json.loads(content[start:end + 1])
                        for s in arr:
                            s = str(s).strip()
                            if s:
                                rows.append((s, emo))
                        got += len(arr)
                        ok = True
                        break
                    except Exception as e:
                        print(f"  [{emo}] 第{ci}批 重试{attempt + 1}/4: {e}")
                if not ok:
                    break
            print(f"  [{emo}] 共 {got} 条")
    return rows


def load_dataset(regen: bool = False) -> list[tuple[str, str]]:
    # 1. 真实数据集
    if os.path.exists(REAL_CSV):
        print(f"✅ 使用真实数据集: {REAL_CSV}")
        rows = []
        with open(REAL_CSV, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                t, l = row.get("text", "").strip(), row.get("label", "").strip()
                if t and l:
                    rows.append((t, l))
        return rows
    # 2. 缓存
    if os.path.exists(GEN_CSV) and not regen:
        print(f"✅ 使用已生成数据缓存: {GEN_CSV}")
        rows = []
        with open(GEN_CSV, "r", encoding="utf-8") as f:
            for row in csv.reader(f):
                if len(row) == 2:
                    rows.append((row[0], row[1]))
        return rows
    # 3. GLM 生成
    print("⏳ 无现成数据集,调用 GLM 生成训练语料(数据增强)...")
    rows = gen_via_glm()
    if rows:
        with open(GEN_CSV, "w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerows(rows)
        print(f"💾 已缓存到 {GEN_CSV}")
    return rows


def load_csv_dataset(path: str) -> list[tuple[str, str]]:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            t, l = row.get("text", "").strip(), row.get("label", "").strip()
            if t and l:
                rows.append((t, l))
    return rows


def tok(s: str) -> str:
    return " ".join(jieba.cut(s))


def make_soft_class_weight(labels: list[str], alpha: float = 0.45) -> dict[str, float]:
    """Use softened inverse-frequency weights to improve minority recall without over-penalizing majority classes."""
    counts = Counter(labels)
    total = len(labels)
    class_count = len(counts)
    balanced = {label: total / (class_count * count) for label, count in counts.items()}
    return {label: weight ** alpha for label, weight in balanced.items()}


# ============================================================
# 训练 + 评估
# ============================================================
def main():
    regen = "--regen" in sys.argv
    data = load_dataset(regen)
    if len(data) < 50:
        print(f"❌ 数据太少({len(data)} 条),无法训练。请放入 data/emotion_train.csv 或检查 GLM。")
        return

    texts = [tok(t) for t, _ in data]
    labels = [l for _, l in data]
    print(f"\n📊 数据集: {len(data)} 条 · 类别分布: {dict(Counter(labels))}")

    fixed_test = os.path.exists(TEST_CSV)
    if fixed_test:
        test_data = load_csv_dataset(TEST_CSV)
        X_tr, y_tr = texts, labels
        X_te = [tok(t) for t, _ in test_data]
        y_te = [l for _, l in test_data]
        print(f"🧪 固定测试集: {len(test_data)} 条 · 类别分布: {dict(Counter(y_te))}")
    else:
        X_tr, X_te, y_tr, y_te = train_test_split(texts, labels, test_size=0.2, random_state=42, stratify=labels)
    soft_class_weight = make_soft_class_weight(y_tr, alpha=0.45)
    accuracy_class_weight = make_soft_class_weight(y_tr, alpha=0.20)
    candidates = [
        (
            "word+char(1-4)-tfidf+soft-balanced-logreg",
            FeatureUnion([
                ("word", TfidfVectorizer(max_features=20000, ngram_range=(1, 2), sublinear_tf=True)),
                ("char", TfidfVectorizer(analyzer="char", max_features=80000, ngram_range=(1, 4), sublinear_tf=True)),
            ]),
            LogisticRegression(max_iter=2000, C=0.9, class_weight=soft_class_weight),
        ),
        (
            "word+char(1-4)-tfidf+accuracy-tuned-logreg",
            FeatureUnion([
                ("word", TfidfVectorizer(max_features=20000, ngram_range=(1, 2), sublinear_tf=True)),
                ("char", TfidfVectorizer(analyzer="char", max_features=80000, ngram_range=(1, 4), sublinear_tf=True)),
            ]),
            LogisticRegression(max_iter=2000, C=0.9, class_weight=accuracy_class_weight),
        ),
        (
            "词级TF-IDF+校准逻辑回归",
            TfidfVectorizer(max_features=20000, ngram_range=(1, 3), sublinear_tf=True),
            CalibratedClassifierCV(
                LogisticRegression(max_iter=1000, C=4.0, class_weight="balanced"),
                method="sigmoid",
                cv=3,
            ),
        ),
        (
            "词级TF-IDF+校准线性SVM",
            TfidfVectorizer(max_features=20000, ngram_range=(1, 3), sublinear_tf=True),
            CalibratedClassifierCV(LinearSVC(C=1.0, class_weight="balanced", max_iter=5000), method="sigmoid", cv=3),
        ),
        (
            "词+字符TF-IDF+逻辑回归",
            FeatureUnion([
                ("word", TfidfVectorizer(max_features=20000, ngram_range=(1, 2), sublinear_tf=True)),
                ("char", TfidfVectorizer(analyzer="char", max_features=60000, ngram_range=(2, 5), sublinear_tf=True)),
            ]),
            LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced"),
        ),
    ]

    results = {}
    fitted_vectorizers = {}
    for name, vec, clf in candidates:
        Xtr, Xte = vec.fit_transform(X_tr), vec.transform(X_te)
        clf.fit(Xtr, y_tr)
        pred = clf.predict(Xte)
        acc = accuracy_score(y_te, pred)
        f1 = f1_score(y_te, pred, average="macro")
        results[name] = (clf, acc, f1)
        fitted_vectorizers[name] = vec
        print(f"\n===== {name} =====")
        print(f"准确率 Accuracy: {acc:.3f}   宏平均 Macro-F1: {f1:.3f}")
        print(classification_report(y_te, pred, zero_division=0))

    # 选 F1 最高的保存
    best_name = max(results, key=lambda k: results[k][2])
    best_clf = results[best_name][0]
    best_vec = fitted_vectorizers[best_name]
    joblib.dump({
        "vectorizer": best_vec,
        "clf": best_clf,
        "emotions": EMOTIONS,
        "dataset_size": len(data) + (len(y_te) if fixed_test else 0),
        "train_size": len(y_tr),
        "test_size": len(y_te),
        "dataset_source": "backend/data/emotion_train.csv + backend/data/emotion_test.csv" if fixed_test else ("backend/data/emotion_train.csv" if os.path.exists(REAL_CSV) else "generated_data.csv"),
        "feature_strategy": best_name,
        "metrics": {name: {"accuracy": acc, "macro_f1": f1} for name, (_, acc, f1) in results.items()},
    }, MODEL_PATH)
    print(f"\n🏆 最佳模型: {best_name}  →  已保存 {MODEL_PATH}")
    print("   (运行时 emotion_classifier 会自动加载它;无模型则回退规则版)")


if __name__ == "__main__":
    main()
