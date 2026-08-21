import json
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8000/api/ai/tts"
OUT = Path(__file__).resolve().parents[1] / "video" / "comic_audio"
LINES = [
    ("01_narration", "工厂开局，就来了一道硬题。"),
    ("02_narration", "第一件订单，能不能跑通？"),
    ("03_narration", "答案，藏在一枚还没到达终点的零件里。"),
    ("04_operator", "BT，最后一件零件去哪了？"),
    ("05_assistant", "没有丢失。它被下游缓存卡住了。"),
    ("06_narration", "一个零件，卡住整条线？这不叫故障，这叫线索。"),
    ("07_operator", "那就把路径改了。"),
    ("08_assistant", "路径已重写。重新运行。"),
    ("09_narration", "在 ForgeMind，错误不会被藏起来。它会被画出来，被追上，被修好。"),
    ("10_assistant", "第一件交付完成。"),
    ("11_narration", "让每一次生产，都先在数字世界里赢一次。"),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in LINES:
        body = json.dumps({"text": text, "length_scale": 1.0}, ensure_ascii=False).encode("utf-8")
        request = Request(BASE, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=90) as response:
            audio = response.read()
        target = OUT / f"{name}.wav"
        target.write_bytes(audio)
        print(f"{target} bytes={len(audio)}", flush=True)


if __name__ == "__main__":
    main()
