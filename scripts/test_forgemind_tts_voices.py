import time
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "voice-chat" / "models" / "sherpa-onnx-vits-zh-ll"
OUT = ROOT / "video" / "tts_voice_tests"
SPEAKERS = {
    0: "suyingxue",
    1: "gunian",
    2: "fushiyu",
    3: "bingjiao",
    4: "bazong",
}
TEXT = "我是 ForgeMind 的本地智能管家。工厂状态稳定，建议继续运行。"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(MODEL_DIR / "model.onnx"),
                tokens=str(MODEL_DIR / "tokens.txt"),
                lexicon=str(MODEL_DIR / "lexicon.txt"),
                dict_dir=str(MODEL_DIR / "dict"),
                data_dir=str(MODEL_DIR),
            ),
            num_threads=4,
        ),
        rule_fsts=f"{MODEL_DIR / 'date.fst'},{MODEL_DIR / 'number.fst'}",
    )
    engine = sherpa_onnx.OfflineTts(config)
    for sid, name in SPEAKERS.items():
        started = time.time()
        audio = engine.generate(TEXT, sid=sid, speed=1.0)
        pcm = (np.clip(np.asarray(audio.samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
        target = OUT / f"sid{sid}_{name}.wav"
        with wave.open(str(target), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(audio.sample_rate)
            wav.writeframes(pcm.tobytes())
        print(f"sid={sid} name={name} duration={len(audio.samples) / audio.sample_rate:.2f}s elapsed={time.time() - started:.2f}s -> {target}", flush=True)


if __name__ == "__main__":
    main()
