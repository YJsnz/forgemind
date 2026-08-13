"""
ForgeMind AI 服务（FastAPI）—— 只做离线 AI / LLM 编排（补充设计 §5.1）。

职责边界（§5.2）：
- 绝不进实时仿真链路（AGV/产能/瓶颈在 Java 引擎侧）。
- 只暴露离线入口：AI 助手、未来方案评分。
- 与 Spring Boot 用异步消息通信（Redis Stream/Kafka），本骨架先以 HTTP 占位。
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="ForgeMind AI Service", version="0.1.0")

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


class AssistantReply(BaseModel):
    answer: str
    source: str  # "rule" | "llm" | "stub"
    note: str | None = None


@app.get("/api/ai/health")
def health() -> dict:
    return {"status": "ok", "service": "forgemind-ai"}


@app.post("/api/ai/assistant", response_model=AssistantReply)
def assistant(req: AssistantRequest) -> AssistantReply:
    """
    AI 助手占位入口（§8 三档演进的「AI 助手（LLM 只做解释）」）。
    第一版不接真实 LLM，返回结构化的占位回复，把服务与接口契约立住。
    未来接 LLM：在 action 库里选动作、填参数，结果以副本仿真回算为准（§8.1）。
    """
    return AssistantReply(
        answer=f"（占位）已收到问题：「{req.question}」。"
               f"AI 分析能力将在接入离线 LLM 编排后启用，"
               f"优化建议一律以副本仿真回算结果为准。",
        source="stub",
        note="LLM 编排占位；接入后走 action 库 + 结构化 schema + 后端合法性校验",
    )
