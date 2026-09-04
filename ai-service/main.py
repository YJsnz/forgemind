"""
ForgeMind 可选智能服务（FastAPI）—— 规则助手、远程 LLM、语音和视觉网关。

职责边界（§5.2）：
- 绝不进实时仿真链路（AGV/产能/瓶颈在 Java 引擎侧）。
- 默认规则模式不依赖本地部署大模型；远程模型只能显式启用。
- 只暴露辅助入口：受限助手、需求约束提取、语音和视觉网关。
- 当前通过 HTTP 被前端调用；Redis Stream/Kafka 仅是未来多实例部署的异步通信方案。
"""
import base64
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

try:
    from .rag import knowledge_document, knowledge_documents, knowledge_inventory, retrieve_evidence
except ImportError:  # pragma: no cover - uvicorn main:app 运行方式
    from rag import knowledge_document, knowledge_documents, knowledge_inventory, retrieve_evidence

PROTOCOL_PATH = Path(__file__).resolve().parent.parent / "contracts" / "forgemind-assistant-tools.json"
with PROTOCOL_PATH.open("r", encoding="utf-8") as protocol_file:
    TOOL_CATALOG: dict[str, Any] = json.load(protocol_file)

PROTOCOL_VERSION = TOOL_CATALOG["protocolVersion"]
TOOL_NAMES = {tool["name"] for tool in TOOL_CATALOG["tools"]}
TOOL_BY_NAME = {tool["name"]: tool for tool in TOOL_CATALOG["tools"]}
LLM_PROVIDER = os.getenv("FORGEMIND_LLM_PROVIDER", "rule").lower()
if LLM_PROVIDER not in {"rule", "deepseek", "ollama"}:
    LLM_PROVIDER = "rule"
