# Heartide MacBERT multi-seed：42、13、2026

保留已完成的seed=42，补跑13和2026；从相同预训练权重重新开始，每次按自己的validation Macro-F1选择最佳检查点。最终在同一设备上重新评价全部三个seed，报告每次结果及均值／样本标准差。脚本不会在三个seed中只选最高分。

## 在原来的4090环境运行

使用上次GPU训练的Python环境和模型缓存，不需要重新划分数据，也不要升级现有PyTorch／Transformers版本。

将 `heartide_multiseed_addon.zip` 上传到原来的 `emotion_v2` 实验目录，解压后应出现 `multiseed_addon/`。在这个**原实验目录**下运行以下命令，Windows和Linux均可：

```bash
python multiseed_addon/scripts/run_multiseed.py --exp-dir . --check-only
python -u multiseed_addon/scripts/run_multiseed.py --exp-dir . --stage all
```

第一条只检查输入、数据哈希和seed=42配置，不启动训练／预测。第二条顺序训练13、2026，然后评价42、13、2026。前台终端需要保持连接；长任务可在你已有的持久终端会话中运行。

默认要求原实验目录中已有：

```text
data/train.csv
data/validation.csv
data/test.csv
runs/macbert/macbert_lr1e-5_seed42_4090/metrics.json
runs/macbert/macbert_lr1e-5_seed42_4090/best_checkpoint/
```

代码包附带冻结数据的manifest备份，不包含语料或模型权重。如果原实验的 `data/split_manifest.json` 存在则使用它，否则使用代码包里的备份。训练和测试仍使用原实验目录中的三个CSV，并检查哈希。

如果seed=42在另一个位置，两条命令都加入真实路径，例如：

```bash
python multiseed_addon/scripts/run_multiseed.py --exp-dir . --seed42-run "/你的实际路径/macbert_lr1e-5_seed42_4090" --check-only
python -u multiseed_addon/scripts/run_multiseed.py --exp-dir . --seed42-run "/你的实际路径/macbert_lr1e-5_seed42_4090" --stage all
```

`--seed42-run` 指向同时包含metrics.json和best_checkpoint的**run目录**，不要直接指向best_checkpoint。

## 固定配置

| 参数 | 数值 |
| --- | --- |
| seed | 已有42；新增13、2026 |
| model | hfl/chinese-macbert-base |
| 学习率 | 1e-5 |
| train／validation／test数量 | 33,844／3,712／7,719 |
| max_length | 256 |
| 训练batch／梯度累计／有效batch | 16／2／32 |
| 训练时validation batch | 16 |
| 最大epoch／早停patience | 5／2 |
| weight_decay／warmup_ratio | 0.01／0.06 |
| max_grad_norm | 1.0 |
| 最终test评价batch | 32 |

各seed的最佳epoch允许不同，不强制都取3。seed42原始metrics没有完整记录weight_decay、warmup、patience等参数，本脚本显式使用现有训练脚本默认值；如果原GPU启动命令曾覆盖这些默认值，应先核对原命令与本表是否一致。不要把只改变seed之外的配置差异隐藏在汇总结果中。

训练沿用原脚本的精度与优化器行为，不新增混合精度／数据增强。CUDA不可用时会直接报错，不自动降级为CPU训练。

评价复用现有评价函数，依赖torch、transformers、scikit-learn、scipy、joblib、jieba。如GPU环境仅运行过训练而未安装jieba，可补装这一依赖：`python -m pip install jieba==0.42.1`；其余依赖沿用原环境。

## 输出位置

新增训练结果：

```text
runs/macbert/macbert_lr1e-5_seed13_multiseed/
runs/macbert/macbert_lr1e-5_seed2026_multiseed/
```

每个目录保存metrics.json、best_checkpoint、multiseed_config.json及console.log。seed42原目录保持原样。

汇总结果在：

```text
results/multiseed_42_13_2026/
  protocol.json
  environment.json
  test_results.csv
  summary.json
  REPORT.md
  per_class_metrics.csv
  domain_results.csv
  seed_42_metrics.json
  seed_13_metrics.json
  seed_2026_metrics.json
  predictions/
  figures/
```

`REPORT.md`会生成三行seed结果，以及：

```text
Test Macro-F1 = 实测均值 +/- 实测样本标准差
Test Accuracy = 实测均值 +/- 实测样本标准差
```

这不是ensemble结果。标准差使用ddof=1，不是置信区间。test仍是原有固定划分，不宣称项目历史上从未接触。seed42会和新seed在同一GPU上重新评价，可能与之前CPU评价出现很小的数值差异；以这次统一设备的三行结果汇总，不选取两次评价中更高的值。

原来的REPORT.md、test_results.csv及模型选择记录不会被覆盖。完成后将新目录下的REPORT.md、test_results.csv、summary.json发回即可更新素材。

## 分阶段与中断处理

如果想先训练、后统一评价，可将 `--stage all` 分成：

```bash
python -u multiseed_addon/scripts/run_multiseed.py --exp-dir . --stage train
python -u multiseed_addon/scripts/run_multiseed.py --exp-dir . --stage evaluate
```

已完成且配置、数据一致的新增run会被复用。存在未完成run目录时脚本会停下，避免覆盖检查点；先保留该目录并将它改名，再重新执行，仍从原始预训练权重开始。这不等于从半途检查点续训。

同一次实验不要在两个终端并发启动这套命令。汇总之前必须已有三个完整run；脚本不会把缺少一个seed的结果称为三次运行。

## 本地文件入口

仓库内脚本位置：`experiments/emotion_v2/scripts/run_multiseed.py`。

针对本地已恢复实验目录的只读检查命令：

```powershell
python experiments/emotion_v2/scripts/run_multiseed.py --exp-dir <restored-emotion-v2-dir> --seed42-run <restored-seed42-run-dir> --check-only
```

CPU环境只用于检查代码与文件。实际训练请使用GPU环境。
