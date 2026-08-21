"""Generate V5 promo narration with network Chinese neural voices."""

import asyncio
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "video" / "v5_narration_edge"

LINES = [
    (
        "S01_narration",
        "一座工厂真正开始生产之前，先要确认的，不是它看起来像不像工厂，而是每一件物料能不能走到该去的地方。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S02_narration",
        "在 ForgeMind 里，仓储不是背景。库存、运输、缓存和在途物料，都是产线能否持续运行的一部分。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S03_narration",
        "一件成品，往往不是从一台机器里直接出现。它来自多条节拍不同、方向不同、却必须最终汇合的生产支线。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S04_narration",
        "当物料跨越楼层，工厂就不再只是设备的集合。它变成一张包含输送带、自动导引车、无人机和缓存的生产网络。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S05_narration",
        "质量不是最后一张报表。它发生在每一次扫描、每一次判断，以及每一次放行或隔离之中。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S06_narration",
        "真实的产线不会永远顺畅。堵塞、等待和背压，会沿着物流方向反向暴露真正的瓶颈。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S07_narration",
        "ForgeMind 不只告诉你哪里出了问题，还可以把需求变成方案，把方案放进副本里重新运行，再比较哪一种改变真正有效。",
        "zh-CN-YunjianNeural",
        "-8%",
        "-2Hz",
    ),
    (
        "S08_assistant",
        "产线运行稳定。包装出口缓存负载较高。建议应用已验证方案。",
        "zh-CN-YunxiNeural",
        "-4%",
        "+0Hz",
    ),
    (
        "S08_final",
        "先运行，才能看见问题；看见问题，才有资格做决定。ForgeMind，先在数字世界运行。",
        "zh-CN-YunjianNeural",
        "+10%",
        "-2Hz",
    ),
]


async def synthesize(name: str, text: str, voice: str, rate: str, pitch: str) -> None:
    target = OUT / f"{name}.mp3"
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await communicate.save(str(target))
    print(f"{name}: {target}", flush=True)


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text, voice, rate, pitch in LINES:
        await synthesize(name, text, voice, rate, pitch)


if __name__ == "__main__":
    asyncio.run(main())
