import asyncio
from pathlib import Path

import edge_tts


OUT = Path(__file__).resolve().parents[1] / "video" / "edge_operator_voice_tests"
TEXT = "我是产线操作员。今天先不启动现实工厂，我们把这条生产线在数字世界里跑通。"
VOICES = {
    "Yunxi": "zh-CN-YunxiNeural",
    "Xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "Xiaoyi": "zh-CN-XiaoyiNeural",
    "Yunjian": "zh-CN-YunjianNeural",
}


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for label, voice in VOICES.items():
        target = OUT / f"{label}.mp3"
        communicate = edge_tts.Communicate(TEXT, voice, rate="-2%", pitch="+0Hz")
        await communicate.save(str(target))
        print(f"{label} ({voice}) -> {target}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
