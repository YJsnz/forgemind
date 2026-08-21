"""Generate the ForgeMind assistant line with the local BT-7274 model."""

from pathlib import Path
import wave
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".bt_runtime"))
import numpy as np
import bt_tts


OUT = ROOT / "video" / "v5_narration_bt"
OUT.mkdir(parents=True, exist_ok=True)

TEXT = "产线运行稳定。包装出口缓存负载较高。建议应用已验证方案。"
audio, sample_rate = bt_tts.synth_array(TEXT, length_scale=1.05)
pcm = np.clip(audio, -1.0, 1.0)
pcm = (pcm * 32767.0).astype(np.int16)

target = OUT / "S08_assistant_BT7274.wav"
with wave.open(str(target), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(sample_rate)
    wav.writeframes(pcm.tobytes())

print(f"{target} duration={len(pcm) / sample_rate:.2f}s", flush=True)
