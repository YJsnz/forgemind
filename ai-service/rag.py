"""ForgeMind 轻量本地 RAG：文档检索只提供依据，不直接执行工厂动作。"""
from __future__ import annotations

import re
import threading
import hashlib
import math
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
_cache: list[dict[str, str]] | None = None
_document_cache: list[dict[str, str]] | None = None
_cache_lock = threading.Lock()
VECTOR_DIM = 256


def _tokens(text: str) -> set[str]:
    words = set(re.findall(r"[a-zA-Z0-9_][a-zA-Z0-9_.:-]*", text.lower()))
    compact = re.sub(r"\s+", "", text)
    words.update(compact[index : index + 2] for index in range(max(0, len(compact) - 1)))
    return {token for token in words if token}


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


def _load_chunks() -> list[dict[str, str]]:
    global _cache
    if _cache is not None:
        return _cache
    with _cache_lock:
        if _cache is not None:
            return _cache
        chunks: list[dict[str, str]] = []
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
                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped.startswith("#"):
                        heading = stripped.lstrip("# ")[:120] or heading
                    elif stripped:
                        paragraphs.append(stripped)
                    elif paragraphs:
                        excerpt = " ".join(paragraphs)
                        if len(excerpt) >= 40:
                            chunks.append({"category": category, "source": str(path.relative_to(ROOT)), "heading": heading, "text": excerpt[:900]})
                        paragraphs = []
                if paragraphs:
                    excerpt = " ".join(paragraphs)
                    if len(excerpt) >= 40:
                        chunks.append({"category": category, "source": str(path.relative_to(ROOT)), "heading": heading, "text": excerpt[:900]})
        _cache = chunks
        return chunks


def _context_chunks(context: dict[str, Any] | None) -> list[dict[str, str]]:
    """把历史运行摘要和用户明确偏好作为独立检索源；不接收实时工厂数值。"""
    if not isinstance(context, dict):
        return []
    chunks: list[dict[str, str]] = []
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
                    chunks.append({
                        "category": "runtime",
                        "source": f"project-memory:{project_id}",
                        "heading": "当前项目历史 Agent 结果",
                        "text": text[:900],
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
            document_id = str(document.get("id", title)).strip()[:120]
            chunks.append({
                "category": "workspace_knowledge",
                "source": f"workspace-knowledge:{document_id}",
                "heading": title,
                "text": content[:900],
            })
    return chunks


def retrieve_evidence(query: str, context: dict[str, Any] | None = None, limit: int = 4) -> list[dict[str, Any]]:
    """返回少量可引用片段；无命中时返回空数组，避免把整库塞给模型。"""
    controls = context.get("assistantCloudSettings") if isinstance(context, dict) else None
    if isinstance(controls, dict) and controls.get("ragEnabled") is False:
        return []
    query_tokens = _tokens(query)
    if not query_tokens:
        return []
    query_vector = _vector(query)
    ranked: list[tuple[float, dict[str, str], str]] = []
    for chunk in [*_load_chunks(), *_context_chunks(context)]:
        haystack = f"{chunk['heading']} {chunk['text']}".lower()
        overlap = sum(1 for token in query_tokens if token.lower() in haystack)
        vector_score = _cosine(query_vector, _vector(haystack))
        if overlap:
            exact_bonus = sum(3 for token in query_tokens if len(token) > 2 and token.lower() in chunk["text"].lower())
            ranked.append((overlap + exact_bonus + max(0.0, vector_score) * 5, chunk, "keyword+vector"))
        elif vector_score >= 0.18:
            ranked.append((vector_score * 5, chunk, "vector"))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {"category": chunk["category"], "source": chunk["source"], "heading": chunk["heading"], "excerpt": chunk["text"], "match": match}
        for _, chunk, match in ranked[: max(1, min(limit, 6))]
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
        "method": "keyword+vector",
        "vectorDimension": VECTOR_DIM,
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
