"""Verify the optional embedding adapter without requiring Ollama or network access."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

import rag  # noqa: E402


class FakeResponse:
    def __init__(self, body: dict):
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


original_urlopen = rag.urllib.request.urlopen
original_provider = rag.EMBEDDING_PROVIDER
original_cache = dict(rag._embedding_cache)
try:
    rag.EMBEDDING_PROVIDER = "ollama"
    rag.EMBEDDING_MODEL = "test-embedding"
    rag._embedding_cache.clear()
    rag._embedding_disabled_until = 0
    rag.urllib.request.urlopen = lambda *_args, **_kwargs: FakeResponse({"embeddings": [[3.0, 4.0], [0.0, 2.0]]})
    vectors = rag._fetch_optional_embeddings(["alpha", "beta"])
    assert vectors[0] and abs(vectors[0][0] - 0.6) < 1e-6, "optional embedding normalization failed"
    assert vectors[1] and abs(vectors[1][1] - 1.0) < 1e-6, "optional embedding response failed"

    rag.urllib.request.urlopen = lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline"))
    rag._embedding_disabled_until = 0
    fallback = rag._fetch_optional_embeddings(["offline"])
    assert fallback == [None], "embedding failure did not soft-fallback"
finally:
    rag.urllib.request.urlopen = original_urlopen
    rag.EMBEDDING_PROVIDER = original_provider
    rag._embedding_cache.clear()
    rag._embedding_cache.update(original_cache)
    rag._embedding_disabled_until = 0
print("Optional embedding adapter PASS: normalized response, cache path, offline fallback")
