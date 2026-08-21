import asyncio
from pathlib import Path

import edge_tts


OUT = Path(__file__).resolve().parents[1] / "video" / "edge_yunjian_operator_test.mp3"
TEXT = "我是产线操作员。今天，我们先让这座工厂在数字世界里完整运行一遍。"


async def main():
    communicate = edge_tts.Communicate(TEXT, "zh-CN-YunjianNeural", rate="-2%", pitch="+0Hz")
    await communicate.save(str(OUT))
    print(OUT)


if __name__ == "__main__":
    asyncio.run(main())
