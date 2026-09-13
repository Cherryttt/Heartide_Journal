# Heartide Emotion V2 Data Audit

- Created: 2026-09-11
- Route: original six-class SMP2020 labels.
- Source test policy: frozen for final evaluation only in this experiment.
- Historical exposure note: 源 test 在项目历史实验中可能已有部分文本进入过训练或开发；本轮未参与训练和模型选择的保留测试集会从本实验开始冻结使用，但不能表述为全新独立测试集。

## Frozen Counts By Split

| Split | Rows |
|---|---:|
| test | 7719 |
| train | 33844 |
| validation | 3712 |

## Frozen Counts By Label

| Label | Rows |
|---|---:|
| neutral | 9250 |
| happy | 12328 |
| sad | 7080 |
| angry | 11567 |
| fear | 2226 |
| surprise | 2824 |

## Excluded Rows

| Reason | Rows |
|---|---:|
| duplicate_lower_priority | 1692 |
| duplicate_same_priority | 1333 |
| empty_text | 22 |

## Source Hashes

| File | SHA-256 |
|---|---|
| `usual_train.txt` | `cc2c7dbc8880596ff6af93dfbcd42701e6c97f200af52701da22f2e02980ada8` |
| `virus_train.txt` | `bbc11bf83d64ffe1286f83de11c8c6203a9a1d451be9457017b434e9ab2fb31d` |
| `usual_eval_labeled.txt` | `f61d8dafd25ea3794b1b4fe64b6aa21d05f86636442f36fac966dd26605ff3f9` |
| `virus_eval_labeled.txt` | `f4e62d00a018712d9553e3ffbe364095587f1b9db6b58c5911f13368bb412b3b` |
| `usual_test_labeled.txt` | `f23f3f4bef48dbbde1a1d56e3455691f32af47b206273bc2e745c9900837ccd9` |
| `virus_test_labeled.txt` | `06eaf697338978a03ed83974306ae20d9bad567e07294aecd57fc5cc2a74d62d` |