LLM_TIMEOUT_SEC = float(os.getenv("FORGEMIND_LLM_TIMEOUT", "45"))
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
OLLAMA_BASE_URL = os.getenv("FORGEMIND_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("FORGEMIND_OLLAMA_MODEL", "qwen2.5:7b")
VOICE_ENABLED = os.getenv("FORGEMIND_VOICE_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
TTS_BASE_URL = os.getenv("FORGEMIND_TTS_URL", "http://127.0.0.1:8001").rstrip("/")
TTS_TIMEOUT_SEC = float(os.getenv("FORGEMIND_TTS_TIMEOUT", "45"))
TTS_BACKEND = os.getenv("FORGEMIND_TTS_BACKEND", "bt").lower()
TTS_SID = int(os.getenv("FORGEMIND_TTS_SID", "1"))
TTS_MODEL_DIR = Path(os.getenv(
    "FORGEMIND_TTS_MODEL_DIR",
    str(PROTOCOL_PATH.parent.parent / "voice-chat" / "models" / "sherpa-onnx-vits-zh-ll"),
))
YOLO_MODEL_PATH = Path(os.getenv(
    "FORGEMIND_YOLO_MODEL",
    str(PROTOCOL_PATH.parent.parent / "ai-service" / "models" / "pcb_defect_yolov8s.pt"),
))
ASR_MODEL_DIR = Path(os.getenv(
    "FORGEMIND_ASR_MODEL_DIR",
    str(PROTOCOL_PATH.parent.parent / "voice-chat" / "models" / "sherpa-onnx-paraformer-zh-2023-09-14"),
))
_asr_recognizer: Any = None
_asr_lock = threading.Lock()
_fast_tts: Any = None
_fast_tts_lock = threading.Lock()
_voice_ready = False
_voice_error: str | None = None
_yolo_model: Any = None
_yolo_lock = threading.Lock()
_yolo_inference_lock = threading.Lock()

SYSTEM_PROMPT = """你是 ForgeMind 工厂的智能管家 BT-7274。
你称呼用户为“驾驶员”，语气沉稳、冷静、专业、简洁；对简短问候正常回应，不使用活泼语气词。
你只能依据提供的工厂上下文回答，不得编造设备、配方、产量或运行状态。
当用户要求查询或控制工厂时，使用工具调用；工具参数必须使用上下文中的真实字符串 ID，不要把自然语言编号当成 ID。
如果对象名称有歧义，先让驾驶员确认，不要猜测。控制动作只提出建议，ForgeMind 前端会在执行前再次校验并决定是否需要确认。
当用户要求解释、查看或汇总最近一帧视觉检测结果时，如果上下文中的 vision.status 为 ready，必须调用 inspect_vision_result；不要根据记忆猜测缺陷。如果用户要求打开视觉检测工作台，调用 open_panel(panelId="inspection").
当用户问“为什么提醒我”“这条提醒依据什么”时，从 proactiveEvents 中选择明确的 fingerprint 并调用 explain_reminder；当用户要求查看当前提醒时调用 list_active_reminders；当用户要求关闭同类提醒时调用 dismiss_reminder_group，不能直接声称已经关闭。
conversationSummary 只是早期对话的连续性摘要；其中的动态工厂数值、设备状态和库存不能当作事实，必须重新调用实时工具核对。
每轮最多选择一个工具；如果请求包含多个动作，先完成最关键的一步并在回答中说明下一步，等待新的实时结果。
普通回答不超过两句话；工具调用同时给出一句简短的中文播报。"""

@asynccontextmanager
async def lifespan(_: FastAPI):
    if VOICE_ENABLED:
        threading.Thread(target=preload_voice, name="forgemind-voice-preload", daemon=True).start()
    yield


app = FastAPI(title="ForgeMind AI Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AssistantRequest(BaseModel):
    """AI 助手请求：自然语言问题 + 可选的工厂统计数据上下文。"""
    question: str
    context: dict | None = None


class AssistantToolCall(BaseModel):
    """模型建议的动作。该结构仍须由 ForgeMind 执行层重新校验。"""

    model_config = ConfigDict(populate_by_name=True)

    protocol_version: Literal["1.0.0"] = Field(alias="protocolVersion")
    name: Literal[
        "query_factory_status",
        "inspect_object",
        "select_object",
        "set_simulation_running",
        "set_simulation_speed",
        "reset_simulation",
        "change_machine_recipe",
        "bind_source_item",
        "open_panel",
        "close_panel",
        "focus_panel",
        "select_floor",
        "locate_object",
        "compare_panels",
        "show_task",
        "inspect_vision_result",
        "open_product",
        "start_agent_task",
        "run_autopilot",
        "retry_agent_task",
        "cancel_agent_task",
        "list_agent_task_history",
        "list_active_reminders",
        "explain_reminder",
        "dismiss_reminder_group",
        "list_user_memory",
        "get_reminder_policy",
        "set_reminder_policy",
        "remember_user_preference",
        "forget_user_preference",
    ]
    arguments: dict[str, Any]


class AssistantReply(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    answer: str
    source: Literal["rule", "llm", "stub", "fallback"]
    note: str | None = None
    protocol_version: Literal["1.0.0"] = Field(default="1.0.0", alias="protocolVersion")
    action: AssistantToolCall | None = None
    validated: bool = False
    requires_confirmation: bool = Field(default=False, alias="requiresConfirmation")
    evidence: list[dict[str, str]] = Field(default_factory=list)


class FactorySpecRequest(BaseModel):
    """自然语言工厂需求；只负责提取约束，不让模型直接生成布局对象。"""

    brief: str
    defaults: dict[str, Any] = Field(default_factory=dict)


class FactorySpecReply(BaseModel):
    spec: dict[str, Any]
    source: Literal["deepseek", "ollama", "rule", "fallback"]
    note: str | None = None


@app.get("/api/ai/health")
def health() -> dict:
    ollama_status = probe_ollama() if LLM_PROVIDER == "ollama" else None
    return {
        "status": "ok",
        "service": "forgemind-ai",
        "protocolVersion": PROTOCOL_VERSION,
        "tools": len(TOOL_NAMES),
        "llm": {
            "provider": LLM_PROVIDER,
            "deepseekConfigured": bool(DEEPSEEK_API_KEY),
            "ollamaConfigured": LLM_PROVIDER == "ollama",
            "ollamaBaseUrl": OLLAMA_BASE_URL if LLM_PROVIDER == "ollama" else None,
            "ollamaModel": OLLAMA_MODEL if LLM_PROVIDER == "ollama" else None,
            "ollamaReady": ollama_status["ready"] if ollama_status else None,
            "ollamaProbeLatencyMs": ollama_status["latencyMs"] if ollama_status else None,
            "ollamaError": ollama_status["error"] if ollama_status else None,
            "localModelRequired": LLM_PROVIDER == "ollama",
        },
        "voiceEnabled": VOICE_ENABLED,
        "voiceReady": (not VOICE_ENABLED) or _voice_ready,
        "tts": {
            "backend": TTS_BACKEND,
            "model": str(TTS_MODEL_DIR) if TTS_BACKEND == "sherpa" else TTS_BASE_URL,
            "fallback": "sherpa" if TTS_BACKEND == "bt" else None,
        },
    }

@app.get("/api/ai/control-plane")
def control_plane() -> dict[str, Any]:
    """只返回 AI 控制面元数据，不返回提示词、文档正文或密钥。"""
    ollama_status = probe_ollama() if LLM_PROVIDER == "ollama" else None
    model_ready = LLM_PROVIDER == "rule" or (LLM_PROVIDER == "ollama" and bool(ollama_status and ollama_status["ready"])) or (LLM_PROVIDER == "deepseek" and bool(DEEPSEEK_API_KEY))
    return {
        "service": "forgemind-ai",
        "protocolVersion": PROTOCOL_VERSION,
        "provider": LLM_PROVIDER,
        "model": OLLAMA_MODEL if LLM_PROVIDER == "ollama" else (DEEPSEEK_MODEL if LLM_PROVIDER == "deepseek" else "rule-engine"),
        "modelStatus": "ready" if model_ready else "unavailable",
        "toolCount": len(TOOL_NAMES),
        "voice": {"enabled": VOICE_ENABLED, "ready": (not VOICE_ENABLED) or _voice_ready, "ttsBackend": TTS_BACKEND},
        "rag": knowledge_inventory(),
        "safety": {"deterministicFacts": True, "toolValidation": True, "patchApprovalRequired": True, "dynamicFactsPolicy": "tool-first"},
    }


@app.get("/api/ai/knowledge")
def built_in_knowledge() -> list[dict[str, Any]]:
    """列出可阅读的内置知识文档；正文通过单文档查询按需读取。"""
    return knowledge_documents()


@app.get("/api/ai/knowledge/content")
def built_in_knowledge_content(source: str) -> dict[str, Any]:
    document = knowledge_document(source)
    if document is None:
        raise HTTPException(status_code=404, detail="知识文档不存在")
    return document


@app.get("/api/ai/tools")
def tools() -> dict[str, Any]:
    """向前端和本地 LLM 编排器公开同一份版本化工具目录。"""
    return TOOL_CATALOG


@app.post("/api/ai/factory-spec", response_model=FactorySpecReply)
def factory_spec(req: FactorySpecRequest) -> FactorySpecReply:
    """把需求提取为受限 GenerationSpec；布局和仿真仍由前端确定性规划器负责。"""
    brief = req.brief.strip()
    defaults = normalize_factory_spec(req.defaults)
    if not brief:
        return FactorySpecReply(spec=defaults, source="rule", note="需求为空，使用表单约束。")

    if LLM_PROVIDER == "ollama":
        try:
            raw = ollama_factory_spec(brief, defaults)
            return FactorySpecReply(spec=normalize_factory_spec(raw, defaults), source="ollama", note="本地 Qwen 已完成受限约束提取。")
        except Exception as exc:  # noqa: BLE001
            return FactorySpecReply(spec=defaults, source="fallback", note=f"本地 Qwen 不可用，使用规则约束：{exc}")
    if LLM_PROVIDER != "deepseek":
        return FactorySpecReply(spec=defaults, source="rule", note="规则模式：使用前端已提取并校验的约束。")
    if not DEEPSEEK_API_KEY:
        return FactorySpecReply(spec=defaults, source="fallback", note="未配置 DeepSeek API Key，使用规则约束。")
    try:
        raw = deepseek_factory_spec(brief, defaults)
        return FactorySpecReply(spec=normalize_factory_spec(raw, defaults), source="deepseek", note="DeepSeek 已完成受限约束提取。")
    except Exception as exc:  # noqa: BLE001
        return FactorySpecReply(spec=defaults, source="fallback", note=f"远程模型不可用，使用规则约束：{exc}")


class AsrReply(BaseModel):
    text: str
    sampleRate: int = 16000


class TtsRequest(BaseModel):
    text: str
    length_scale: float = 1.0


@app.post("/api/ai/asr", response_model=AsrReply)
async def asr(request: Request) -> AsrReply:
    """接收浏览器录制的 PCM WAV，使用本地 Paraformer 返回中文文本。"""
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="音频为空")
    try:
        text = transcribe_wav(audio)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ValueError, wave.Error) as exc:
        raise HTTPException(status_code=400, detail=f"WAV 音频无效：{exc}") from exc
    return AsrReply(text=text, sampleRate=16000)


@app.post("/api/ai/tts")
def tts(req: TtsRequest) -> Response:
    """低延迟本地 TTS；默认保留 BT 音色，失联时回退 sherpa VITS。"""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="播报文本为空")
    if TTS_BACKEND == "sherpa":
        try:
            return Response(content=synthesize_fast_tts(text, req.length_scale), media_type="audio/wav")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"本地快速 TTS 失败：{exc}") from exc

    try:
        return proxy_bt_tts(text, req.length_scale)
    except HTTPException:
        try:
            return Response(content=synthesize_fast_tts(text, req.length_scale), media_type="audio/wav")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"BT 与备用 TTS 均不可用：{exc}") from exc


