# Heartide Six-Class Product Integration Plan

## Goal

Switch Heartide/MoodGarden frontend and backend to the new six-class emotion taxonomy. The app should directly expose the six classes, with concise literary frontend wording that remains one-to-one with the canonical backend labels.

## Canonical Labels

Backend, database, analytics, and model evaluation use exactly these labels:

- `无情绪`
- `积极`
- `悲伤`
- `愤怒`
- `恐惧`
- `惊奇`

If a model artifact outputs raw labels `neutral`, `happy`, `sad`, `angry`, `fear`, `surprise`, normalize them once at the backend model-adapter boundary.

## Frontend Display Copy

Frontend copy is presentation-only. It must not affect model output, stored values, analytics, or evaluation metrics.

| Canonical label | Frontend display |
| --- | --- |
| `无情绪` | `无波` |
| `积极` | `欣然` |
| `悲伤` | `低落` |
| `愤怒` | `愠怒` |
| `恐惧` | `惶然` |
| `惊奇` | `惊奇` |

## Product Rules

- Use the six classes directly in frontend and backend.
- Do not map six-class labels back to old product moods such as `开心`, `平静`, `忧郁`, `焦虑`, `疲惫`, `治愈`, `放松`, `孤独`, `空白`, or `安静`.
- Keep one frontend metadata table, such as `EMOTION_META`, for display label, color, icon, and scene treatment.
- Existing records with old mood labels must not be silently relabeled. Either mark them as legacy or re-run the new classifier on their original text.
- Manual frontend selection should submit canonical labels, not display labels.

## Implementation Outline

1. Add a backend six-class schema and normalize raw model labels to canonical Chinese labels.
2. Remove the old product-mood bridge from classifier output.
3. Replace frontend `Mood` type with the six canonical labels.
4. Add fixed one-to-one frontend display metadata.
5. Update record creation, homepage, history, profile, and trend views to render via metadata.
6. Add a dry-run script for optional legacy record reclassification.
