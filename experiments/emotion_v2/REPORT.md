# Heartide Emotion V2 Report

## Problem

This experiment evaluates original six-class Chinese emotion classification with frozen train, validation, and test splits.
The product five-class mapping and fatigue templates are not used in this experiment.
Product-facing Chinese labels are one-to-one with the six canonical labels: `无情绪`, `积极`, `悲伤`, `愤怒`, `恐惧`, `惊奇`.

## Data

Frozen data files are stored in `data/`. Source test is held out for this experiment's final evaluation, while the report discloses historical exposure risk.

| Split | Rows |
|---|---:|
| Train | 33844 |
| Validation | 3712 |
| Test | 7719 |

## Classical Results

| Model | Test Accuracy | Test Macro-F1 | Surprise F1 | Support |
|---|---:|---:|---:|---:|
| `dummy_most_frequent` | 0.30781189 | 0.07845468 | 0.00000000 | 7719 |
| `016_logreg_word_char_c1_weightbalanced` | 0.73416246 | 0.68415343 | 0.54842220 | 7719 |

Validation selected best classical model: `016_logreg_word_char_c1_weightbalanced`.

## MacBERT Validation Search

| Run | LR | Best Epoch | Validation Macro-F1 | Validation Accuracy At Best | Epochs Run |
|---|---:|---:|---:|---:|---:|
| `macbert_lr1e-5_seed42_4090` | 1e-05 | 3 | 0.71888478 | 0.77532328 | 5 |
| `macbert_lr2e-5_seed42_4090` | 2e-05 | 2 | 0.71869746 | 0.77640086 | 4 |
| `macbert_lr3e-5_seed42_4090` | 3e-05 | 2 | 0.71237698 | 0.77370690 | 4 |

Selection rule: choose the MacBERT run with the highest validation macro-F1, then evaluate that checkpoint on the frozen test split once.
Selected MacBERT checkpoint: `macbert_lr1e-5_seed42_4090` from epoch 3.

## Final Test Results

| Model | Test Accuracy | Test Macro-F1 | Surprise F1 | Support | Note |
|---|---:|---:|---:|---:|---|
| `dummy_most_frequent` | 0.30781189 | 0.07845468 | 0.00000000 | 7719 | Majority label baseline fitted from train labels only. |
| `016_logreg_word_char_c1_weightbalanced` | 0.73416246 | 0.68415343 | 0.54842220 | 7719 | Validation-selected best classical model. |
| `macbert_lr1e-5_seed42_4090` | 0.77872781 | 0.73131393 | 0.61411765 | 7719 | Validation-selected best MacBERT checkpoint. |

Primary final model for product integration: `macbert_lr1e-5_seed42_4090`.
MacBERT minus best classical test macro-F1 delta: `+0.04716050`.

## Interpretation

- MacBERT gives a moderate improvement over the selected classical baseline on this six-class frozen test, but the gain is not large enough to justify exaggerated claims.
- The earlier 5k MacBERT cross-validation record in `moodgarden/RUN.md` used a different experimental口径; it is not treated as a strict apples-to-apples baseline here.
- 本轮大样本训练相对 classical baseline 有中等提升，但相对旧 5k 记录不能形成“同口径显著提升”的结论；尤其 `surprise` / `惊奇` 仍是主要短板。
- `surprise` is low-support and semantically broad. In the selected MacBERT test confusion matrix, true `surprise` is predicted as `angry` 48 times, `happy` 42 times, `neutral` 35 times, `fear` 29 times, and `sad` 24 times.
- Domain shift remains visible: selected MacBERT reaches macro-F1 `0.75800405` on `usual` but `0.62808452` on `virus`.

## Artifacts

- `results/test_results.csv`: final model-level metrics.
- `results/per_class_metrics.csv`: precision, recall, and F1 for each label.
- `results/domain_results.csv`: usual / virus domain metrics.
- `figures/confusion_counts_*.csv` and `figures/confusion_row_normalized_*.csv`: confusion matrices.
- `results/predictions/*_test_predictions.csv`: frozen-test predictions.
- `results/error_analysis*.csv`: stratified sampled errors for manual review.

## Limitations

- The test split is not claimed as historically untouched.
- No five-class product score is reported from this six-class experiment.
- Only one seed (`42`) was run for the three MacBERT learning rates; cross-seed means and bootstrap intervals are not reported.
- Error analysis rows are sampled for manual annotation; `analysis_bucket` and `notes` are intentionally blank until reviewed.