def proxy_bt_tts(text: str, length_scale: float) -> Response:
    payload = json.dumps(
        {"text": text, "length_scale": length_scale},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{TTS_BASE_URL}/tts",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TTS_TIMEOUT_SEC) as upstream:
            audio = upstream.read()
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"BT TTS 返回 {exc.code}") from exc
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="BT TTS 服务未连接") from exc
    return Response(content=audio, media_type="audio/wav")


def preload_bt_tts() -> None:
    """触发 Bert-VITS2 首次推理初始化，避免第一句额外等待数秒。"""
    try:
        proxy_bt_tts("系统就绪。", 1.0)
    except Exception:
        # 8001 未启动时先准备快速本地兜底。
        preload_fast_tts()


def preload_fast_tts() -> None:
    try:
        get_fast_tts()
        # 第一次推理会初始化内部执行计划，启动阶段先完成这一步。
        synthesize_fast_tts("系统就绪。", 1.0)
    except Exception:
        return


def get_fast_tts():
    global _fast_tts
    if _fast_tts is not None:
        return _fast_tts
    with _fast_tts_lock:
        if _fast_tts is not None:
            return _fast_tts
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(TTS_MODEL_DIR / "model.onnx"),
                    tokens=str(TTS_MODEL_DIR / "tokens.txt"),
                    lexicon=str(TTS_MODEL_DIR / "lexicon.txt"),
                    dict_dir=str(TTS_MODEL_DIR / "dict"),
                    data_dir=str(TTS_MODEL_DIR),
                ),
                num_threads=4,
            ),
            rule_fsts=f"{TTS_MODEL_DIR / 'date.fst'},{TTS_MODEL_DIR / 'number.fst'}",
        )
        _fast_tts = sherpa_onnx.OfflineTts(config)
        return _fast_tts


def synthesize_fast_tts(text: str, length_scale: float) -> bytes:
    import numpy as np

    engine = get_fast_tts()
    speed = max(0.7, min(1.4, 1.0 / max(0.7, min(1.4, length_scale))))
    with _fast_tts_lock:
        audio = engine.generate(text, sid=TTS_SID, speed=speed)
    samples = np.asarray(audio.samples, dtype=np.float32)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(audio.sample_rate)
        wav.writeframes(pcm)
    return output.getvalue()


def preload_voice() -> None:
    """Load ASR and complete one TTS synthesis before startup reports ready."""
    global _voice_ready, _voice_error
    try:
        get_asr_recognizer()
        if TTS_BACKEND == "sherpa":
            synthesize_fast_tts("系统就绪。", 1.0)
        else:
            try:
                proxy_bt_tts("系统就绪。", 1.0)
            except Exception:
                synthesize_fast_tts("系统就绪。", 1.0)
        _voice_ready = True
    except Exception as exc:  # noqa: BLE001
        _voice_error = str(exc)


@app.post("/api/ai/assistant", response_model=AssistantReply)
def assistant(req: AssistantRequest) -> AssistantReply:
    """使用规则助手或显式配置的远程模型生成 ForgeMind 1.0.0 动作信封。"""
    question = req.question.strip()
    if not question:
        return fallback_reply("驾驶员，请告诉我需要检查或调整什么。", "问题不能为空。")
    return create_assistant_reply(question, req.context or {})


@app.post("/api/ai/assistant/stream")
def assistant_stream(req: AssistantRequest) -> StreamingResponse:
    """返回前端可消费的 NDJSON；工具动作只在最终校验后发出。"""
    question = req.question.strip()
    if not question:
        reply = fallback_reply("驾驶员，请告诉我需要检查或调整什么。", "问题不能为空。")
        return StreamingResponse(
            iter([stream_event("done", reply=reply.model_dump(by_alias=True))]),
            media_type="application/x-ndjson",
        )
    return StreamingResponse(
        iter_assistant_events(question, req.context or {}),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


FACTORY_SPEC_PROMPT = """你是 ForgeMind 的工厂需求解析器。
只从用户需求中提取生产约束，不设计机器、不生成布局、不解释过程。
必须只返回 JSON 对象，字段只能是：product、targetThroughputPerHour、floorWidth、floorDepth、cncLimit、agvLimit、objective。
objective 只能是 balanced、throughput、energy；缺失字段沿用默认值。
"""


def deepseek_factory_spec(brief: str, defaults: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": FACTORY_SPEC_PROMPT},
            {"role": "user", "content": json.dumps({"defaults": defaults, "brief": brief}, ensure_ascii=False)},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.05,
        "max_tokens": 160,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_TIMEOUT_SEC) as response:
        result = json.loads(response.read().decode("utf-8"))
    choices = result.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("DeepSeek 需求解析缺少 choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("DeepSeek 需求解析缺少 message")
    return parse_json_object(message.get("content"))


def ollama_factory_spec(brief: str, defaults: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": FACTORY_SPEC_PROMPT},
            {"role": "user", "content": json.dumps({"defaults": defaults, "brief": brief}, ensure_ascii=False)},
        ],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.05, "num_predict": 160},
    }

    result = ollama_json("/api/chat", payload)
    message = result.get("message")
    if not isinstance(message, dict):
        raise ValueError("Ollama 需求解析缺少 message")
    return parse_json_object(message.get("content"))


def parse_json_object(content: Any) -> dict[str, Any]:
    if not isinstance(content, str):
        raise ValueError("模型没有返回 JSON 文本")
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").replace("json", "", 1).strip()
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("需求解析结果不是对象")
    return value


def normalize_factory_spec(value: dict[str, Any] | None, defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    source = {**(defaults or {
        "product": "齿轮箱",
        "targetThroughputPerHour": 120,
        "floorWidth": 30,
        "floorDepth": 20,
        "cncLimit": 4,
        "agvLimit": 3,
        "objective": "energy",
    }), **(value or {})}
    objective = source.get("objective") if source.get("objective") in {"balanced", "throughput", "energy"} else "energy"
    return {
        "product": str(source.get("product") or "齿轮箱")[:80],
        "targetThroughputPerHour": clamp_number(source.get("targetThroughputPerHour"), 120, 1, 100000),
        "floorWidth": clamp_number(source.get("floorWidth"), 30, 10, 200),
        "floorDepth": clamp_number(source.get("floorDepth"), 20, 10, 200),
        "cncLimit": int(clamp_number(source.get("cncLimit"), 4, 1, 32)),
        "agvLimit": int(clamp_number(source.get("agvLimit"), 3, 1, 32)),
        "objective": objective,
    }


def clamp_number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return max(minimum, min(maximum, number))


def create_assistant_reply(question: str, context: dict[str, Any]) -> AssistantReply:
    evidence = retrieve_evidence(question, context)
    if LLM_PROVIDER == "ollama":
        try:
            message = ollama_assistant_message(question, context)
            return assistant_reply_from_message(message, context, note="本地 Qwen2.5:7b 回复", evidence=evidence, question=question)
        except Exception as exc:  # noqa: BLE001
            return rule_assistant_reply(question, context, f"本地 Qwen 不可用，已切换规则助手：{exc}", evidence=evidence)
    if LLM_PROVIDER == "deepseek" and DEEPSEEK_API_KEY:
        try:
            message = deepseek_assistant_message(question, context)
            return assistant_reply_from_message(message, context, evidence=evidence, question=question)
        except Exception as exc:  # noqa: BLE001
            return rule_assistant_reply(question, context, f"远程模型不可用，已切换规则助手：{exc}", evidence=evidence)
    return rule_assistant_reply(question, context, "规则助手不需要本地大语言模型。", evidence=evidence)


def deepseek_assistant_message(question: str, context: dict[str, Any]) -> dict[str, Any]:
    context_text = model_user_message(question, context)
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": context_text},
        ],
        "tools": llm_tools(),
        "tool_choice": "auto",
        "stream": False,
        "temperature": 0.15,
        "max_tokens": 240,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_TIMEOUT_SEC) as response:
        result = json.loads(response.read().decode("utf-8"))
    choices = result.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("DeepSeek 助手响应缺少 choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("DeepSeek 助手响应缺少 message")
    return message


def ollama_json(endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}{endpoint}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_TIMEOUT_SEC) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise ValueError("Ollama 返回格式无效")
    return result


