from pathlib import Path

import sherpa_onnx
import wave
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ASR_DIR = ROOT / "voice-chat" / "models" / "sherpa-onnx-paraformer-zh-2023-09-14"
FILES = [
    Path(r"D:\local\bt7274-space\bt_selfintro.wav"),
    Path(r"D:\local\bt7274-space\bt_server_test.wav"),
    Path(r"D:\local\bt7274-space\bt_test.wav"),
    *(ROOT / "video" / "tts_voice_tests").glob("*.wav"),
    *(ROOT / "voice-chat" / "samples").glob("*.wav"),
    *(ROOT / "voice-chat" / "samples").glob("*.mp3"),
]


def main():
    recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=str(ASR_DIR / "model.int8.onnx"),
        tokens=str(ASR_DIR / "tokens.txt"),
        num_threads=4,
        sample_rate=16000,
        feature_dim=80,
    )
    for path in FILES:
        if not path.exists() or path.suffix.lower() != ".wav":
            continue
        with wave.open(str(path), "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            raw = wav.readframes(wav.getnframes())
        samples = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
        if sample_rate != 16000:
            target_len = int(len(samples) * 16000 / sample_rate)
            samples = np.interp(np.linspace(0, len(samples) - 1, target_len), np.arange(len(samples)), samples).astype("float32")
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        print(f"{path.name}: {stream.result.text}", flush=True)


if __name__ == "__main__":
    main()
