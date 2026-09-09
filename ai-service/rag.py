"""ForgeMind 轻量本地 RAG：文档检索只提供依据，不直接执行工厂动作。"""
from __future__ import annotations

import re
import threading
import hashlib
import math
import json
import os
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SOURCE_GROUPS = {
    "product": (
        ROOT / "docs" / "ForgeMind-模块用户文档.md",
        ROOT / "docs" / "ForgeMind-用户使用手册.md",
        ROOT / "docs" / "ForgeMind-智能管家工具协议.md",
    ),
    "process": (
        ROOT / "ForgeMind 项目方案.md",
        ROOT / "docs" / "ForgeMind-智能助手2.0优化方案.md",
        ROOT / "docs" / "ForgeMind-当前实现总览.md",
    ),
}
_cache: list[dict[str, Any]] | None = None
_document_cache: list[dict[str, str]] | None = None
_cache_lock = threading.Lock()
VECTOR_DIM = 256
CHILD_CHUNK_CHARS = 480
CHILD_CHUNK_OVERLAP = 80
MAX_PARENT_CHARS = 1500
MAX_CANDIDATES = 24
BM25_K1 = 1.2
BM25_B = 0.75
MMR_LAMBDA = 0.82
EMBEDDING_PROVIDER = os.getenv("FORGEMIND_RAG_EMBEDDING_PROVIDER", "none").lower()
if EMBEDDING_PROVIDER not in {"none", "ollama"}:
    EMBEDDING_PROVIDER = "none"
EMBEDDING_BASE_URL = os.getenv("FORGEMIND_RAG_EMBEDDING_BASE_URL", os.getenv("FORGEMIND_OLLAMA_BASE_URL", "http://127.0.0.1:11434")).rstrip("/")
EMBEDDING_MODEL = os.getenv("FORGEMIND_RAG_EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_TIMEOUT_SEC = float(os.getenv("FORGEMIND_RAG_EMBEDDING_TIMEOUT", "8"))
EMBEDDING_FAILURE_COOLDOWN_SEC = 30.0
_embedding_cache: dict[str, list[float]] = {}
_embedding_lock = threading.Lock()
_embedding_disabled_until = 0.0
_embedding_last_error: str | None = None

QUERY_EXPANSIONS = {
    "产能": ("吞吐", "产量", "产出"),
    "堵塞": ("阻塞", "瓶颈", "等待"),
    "设备": ("机器", "对象", "资产"),
    "提醒": ("告警", "预警", "通知"),
    "方案": ("规划", "候选", "patch", "审批"),
    "知识库": ("文档", "资料", "规则"),
}

CATEGORY_AUTHORITY = {
    "product": 0.90,
    "process": 0.95,
    "runtime": 0.85,
    "user_memory": 0.80,
    "workspace_knowledge": 0.88,
}


def _token_list(text: str) -> list[str]:
    """Return stable lexical tokens: identifiers plus Chinese character bigrams."""
    words = re.findall(r"[a-zA-Z0-9_][a-zA-Z0-9_.:-]*", text.lower())
    bigrams: list[str] = []
    for match in re.finditer(r"[\u4e00-\u9fff]+", text):
        compact = match.group(0)
        bigrams.extend(compact[index : index + 2] for index in range(max(0, len(compact) - 1)))
    return [token for token in [*words, *bigrams] if token]


def _tokens(text: str) -> set[str]:
    return set(_token_list(text))


def _vector(text: str) -> list[float]:
    """Build a deterministic sparse lexical vector without adding an embedding dependency."""
    vector = [0.0] * VECTOR_DIM
    for token in _tokens(text):
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % VECTOR_DIM
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else vector


def _cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=False))


def _expand_query(query: str) -> str:
    normalized = query.lower()
    extras: list[str] = []
    for phrase, expansions in QUERY_EXPANSIONS.items():
        if phrase in normalized:
            extras.extend(expansions)
    return f"{query} {' '.join(dict.fromkeys(extras))}".strip()


def _normalize_embedding(values: Any) -> list[float] | None:
    if not isinstance(values, list) or not values:
        return None
    try:
        vector = [float(value) for value in values]
    except (TypeError, ValueError):
        return None
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else None