def probe_ollama() -> dict[str, Any]:
    started = time.perf_counter()
    try:
        request = urllib.request.Request(f"{OLLAMA_BASE_URL}/api/tags", method="GET")
        with urllib.request.urlopen(request, timeout=min(3.0, LLM_TIMEOUT_SEC)) as response:
            result = json.loads(response.read().decode("utf-8"))
        models = result.get("models", []) if isinstance(result, dict) else []
        names = {item.get("name") for item in models if isinstance(item, dict)}
        ready = OLLAMA_MODEL in names or any(isinstance(name, str) and name.split(":", 1)[0] == OLLAMA_MODEL for name in names)
        return {
            "ready": ready,
            "latencyMs": round((time.perf_counter() - started) * 1000, 1),
            "error": None if ready else f"未找到模型 {OLLAMA_MODEL}",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ready": False,
            "latencyMs": round((time.perf_counter() - started) * 1000, 1),
            "error": str(exc)[:180],
        }


def model_user_message(question: str, context: dict[str, Any]) -> str:
    compact = compact_model_context(context)
    compact["ragEvidence"] = retrieve_evidence(question, context)
    return (
        "工厂实时上下文与检索依据如下。检索依据只能用于解释产品和系统规则，实时状态必须以工厂上下文和工具结果为准。\n"
        f"{json.dumps(compact, ensure_ascii=False, separators=(',', ':'))}\n\n"
        f"驾驶员请求：{question}"
    )


def ollama_assistant_message(question: str, context: dict[str, Any]) -> dict[str, Any]:
    messages = ollama_messages(question, context)
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "tools": llm_tools(),
        "stream": False,
        "options": {"temperature": 0.15, "num_predict": 240},
    }
    result = ollama_json("/api/chat", payload)
    message = result.get("message")
    if not isinstance(message, dict):
        raise ValueError("Ollama 助手响应缺少 message")
    return message


def ollama_messages(question: str, context: dict[str, Any]) -> list[dict[str, str]]:
    history = context.get("conversation", [])
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if isinstance(history, list):
        for turn in history[-8:]:
            if not isinstance(turn, dict) or turn.get("role") not in {"user", "assistant"}:
                continue
            content = turn.get("content")
            if isinstance(content, str) and content.strip():
                messages.append({"role": turn["role"], "content": content.strip()[:700]})
    messages.append({"role": "user", "content": model_user_message(question, context)})
    return messages


def assistant_reply_from_message(message: dict[str, Any], context: dict[str, Any], note: str = "远程模型文本回复", evidence: list[dict[str, Any]] | None = None, question: str = "") -> AssistantReply:
    # Deterministic IntentRouter repairs are applied before accepting a model
    # tool call for unambiguous high-frequency intents. This keeps a small
    # local model from turning an explicit panel request into an unrelated
    # write action; the normal validator still remains the final gate.
    action = repair_common_action(question, context) or parse_tool_call(message.get("tool_calls"))
    if action is None:
        return AssistantReply(
            answer=clean_answer(message.get("content", "")) or "收到，驾驶员。当前没有需要执行的动作。",
            source="llm",
            note=note,
            protocolVersion=PROTOCOL_VERSION,
            action=None,
            validated=False,
            requiresConfirmation=False,
            evidence=normalize_evidence(evidence),
        )
    valid, validation_note = validate_action(action, context)
    definition = TOOL_BY_NAME[action.name]
    return AssistantReply(
        answer=clean_answer(message.get("content", "")) or action_ack(action),
        source="llm",
        note=validation_note if not valid else f"{note}；动作已通过服务端基础校验，前端执行层仍须再次校验。",
        protocolVersion=PROTOCOL_VERSION,
        action=action,
        validated=valid,
        requiresConfirmation=bool(definition.get("requiresConfirmation", False)),
        evidence=normalize_evidence(evidence),
    )


def repair_common_action(content: Any, context: dict[str, Any]) -> AssistantToolCall | None:
    """Repair only unambiguous high-frequency intents when a local 7B model returns prose without a tool call.

    This is an IntentRouter guardrail, not a second model: it never infers objects,
    quantities or layout facts, and every repaired action still passes validate_action.
    """
    if not isinstance(content, str):
        return None
    normalized = "".join(content.lower().split())
    if any(word in normalized for word in ("视觉检测结果", "最近一帧检测", "最近视觉结果", "缺陷检测结果")):
        vision = context.get("vision")
        if isinstance(vision, dict) and vision.get("status") == "ready":
            return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="inspect_vision_result", arguments={})
    task_match = re.search(r"(?:task[-_])[a-z0-9-]+", normalized, re.IGNORECASE)
    if task_match and any(word in normalized for word in ("任务", "步骤", "结果")):
        task_id = task_match.group(0)
        task_ids = {
            item.get("taskId")
            for key in ("taskHistory", "serverTaskHistory")
            for item in (context.get(key) if isinstance(context.get(key), list) else [])
            if isinstance(item, dict) and isinstance(item.get("taskId"), str)
        }
        if task_id in task_ids:
            return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="show_task", arguments={"taskId": task_id})
    reminder_events = [
        item for item in (context.get("proactiveEvents") if isinstance(context.get("proactiveEvents"), list) else [])
        if isinstance(item, dict) and item.get("status") == "open" and isinstance(item.get("fingerprint"), str)
    ]
    if any(word in normalized for word in ("当前提醒", "有哪些提醒", "查看提醒", "主动提醒列表")):
        return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="list_active_reminders", arguments={})
    if any(word in normalized for word in ("为什么提醒我", "提醒依据", "提醒原因", "这条提醒为什么")) and len(reminder_events) == 1:
        return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="explain_reminder", arguments={"dedupeKey": reminder_events[0]["fingerprint"]})
    if any(word in normalized for word in ("关闭同类提醒", "关闭这个提醒", "别再提醒")) and len(reminder_events) == 1:
        return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="dismiss_reminder_group", arguments={"dedupeKey": reminder_events[0]["fingerprint"]})
    product_aliases = {
        "forgemind": "forgemind",
        "forgehub": "forgehub",
        "forgelab": "forgelab",
        "forgecloud": "forgecloud",
    }
    if any(word in normalized for word in ("打开", "进入", "查看")):
        for alias, product_id in product_aliases.items():
            if alias in normalized:
                return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="open_product", arguments={"productId": product_id})
    if "记住我" in normalized and "优先看产能" in normalized:
        return AssistantToolCall(
            protocolVersion=PROTOCOL_VERSION,
            name="remember_user_preference",
            arguments={"key": "response_style", "value": "优先关注产能，不先看装饰信息"},
        )
    if any(word in normalized for word in ("比较", "对比", "并排")):
        panel_aliases = {
            "工厂总览": "factory-overview",
            "总览": "factory-overview",
            "仿真": "simulation",
            "对象详情": "object-detail",
            "设备详情": "object-detail",
            "生产": "production",
            "物流": "logistics",
            "仓储": "warehouse",
            "agent诊断": "agent-diagnosis",
            "诊断": "agent-diagnosis",
            "生成式工厂": "generative-planner",
            "视觉检测": "inspection",
            "云端运行": "cloud-runtime",
            "活动历史": "activity-history",
        }
        found: list[str] = []
        for alias, panel_id in sorted(panel_aliases.items(), key=lambda item: len(item[0]), reverse=True):
            if alias in normalized and panel_id not in found:
                found.append(panel_id)
        if len(found) >= 2:
            return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="compare_panels", arguments={"leftPanelId": found[0], "rightPanelId": found[1]})
    if any(word in normalized for word in ("查询工厂状态", "查看工厂状态", "工厂运行情况", "当前工厂状态")):
        return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="query_factory_status", arguments={})
    return None


