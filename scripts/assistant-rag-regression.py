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


def evidence(query: str):
    return retrieve_evidence(query, context, limit=6)


assert "user_memory" in categories("\u4ee5\u540e\u4f18\u5148\u770b\u4ea7\u80fd"), "用户偏好未进入独立记忆索引"
assert "runtime" in categories("\u539f\u6599\u5b89\u5168\u7ebf"), "主动提醒未进入运行记忆索引"
assert "product" in categories("tool protocol"), "产品文档未进入产品索引"
assert "process" in categories("Agent plan approval deterministic simulation"), "方案文档未进入工艺索引"
assert evidence("\u5f53\u524d\u5e93\u5b58\u662f\u591a\u5c11") == [], "实时事实问题不能用 RAG 片段回答"
assert all("bm25+hash-vector+metadata+mmr" in item.get("match", "") for item in evidence("Agent plan approval deterministic simulation")), "混合检索/重排序标记缺失"
assert all(item.get("chunkId") and item.get("score") and item.get("confidence") for item in evidence("tool protocol")), "证据块元数据缺失"

workspace_context = {
    "workspaceId": "workspace-a",
    "knowledgeDocuments": [
        {"id": "allowed", "workspaceId": "workspace-a", "title": "工艺规则", "content": "workspace-a 工艺规则允许通过审批后执行。"},
        {"id": "foreign", "workspaceId": "workspace-b", "title": "工艺规则", "content": "workspace-b 私有规则不应被当前工作空间检索。"},
    ],
}
workspace_evidence = retrieve_evidence("工艺规则", workspace_context, limit=6)
assert workspace_evidence and any("workspace-knowledge:allowed" == item.get("source") for item in workspace_evidence), "当前工作空间知识未被检索"
assert all("workspace-knowledge:foreign" != item.get("source") for item in workspace_evidence), "跨工作空间知识未被隔离"

version_context = {
    "ui": {"projectId": "versioned-project", "projectVersion": 8},
    "projectMemory": {
        "projectId": "versioned-project",
        "runs": [
            {"runId": "old", "projectVersion": 2, "headline": "历史瓶颈", "summary": "旧版本供料等待"},
            {"runId": "current", "projectVersion": 8, "headline": "历史瓶颈", "summary": "当前版本供料等待"},
        ],
    },
}
version_evidence = retrieve_evidence("历史瓶颈供料等待", version_context, limit=2)
assert version_evidence and "current" in version_evidence[0].get("chunkId", ""), "当前项目版本没有获得优先权"
assert any(item.get("conflict") == "project-version-mismatch" for item in version_evidence), "项目版本冲突没有被标记"
print("RAG maturity PASS: routed sources, hybrid retrieval, MMR evidence, tool-first live facts")