def _embedding_key(text: str) -> str:
    return hashlib.sha256(f"{EMBEDDING_PROVIDER}:{EMBEDDING_MODEL}:{text}".encode("utf-8")).hexdigest()


def _fetch_optional_embeddings(texts: list[str]) -> list[list[float] | None]:
    """Use a local Ollama embedding endpoint only when explicitly enabled; failures are soft."""
    global _embedding_disabled_until, _embedding_last_error
    if EMBEDDING_PROVIDER != "ollama" or not texts:
        return [None for _ in texts]
    now = time.time()
    if now < _embedding_disabled_until:
        return [None for _ in texts]
    keys = [_embedding_key(text) for text in texts]
    result: list[list[float] | None] = [None for _ in texts]
    missing_indexes: list[int] = []
    with _embedding_lock:
        for index, key in enumerate(keys):
            cached = _embedding_cache.get(key)
            if cached is not None:
                result[index] = cached
            else:
                missing_indexes.append(index)
    if not missing_indexes:
        return result
    payload = json.dumps({"model": EMBEDDING_MODEL, "input": [texts[index] for index in missing_indexes]}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{EMBEDDING_BASE_URL}/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=EMBEDDING_TIMEOUT_SEC) as response:
            body = json.loads(response.read().decode("utf-8"))
        raw_embeddings = body.get("embeddings") if isinstance(body, dict) else None
        if not isinstance(raw_embeddings, list) and isinstance(body, dict) and body.get("embedding") is not None:
            raw_embeddings = [body.get("embedding")]
        if not isinstance(raw_embeddings, list) or len(raw_embeddings) != len(missing_indexes):
            raise ValueError("embedding 服务返回数量不一致")
        for index, raw in zip(missing_indexes, raw_embeddings, strict=False):
            vector = _normalize_embedding(raw)
            if vector is None:
                raise ValueError("embedding 服务返回了无效向量")
            result[index] = vector
            with _embedding_lock:
                _embedding_cache[keys[index]] = vector
                if len(_embedding_cache) > 2048:
                    _embedding_cache.pop(next(iter(_embedding_cache)))
        _embedding_last_error = None
        return result
    except (OSError, ValueError, json.JSONDecodeError, urllib.error.URLError) as exc:
        _embedding_last_error = str(exc)[:180]
        _embedding_disabled_until = time.time() + EMBEDDING_FAILURE_COOLDOWN_SEC
        return [None for _ in texts]


def _semantic_vectors(query: str, chunks: list[dict[str, Any]]) -> tuple[list[float] | None, list[list[float] | None]]:
    texts = [query, *[f"{chunk.get('heading', '')} {chunk.get('text', '')}" for chunk in chunks]]
    vectors = _fetch_optional_embeddings(texts)
    return vectors[0], vectors[1:]


def _split_child_chunks(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if len(normalized) <= CHILD_CHUNK_CHARS:
        return [normalized]
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + CHILD_CHUNK_CHARS)
        candidate = normalized[start:end]
        if end < len(normalized):
            boundary = max(candidate.rfind("。"), candidate.rfind("；"), candidate.rfind("，"), candidate.rfind(" "))
            if boundary >= CHILD_CHUNK_CHARS // 2:
                end = start + boundary + 1
                candidate = normalized[start:end]
        if len(candidate.strip()) >= 40:
            chunks.append(candidate.strip())
        if end >= len(normalized):
            break
        start = max(start + 1, end - CHILD_CHUNK_OVERLAP)
    return chunks


