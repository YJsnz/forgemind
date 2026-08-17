# ForgeMind AI 服务（FastAPI）

离线 AI / LLM 编排服务（补充设计 §5.1：只做离线，绝不进实时仿真链路）。

## 安装 & 运行

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## 接口

- `GET /api/ai/health` — 健康检查
- `GET /api/ai/tools` — ForgeMind 1.0.0 工具目录
- `POST /api/ai/assistant` — 本地千问助手入口，返回文本和可选结构化动作
- `POST /api/ai/assistant/stream` — Ollama NDJSON 流式文本 + 最终校验后的工具动作
- `POST /api/ai/asr` — 16-bit PCM WAV → 本地 Paraformer 中文文本
- `POST /api/ai/tts` — 文字 → 本地 WAV；默认使用预热后的 BT Bert-VITS2，失联时自动回退 sherpa VITS

```bash
curl -X POST http://localhost:8000/api/ai/assistant \
  -H "Content-Type: application/json" \
  -d '{"question": "怎么提高产量？", "context": {"simulation": {"running": true}}}'
```

默认连接 `http://127.0.0.1:11434` 的 `qwen2.5:7b`。可用环境变量覆盖：

```powershell
$env:FORGEMIND_OLLAMA_URL = 'http://127.0.0.1:11434'
$env:FORGEMIND_OLLAMA_MODEL = 'qwen2.5:7b'
$env:FORGEMIND_OLLAMA_TIMEOUT = '120'
$env:FORGEMIND_OLLAMA_KEEP_ALIVE = '30m'
$env:FORGEMIND_TTS_BACKEND = 'bt' # 默认保留 BT-7274 音色；可改为 sherpa 追求最低合成延迟
```

当 Ollama 不可用时，接口返回 `source: "fallback"`，不会阻塞前端，也不会伪造动作。模型生成的动作会先经过 ai-service 基础校验，再由前端 `assistantExecutor` 进行第二次白名单、对象和确认校验。

前端运行桥可以通过统一事件发起请求：

```js
window.dispatchEvent(new CustomEvent('forgemind:assistant-request', {
  detail: { question: '现在工厂运行情况怎么样？' }
}))
```

ai-service 启动后会在后台预加载千问、ASR，并用一条短语预热 BT TTS。前端一边读取 Ollama token，一边按标点切分并立即发起 TTS；后续短语的合成与当前短语播放并行。播放期间会派发 `forgemind:assistant-audio-level`，底部 `BT-7274` 字节码球旁的短声波会随真实音频能量变化。

网页底栏的“语音”按钮会直接录制单声道音频，并在浏览器内重采样为 16kHz WAV，再调用 `/api/ai/asr`。ASR 识别结果会复用 `/api/ai/assistant` 的工厂上下文、工具校验和 TTS 播报链路。

## 职责边界（§5.2）

- 与 Spring Boot 用**异步消息**（Redis Stream / Kafka）通信，本骨架先以 HTTP 占位。
- LLM 只做**动作库选型 + 结构化 schema 填参**，产出数字以副本仿真为准，不自由改工厂。
