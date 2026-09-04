"""独立语音入口的确定性对话摘要；不保存或推断工厂实时事实。"""
from __future__ import annotations

from typing import Any

SUMMARY_TRIGGER_TURNS = 8
MAX_SUMMARY_CHARS = 1600


def build_conversation_summary(turns: list[dict[str, Any]], previous: str = "") -> str:
    """保留早期目标/安全约束和最近语句，给本地 Qwen 做连续性提示。"""
    if len(turns) <= SUMMARY_TRIGGER_TURNS:
        return previous[:MAX_SUMMARY_CHARS]
    valid = [
        turn for turn in turns
        if isinstance(turn, dict)
        and turn.get("role") in {"user", "assistant"}
        and isinstance(turn.get("content"), str)
        and turn["content"].strip()
    ]
    if not valid:
        return previous[:MAX_SUMMARY_CHARS]
    early = valid[:4]
    tail = valid[-4:]
    fragments: list[str] = []
    for turn in [*early, *tail]:
        role = "驾驶员" if turn["role"] == "user" else "BT"
        content = " ".join(turn["content"].strip().split())[:260]
        if content:
            fragments.append(f"{role}：{content}")
    summary = "；".join(fragments)
    return f"早期对话摘要（动态工厂事实需重新读取）：{summary}"[:MAX_SUMMARY_CHARS]