def rule_assistant_reply(question: str, context: dict[str, Any], note: str, evidence: list[dict[str, Any]] | None = None) -> AssistantReply:
    normalized = "".join(question.lower().split())
    action: AssistantToolCall | None = None
    if any(word in normalized for word in ("重置仿真", "重新开始", "清空进度")):
        action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="reset_simulation", arguments={})
    else:
        speed_match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(?:倍|x)", normalized)
        if speed_match and any(word in normalized for word in ("倍率", "倍速", "速度", "调到", "设置")):
            action = AssistantToolCall(
                protocolVersion=PROTOCOL_VERSION,
                name="set_simulation_speed",
                arguments={"speed": float(speed_match.group(1))},
            )
        elif any(word in normalized for word in ("暂停仿真", "停止仿真", "暂停生产")):
            action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="set_simulation_running", arguments={"running": False})
        elif any(word in normalized for word in ("启动仿真", "开始仿真", "开始生产", "继续仿真")):
            action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="set_simulation_running", arguments={"running": True})
        elif any(word in normalized for word in ("工厂状态", "运行情况", "生产情况", "累计产出", "在途物料")):
            action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="query_factory_status", arguments={})

    if action is None:
        return AssistantReply(
            answer="规则助手已就绪。可查询工厂状态、启动或暂停仿真、调整倍率，也可发起仿真重置确认。",
            source="rule",
            note=note,
            protocolVersion=PROTOCOL_VERSION,
            action=None,
            validated=False,
            requiresConfirmation=False,
            evidence=normalize_evidence(evidence),
        )

    valid, validation_note = validate_action(action, context)
    definition = TOOL_BY_NAME[action.name]
    return AssistantReply(
        answer=action_ack(action),
        source="rule",
        note=validation_note if not valid else note,
        protocolVersion=PROTOCOL_VERSION,
        action=action,
        validated=valid,
        requiresConfirmation=bool(definition.get("requiresConfirmation", False)),
        evidence=normalize_evidence(evidence),
    )


def iter_assistant_events(question: str, context: dict[str, Any]):
    if LLM_PROVIDER == "ollama":
        try:
            yield from iter_ollama_assistant_events(question, context)
        except Exception as exc:  # noqa: BLE001
            reply = rule_assistant_reply(question, context, f"本地 Qwen 不可用，已切换规则助手：{exc}", evidence=retrieve_evidence(question, context))
            if reply.answer:
                yield stream_event("delta", text=reply.answer)
            yield stream_event("done", reply=reply.model_dump(by_alias=True))
        return
    try:
        reply = create_assistant_reply(question, context)
        if reply.answer:
            yield stream_event("delta", text=reply.answer)
        yield stream_event("done", reply=reply.model_dump(by_alias=True))
    except Exception as exc:  # noqa: BLE001
        yield stream_event("error", message=f"智能助手调用失败：{exc}")


