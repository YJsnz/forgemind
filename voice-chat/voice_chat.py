"""
ForgeMind 语音对话助手
录音 → ASR → LLM(Ollama 本地) → TTS → 播放，全本地闭环。

用法：  ./venv/Scripts/python voice_chat.py
交互：  按回车开始说话 → 说完再按回车 → 听它回答 → 循环。说「退出」结束。
"""
import io
import json
import queue
import threading
import urllib.request

import numpy as np
import sounddevice as sd
import soundfile as sf
import sherpa_onnx

# ---------- 配置 ----------
ASR_DIR = "models/sherpa-onnx-paraformer-zh-2023-09-14"
TTS_DIR = "models/sherpa-onnx-vits-zh-ll"
OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "qwen2.5:7b"
SAMPLE_RATE = 16000
BT_TTS_URL = "http://127.0.0.1:8001/tts"   # BT-7274 语音服务（Bert-VITS2）
SILENCE_THRESHOLD = 0.01

SYSTEM_PROMPT = (
    "你是泰坦陨落2里的机甲AI BT-7274。说话必须像BT：沉稳、冷静、专业、极简，带一点机械式礼貌。"
    "称呼用户为「驾驶员」。禁止「你好呀」「嗨」「哦」「呢」「啦」等活泼语气词，禁止寒暄客套。"
    "每次回答不超过一句话（20字以内），直接说结论。\n\n"
    "风格示例：\n"
    "用户：你好\n"
    "你：收到，驾驶员。需要什么帮助？\n"
    "用户：今天辛苦了\n"
    "你：收到，驾驶员。已记录你的付出。\n"
    "用户：传送带好像卡住了\n"
    "你：系统检测到传送带异常，建议排查。\n"
    "用户：介绍一下你自己\n"
    "你：我是BT七二七四，你的机甲AI，随时待命。\n"
    "用户：把3号产线速度调到80%\n"
    "你：收到，已调到80%。"
)

# ---------- 加载模型 ----------
print("加载 ASR 模型…")
asr = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=f"{ASR_DIR}/model.int8.onnx",
    tokens=f"{ASR_DIR}/tokens.txt",
    num_threads=4,
    sample_rate=16000,
    feature_dim=80,
)

print("加载本地 TTS（断网兜底）…")
tts_fallback = sherpa_onnx.OfflineTts(
    sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{TTS_DIR}/model.onnx",
                tokens=f"{TTS_DIR}/tokens.txt",
                lexicon=f"{TTS_DIR}/lexicon.txt",
                dict_dir=f"{TTS_DIR}/dict",
                data_dir=f"{TTS_DIR}/",
            ),
            num_threads=4,
        ),
        rule_fsts=f"{TTS_DIR}/date.fst,{TTS_DIR}/number.fst",
    )
)

# ---------- 功能函数 ----------
def record_until_enter():
    """按回车开始录音，再按回车结束。返回 float32 单声道数组。"""
    frames, recording = [], threading.Event()
    recording.set()

    def callback(indata, *_):
        if recording.is_set():
            frames.append(indata.copy())

    input("  按回车开始说话…")
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback):
        print("  正在听，请说话…（再按回车结束）")
        input()
        recording.clear()
    return np.concatenate(frames) if frames else np.zeros(0, dtype="float32")


def transcribe(audio):
    stream = asr.create_stream()
    stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=audio)
    asr.decode_stream(stream)
    return stream.result.text


def ask_llm(messages):
    body = json.dumps({"model": OLLAMA_MODEL, "messages": messages, "stream": False}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))["message"]["content"]


def ask_llm_stream(messages, on_clause):
    """流式调用 LLM，每攒出一个断句就回调 on_clause(子句)，返回完整回复。

    断句符：。！？；，、和换行。子句一到就交给 TTS 播放，同时 LLM 继续生成，
    从而把「生成+合成+播放」流水线化，显著缩短开口等待。
    """
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "options": {"num_predict": 100},
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    full, buf = "", ""
    with urllib.request.urlopen(req, timeout=120) as resp:
        for line in resp:
            if not line.strip():
                continue
            chunk = json.loads(line.decode("utf-8"))
            piece = chunk.get("message", {}).get("content", "")
            full += piece
            buf += piece
            while buf:
                cut = -1
                for i, ch in enumerate(buf):
                    if ch in "。！？；，、\n":
                        cut = i
                        break
                if cut == -1:
                    break
                clause = buf[: cut + 1]
                buf = buf[cut + 1:]
                if clause.strip():
                    on_clause(clause.strip())
    if buf.strip():
        on_clause(buf.strip())
    return full


def trim_history(messages, max_turns=6):
    """只保留 system + 最近 max_turns 轮对话，防止历史无限膨胀拖慢生成。"""
    keep = messages[:1]
    keep.extend(messages[1:][-max_turns * 2:])
    return keep


def speak(text):
    """BT-7274 语音合成（HTTP 服务），服务不可用时回退本地 sherpa。"""
    try:
        body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            BT_TTS_URL, data=body, headers={"Content-Type": "application/json"}
        )
        resp = urllib.request.urlopen(req, timeout=120).read()
        data, sr = sf.read(io.BytesIO(resp))
        if data.ndim > 1:
            data = data.mean(axis=1)
        sd.play(data.astype("float32"), samplerate=sr)
        sd.wait()
    except Exception as e:
        print(f"  (BT 语音服务不可用，用本地音色: {e})")
        audio = tts_fallback.generate(text, sid=1, speed=1.0)
        sd.play(audio.samples, samplerate=audio.sample_rate)
        sd.wait()


def _tts_worker(q):
    while True:
        item = q.get()
        if item is None:
            break
        try:
            speak(item)
        except Exception as e:
            print(f"  (播放异常: {e})")
        finally:
            q.task_done()


# ---------- 主循环 ----------
def main():
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    tts_queue = queue.Queue()
    threading.Thread(target=_tts_worker, args=(tts_queue,), daemon=True).start()
    print("\n语音助手就绪！说「退出」结束。")
    print("-" * 50)

    while True:
        audio = record_until_enter()
        if len(audio) / SAMPLE_RATE < 0.3:
            print("  (录音太短，忽略)\n")
            continue
        if np.max(np.abs(audio)) < SILENCE_THRESHOLD:
            print("  (没听到声音，请靠近麦克风)\n")
            continue

        text = transcribe(audio)
        print(f"你说: {text}")
        if "退出" in text or "再见" in text:
            print("再见！")
            break

        messages = trim_history(messages)
        messages.append({"role": "user", "content": text})

        clauses = []
        def on_clause(c):
            clauses.append(c)
            tts_queue.put(c)

        reply = ask_llm_stream(messages, on_clause)
        messages.append({"role": "assistant", "content": reply})
        print(f"助手: {reply}")
        tts_queue.join()   # 等所有断句播完
        print()


if __name__ == "__main__":
    main()

