# ForgeMind 可选智能服务

FastAPI 服务负责受限规则助手、可选本地 Ollama/Qwen、可选远程 DeepSeek、工厂需求约束提取、工具协议、轻量 RAG、ASR/TTS 网关和视觉检测辅助。它不进入实时仿真 tick，也不是默认启动依赖。

## 默认原则

- 默认 `FORGEMIND_LLM_PROVIDER=rule`，不安装、不启动、不探测本地大语言模型。
- 已安装的 Ollama `qwen2.5:7b` 可通过显式 provider 启用；模型只做理解、检索和工具选择，不能越过前端/服务端校验修改工厂事实。
- 前端未启用本服务时，生成式工厂继续使用确定性规则解析，助手使用浏览器内规则降级。
- 模型不能直接生成布局坐标、碰撞结论、路线或仿真指标。
- 工具动作必须经过服务端基础校验和前端二次校验；高风险动作仍需确认。

## 启动

项目根目录推荐：

```powershell
.\start-forgemind.bat -IncludeAI
```

也可以手动启动：

```powershell
cd ai-service
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-core.txt
.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

前端只有在启动时设置 `VITE_AI_ENABLED=true` 才会访问该服务；一键启动器使用 `-IncludeAI` 时会自动设置。

`requirements-core.txt` 只安装规则/模型网关所需的轻量 Web 依赖；Ollama 在服务外独立运行，Python 服务通过本机 HTTP 调用，不把模型权重放进仓库。需要视觉、ASR 或本地 TTS 时，再安装完整的 `requirements.txt`。

## 可选本地 Qwen

```powershell
$env:FORGEMIND_LLM_PROVIDER = 'ollama'
$env:FORGEMIND_OLLAMA_MODEL = 'qwen2.5:7b'
$env:FORGEMIND_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
.\启动ForgeMind.cmd -UseLocalQwen
```

也可以使用 `start-forgemind.bat -IncludeAI -UseLocalQwen`。启动器默认不触碰 Ollama；只有显式 `-UseLocalQwen` 才会选择本地模型，并检查已运行的 AI 网关是否确实使用 `ollama` provider。模型调用包含最近 8 轮会话、当前页面/项目/任务状态、任务步骤进度、任务历史、开放主动提醒和文档检索片段，响应可提出工具动作；动作仍由双重协议校验执行。RAG 默认使用零依赖的 BM25、哈希词元向量、查询扩展、父子片段、来源/版本权重和 MMR 去重；可通过显式设置 `FORGEMIND_RAG_EMBEDDING_PROVIDER=ollama` 与 `FORGEMIND_RAG_EMBEDDING_MODEL` 启用本地 Ollama 语义 embedding，服务不可用时自动回退到默认检索。`evidence` 会返回来源、章节、chunkId、score、confidence、route、match 和潜在版本冲突。浏览器端的任务历史、用户偏好、项目运行记忆和主动提醒缓存按登录令牌散列到独立命名空间，避免同一浏览器多用户串数据。提醒策略在已登录时通过 `PUT /api/assistant/reminder-policy` 写入用户级 MySQL，主动提醒事件可通过 `GET /api/assistant/reminders?status=open` 回灌助手上下文；BT 可以列出提醒、解释来源/时间/次数，并在确认后关闭同类提醒。后端不可用时继续使用本地缓存；用户偏好、提醒策略和关闭提醒只在明确请求后写入，并且必须经过前端确认。

## 可选 DeepSeek

```powershell
$env:FORGEMIND_LLM_PROVIDER = 'deepseek'
$env:DEEPSEEK_API_KEY = '<本机密钥>'
$env:DEEPSEEK_MODEL = 'deepseek-chat'
.\start-forgemind.bat -IncludeAI
```

密钥只由服务端读取。未配置密钥、远程请求失败或响应不符合约束时，服务返回规则/降级结果，不会再回退到本地 Qwen。

## 可选语音

ASR/TTS 默认不预热。需要语音时显式设置 `FORGEMIND_VOICE_ENABLED=true`，并准备 `voice-chat/models/` 下的 Paraformer/VITS 文件或外部 TTS 服务。语音模型缺失不影响规则助手、视觉检测和核心前端。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/health` | 服务、协议、provider 和语音状态 |
| GET | `/api/ai/control-plane` | ForgeCloud AI 控制面只读元数据：模型/语音状态、工具数量、RAG 来源目录和事实安全策略；不返回文档正文、问题文本或密钥 |
| GET | `/api/ai/knowledge` | 内置产品/方案文档可读目录；正文通过 `/api/ai/knowledge/content?source=...` 按文档按需读取 |
| GET | `/api/ai/knowledge/content` | 读取内置白名单文档正文；不接受任意文件路径 |
| GET | `/api/ai/tools` | `1.0.0` 工具目录 |
| POST | `/api/ai/assistant` | 规则/远程助手和受限动作信封 |
| POST | `/api/ai/assistant/stream` | NDJSON 兼容响应 |
| POST | `/api/ai/factory-spec` | 只提取受限生成约束 |
| POST | `/api/ai/asr` | 可选 WAV 中文识别 |
| POST | `/api/ai/tts` | 可选语音合成 |
| POST | `/api/vision/detect` | 视觉检测辅助 |
| GET | `/api/vision/yolo/health` | PCB YOLOv8 模型状态 |
| POST | `/api/vision/yolo/detect` | 对视频单帧进行真实 YOLOv8 推理 |

