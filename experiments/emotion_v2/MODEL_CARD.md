# Heartide Emotion V2 Model Card

- Selected classical model: `016_logreg_word_char_c1_weightbalanced`
- Primary final model: `macbert_lr1e-5_seed42_4090`
- Task: original six-class SMP2020 emotion classification.
- Labels: `neutral`, `happy`, `sad`, `angry`, `fear`, `surprise`.
- Product labels: `无情绪`, `积极`, `悲伤`, `愤怒`, `恐惧`, `惊奇`.
- Intended use: Heartide/MoodGarden emotion classification and product routing after six-class frontend/backend integration.
- Not intended for diagnosis, clinical triage, or high-stakes mental-health decisions.
- Test policy: validation-selected models evaluated once on the frozen test split.
- Final frozen-test metrics: accuracy `0.77872781`, macro-F1 `0.73131393`, surprise F1 `0.61411765`.
- Selected MacBERT checkpoint: `macbert_lr1e-5_seed42_4090/best_checkpoint`
- MacBERT selection metric: validation macro-F1 `0.71888478`.
- Known weakness: `surprise` / `惊奇` remains the least stable class and requires manual error review before strong product claims.
