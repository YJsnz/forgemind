"""Generate comparable Chinese neural voice auditions."""

import asyncio
from pathlib import Path

import edge_tts


OUT = Path(__file__).resolve().parents[1] / "video" / "voice_auditions_v56"
TEXT = "在 ForgeMind 里，我们先让工厂在数字世界运行一遍，再把验证过的方案交给现实。"
VOICES = [
    ("xiaoxiao", "zh-CN-XiaoxiaoNeural"),
    ("xiaoyi", "zh-CN-XiaoyiNeural"),
    ("yunyang", "zh-CN-YunyangNeural"),
    ("yunjian", "zh-CN-YunjianNeural"),
    ("yunxi_current", "zh-CN-YunxiNeural"),
]


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, voice in VOICES:
        target = OUT / f"{slug}.mp3"
        communicate = edge_tts.Communicate(TEXT, voice, rate="+0%", pitch="+0Hz")
        await communicate.save(str(target))
        print(f"{slug}: {target}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
