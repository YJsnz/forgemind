# ForgeMind 语音/AI 控制模块 — 接入文档

> **实现更新（协议 1.0.0）：** 当前权威动作目录已迁移到 `contracts/forgemind-assistant-tools.json`，安全校验与执行说明见《ForgeMind-智能管家工具协议》。`ai-service` 已接入本地 Ollama `qwen2.5:7b`；本文 §4 的 `line_id:int`、单线调速和单机暂停是早期设计，尚无当前仿真内核支持，不应直接用于执行。

> 给集成方的完整接口契约。模块已具备：本地 LLM、语音识别（ASR）、BT-7274 语音合成（TTS）、中文→结构化控制意图的工具调用。集成方需要：把「意图→动作」接到仿真执行层，并在 ai-service 里编排。

## 0. 一句话架构

```
前端/调用方
  └─(HTTP)→ ai-service(端口8000, 待集成方实现编排)          ← 编排中枢
              ├─→ Ollama qwen2.5:7b (11434)  本地LLM，输出文本或结构化动作
              ├─→ BT-7274 TTS (8001)         Bert-VITS2，中文语音合成
              └─→ sherpa ASR (可复用 voice_chat.py 的 transcribe)
```

原则（§8.1 红线）：**LLM 只输出「动作 + 参数」，不直接改工厂**；执行前必须做合法性校验，产出数字以副本仿真回算为准。

---

## 1. 服务清单

| 服务 | 端口 | 启动 | 模型/依赖位置 | venv |
|---|---|---|---|---|
| Ollama (LLM) | 11434 | `start_voice_demo.bat` 或手动 | `OLLAMA_MODELS=D:\local\ollama\models` | 独立（Ollama 自带） |
| BT-7274 TTS | 8001 | `cd D:\local\bt7274-space && venv\Scripts\python bt_tts_server.py` | `D:\local\bt7274-space` | `D:\local\bt7274-space\venv` |
| ai-service (编排) | 8000 | 见 §5，待集成方实现 | `D:\Code\factory\ai-service` | 需自行建 venv（Python 3.10） |
| 语音助手(参考) | — | `cd D:\Code\factory\voice-chat && venv\Scripts\python voice_chat.py` | `D:\Code\factory\voice-chat` | `D:\Code\factory\voice-chat\venv` |

**一键启动**：`D:\Code\factory\voice-chat\start_voice_demo.bat`（自动起 Ollama + BT TTS + 语音助手）。

---

## 2. Ollama 接口（LLM，端口 11434）

基础信息：
- 模型：`qwen2.5:7b`（Q4_K_M，约 4.4GB，显存约 4.8GB，33 token/s）
- 同时兼容 OpenAI 格式：`POST /v1/chat/completions`（**支持 tools/function calling**）

### 2.1 流式聊天 `POST /api/chat`

请求：
```json
{
  "model": "qwen2.5:7b",
  "messages": [
    {"role": "system", "content": "你是机甲AI BT-7274…（见 §6 系统提示）"},
    {"role": "user", "content": "把3号产线速度调到80%"}
  ],
  "stream": true,
  "options": {"num_predict": 100}
}
```

响应（`stream:true` 时是 NDJSON，每行一个 JSON）：
```json
{"model":"qwen2.5:7b","message":{"role":"assistant","content":"收到，"},"done":false}
{"model":"qwen2.5:7b","message":{"role":"assistant","content":"已调到80%。"},"done":true}
```

### 2.2 工具调用（结构化动作）— 控制意图的关键

标准 OpenAI tools 格式，定义动作库 schema（§4）。模型会返回 `message.tool_calls`：
```json
{"message": {"role": "assistant", "tool_calls": [
  {"function": {"name": "control_factory", "arguments": "{\"action\":\"set_conveyor_speed\",\"line_id\":3,\"speed\":80}"}}
]}}
```

> ⚠️ 实测教训：复合指令下模型可能把 `action` 输出成嵌套 `{"type":...}`。**接收端必须做规范化 + 枚举校验**，不要盲信 schema 输出。

---

## 3. BT-7274 语音服务（TTS，端口 8001）

FastAPI，CPU 推理，模型常驻内存。

