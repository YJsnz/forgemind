import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from rag import retrieve_evidence  # noqa: E402


context = {
    "projectMemory": {
        "projectId": "factory-rag-regression",
        "runs": [{"headline": "历史瓶颈复盘", "summary": "CNC-02 曾出现供料等待", "findings": []}],
    },
    "proactiveEvents": [{
        "fingerprint": "inventory:steel",
        "status": "open",
        "message": "原料库存接近安全线",
        "sources": ["inventory", "autopilot"],
        "count": 3,
    }],
    "userMemory": {"response_style": "优先看产能，不先看装饰信息"},
}


def categories(query: str):
    return {item.get("category") for item in retrieve_evidence(query, context, limit=6)}


assert "user_memory" in categories("\u4ee5\u540e\u4f18\u5148\u770b\u4ea7\u80fd"), "用户偏好未进入独立记忆索引"
assert "runtime" in categories("\u539f\u6599\u5b89\u5168\u7ebf"), "主动提醒未进入运行记忆索引"
assert "product" in categories("tool protocol"), "产品文档未进入产品索引"
assert "process" in categories("Agent plan approval deterministic simulation"), "方案文档未进入工艺索引"
print("RAG categories PASS: product/process/runtime/user_memory; dynamic facts remain tool-owned")