def iter_ollama_assistant_events(question: str, context: dict[str, Any]):
    payload = {
        "model": OLLAMA_MODEL,
        "messages": ollama_messages(question, context),
        "tools": llm_tools(),
        "stream": True,
        "options": {"temperature": 0.15, "num_predict": 240},
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    content_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    with urllib.request.urlopen(request, timeout=LLM_TIMEOUT_SEC) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8").strip()
            if not line:
                continue
            chunk = json.loads(line)
            message = chunk.get("message") if isinstance(chunk, dict) else None
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content:
                    content_parts.append(content)
                    yield stream_event("delta", text=content)
                calls = message.get("tool_calls")
                if isinstance(calls, list):
                    tool_calls.extend(call for call in calls if isinstance(call, dict))
            if isinstance(chunk, dict) and chunk.get("done"):
                break
    reply = assistant_reply_from_message(
        {"content": "".join(content_parts), "tool_calls": tool_calls},
        context,
        note="本地 Qwen2.5:7b 流式回复",
        evidence=retrieve_evidence(question, context),
        question=question,
    )
    yield stream_event("done", reply=reply.model_dump(by_alias=True))


def compact_model_context(context: dict[str, Any]) -> dict[str, Any]:
    """只给模型决策所需字段；完整上下文仍保留在服务端用于动作校验。"""
    objects = context.get("objects", [])
    items = context.get("items", [])
    recipes = context.get("recipes", [])
    ui = context.get("ui", {})
    task = context.get("task")
    project_memory = context.get("projectMemory")
    user_memory = context.get("userMemory")
    memory_items = user_memory.items() if isinstance(user_memory, dict) else ()
    return {
        "protocolVersion": context.get("protocolVersion", PROTOCOL_VERSION),
        "simulation": context.get("simulation", {}),
        "conversationSummary": str(context.get("conversationSummary", ""))[:1600],
        "ui": {
            key: ui.get(key)
            for key in ("route", "view", "panel", "floorId", "selectedObjectId", "selectedObjectLabel", "projectId", "projectName", "projectVersion")
            if isinstance(ui, dict) and key in ui
        },
        "task": {
            key: task.get(key)
            for key in ("kind", "status", "objective", "mode", "message", "resultSummary", "progress", "activeStepId", "steps", "updatedAt")
            if isinstance(task, dict) and key in task
        },
        "taskHistory": [
            {
                key: item.get(key)
                for key in ("taskId", "kind", "status", "objective", "mode", "message", "resultSummary", "progress", "activeStepId", "steps", "updatedAt")
                if key in item
            }
            for item in (context.get("taskHistory") if isinstance(context.get("taskHistory"), list) else [])[:6]
            if isinstance(item, dict)
        ],
        "serverTaskHistory": [
            {
                key: item.get(key)
                for key in ("taskId", "objective", "mode", "status", "summary", "updatedAt")
                if key in item
            }
            for item in (context.get("serverTaskHistory") if isinstance(context.get("serverTaskHistory"), list) else [])[:8]
            if isinstance(item, dict)
        ],
        "proactiveEvents": [
            {
                key: item.get(key)
                for key in ("fingerprint", "source", "severity", "message", "sources", "count", "firstObservedAt", "lastObservedAt", "status")
                if key in item
            }
            for item in (context.get("proactiveEvents") if isinstance(context.get("proactiveEvents"), list) else [])[:12]
            if isinstance(item, dict) and item.get("status") == "open"
        ],
        "vision": {
            "source": vision.get("source"),
            "partId": vision.get("partId"),
            "status": vision.get("status"),
            "verdict": vision.get("verdict"),
            "confidence": vision.get("confidence"),
            "inferenceMs": vision.get("inferenceMs"),
            "capturedAt": vision.get("capturedAt"),
            "detections": [
                {
                    key: detection.get(key)
                    for key in ("className", "confidence", "x1", "y1", "x2", "y2")
                    if key in detection
                }
                for detection in vision.get("detections", [])[:32]
                if isinstance(detection, dict)
            ],
        } if isinstance(vision := context.get("vision"), dict) else None,
        "projectMemory": {
            "projectId": project_memory.get("projectId"),
            "projectName": project_memory.get("projectName"),
            "updatedAt": project_memory.get("updatedAt"),
            "versions": [
                {
                    key: version.get(key)
                    for key in ("version", "observedAt", "label")
                    if key in version
                }
                for version in project_memory.get("versions", [])[:12]
                if isinstance(version, dict)
            ],
            "runs": [
                {
                    key: run.get(key)
                    for key in ("runId", "createdAt", "mode", "headline", "summary", "findings")
                    if key in run
                }
                for run in project_memory.get("runs", [])[:6]
                if isinstance(run, dict)
            ],
        } if isinstance(project_memory, dict) else None,
        "userMemory": {
            str(key)[:80]: str(value)[:400]
            for key, value in memory_items
            if isinstance(value, str)
        },
        "objects": [
            {
                key: item.get(key)
                for key in ("id", "label", "role", "recipeId", "itemId", "runtime")
                if key in item
            }
            for item in objects
            if isinstance(item, dict)
        ],
        "items": [
            {key: item.get(key) for key in ("id", "name", "category") if key in item}
            for item in items
            if isinstance(item, dict)
        ],
        "recipes": [
            {key: item.get(key) for key in ("id", "name", "durationSec") if key in item}
            for item in recipes
            if isinstance(item, dict)
        ],
    }


def stream_event(event_type: str, **payload: Any) -> bytes:
    return (json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n").encode("utf-8")


def llm_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["parameters"],
            },
        }
        for tool in TOOL_CATALOG["tools"]
    ]


def parse_tool_call(raw_calls: Any) -> AssistantToolCall | None:
    if not isinstance(raw_calls, list) or not raw_calls:
        return None
    raw = raw_calls[0]
    if not isinstance(raw, dict):
        return None
    function = raw.get("function") if isinstance(raw.get("function"), dict) else raw
    name = function.get("name")
    arguments = function.get("arguments", {})
    if not isinstance(name, str) or name not in TOOL_NAMES:
        return None
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            return None
    if not isinstance(arguments, dict):
        return None
    return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name=name, arguments=arguments)


def validate_action(action: AssistantToolCall, context: dict[str, Any]) -> tuple[bool, str]:
    args = action.arguments
    definition = TOOL_BY_NAME[action.name]
    properties = definition["parameters"].get("properties", {})
    if set(args) != set(properties):
        return False, "动作参数字段与协议不一致，前端将拒绝执行。"
    if action.name in {"query_factory_status", "reset_simulation", "run_autopilot", "retry_agent_task", "cancel_agent_task", "list_agent_task_history", "list_active_reminders", "list_user_memory", "get_reminder_policy", "compare_panels"}:
        return True, ""
    if action.name in {"explain_reminder", "dismiss_reminder_group"}:
        key = args.get("dedupeKey")
        events = context.get("proactiveEvents") if isinstance(context.get("proactiveEvents"), list) else []
        valid = isinstance(key, str) and bool(key.strip()) and len(key) <= 180 and any(
            isinstance(item, dict) and item.get("fingerprint") == key and item.get("status") == "open"
            for item in events
        )
        return valid, "提醒不存在或不属于当前用户，前端将拒绝执行。" if not valid else ""
    if action.name == "inspect_vision_result":
        vision = context.get("vision")
        valid = isinstance(vision, dict) and vision.get("status") == "ready"
        return valid, "当前没有可供解释的有效视觉检测结果，前端将拒绝执行。" if not valid else ""
    if action.name == "show_task":
        task_id = args.get("taskId")
        task_ids = {
            item.get("taskId")
            for key in ("taskHistory", "serverTaskHistory")
            for item in (context.get(key) if isinstance(context.get(key), list) else [])
            if isinstance(item, dict) and isinstance(item.get("taskId"), str)
        }
        valid = isinstance(task_id, str) and bool(task_id.strip()) and len(task_id) <= 120 and task_id in task_ids
        return valid, "任务不存在或不属于当前用户，前端将拒绝执行。" if not valid else ""
    if action.name == "open_product":
        valid = args.get("productId") in {"forgemind", "forgehub", "forgelab", "forgecloud"}
        return valid, "产品入口不在生态白名单中，前端将拒绝执行。" if not valid else ""
    if action.name == "remember_user_preference":
        key = args.get("key")
        value = args.get("value")
        live_fact = re.search(r"(库存|产量|产出|坐标|位置|仿真|在途|吞吐|利用率|inventory|output|coordinate|simulation|throughput)", f"{key or ''} {value or ''}", re.IGNORECASE)
        valid = isinstance(key, str) and bool(key.strip()) and len(key) <= 80 and isinstance(value, str) and bool(value.strip()) and len(value) <= 400 and live_fact is None
        return valid, "实时库存、产量、坐标和仿真事实不能写入长期记忆。" if live_fact else "用户偏好参数无效，前端将拒绝执行。" if not valid else ""
    if action.name == "forget_user_preference":
        key = args.get("key")
        valid = isinstance(key, str) and bool(key.strip()) and len(key) <= 80
        return valid, "要删除的用户偏好键无效，前端将拒绝执行。" if not valid else ""
    if action.name == "set_reminder_policy":
        valid = (
            isinstance(args.get("enabled"), bool)
            and args.get("minSeverity") in {"info", "warning", "critical"}
            and isinstance(args.get("cooldownMinutes"), int)
            and 1 <= args.get("cooldownMinutes") <= 1440
            and all(value is None or (isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)) for value in (args.get("quietStart"), args.get("quietEnd")))
        )
        return valid, "主动提醒策略无效，前端将拒绝执行。" if not valid else ""
    if action.name == "start_agent_task":
        objective = args.get("objective")
        mode = args.get("mode")
        valid = isinstance(objective, str) and bool(objective.strip()) and len(objective) <= 2000 and mode in {"diagnose", "plan_design"}
        return valid, "Agent 任务参数无效，前端将拒绝执行。" if not valid else ""
    if action.name == "set_simulation_running":
        return isinstance(args.get("running"), bool), "running 必须是布尔值。"
    if action.name == "set_simulation_speed":
        speed = args.get("speed")
        return isinstance(speed, (int, float)) and 0.1 <= speed <= 4, "speed 必须在 0.1 到 4 之间。"
    objects = context.get("objects", [])
    object_id = args.get("objectId")
    obj = next((item for item in objects if isinstance(item, dict) and item.get("id") == object_id), None)
    if action.name in {"open_panel", "close_panel", "focus_panel"}:
        panel_id = args.get("panelId")
        valid = isinstance(panel_id, str) and any(
            panel_id in tool.get("parameters", {}).get("properties", {}).get("panelId", {}).get("enum", [])
            for tool in TOOL_CATALOG["tools"]
        )
        return valid, "面板不在注册白名单中，前端将拒绝执行。" if not valid else ""
    if action.name == "select_floor":
        floor_id = args.get("floorId")
        floor_count = context.get("floorCount", 1)
        valid = isinstance(floor_id, int) and not isinstance(floor_id, bool) and 1 <= floor_id <= floor_count
        return valid, "楼层不存在，前端将拒绝执行。" if not valid else ""
    if action.name in {"inspect_object", "select_object", "locate_object"}:
        return (obj is not None, "对象不存在，前端将拒绝执行。" if obj is None else "")
    if obj is None:
        return False, "对象不存在，前端将拒绝执行。"
    if action.name == "change_machine_recipe":
        if obj.get("role") != "machine":
            return False, "对象不是加工设备，前端将拒绝执行。"
        recipe_id = args.get("recipeId")
        recipes = context.get("recipes", [])
        valid = recipe_id is None or any(isinstance(item, dict) and item.get("id") == recipe_id for item in recipes)
        return valid, "配方不存在，前端将拒绝执行。" if not valid else ""
    if action.name == "bind_source_item":
        if obj.get("role") != "source":
            return False, "对象不是来料站，前端将拒绝执行。"
        item_id = args.get("itemId")
        items = context.get("items", [])
        valid = item_id is None or any(isinstance(item, dict) and item.get("id") == item_id for item in items)
        return valid, "物品不存在，前端将拒绝执行。" if not valid else ""
    return True, ""


