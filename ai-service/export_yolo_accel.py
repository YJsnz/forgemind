"""导出 PCB YOLOv8 的 ONNX/TensorRT 部署产物。"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path


def build_tensorrt_engine(onnx_path: Path, engine_path: Path, half: bool) -> Path:
    """使用 TensorRT Python API 从 ONNX 构建 engine，不依赖 CUDA 版 PyTorch。"""
    from yolo_runtime import _prepare_optional_cuda_dlls

    _prepare_optional_cuda_dlls()
    try:
        import tensorrt as trt
    except ImportError as exc:
        raise SystemExit("未安装 TensorRT，请先安装 tensorrt-cu12==10.7.0") from exc
    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    parser = trt.OnnxParser(network, logger)
    if not parser.parse(onnx_path.read_bytes()):
        errors = [str(parser.get_error(index)) for index in range(parser.num_errors)]
        raise SystemExit("TensorRT ONNX 解析失败：" + " | ".join(errors))
    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 4 << 30)
    if half:
        config.set_flag(trt.BuilderFlag.FP16)
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise SystemExit("TensorRT engine 构建失败")
    engine_path.write_bytes(bytes(serialized))
    print(f"TensorRT engine saved={engine_path} size={engine_path.stat().st_size}")
    return engine_path


ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = ROOT / "models" / "pcb_defect_yolov8s.pt"


def main() -> int:
    parser = argparse.ArgumentParser(description="Export ForgeMind PCB YOLOv8 for ONNX/TensorRT")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--format", choices=("onnx", "engine"), default="onnx")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--device", default="cpu", help="ONNX 通常使用 cpu 导出；TensorRT 使用 0")
    parser.add_argument("--half", action="store_true", help="TensorRT 使用 FP16")
    parser.add_argument("--simplify", action="store_true", help="简化 ONNX 图")
    parser.add_argument("--nms", action="store_true", help="将 NMS 融入 ONNX")
    parser.add_argument("--output", type=Path, default=None, help="ONNX 输出路径；TensorRT 默认使用同名 .trt.onnx")
    args = parser.parse_args()

    model_path = args.model.resolve()
    if not model_path.exists():
        raise SystemExit(f"找不到模型：{model_path}")
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("未安装 ultralytics，请先安装 requirements-yolo.txt 或 requirements-yolo-gpu.txt") from exc

    if args.format == "engine":
        onnx_path = (args.output or model_path.with_name(f"{model_path.stem}.trt.onnx")).resolve()
        if not onnx_path.exists():
            raise SystemExit(f"TensorRT 构建需要无 NMS ONNX 文件：{onnx_path}；请先运行 `--format onnx --output {onnx_path}`")
        return 0 if build_tensorrt_engine(onnx_path, model_path.with_suffix(".engine"), args.half) else 1

    model = YOLO(str(model_path))
    kwargs = {"format": args.format, "imgsz": args.imgsz, "device": args.device, "verbose": True}
    if args.format == "onnx":
        kwargs.update(opset=args.opset, simplify=args.simplify, nms=args.nms)
    output = model.export(**kwargs)
    if args.output:
        target = args.output.resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output, target)
        output = target
    print(f"exported={output}")
    print("运行时选择：设置 FORGEMIND_YOLO_BACKEND=onnx 或 tensorrt，并可设置 FORGEMIND_YOLO_DEVICE=cuda")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("YOLO_VERBOSE", "true")
    raise SystemExit(main())