def _load_chunks() -> list[dict[str, Any]]:
    global _cache
    if _cache is not None:
        return _cache
    with _cache_lock:
        if _cache is not None:
            return _cache
        chunks: list[dict[str, Any]] = []
        for category, paths in SOURCE_GROUPS.items():
            for path in paths:
                if not path.exists():
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except OSError:
                    continue
                heading = "文档正文"
                paragraphs: list[str] = []
                paragraph_index = 0

                def flush_paragraph() -> None:
                    nonlocal paragraph_index, paragraphs
                    excerpt = " ".join(paragraphs).strip()
                    paragraphs = []
                    if len(excerpt) < 40:
                        return
                    parent = excerpt[:MAX_PARENT_CHARS]
                    source = str(path.relative_to(ROOT)).replace("\\", "/")
                    parent_id = f"{source}#p{paragraph_index}"
                    for child_index, child in enumerate(_split_child_chunks(parent)):
                        chunks.append({
                            "category": category,
                            "source": source,
                            "heading": heading,
                            "text": child,
                            "parentExcerpt": parent,
                            "chunkId": f"{parent_id}-c{child_index}",
                            "parentId": parent_id,
                            "authority": CATEGORY_AUTHORITY.get(category, 0.5),
                        })
                    paragraph_index += 1

                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped.startswith("#"):
                        flush_paragraph()
                        heading = stripped.lstrip("# ")[:120] or heading
                    elif stripped:
                        paragraphs.append(stripped)
                    elif paragraphs:
                        flush_paragraph()
                if paragraphs:
                    flush_paragraph()
        _cache = chunks
        return chunks


def _context_chunks(context: dict[str, Any] | None) -> list[dict[str, Any]]:
    """把历史运行摘要和用户明确偏好作为独立检索源；不接收实时工厂数值。"""
    if not isinstance(context, dict):
        return []
    chunks: list[dict[str, Any]] = []
    project = context.get("projectMemory")
    if isinstance(project, dict):
        project_id = str(project.get("projectId", "unknown"))[:80]
        runs = project.get("runs")
        if isinstance(runs, list):
            for run in runs[:6]:
                if not isinstance(run, dict):
                    continue
                fragments = [str(run.get(key, "")).strip() for key in ("headline", "summary")]
                findings = run.get("findings")
                if isinstance(findings, list):
                    for finding in findings[:6]:
                        if isinstance(finding, dict):
                            fragments.extend(str(finding.get(key, "")).strip() for key in ("title", "detail", "recommendation"))
                text = "；".join(fragment[:420] for fragment in fragments if fragment)
                if text:
                    run_version = run.get("projectVersion", run.get("version"))
                    chunks.append({
                        "category": "runtime",
                        "source": f"project-memory:{project_id}",
                        "heading": "当前项目历史 Agent 结果",
                        "text": text[:900],
                        "parentExcerpt": text[:1200],
                        "chunkId": f"project-memory:{project_id}:{str(run.get('runId', 'run'))[:80]}",
                        "parentId": f"project-memory:{project_id}",
                        "authority": CATEGORY_AUTHORITY["runtime"],
                        "projectId": project_id,
                        "version": run_version,
                        "observedAt": str(run.get("createdAt", "")),
                    })
        versions = project.get("versions")
        if isinstance(versions, list):
            for version in versions[:12]:
                if not isinstance(version, dict):
                    continue
                version_number = version.get("version")
                if not isinstance(version_number, int):
                    continue
                label = str(version.get("label", f"v{version_number}"))[:160]
                chunks.append({
                    "category": "runtime",
                    "source": f"project-memory:{project_id}",
                    "heading": "当前项目版本记忆",
                    "text": f"项目 {project_id} 的版本 {version_number}：{label}",
                    "parentExcerpt": f"项目 {project_id} 的版本 {version_number}：{label}",
                    "chunkId": f"project-memory:{project_id}:version:{version_number}",
                    "parentId": f"project-memory:{project_id}:versions",
                    "authority": CATEGORY_AUTHORITY["runtime"],
                    "projectId": project_id,
                    "version": version_number,
                    "observedAt": str(version.get("observedAt", "")),
                })
    events = context.get("proactiveEvents")
    if isinstance(events, list):
        for event in events[:12]:
            if not isinstance(event, dict) or event.get("status") != "open":
                continue
            message = str(event.get("message", "")).strip()
            if not message:
                continue
            sources = event.get("sources") if isinstance(event.get("sources"), list) else []
            source_text = "、".join(str(item)[:80] for item in sources if str(item).strip())
            count = event.get("count")
            chunks.append({
                "category": "runtime",
                "source": f"assistant-reminder:{str(event.get('fingerprint', 'event'))[:120]}",
                "heading": "开放主动提醒",
                "text": f"{message[:700]}；来源：{source_text or 'assistant'}；累计出现：{count if isinstance(count, int) else 1} 次",
                "parentExcerpt": message[:900],
                "chunkId": f"assistant-reminder:{str(event.get('fingerprint', 'event'))[:120]}",
                "parentId": "assistant-reminders",
                "authority": CATEGORY_AUTHORITY["runtime"],
                "projectId": event.get("projectId"),
                "version": event.get("projectVersion", event.get("version")),
                "observedAt": str(event.get("lastObservedAt", "")),
            })
    memory = context.get("userMemory")
    if isinstance(memory, dict):
        for key, value in list(memory.items())[:24]:
            if not isinstance(key, str) or not isinstance(value, str) or not value.strip():
                continue
            chunks.append({
                "category": "user_memory",
                "source": "user-memory",
                "heading": f"用户偏好：{key[:80]}",
                "text": value[:400],
                "parentExcerpt": value[:400],
                "chunkId": f"user-memory:{key[:80]}",
                "parentId": "user-memory",
                "authority": CATEGORY_AUTHORITY["user_memory"],
            })
    knowledge = context.get("knowledgeDocuments")
    if isinstance(knowledge, list):
        for document in knowledge[:48]:
            if not isinstance(document, dict):
                continue
            content = str(document.get("content", "")).strip()
            title = str(document.get("title", "工作空间知识")).strip()[:120]
            if not content or not title:
                continue
            if str(document.get("status", "active")).lower() in {"archived", "deleted", "inactive"}:
                continue
            document_id = str(document.get("id", title)).strip()[:120]
            chunks.append({
                "category": "workspace_knowledge",
                "source": f"workspace-knowledge:{document_id}",
                "heading": title,
                "text": content[:900],
                "parentExcerpt": content[:1400],
                "chunkId": f"workspace-knowledge:{document_id}",
                "parentId": f"workspace-knowledge:{document_id}",
                "authority": CATEGORY_AUTHORITY["workspace_knowledge"],
                "workspaceId": str(document.get("workspaceId", "")).strip() or None,
                "projectId": str(document.get("projectId", "")).strip() or None,
                "version": document.get("version"),
                "observedAt": str(document.get("updatedAt", document.get("createdAt", ""))),
            })
    return chunks


