import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8000/api/ai/tts"
OUT = Path(__file__).resolve().parents[1] / "video" / "story_audio"
LINES = [
    ("01_narration", "投产前的第一次运行，最怕的不是机器不动。是所有东西看起来都在动。"),
    ("02_narration", "所以，我们先把工厂搬进数字世界。不是做一张漂亮的平面图，而是让每一条路径都能被运行。"),
    ("03_narration", "第一件产品出发。加工、转运、入库，节拍一环接一环。"),
    ("04_narration", "但真正的风险，往往只是一秒钟的停顿。它不会立刻让工厂停机，只会让等待开始累积。"),
    ("05_narration", "我们不猜。沿着这件产品的路径回放：质量通过，设备在线，只有下游缓存正在被一点点压满。"),
    ("06_operator", "BT，告诉我，这条线为什么会慢下来？"),
    ("07_assistant", "已定位。瓶颈不在加工中心，而在下游缓存不足。建议将分流段后移一格，并增加一个缓冲位。"),
    ("08_narration", "在现实里，这可能意味着停线、试错和等待。在 ForgeMind 里，它只是一条还没跑通的路径。"),
    ("09_operator", "调整完成。再次运行。"),
    ("10_assistant", "节拍恢复。缓存稳定，视觉检测通过，物流路径畅通。"),
    ("11_narration", "先让工厂在数字世界里犯错，再让现实一次通过。"),
    ("12_final", "ForgeMind。让工厂，先在数字世界里运行。"),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in LINES:
        payload = json.dumps({"text": text, "length_scale": 1.0}, ensure_ascii=False).encode("utf-8")
        request = Request(BASE, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=90) as response:
            audio = response.read()
        target = OUT / f"{name}.wav"
        target.write_bytes(audio)
        print(f"{target} bytes={len(audio)}", flush=True)


if __name__ == "__main__":
    main()
