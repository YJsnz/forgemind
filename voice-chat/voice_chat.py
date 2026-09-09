"""
ForgeMind 语音对话助手
录音 → ASR → ForgeMind 可选智能服务 → TTS → 播放。

智能服务默认使用规则模式，也可由服务端显式配置远程 DeepSeek；
本控制台不安装、不启动也不直接访问本地大语言模型。

用法：  ./venv/Scripts/python voice_chat.py
交互：  首轮说「BT」唤醒，停顿后自动提交；回答后 30 秒内可连续追问，无需重复 BT。说「BT 退出」结束。
"""
import io
import json
import os
import queue
import threading
import time
import urllib.request

import numpy as np
import sounddevice as sd
import soundfile as sf
import sherpa_onnx

try:
    from .conversation_context import build_conversation_summary
except ImportError:
    from conversation_context import build_conversation_summary

# ---------- 配置 ----------
ASR_DIR = "models/sherpa-onnx-paraformer-zh-2023-09-14"
TTS_DIR = "models/sherpa-onnx-vits-zh-ll"
TTS_SID = int(os.getenv("FORGEMIND_TTS_SID", "1"))
ASSISTANT_URL = os.getenv("FORGEMIND_AI_URL", "http://127.0.0.1:8000/api/ai/assistant")
ASSISTANT_WAKE_WORD = "BT"
SAMPLE_RATE = 16000
BT_TTS_URL = "http://127.0.0.1:8001/tts"   # BT-7274 语音服务（Bert-VITS2）
SILENCE_THRESHOLD = 0.01

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
def record_voice_turn(max_wait=9.0, max_turn=9.0, silence_seconds=0.76):
    """本地 VAD 轮次：等待明显语音，语音结束后自动收口，不上传音频。"""
    frames, speech_started, last_voice = [], None, None
    started_at = time.monotonic()

    def callback(indata, *_):
        nonlocal speech_started, last_voice
        samples = indata[:, 0].copy()
        frames.append(samples)
        level = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
        now = time.monotonic()
        if level >= 0.015:
            if speech_started is None:
                speech_started = now
            last_voice = now

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback):
        print("  正在听…", end=" ", flush=True)
        while True:
            elapsed = time.monotonic() - started_at
            if elapsed >= max_turn:
                break
            if speech_started is None and elapsed >= max_wait:
                break
            if speech_started is not None and last_voice is not None and time.monotonic() - last_voice >= silence_seconds:
                break
            time.sleep(0.05)
    return np.concatenate(frames) if frames else np.zeros(0, dtype="float32")


def transcribe(audio):
    stream = asr.create_stream()
    stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=audio)
    asr.decode_stream(stream)
    return stream.result.text


def normalize_wake_text(text):
    return "".join((text or "").lower().split()).replace("-", "").replace("_", "")


def is_wake_word(text):
    normalized = normalize_wake_text(text)
    return normalized == "bt" or normalized.startswith("bt") or normalized.startswith("逼提")


def remove_wake_word(text):
    value = (text or "").strip()
    if value[:2].lower() == "bt":
        value = value[2:]
    elif value.startswith("逼提"):
        value = value[2:]
    return value.lstrip(" ，,。.!！？?：:、")


def ask_assistant(question, conversation, conversation_summary):
    context = {
        "conversation": conversation[-12:],
        "conversationSummary": conversation_summary,
        "voiceSurface": "standalone-voice-chat",
    }
    body = json.dumps({"question": question, "context": context}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        ASSISTANT_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    return str(result.get("answer") or "规则助手没有返回文本。")


def strip_english_from_speech(text):
    """屏幕和日志保留原回答，语音副本跳过英文、缩写和对象 ID。"""
    spoken = re.sub(r"[A-Za-z][A-Za-z0-9_.:/\\-]*", " ", text)
    spoken = re.sub(r"\s+([，。！？!?；;：:、])", r"\1", spoken)
    spoken = re.sub(r"([，。！？!?；;：:、])(?:\s*\1)+", r"\1", spoken)
    spoken = re.sub(r"^[\s，。！？!?；;：:、]+", "", spoken)
    spoken = re.sub(r"\s+", " ", spoken)
    return re.sub(r"([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", r"\1", spoken).strip()


def speak(text):
    """BT-7274 语音合成（HTTP 服务），服务不可用时回退本地 sherpa。"""
    text = strip_english_from_speech(text)
    if not text:
        return
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
        audio = tts_fallback.generate(text, sid=TTS_SID, speed=1.0)
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
    tts_queue = queue.Queue()
    conversation = []
    conversation_summary = ""
    threading.Thread(target=_tts_worker, args=(tts_queue,), daemon=True).start()
    print("FORGEMIND_VOICE_READY", flush=True)
    print(f"\nBT-7274 语音助手就绪！请以「{ASSISTANT_WAKE_WORD}」开头，说「{ASSISTANT_WAKE_WORD} 退出」结束。")
    print("-" * 50)

    session_active = False
    session_last_activity = 0.0
    while True:
        if session_active and time.monotonic() - session_last_activity >= 30.0:
            session_active = False
            print("\n  连续会话已结束，请再次说 BT 唤醒。")
        audio = record_voice_turn()
        if len(audio) / SAMPLE_RATE < 0.3:
            print("  (录音太短，忽略)\n")
            continue
        if np.max(np.abs(audio)) < SILENCE_THRESHOLD:
            print("  (没听到声音，请靠近麦克风)\n")
            continue

        text = transcribe(audio)
        print(f"你说: {text}")
        if not session_active and not is_wake_word(text):
            print(f"  (未检测到唤醒词 {ASSISTANT_WAKE_WORD}，本段不会发送到智能服务)\n")
            continue
        command = remove_wake_word(text) if is_wake_word(text) else text.strip()
        if "退出" in command or "再见" in command:
            print("再见！")
            break
        if not command:
            session_active = True
            session_last_activity = time.monotonic()
            print("  (已唤醒，接下来 30 秒内可直接继续说话)\n")
            continue

        reply = ask_assistant(command, conversation, conversation_summary)
        conversation.extend([{"role": "user", "content": command[:700]}, {"role": "assistant", "content": reply[:700]}])
        conversation = conversation[-12:]
        conversation_summary = build_conversation_summary(conversation, conversation_summary)
        tts_queue.put(reply)
        print(f"助手: {reply}")
        tts_queue.join()   # 等所有断句播完
        session_active = True
        session_last_activity = time.monotonic()
        print()


if __name__ == "__main__":
    main()