## 验证

```powershell
py -3 -m py_compile main.py vision.py
```

实时 PCB Demo 还需要安装 `requirements.txt` 中的 `ultralytics`，并将 `pcb_defect_yolov8s.pt` 放在 `ai-service/models/`（或通过 `FORGEMIND_YOLO_MODEL` 指定路径）。默认核心服务仍不强制加载 YOLO；只有打开视觉检测 Demo 并启动 AI 服务后才会加载权重。

### CUDA / ONNX Runtime / TensorRT 部署

视觉服务保留 `.pt` + CPU 回退，并支持按产物自动选择加速后端：

| 后端 | 触发条件 | 用途 |
| --- | --- | --- |
| PyTorch CPU/CUDA | 只有 `.pt`，或显式 `FORGEMIND_YOLO_BACKEND=pytorch` | 开发、回退和基准对照 |
| ONNX Runtime CUDA | 存在同名 `.onnx` 且 Provider 含 `CUDAExecutionProvider` | 通用 GPU 推理 |
| TensorRT FP16 | 存在 `.engine`、TensorRT 专用 `.trt.onnx` 且 Provider 含 `TensorrtExecutionProvider` | 固定 NVIDIA 环境的低延迟部署 |

在 D 盘的 `ai-service/.venv` 中安装 GPU 依赖并导出模型（本项目当前 CUDA 12.0 对应 ORT 1.20.2；TensorRT EP 的实际名称是 `TensorrtExecutionProvider`）：

```powershell
.\.venv\Scripts\pip.exe install -r requirements-yolo-gpu.txt
# 本机使用系统 CUDA 12.0 的 cublas/cudart；若 pip 尝试替换系统 CUDA 数学库，改为：
.\.venv\Scripts\pip.exe install --no-deps onnxruntime-gpu==1.20.2
.\.venv\Scripts\pip.exe install --no-deps nvidia-cudnn-cu12==9.0.0.312
.\.venv\Scripts\pip.exe install --no-deps tensorrt-cu12==10.7.0
.\.venv\Scripts\python.exe export_yolo_accel.py --format onnx --simplify --nms
# TensorRT 需要无 NMS 图，单独导出一个专用 ONNX：
.\.venv\Scripts\python.exe export_yolo_accel.py --format onnx --simplify --output models\pcb_defect_yolov8s.trt.onnx
# 已安装兼容 TensorRT 时再构建 FP16 engine：
.\.venv\Scripts\python.exe export_yolo_accel.py --format engine --device 0 --half
```

运行时可用环境变量控制：`FORGEMIND_YOLO_BACKEND=auto|pytorch|onnx|tensorrt`、`FORGEMIND_YOLO_DEVICE=auto|cpu|cuda`、`FORGEMIND_YOLO_ONNX_MODEL`、`FORGEMIND_YOLO_TRT_ONNX_MODEL` 和 `FORGEMIND_YOLO_ENGINE`。`auto` 只在对应产物和 Provider 均可用时启用加速，否则回退 `.pt` CPU；TensorRT 后端会校验实际 Provider，失败时不会静默回退成 CPU benchmark。健康接口会返回实际 `backend/provider/device`，不会把“安装了 CUDA”误报为已使用 GPU。

用统一脚本比较后端（结果只用于工程基准，不替代现场质量验收）：

```powershell
.\.venv\Scripts\python.exe benchmark_yolo.py --backend auto --device auto
```

TensorRT 首次加载会构建或读取本机 SM 8.9 的 engine cache，冷启动延迟不应与稳态帧延迟混报；当前 RTX 4060 Laptop GPU 的稳态 benchmark 约为 7–8 ms/帧，接口还包含 JPEG 解码与 Python 后处理。

启动后检查 `http://127.0.0.1:8000/api/ai/health`：规则模式显示 `localModelRequired: false`，本地 Qwen 模式显示 `provider: ollama`、`ollamaModel: qwen2.5:7b`。两种模式均可用 `/api/ai/assistant` 测试工厂状态、仿真控制和面板调度；助手响应中的 `evidence` 字段会返回裁剪后的文档来源摘要、检索评分、置信度、路由和版本冲突标记。RAG 语义增强默认关闭；若显式启用 embedding 服务不可用，控制面仍保持 `bm25+hash-vector` 回退。