def action_ack(action: AssistantToolCall) -> str:
    return {
        "query_factory_status": "正在读取工厂状态。",
        "inspect_object": "正在读取设备状态。",
        "select_object": "正在定位目标设备。",
        "set_simulation_running": "正在调整仿真运行状态。",
        "set_simulation_speed": "正在调整仿真倍率。",
        "reset_simulation": "仿真重置需要驾驶员确认。",
        "change_machine_recipe": "设备配方变更需要驾驶员确认。",
        "bind_source_item": "来料绑定变更需要驾驶员确认。",
        "open_panel": "正在打开指定业务面板。",
        "close_panel": "正在关闭指定业务面板。",
        "focus_panel": "正在聚焦指定业务面板。",
        "select_floor": "正在切换工作楼层。",
        "locate_object": "正在定位指定对象。",
        "compare_panels": "正在打开并排面板比较视图。",
        "show_task": "正在打开 Agent 任务步骤与结果。",
        "inspect_vision_result": "正在读取最近一帧视觉检测结果。",
        "open_product": "正在打开 ForgeMind 生态产品入口。",
        "start_agent_task": "正在启动受控 Agent 任务。",
        "run_autopilot": "正在启动只读自动巡检。",
        "retry_agent_task": "正在重试最近一次失败任务。",
        "cancel_agent_task": "正在取消当前 Agent 任务。",
        "list_agent_task_history": "正在读取 Agent 任务历史。",
        "list_active_reminders": "正在读取当前仍开放的主动提醒。",
        "explain_reminder": "正在读取主动提醒的来源和证据。",
        "dismiss_reminder_group": "关闭同类主动提醒需要驾驶员确认。",
        "get_reminder_policy": "正在读取主动提醒策略。",
        "set_reminder_policy": "主动提醒策略修改需要驾驶员确认。",
        "list_user_memory": "正在读取已保存的用户偏好。",
        "remember_user_preference": "保存用户偏好需要驾驶员确认。",
        "forget_user_preference": "删除用户偏好需要驾驶员确认。",
    }[action.name]


def clean_answer(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.strip().split())[:240]


def normalize_evidence(evidence: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """把 RAG 片段裁剪成可展示的来源摘要，不把任意模型字段透传给前端。"""
    if not isinstance(evidence, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in evidence[:6]:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category", "")).strip()[:32]
        source = str(item.get("source", "")).strip()[:180]
        heading = str(item.get("heading", "")).strip()[:120]
        excerpt = str(item.get("excerpt", "")).strip()[:420]
        match = str(item.get("match", "")).strip()[:32]
        if source and excerpt:
            normalized.append({"source": source, "heading": heading, "excerpt": excerpt, **({"category": category} if category else {}), **({"match": match} if match else {})})
    return normalized


def fallback_reply(answer: str, note: str) -> AssistantReply:
    return AssistantReply(
        answer=answer,
        source="fallback",
        note=note,
        protocolVersion=PROTOCOL_VERSION,
        action=None,
        validated=False,
        requiresConfirmation=False,
    )


def transcribe_wav(audio: bytes) -> str:
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("ASR 依赖未安装，请安装 numpy。") from exc

    with wave.open(io.BytesIO(audio), "rb") as wav:
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)
    if sample_width != 2:
        raise ValueError("当前仅支持 16-bit PCM WAV")
    waveform = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        waveform = waveform.reshape(-1, channels).mean(axis=1)
    if waveform.size == 0 or float(np.max(np.abs(waveform))) < 0.01:
        return ""
    if sample_rate != 16000:
        target_length = max(1, round(len(waveform) * 16000 / sample_rate))
        source_x = np.linspace(0, 1, len(waveform), endpoint=False)
        target_x = np.linspace(0, 1, target_length, endpoint=False)
        waveform = np.interp(target_x, source_x, waveform).astype(np.float32)

    recognizer = get_asr_recognizer()
    with _asr_lock:
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=waveform)
        recognizer.decode_stream(stream)
        return str(stream.result.text).strip()


def preload_asr() -> None:
    try:
        get_asr_recognizer()
    except Exception:
        return