def _query_route(query: str) -> str:
    normalized = "".join(query.lower().split())
    fact_words = ("当前", "现在", "实时", "目前", "多少", "状态", "库存", "产量", "产出", "坐标", "位置", "路线", "在途", "利用率", "吞吐")
    preference_words = ("记住", "偏好", "以后", "习惯", "优先看", "不要先看")
    history_words = ("上一版", "历史", "之前", "曾经", "finding", "诊断", "巡检", "提醒", "方案效果", "为什么")
    knowledge_words = ("什么是", "如何", "怎么用", "文档", "协议", "权限", "规则", "流程", "工具", "方案", "原理")
    if any(word in normalized for word in preference_words):
        return "memory"
    if any(word in normalized for word in fact_words) and any(word in normalized for word in ("当前", "现在", "实时", "目前", "多少", "是否")):
        return "fact"
    if any(word in normalized for word in history_words):
        return "history"
    if any(word in normalized for word in knowledge_words):
        return "knowledge"
    return "mixed"


def _route_allows(route: str, category: str) -> bool:
    if route == "fact":
        return category in {"product", "process", "workspace_knowledge"}
    if route == "memory":
        return category in {"user_memory", "workspace_knowledge"}
    if route == "history":
        return category in {"runtime", "process", "workspace_knowledge", "user_memory"}
    if route == "knowledge":
        return category in {"product", "process", "workspace_knowledge", "user_memory"}
    return True


def _route_fit(route: str, category: str) -> float:
    preferred = {
        "fact": {"product", "process", "workspace_knowledge"},
        "memory": {"user_memory", "workspace_knowledge"},
        "history": {"runtime", "process"},
        "knowledge": {"product", "process", "workspace_knowledge"},
        "mixed": set(CATEGORY_AUTHORITY),
    }.get(route, set(CATEGORY_AUTHORITY))
    return 1.0 if category in preferred else 0.45


