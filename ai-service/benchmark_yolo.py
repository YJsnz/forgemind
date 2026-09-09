"""对当前选定 YOLO 后端做简单延迟基准，不代表现场验收指标。"""

from __future__ import annotations

import argparse
import os
import statistics
import time
from pathlib import Path

import numpy as np

from yolo_runtime import YoloRuntime


ROOT = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=ROOT / "models" / "pcb_defect_yolov8s.pt")
    parser.add_argument("--frames", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--backend", choices=("auto", "pytorch", "onnx", "tensorrt"), default=None)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default=None)
    args = parser.parse_args()
    if args.backend:
        os.environ["FORGEMIND_YOLO_BACKEND"] = args.backend
    if args.device:
        os.environ["FORGEMIND_YOLO_DEVICE"] = args.device
    runtime = YoloRuntime(args.model.resolve())
    frame = np.zeros((640, 640, 3), dtype=np.uint8)
    for _ in range(max(0, args.warmup)):
        runtime.predict(frame, confidence=0.35)
    samples: list[float] = []
    for _ in range(max(1, args.frames)):
        started = time.perf_counter()
        runtime.predict(frame, confidence=0.35)
        samples.append((time.perf_counter() - started) * 1000)
    print({
        "backend": runtime.info.backend,
        "provider": runtime.info.provider,
        "device": runtime.info.device,
        "model": runtime.info.model_path,
        "frames": len(samples),
        "meanMs": round(statistics.mean(samples), 2),
        "p50Ms": round(statistics.median(samples), 2),
        "p95Ms": round(float(np.percentile(samples, 95)), 2),
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