### 3.1 健康检查 `GET /health`
```json
{"status": "ok", "tts": "bt7274", "device": "cpu"}
```

### 3.2 合成 `POST /tts`

请求：
```json
{"text": "我是毕提七二七四，随时待命。", "length_scale": 1.0}
```
响应：`audio/wav`（44.1kHz 单声道 float32）。

内置处理：
- **英文→中文读音归一化**：`BT→毕提`、`AI→人工智能`、`AGV→自动导引车`、`OK→收到`、其余字母逐个转中文读音；数字由 cn2an 读成中文。**调用方可直接传含英文的原文。**
- `length_scale`：语速（<1 更快，默认 1.0）。

实测性能：CPU 合成约 **1.0s/句**。首次调用含 ~20s 模型加载（服务启动时完成，之后常驻）。

---

## 4. 控制层契约（集成方要实现的核心）

LLM 通过工具调用产出「控制意图」。定义如下动作库：

### 4.1 动作库（action enum）

| action | 参数 | 说明 |
|---|---|---|
| `set_conveyor_speed` | `line_id:int, speed:number(0-100)` | 调整产线/传送带速度 |
| `pause_machine` | `machine_id:int` | 暂停设备 |
| `resume_machine` | `machine_id:int` | 恢复设备 |
| `change_recipe` | `machine_id:int, recipe:string` | 切换配方 |
| `query_status` | `target?:string` | 查询状态（只读，无副作用） |

工具 schema（传给 Ollama 的 `tools` 字段）建议**扁平化**（扁平结构模型输出更准，见 §2.2 教训）。

### 4.2 工厂状态上下文

每次调用需把仿真当前状态序列化成 JSON 放进 `messages`（作为 user/system 上下文），LLM 才有依据：
```json
{
  "factory": {
    "objects": [{"id":"obj_1","type":"conveyor","pos":{"x":0,"z":0},"rotation":0}],
    "lines": [{"id":"line_3","speed":80,"status":"running"}],
    "machines": [{"id":"m_2","recipe":"冲压壳体","status":"running"}],
    "stats": {"throughput": 120, "backpressure": 0.02}
  }
}
```
> 真实结构对应 `src/game/save.ts` 的 `FactorySave`。集成方负责把前端/后端的真相源序列化成这个扁平结构。

### 4.3 校验 + 副本仿真（§8.1 红线，必须做）

执行动作前：
1. **枚举校验**：action 必须在 §4.1 枚举内。
2. **参数校验**：`speed ∈ [0,100]`；`line_id/machine_id` 必须存在（对照状态上下文）。
3. **副本仿真回算**（可选但推荐）：克隆状态、推进 N 帧，确认吞吐提升/无异常才真正执行；负增益则拒绝并回退。
4. **拒绝时**：给用户自然语言解释（如「3号产线不存在，当前只有 1、2 号」），用 BT 语音播报。

### 4.4 ai-service 编排接口（8000）

`ai-service/main.py` 目前是 stub（`POST /api/ai/assistant`，返回占位）。集成方实现为：

```
POST /api/ai/assistant
请求: {"question": "把3号产线速度调到80%", "context": {<工厂状态快照>}}
响应: {
  "answer": "收到，已调到80%。",          // 给用户的自然语言（可送 TTS）
  "source": "llm",
  "action": {"action":"set_conveyor_speed","line_id":3,"speed":80},  // 执行器要消费的动作
  "validated": true
}
```

可选扩展（语音入口）：
```
POST /api/ai/voice        // multipart 或 raw wav(16k mono) → 先 ASR 再走 /assistant
POST /api/ai/asr          // raw wav(16k float32 mono) → {"text": "..."}  // ASR 参考代码见 §7
```

---

## 5. ai-service 环境

- Python 必须 **3.10**（`py -3.10`，3.14 无 pydantic-core wheel）。
- 依赖：`fastapi uvicorn[standard] pydantic`，加 ASR 则 `sherpa-onnx soundfile numpy`，加 LLM 调用用标准库 `urllib` 即可。
- **国内网络必须用镜像**：
  ```bash
  pip install -i https://pypi.tuna.tsinghua.edu.cn/simple <包>
  ```
  torch CPU 用 `--index-url https://mirror.sjtu.edu.cn/pytorch-wheels/cpu`。