def _active_scope(context: dict[str, Any] | None) -> tuple[str, str, int | None]:
    if not isinstance(context, dict):
        return "", "", None
    ui = context.get("ui") if isinstance(context.get("ui"), dict) else {}
    project = context.get("projectMemory") if isinstance(context.get("projectMemory"), dict) else {}
    settings = context.get("assistantCloudSettings") if isinstance(context.get("assistantCloudSettings"), dict) else {}
    workspace_id = str(context.get("workspaceId") or ui.get("workspaceId") or settings.get("workspaceId") or "").strip()
    project_id = str(ui.get("projectId") or project.get("projectId") or "").strip()
    version = ui.get("projectVersion")
    return workspace_id, project_id, version if isinstance(version, int) else None


def _workspace_allowed(chunk: dict[str, Any], context: dict[str, Any] | None) -> bool:
    active_workspace, _, _ = _active_scope(context)
    chunk_workspace = str(chunk.get("workspaceId") or "").strip()
    return not active_workspace or not chunk_workspace or active_workspace == chunk_workspace


def _scope_fit(chunk: dict[str, Any], context: dict[str, Any] | None) -> float:
    _, active_project, active_version = _active_scope(context)
    chunk_project = str(chunk.get("projectId") or "").strip()
    project_fit = 0.5
    if active_project and chunk_project:
        project_fit = 1.0 if active_project == chunk_project else 0.0
    elif str(chunk.get("category", "")) == "runtime":
        project_fit = 0.35
    chunk_version = chunk.get("version")
    version_fit = 0.5
    if active_version is not None and isinstance(chunk_version, int):
        version_fit = max(0.0, 1.0 - min(abs(active_version - chunk_version) / 10.0, 1.0))
    elif isinstance(chunk_version, int):
        version_fit = 0.7
    return 0.55 * project_fit + 0.45 * version_fit


def _bm25(query_tokens: list[str], document_tokens: Counter[str], document_length: int, document_count: int, document_frequency: Counter[str], average_length: float) -> float:
    if not query_tokens or not document_tokens or average_length <= 0:
        return 0.0
    score = 0.0
    for token in set(query_tokens):
        term_frequency = document_tokens.get(token, 0)
        if not term_frequency:
            continue
        df = document_frequency.get(token, 0)
        idf = math.log(1.0 + (document_count - df + 0.5) / (df + 0.5))
        normalization = BM25_K1 * (1.0 - BM25_B + BM25_B * document_length / average_length)
        score += idf * (term_frequency * (BM25_K1 + 1.0)) / (term_frequency + normalization)
    return score


def _minmax(values: list[float]) -> list[float]:
    if not values:
        return []
    low, high = min(values), max(values)
    if high - low < 1e-9:
        return [1.0 if high > 0 else 0.0 for _ in values]
    return [(value - low) / (high - low) for value in values]


def _chunk_similarity(left: dict[str, Any], right: dict[str, Any]) -> float:
    lexical = max(0.0, _cosine(_vector(str(left.get("text", ""))), _vector(str(right.get("text", "")))))
    same_parent = 1.0 if left.get("parentId") == right.get("parentId") else 0.0
    return 0.7 * lexical + 0.3 * same_parent