def get_asr_recognizer():
    global _asr_recognizer
    if _asr_recognizer is not None:
        return _asr_recognizer
    with _asr_lock:
        if _asr_recognizer is not None:
            return _asr_recognizer
        try:
            import sherpa_onnx
        except ImportError as exc:
            raise RuntimeError("ASR 依赖未安装，请安装 sherpa-onnx。") from exc
        model = ASR_MODEL_DIR / "model.int8.onnx"
        tokens = ASR_MODEL_DIR / "tokens.txt"
        if not model.exists() or not tokens.exists():
            raise RuntimeError(f"找不到 Paraformer 模型：{ASR_MODEL_DIR}")
        _asr_recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=str(model),
            tokens=str(tokens),
            num_threads=4,
            sample_rate=16000,
            feature_dim=80,
        )
        return _asr_recognizer


class DetectRequest(BaseModel):
    """视觉检测请求：质检相机截图的 base64 PNG。"""

    image: str
    partId: str = "unknown"


class DetectDefect(BaseModel):
    type: str
    x: int
    y: int
    size: int
    severity: float


class DetectReply(BaseModel):
    verdict: Literal["pass", "fail", "error"]
    defects: list[DetectDefect]
    confidence: float
    note: str | None = None


class YoloDetectRequest(BaseModel):
    """实时 PCB 视频帧：浏览器送入单帧 PNG/JPEG base64。"""

    image: str
    confidence: float = Field(default=0.35, ge=0.05, le=0.95)


class YoloDetection(BaseModel):
    className: str
    confidence: float
    x1: int
    y1: int
    x2: int
    y2: int


class YoloDetectReply(BaseModel):
    status: Literal["ready", "error"]
    detections: list[YoloDetection] = Field(default_factory=list)
    width: int = 0
    height: int = 0
    inferenceMs: float = 0.0
    note: str | None = None


@app.get("/api/vision/yolo/health")
def yolo_health() -> dict[str, Any]:
    """返回实时 YOLO 模型是否可用；不在健康检查阶段加载权重。"""
    return {
        "status": "ready" if YOLO_MODEL_PATH.exists() else "error",
        "model": str(YOLO_MODEL_PATH),
        "modelExists": YOLO_MODEL_PATH.exists(),
        "loaded": _yolo_model is not None,
        "classes": ["missing_hole", "mouse_bite", "open_circuit", "short", "spur", "spurious_copper"],
    }


@app.get("/api/ai/readiness")
def readiness() -> dict[str, Any]:
    """Return startup readiness for browser ASR/TTS, not just HTTP listener state."""
    if not VOICE_ENABLED:
        return {"status": "ok", "ready": True, "voiceEnabled": False}
    if _voice_ready:
        return {"status": "ok", "ready": True, "voiceEnabled": True}
    if _voice_error:
        return {"status": "error", "ready": False, "voiceEnabled": True, "error": _voice_error}
    return {"status": "warming", "ready": False, "voiceEnabled": True}


def get_yolo_model():
    global _yolo_model
    if _yolo_model is not None:
        return _yolo_model
    with _yolo_lock:
        if _yolo_model is not None:
            return _yolo_model
        if not YOLO_MODEL_PATH.exists():
            raise RuntimeError(f"找不到 YOLO 模型：{YOLO_MODEL_PATH}")
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("未安装 ultralytics，请安装 ai-service/requirements-yolo.txt") from exc
        _yolo_model = YOLO(str(YOLO_MODEL_PATH))
        return _yolo_model


@app.post("/api/vision/yolo/detect", response_model=YoloDetectReply)
def yolo_detect(req: YoloDetectRequest) -> YoloDetectReply:
    """使用已加载的 PCB YOLOv8 权重对视频当前帧做真实推理。"""
    try:
        import cv2
        import numpy as np
        model = get_yolo_model()
        b64 = req.image.split(",", 1)[-1]
        img_bytes = base64.b64decode(b64)
        image = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return YoloDetectReply(status="error", note="视频帧解码失败")
        if not _yolo_inference_lock.acquire(blocking=False):
            return YoloDetectReply(status="error", note="YOLO 正在处理上一帧，请稍后重试")
        started = __import__("time").perf_counter()
        try:
            result = model.predict(source=image, conf=req.confidence, imgsz=640, verbose=False)[0]
        finally:
            _yolo_inference_lock.release()
        detections: list[YoloDetection] = []
        if result.boxes is not None:
            for box in result.boxes:
                coords = [int(round(value)) for value in box.xyxy[0].tolist()]
                detections.append(YoloDetection(
                    className=str(model.names[int(box.cls[0])]),
                    confidence=round(float(box.conf[0]), 3),
                    x1=coords[0], y1=coords[1], x2=coords[2], y2=coords[3],
                ))
        return YoloDetectReply(
            status="ready",
            detections=detections,
            width=int(image.shape[1]),
            height=int(image.shape[0]),
            inferenceMs=round((__import__("time").perf_counter() - started) * 1000, 1),
            note="YOLOv8 PCB 缺陷模型实时推理",
        )
    except (ValueError, RuntimeError, ImportError) as exc:
        return YoloDetectReply(status="error", note=str(exc))
    except Exception as exc:  # noqa: BLE001
        return YoloDetectReply(status="error", note=f"YOLO 推理失败：{exc}")


@app.post("/api/vision/detect", response_model=DetectReply)
def vision_detect(req: DetectRequest) -> DetectReply:
    """工业视觉检测：分割橙色被测件 → 划痕/毛刺/凹痕 → 判定。"""
    try:
        import cv2
        import numpy as np
        import vision
    except ImportError as exc:
        return DetectReply(verdict="error", defects=[], confidence=0.0, note=f"视觉依赖未就绪: {exc}")
    b64 = req.image.split(",", 1)[-1]
    try:
        img_bytes = base64.b64decode(b64)
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return DetectReply(verdict="error", defects=[], confidence=0.0, note="图片解码失败")
    except Exception as exc:  # noqa: BLE001
        return DetectReply(verdict="error", defects=[], confidence=0.0, note=f"输入异常: {exc}")

    result = vision.detect(img)
    return DetectReply(
        verdict=result["verdict"],
        defects=[DetectDefect(**d) for d in result["defects"]],
        confidence=result["confidence"],
        note=result["note"],
    )


@app.post("/api/vision/debug")
def vision_debug(req: DetectRequest) -> DetectReply:
    """调试：保存输入帧与中间掩膜到 D:/local/vision-debug，并返回判定。"""
    from pathlib import Path as _Path
    b64 = req.image.split(",", 1)[-1]
    img_bytes = base64.b64decode(b64)
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return DetectReply(verdict="error", defects=[], confidence=0.0, note="图片解码失败")
    save_dir = _Path(r"D:/local/vision-debug")
    result = vision.detect_debug(img, save_dir)
    return DetectReply(
        verdict=result["verdict"],
        defects=[DetectDefect(**d) for d in result["defects"]],
        confidence=result["confidence"],
        note=f"{result['note']} · 已存 {save_dir}",
    )
