# MoodGarden 运行指南

> 响应式 Web + 移动 App 风格 · 前端 React+R3F · 后端 FastAPI · 智谱 GLM + 本地情绪分类器
> Windows 中文环境注意:命令尽量在 **Trae / VS Code 集成终端**里跑(Node/Python PATH 全)。

## 一、后端

```bat
cd backend
python -m venv venv                                   :: 首次
venv\Scripts\python -m pip install -r requirements.txt :: 首次
copy .env.example .env                                 :: 首次,然后编辑 .env
```

编辑 `backend\.env`:
```
ZHIPU_API_KEY=你的智谱key（open.bigmodel.cn 完整复制,形如 id.secret）
GLM_VISION_MODEL=glm-4.6v
GLM_FLASH_MODEL=glm-4.5-flash
WEREAD_API_KEY=你的微信读书官方 Skill Key（可选，获取地址：https://weread.qq.com/r/weread-skills）
WEREAD_API_BASE_URL=https://i.weread.qq.com/api/agent/gateway
WEREAD_OWNER_EMAIL=允许使用该微信读书 Key 的心潮手帐登录邮箱
```

启动:
```bat
run.bat
```
`run.bat` 会先执行 `alembic upgrade head` 再启动后端，SQLite 与 PostgreSQL 使用同一套迁移。
( **PYTHONUTF8=1 必须有** —— 否则中文 locale 下 print emoji 会崩 )
→ http://localhost:8000/api/health 应返回 `{"status":"ok","llm_configured":true}`

手动创建新迁移：
```bat
cd backend
venv\Scripts\python -m alembic revision --autogenerate -m "描述本次结构变化"
venv\Scripts\python -m alembic upgrade head
```

## 二、前端

```bat
npm install        :: 首次
npm run dev
```
→ http://localhost:5173 (前端 .env 里 VITE_API_URL 默认指向 http://localhost:8000)

### 手机 / App 样式真机测试

电脑和手机连接同一个 Wi-Fi，然后在电脑执行：

```bat
npm run dev -- --host 0.0.0.0
```

查询电脑局域网 IP：

```bat
ipconfig
```

手机浏览器访问 `http://电脑局域网IP:5173`，例如 `http://10.128.7.40:5173`。首次访问需要注册账号，并允许定位权限才能显示真实天气。若无法打开，请允许 Windows 防火墙放行 Node.js 的专用网络访问。

### Android App（Capacitor）

项目已生成原生 Android 工程，包名为 `com.heartide.journal`，App 名称为“心潮手帐”。

首次安装 Android Studio 后，打开项目：

```bat
npm run android:sync
npm run android:open
```

Android 模拟器默认通过 `http://10.0.2.2:8000` 访问电脑后端。真机调试时，复制 `.env.android.example` 为 `.env.production`，将 `VITE_API_URL` 改为电脑局域网地址：

```env
VITE_API_URL=http://10.128.7.40:8000
```

然后保证电脑与手机连接同一 Wi-Fi，运行后端 `backend\run.bat`，再执行：

```bat
npm run android:run
```

发布版本必须把 `VITE_API_URL` 改为公网 HTTPS 后端。普通页面仍在 `src/` 中修改，每次修改后执行 `npm run android:sync` 即可同步进 Android 工程。

生成可直接安装的 Debug APK：

```bat
npm run android:apk
```

APK 输出位置：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

发布到应用商店前仍需在 Android Studio 配置正式签名，并递增 `android/app/build.gradle` 中的 `versionCode` / `versionName`。Release 包默认关闭明文 HTTP、混合内容和系统备份，并开启 R8 压缩；本地 Debug 包通过 `npm run android:sync:debug` 保留局域网 HTTP 调试能力。构建 Release 前使用 `npm run android:release`，避免把 Debug 网络配置带入发布包。

项目已为内存受限环境配置低内存 Gradle 模式（768MB、最多2个 worker）。若 Android Studio 曾显示 Gradle daemon 内存不足，请重启 Android Studio 后执行 **File → Sync Project with Gradle Files**。

连接已开启 USB 调试的安卓手机后，可以执行：

```bat
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\debug\app-debug.apk
```

## 三、生产部署基础

```bat
docker compose up --build
```

- PostgreSQL：生产数据主库；本地不设置 `DATABASE_URL` 时仍可使用 SQLite。
- 登录鉴权：首次打开前端注册账号，记录数据按用户隔离。
- 账号注销：画像页底部可验证密码后永久删除该账号的记录、书摘、词典、手账同步数据、向量条目和上传图片。
- 接口限流：登录、注册、上传、图片理解和 AIGC 接口默认启用进程内限流；生产多实例部署建议改用 Redis/网关级共享限流。
- 请求防护：后端默认拒绝超过 10MB 的请求，Caddy 为 Web 增加 CSP、防嵌入、MIME 嗅探与权限策略响应头。
- 生产启动闸门：`DEBUG=false` 时会强制检查 32 位以上随机 `JWT_SECRET`、PostgreSQL，以及微信读书 Key 对应的 `WEREAD_OWNER_EMAIL`；配置不完整时拒绝启动。
- MinIO/S3：Docker 默认通过 `https://你的域名/storage/moodgarden/...` 回显图片；若图片包含敏感内容，生产应改为私有对象存储 + 短期签名 URL。
- HTTPS：设置根目录 `.env` 中的 `DOMAIN=你的域名`，Caddy 自动申请和续期证书。
- 监控：Prometheus 位于 `http://localhost:9090`，采集后端 `/metrics`。
- 微信读书：通过官方 Agent API Gateway 接入；Key 从微信读书官方 Skill 页面获取，书摘文本导入仍可作为备用方式。