def retrieve_evidence(query: str, context: dict[str, Any] | None = None, limit: int = 4) -> list[dict[str, Any]]:
    """Return a small, routed and de-duplicated evidence set; never supplies live facts."""
    controls = context.get("assistantCloudSettings") if isinstance(context, dict) else None
    if isinstance(controls, dict) and controls.get("ragEnabled") is False:
        return []
    expanded_query = _expand_query(query)
    query_tokens_list = _token_list(expanded_query)
    query_tokens = set(query_tokens_list)
    if not query_tokens:
        return []
    route = _query_route(query)
    # A pure live-fact question must go to deterministic tools, not stale evidence.
    if route == "fact":
        return []
    query_vector = _vector(expanded_query)
    chunks = [
        chunk
        for chunk in [*_load_chunks(), *_context_chunks(context)]
        if _route_allows(route, str(chunk.get("category", ""))) and _workspace_allowed(chunk, context)
    ]
    if not chunks:
        return []
    semantic_query, semantic_chunks = _semantic_vectors(expanded_query, chunks)
    semantic_enabled = semantic_query is not None and all(vector is not None for vector in semantic_chunks)
    token_counters = [Counter(_token_list(f"{chunk.get('heading', '')} {chunk.get('text', '')}")) for chunk in chunks]
    lengths = [sum(counter.values()) for counter in token_counters]
    document_frequency: Counter[str] = Counter()
    for counter in token_counters:
        document_frequency.update(counter.keys())
    average_length = sum(lengths) / max(1, len(lengths))
    raw: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        haystack = f"{chunk.get('heading', '')} {chunk.get('text', '')}".lower()
        overlap = sum(1 for token in query_tokens if token in haystack)
        exact_bonus = sum(1 for token in query_tokens if len(token) > 2 and token in str(chunk.get("text", "")).lower())
        vector_score = _cosine(query_vector, _vector(haystack))
        semantic_score = _cosine(semantic_query, semantic_chunks[index]) if semantic_enabled and semantic_query is not None and semantic_chunks[index] is not None else 0.0
        bm25_score = _bm25(query_tokens_list, token_counters[index], lengths[index], len(chunks), document_frequency, average_length)
        if overlap == 0 and bm25_score <= 0 and vector_score < 0.18 and semantic_score < 0.25:
            continue
        raw.append({
            "chunk": chunk,
            "bm25": bm25_score,
            "vector": max(0.0, vector_score),
            "semantic": max(0.0, semantic_score),
            "overlap": overlap,
            "exact": exact_bonus,
        })
    if not raw:
        return []
    bm25_values = _minmax([item["bm25"] for item in raw])
    vector_values = _minmax([item["vector"] for item in raw])
    semantic_values = _minmax([item["semantic"] for item in raw])
    for item, bm25_norm, vector_norm, semantic_norm in zip(raw, bm25_values, vector_values, semantic_values, strict=False):
        chunk = item["chunk"]
        route_fit = _route_fit(route, str(chunk.get("category", "")))
        authority = float(chunk.get("authority", CATEGORY_AUTHORITY.get(str(chunk.get("category", "")), 0.5)))
        scope_fit = _scope_fit(chunk, context)
        item["score"] = (
            0.34 * bm25_norm + 0.20 * vector_norm + 0.24 * semantic_norm + 0.14 * route_fit + 0.05 * authority + 0.03 * scope_fit
            if semantic_enabled
            else 0.42 * bm25_norm + 0.26 * vector_norm + 0.14 * route_fit + 0.10 * authority + 0.08 * scope_fit
        )
        item["authority"] = authority
        item["scopeFit"] = scope_fit
        item["match"] = "bm25+hash-vector+semantic+metadata" if semantic_enabled else "bm25+hash-vector+metadata"
    raw.sort(key=lambda item: item["score"], reverse=True)
    pool = raw[: min(MAX_CANDIDATES, max(limit * 6, 12))]
    selected: list[dict[str, Any]] = []
    while pool and len(selected) < max(1, min(limit, 6)):
        best_index = 0
        best_value = -float("inf")
        for index, item in enumerate(pool):
            redundancy = max((_chunk_similarity(item["chunk"], chosen["chunk"]) for chosen in selected), default=0.0)
            mmr = MMR_LAMBDA * item["score"] - (1.0 - MMR_LAMBDA) * redundancy
            if mmr > best_value:
                best_index, best_value = index, mmr
        chosen = pool.pop(best_index)
        chosen["mmr"] = best_value
        selected.append(chosen)
    project_versions = {
        item["chunk"].get("version")
        for item in selected
        if item["chunk"].get("projectId") and isinstance(item["chunk"].get("version"), int)
    }
    has_version_conflict = len(project_versions) > 1
    return [
        {
            "category": str(item["chunk"].get("category", "")),
            "source": str(item["chunk"].get("source", "")),
            "heading": str(item["chunk"].get("heading", "")),
            "excerpt": str(item["chunk"].get("text", "")),
            "parentExcerpt": str(item["chunk"].get("parentExcerpt", ""))[:1200],
            "chunkId": str(item["chunk"].get("chunkId", "")),
            "route": route,
            "score": f"{item['score']:.3f}",
            "confidence": f"{max(0.0, min(1.0, 0.58 * item['score'] + 0.24 * item.get('authority', 0.5) + 0.18 * item.get('scopeFit', 0.5) - (0.15 if has_version_conflict and item['chunk'].get('projectId') and isinstance(item['chunk'].get('version'), int) else 0.0))):.3f}",
            "conflict": "project-version-mismatch" if has_version_conflict and item['chunk'].get('projectId') and isinstance(item['chunk'].get('version'), int) else "",
            "embedding": "enabled" if semantic_enabled else "fallback",
            "match": f"{item['match']}+mmr",
        }
        for item in selected
    ]


