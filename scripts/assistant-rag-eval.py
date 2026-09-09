"""Offline RAG quality gate for routed retrieval and tool-first boundaries."""
from __future__ import annotations

import sys
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from rag import retrieve_evidence  # noqa: E402


CONTEXT = {
    "projectMemory": {
        "projectId": "rag-eval-project",
        "runs": [{
            "runId": "run-001",
            "headline": "历史瓶颈复盘",
            "summary": "CNC-02 曾出现供料等待",
            "findings": [{"title": "供料等待", "detail": "AGV 运输造成阻塞", "recommendation": "复核物流路线"}],
        }],
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


CASES = [
    ("以后优先看产能", "user_memory"),
    ("原料安全线", "runtime"),
    ("tool protocol", "product"),
    ("Agent plan approval deterministic simulation", "process"),
    ("为什么上一版发生供料等待", "runtime"),
]

VERSION_CONTEXT = {
    "ui": {"projectId": "eval-versioned-project", "projectVersion": 8},
    "projectMemory": {
        "projectId": "eval-versioned-project",
        "runs": [
            {"runId": "old", "projectVersion": 2, "headline": "历史瓶颈", "summary": "旧版本供料等待"},
            {"runId": "current", "projectVersion": 8, "headline": "历史瓶颈", "summary": "当前版本供料等待"},
        ],
    },
}


def evaluate() -> tuple[float, float, float]:
    hits = 0
    reciprocal_rank = 0.0
    discounted_gain = 0.0
    for query, expected_category in CASES:
        results = retrieve_evidence(query, CONTEXT, limit=4)
        categories = [item.get("category") for item in results]
        if expected_category in categories:
            rank = categories.index(expected_category) + 1
            hits += 1
            reciprocal_rank += 1.0 / rank
            discounted_gain += 1.0 / (1.0 if rank == 1 else math.log2(rank + 1))
        assert all(item.get("source") and item.get("heading") and item.get("excerpt") for item in results), query
        assert all(item.get("chunkId") and item.get("score") and item.get("confidence") and item.get("match") for item in results), query
    count = len(CASES)
    return hits / count, reciprocal_rank / count, discounted_gain / count


recall, mrr, ndcg = evaluate()
fact_evidence = retrieve_evidence("当前库存是多少", CONTEXT, limit=4)
version_evidence = retrieve_evidence("历史瓶颈供料等待", VERSION_CONTEXT, limit=2)
conflict_detected = any(item.get("conflict") == "project-version-mismatch" for item in version_evidence)
assert fact_evidence == [], "live-fact query must remain tool-first"
assert conflict_detected, "project-version conflict was not surfaced"
assert recall >= 0.8, f"Recall@4 below gate: {recall:.3f}"
assert mrr >= 0.6, f"MRR below gate: {mrr:.3f}"
assert ndcg >= 0.7, f"nDCG@4 below gate: {ndcg:.3f}"
evidence_coverage = 1.0 if all(item.get("source") and item.get("heading") and item.get("excerpt") for query, _ in CASES for item in retrieve_evidence(query, CONTEXT, limit=4)) else 0.0
assert evidence_coverage == 1.0, "evidence coverage below gate"
print(f"RAG eval PASS: Recall@4={recall:.3f} MRR={mrr:.3f} nDCG@4={ndcg:.3f} evidenceCoverage={evidence_coverage:.3f} conflict=PASS tool-first=PASS")
