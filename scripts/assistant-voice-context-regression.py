import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "voice-chat"))

from conversation_context import MAX_SUMMARY_CHARS, build_conversation_summary  # noqa: E402


turns = [
    {"role": "user" if index % 2 == 0 else "assistant", "content": (
        "目标是检查 CNC-02 的产能瓶颈，不增加设备；所有修改必须人工确认并保留回滚。"
        if index == 0 else f"连续语音上下文测试第 {index} 轮"
    )}
    for index in range(20)
]
summary = build_conversation_summary(turns)
assert "CNC-02" in summary
assert "人工确认" in summary
assert "动态工厂事实需重新读取" in summary
assert len(summary) <= MAX_SUMMARY_CHARS
print("Voice context summary PASS: early goal and safety constraints retained")