def knowledge_inventory() -> dict[str, Any]:
    """Expose metadata only; document bodies stay behind the retrieval path."""
    chunks = _load_chunks()
    labels = {"product": "产品文档", "process": "工艺与方案"}
    groups = []
    for category in ("product", "process"):
        category_chunks = [chunk for chunk in chunks if chunk["category"] == category]
        groups.append({
            "id": category,
            "label": labels[category],
            "mode": "indexed",
            "documents": sorted({chunk["source"] for chunk in category_chunks}),
            "chunkCount": len(category_chunks),
        })
    groups.extend([
        {"id": "runtime", "label": "运行记忆", "mode": "request-context", "documents": ["当前项目 Agent 摘要", "开放主动提醒"], "chunkCount": None},
        {"id": "user_memory", "label": "用户偏好", "mode": "request-context", "documents": ["用户明确批准的偏好"], "chunkCount": None},
    ])
    return {
        "enabled": True,
        "method": "routed-bm25+hash-vector+metadata+mmr",
        "vectorDimension": VECTOR_DIM,
        "queryExpansion": sorted(QUERY_EXPANSIONS),
        "embedding": {"provider": EMBEDDING_PROVIDER, "model": EMBEDDING_MODEL if EMBEDDING_PROVIDER != "none" else None, "enabled": EMBEDDING_PROVIDER != "none", "fallback": "bm25+hash-vector", "lastError": _embedding_last_error},
        "chunking": {"parentMaxChars": MAX_PARENT_CHARS, "childMaxChars": CHILD_CHUNK_CHARS, "childOverlapChars": CHILD_CHUNK_OVERLAP},
        "ranking": {"maxCandidates": MAX_CANDIDATES, "mmrLambda": MMR_LAMBDA, "bm25K1": BM25_K1, "bm25B": BM25_B},
        "routing": {"fact": "tool-only", "knowledge": "product/process/workspace", "history": "runtime/process/workspace", "memory": "user/workspace", "mixed": "all-scoped"},
        "scopePolicy": {"workspace": "exact-match-when-present", "project": "current-project-boost", "version": "nearest-current-version-boost", "archived": "excluded"},
        "documentBodiesExposed": False,
        "dynamicFactsPolicy": "tool-first",
        "groups": groups,
    }


def _load_documents() -> list[dict[str, str]]:
    global _document_cache
    if _document_cache is not None:
        return _document_cache
    with _cache_lock:
        if _document_cache is not None:
            return _document_cache
        documents: list[dict[str, str]] = []
        for category, paths in SOURCE_GROUPS.items():
            for path in paths:
                if not path.exists():
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except OSError:
                    continue
                title = next((line.strip().lstrip("# ")[:160] for line in text.splitlines() if line.strip().startswith("#")), path.stem)
                relative = str(path.relative_to(ROOT)).replace("\\", "/")
                documents.append({
                    "id": relative,
                    "category": category,
                    "title": title,
                    "source": relative,
                    "content": text,
                })
        _document_cache = documents
        return documents


def knowledge_documents() -> list[dict[str, Any]]:
    """Return readable metadata for built-in documents; bodies are loaded on demand."""
    return [
        {
            "id": document["id"],
            "category": document["category"],
            "title": document["title"],
            "source": document["source"],
            "readOnly": True,
            "charCount": len(document["content"]),
        }
        for document in _load_documents()
    ]


def knowledge_document(source: str) -> dict[str, Any] | None:
    """Read one allow-listed built-in document; arbitrary filesystem paths are never accepted."""
    normalized = source.replace("\\", "/").strip()
    for document in _load_documents():
        if document["id"] == normalized:
            return {
                "id": document["id"],
                "category": document["category"],
                "title": document["title"],
                "source": document["source"],
                "readOnly": True,
                "charCount": len(document["content"]),
                "content": document["content"],
            }
    return None