## 四、训练情绪分类器(真·ML①)

项目有两层情绪模型：
- **运行侧轻量模型**：`backend\ml\model.pkl`，启动快，课堂展示稳定；默认后端加载它。
- **MacBERT 实验/可选部署模型**：`hfl/chinese-macbert-base`，用于真实数据训练验证；导出 checkpoint 后可通过 `.env` 开关接入后端。

### 4.1 轻量运行模型

```bat
cd backend
venv\Scripts\python ml\prepare_smp.py
venv\Scripts\python ml\train.py
```

标签映射和数据来源见 `backend\data\DATASET.md`。公开语料没有「疲惫」类，因此只对该缺失类保留少量合成样本。
- 产物：`backend\ml\model.pkl`（TF-IDF + 线性 SVM/逻辑回归）。
- 后端默认自动加载；无模型则回退规则版。

### 4.2 MacBERT 交叉验证

```bat
cd backend
venv\Scripts\python ml\transformer_cv.py --model-name hfl/chinese-macbert-base --folds 5 --epochs 1 --max-samples 5000 --batch-size 8 --eval-batch-size 16 --max-length 128 --log-every 50
```

已有记录：5000 平衡样本 5 折交叉验证，Accuracy `0.7668 ± 0.0199`，Macro-F1 `0.7672 ± 0.0200`。报告/简历请写“5k 平衡样本 5 折交叉验证约 76.7%”，不要写成全量指标。

### 4.3 导出并启用 MacBERT 后端推理（可选）

```bat
cd backend
venv\Scripts\python ml\train_transformer_final.py --model-name hfl/chinese-macbert-base --epochs 1 --max-samples 10000 --batch-size 8 --eval-batch-size 16 --max-length 128 --log-every 50
```

导出成功后会生成 `backend\ml\macbert_emotion\`，再在 `backend\.env` 中开启：

```env
EMOTION_TRANSFORMER_ENABLED=true
EMOTION_TRANSFORMER_MODEL_PATH=./ml/macbert_emotion
EMOTION_TRANSFORMER_MAX_LENGTH=128
EMOTION_TRANSFORMER_DEVICE=auto
```

后端优先使用 MacBERT；如果 checkpoint、依赖或推理失败，会自动回退 `model.pkl`，再回退规则版。

## 五、关键技术点(答辩/报告用)

- **情绪分类(真ML)**:SMP2020-EWECT 真实中文情绪数据;MacBERT 5 折交叉验证约 76.7%,运行侧可选 MacBERT checkpoint,默认轻量模型实时推理;经「标签桥接」映射回 12 心情 +(效价,唤醒)坐标。
- **多知识库 RAG**:本地句向量(bge-small-zh)+ numpy 余弦检索,书摘/记录/不可译词三库;Agent 回答带出处。
- **LLM**:智谱 GLM-4.6V(视觉)+ GLM-4.5-Flash(文本/Agent/拼贴诗/拾词),统一在 `LLMClient` 抽象层后。
- **动态主页**:React Three Fiber 低多边形 3D 海景,情绪驱动换肤。
- **动态推荐**:后端综合今日情绪、历史记录、个人书摘/书架和收藏/划线/不感兴趣行为实时排序，推荐理由来自真实命中信号。
- **账号云同步**:手帐布局、书架、手帐素材、已看书籍和阅读反馈采用本地优先策略，登录后与服务端合并并自动同步。
- **安全优先**:记录和 Agent 对话均先做危机信号识别；高风险时停止角色扮演并提示联系现实支持与紧急服务。
- **模型监控**:Prometheus 记录分类来源、置信度、LLM 兜底次数、危机信号和推荐反馈；Docker 使用 `backend_data` 卷持久化向量索引。

运行自动化测试：
```bat
cd backend
set PYTHONUTF8=1
venv\Scripts\python -m pytest -q
```

仓库内 `.github/workflows/ci.yml` 会在每次 push / pull request 时自动运行后端反例测试、向量持久化测试和前端生产构建。

## 踩坑备忘(都已修)
- pip 读 requirements.txt:中文 locale 用 GBK 解码会失败 → 文件保持纯 ASCII。
- print emoji:中文 locale GBK 编码崩 → 用 PYTHONUTF8=1。
- chromadb 需 C++ 编译器 → 已换成纯 numpy 向量库。
- GLM:temperature 必须 ≤ 1.0;glm-4.6v 对纯文本会返回空(故拼贴诗/文本生成走 flash)。
