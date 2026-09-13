# Heartide Emotion V2 Sanitized Materials

This directory contains the sanitized public/project version of the Heartide six-class emotion experiment and product integration materials.

## Scope

Included:

- Final report and model card.
- Six-class label schema and frozen split manifest.
- Aggregate metrics, per-class metrics, domain metrics, validation search results, latency summary, and confusion matrices.
- Reproducibility scripts and tests.
- MacBERT run summaries (`metrics.json` and validation reports) for the three learning-rate runs.
- Aggregate research-extension summaries without raw review text.

Excluded:

- Raw `train.csv`, `validation.csv`, `test.csv`, and excluded rows.
- Per-sample prediction CSV files.
- Error-analysis samples and manual/AI review rows containing original text.
- Local application materials and personal application documents.
- Large model artifacts such as `model.safetensors` and classical `.joblib` files.
- Local absolute paths, API keys, `.env` files, databases, logs, and caches.

## Final Selection

Primary final model:

```text
macbert_lr1e-5_seed42_4090
```

Frozen-test metrics:

| Metric | Value |
|---|---:|
| Accuracy | 0.77872781 |
| Macro-F1 | 0.73131393 |
| Surprise F1 | 0.61411765 |

The selected checkpoint is not committed to GitHub because it is a large model artifact. Restore it from the local GPU result archive when deploying:

```text
gpu_result/emotion_v2/runs/macbert/macbert_lr1e-5_seed42_4090/best_checkpoint
```

## Privacy Note

The fixed test split is held out for this experiment's final evaluation, but it is not described as historically untouched. All files committed here are intended to avoid raw social-media text and personally identifying local paths.
