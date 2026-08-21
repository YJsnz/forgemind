"""Generate concise, younger main narration for the ForgeMind promo."""

import asyncio
from pathlib import Path

import edge_tts


OUT = Path(__file__).resolve().parents[1] / "video" / "v5_narration_young"
LINES = [
    ("S01_narration", "先把工厂搬进数字世界，让每一件物料找到正确的路径。"),
    ("S02_narration", "仓储、运输、缓存，都是产线的一部分。"),
    ("S03_narration", "一件成品，来自多条必须汇合的生产支线。"),
    ("S04_narration", "跨越三层楼，物流才真正成为一张网络。"),
    ("S05_narration", "每一次扫描，都决定下一步放行，还是隔离。"),
    ("S06_narration", "当等待开始累积，背压会暴露真正的瓶颈。"),
    ("S07_narration", "在 ForgeMind 里，把需求变成方案，在副本里先运行，再比较。"),
    ("S08_final", "先让工厂运行，再让现实发生。"),
]


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in LINES:
        target = OUT / f"{name}.mp3"
        communicate = edge_tts.Communicate(
            text,
            "zh-CN-XiaoxiaoNeural",
            rate="+0%",
            pitch="+0Hz",
        )
        await communicate.save(str(target))
        print(f"{name}: {target}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