- **坑**：setuptools 必须 <81（`pip install "setuptools<81"`），否则 librosa 0.9.1 的 `pkg_resources` 崩。
- pip 缓存/临时目录建议指到 D 盘：`PIP_CACHE_DIR=D:\local\pip-cache TMPDIR=D:\local\pip-tmp`。

---

## 6. BT-7274 系统提示词（few-shot，直接可用）

`voice_chat.py` 的 `SYSTEM_PROMPT`（效果已验证）：

```
你是泰坦陨落2里的机甲AI BT-7274。说话必须像BT：沉稳、冷静、专业、极简，带一点机械式礼貌。
称呼用户为「驾驶员」。禁止「你好呀」「嗨」「哦」「呢」「啦」等活泼语气词，禁止寒暄客套。
每次回答不超过一句话（20字以内），直接说结论。

风格示例：
用户：你好
你：收到，驾驶员。需要什么帮助？
用户：今天辛苦了
你：收到，驾驶员。已记录你的付出。
用户：传送带好像卡住了
你：系统检测到传送带异常，建议排查。
用户：介绍一下你自己
你：我是BT七二七四，你的机甲AI，随时待命。
用户：把3号产线速度调到80%
你：收到，已调到80%。
```

> 控制场景建议再加一句：`当你需要执行动作时，调用 control_factory 工具返回结构化动作，并同时用一句话向驾驶员播报结果。`

---

## 7. 参考实现（可直接复用/迁移）

### 7.1 语音助手全链路 `D:\Code\factory\voice-chat\voice_chat.py`

核心函数：
- `transcribe(audio: np.ndarray[16k mono f32]) -> str` — ASR，sherpa-onnx Paraformer-zh，1s 音频约 0.16s。
- `ask_llm(messages) -> str` — 非流式聊天。
- `ask_llm_stream(messages, on_clause) -> str` — **流式 + 断句回调**（`。！？；，、\n` 切分），每出断句立即回调，用于边生成边 TTS 播放（开口时间从 ~1.8s 降到 ~1.2s）。
- `trim_history(messages, max_turns=6)` — 历史裁剪。
- `speak(text)` — 调 BT TTS（8001）播放，服务不可用回退本地 sherpa。
- 录音：`record_until_enter()`（按回车开始/结束，16k mono float32）。

### 7.2 BT TTS 服务 `D:\local\bt7274-space\bt_tts_server.py`
- `normalize_tts_text(text)` — 英文→中文归一化（§3.2）。
- 合成核心 `bt_tts.synth_array(text, **kw) -> (np.ndarray, 44100)`。

### 7.3 前端现有接入点 `D:\Code\factory\src\game\api.ts`
已有 `askAssistant(question, context)` 调 `http://localhost:8000/api/ai/assistant`（带 2.5s 超时）。集成方只需让 ai-service 的这个接口返回 §4.4 的契约即可，前端不用大改。

---

## 8. 前端仿真可控制对象（动作库的物理依据）

`src/game/types.ts` 的 `BuildType`：
`source | conveyor | splitter | merger | machine | smelter | press | assembler | inspection | washing | agv | storage`

实体 `FactoryObject { id, type, pos, rotation, recipeId?, itemId? }`。
机器类设备有 `recipeId`（可换配方）、`throughput`（可调速）、`status`（可暂停/恢复）。
传送带类有速度概念。动作库 §4.1 就是按这些可控制面设计的。

---

## 9. 集成自检清单（验收标准）

- [ ] ai-service `POST /api/ai/assistant` 返回 §4.4 契约，`action` 结构稳定
- [ ] 所有动作经过枚举/参数/存在性校验，非法输入被拒绝并给出自然语言解释
- [ ] 前端发"把3号产线速度调到80%" → 仿真里真实生效（或副本仿真回算通过后生效）
- [ ] BT TTS 能播报结果，英文缩写（BT/AGV）能读成中文
- [ ] 三个服务可被 `start_voice_demo.bat` 一键拉起
