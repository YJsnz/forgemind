"""可选 YOLO 推理后端选择。

默认仍使用仓库中的 ``.pt`` + CPU 路径。只有显式准备 ONNX/TensorRT
产物并安装对应运行时后，才会切换到 CUDA/TensorRT；这样 GPU 加速不会
成为 ForgeMind 核心服务或离线仿真的启动依赖。
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PCB_CLASS_NAMES = [
    "missing_hole",
    "mouse_bite",
    "open_circuit",
    "short",
    "spur",
    "spurious_copper",
]

_DLL_DIRECTORY_HANDLES: list[Any] = []
_PROVIDER_READY_CACHE: dict[str, bool] = {}


def _prepare_optional_cuda_dlls() -> None:
    """让 D 盘虚拟环境里的 NVIDIA pip DLL 可被 Windows Provider 找到。"""
    if os.name != "nt":
        return
    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    candidates = [
        site_packages / "nvidia" / "cudnn" / "bin",
        site_packages / "nvidia" / "cublas" / "bin",
        site_packages / "nvidia" / "cuda_runtime" / "bin",
        site_packages / "nvidia" / "cuda_nvrtc" / "bin",
        site_packages / "tensorrt_libs",
        site_packages / "tensorrt_bindings",
    ]
    existing = [path for path in candidates if path.is_dir()]
    if not existing:
        return
    current_path = os.environ.get("PATH", "").split(os.pathsep)
    for path in existing:
        path_text = str(path)
        if path_text not in current_path:
            current_path.insert(0, path_text)
        try:
            _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(path_text))
        except (AttributeError, OSError):
            pass
    os.environ["PATH"] = os.pathsep.join(current_path)


@dataclass(frozen=True)
class YoloRuntimeInfo:
    backend: str
    model_path: str
    requested_device: str
    device: str
    provider: str
    loaded: bool = False


class YoloRuntime:
    """懒加载 YOLO 模型，并统一 PyTorch/ONNX/TensorRT 的推理入口。"""

    def __init__(self, pytorch_model: Path):
        self.pytorch_model = pytorch_model
        self.engine_path = Path(os.getenv("FORGEMIND_YOLO_ENGINE", str(pytorch_model.with_suffix(".engine"))))
        self.onnx_path = Path(os.getenv("FORGEMIND_YOLO_ONNX_MODEL", str(pytorch_model.with_suffix(".onnx"))))
        self.trt_onnx_path = Path(os.getenv(
            "FORGEMIND_YOLO_TRT_ONNX_MODEL",
            str(pytorch_model.with_name(f"{pytorch_model.stem}.trt.onnx")),
        ))
        self.requested_backend = os.getenv("FORGEMIND_YOLO_BACKEND", "auto").strip().lower()
        self.requested_device = os.getenv("FORGEMIND_YOLO_DEVICE", "auto").strip().lower()
        self.model: Any = None
        self.session: Any = None
        self.input_name: str | None = None
        self.info = self._select_info()

    @staticmethod
    def _available_providers() -> list[str]:
        _prepare_optional_cuda_dlls()
        try:
            import onnxruntime as ort

            return list(ort.get_available_providers())
        except Exception:  # noqa: BLE001 - optional dependency probe
            return []

    @staticmethod
    def _torch_cuda_available() -> bool:
        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:  # noqa: BLE001 - optional dependency probe
            return False

    @classmethod
    def _provider_ready(cls, provider: str) -> bool:
        """Provider 名称存在不代表 DLL 可加载，使用极小 ONNX 图做真实探针。"""
        if provider in _PROVIDER_READY_CACHE:
            return _PROVIDER_READY_CACHE[provider]
        if provider not in cls._available_providers():
            _PROVIDER_READY_CACHE[provider] = False
            return False
        try:
            import onnx
            import onnxruntime as ort
            from onnx import TensorProto, helper

            graph = helper.make_graph(
                [helper.make_node("Identity", ["input"], ["output"])],
                "forgemind-provider-probe",
                [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1])],
                [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1])],
            )
            model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
            model.ir_version = 8
            session_options = ort.SessionOptions()
            session_options.log_severity_level = 3
            session = ort.InferenceSession(
                model.SerializeToString(),
                sess_options=session_options,
                providers=[provider, "CPUExecutionProvider"],
            )
            ready = bool(session.get_providers() and session.get_providers()[0] == provider)
            _PROVIDER_READY_CACHE[provider] = ready
            return ready
        except Exception:  # noqa: BLE001 - missing CUDA/cuDNN must become a clean fallback
            _PROVIDER_READY_CACHE[provider] = False
            return False

    def _select_backend(self) -> tuple[str, Path]:
        backend = self.requested_backend
        if backend not in {"auto", "pytorch", "onnx", "tensorrt"}:
            raise RuntimeError("FORGEMIND_YOLO_BACKEND 只能是 auto、pytorch、onnx 或 tensorrt")
        if backend == "auto":
            cpu_requested = self.requested_device in {"cpu", "0:cpu"}
            if not cpu_requested and self.engine_path.exists() and self._provider_ready("TensorrtExecutionProvider"):
                if self.trt_onnx_path.exists():
                    return "tensorrt", self.trt_onnx_path
            if not cpu_requested and self.onnx_path.exists() and self._provider_ready("CUDAExecutionProvider"):
                return "onnx", self.onnx_path
            return "pytorch", self.pytorch_model
        if backend == "tensorrt":
            if self.requested_device in {"cpu", "0:cpu"}:
                raise RuntimeError("TensorRT 后端需要 CUDA；请将 FORGEMIND_YOLO_DEVICE 改为 cuda 或 auto")
            if not self.engine_path.exists():
                raise RuntimeError(f"TensorRT engine 不存在：{self.engine_path}，请先运行 export_yolo_accel.py")
            if not self.trt_onnx_path.exists():
                raise RuntimeError(f"TensorRT EP 需要无 NMS ONNX 模型：{self.trt_onnx_path}，请先导出 TensorRT 专用 ONNX")
            return backend, self.trt_onnx_path
        if backend == "onnx":
            if not self.onnx_path.exists():
                raise RuntimeError(f"ONNX 模型不存在：{self.onnx_path}，请先运行 export_yolo_accel.py")
            return backend, self.onnx_path
        return "pytorch", self.pytorch_model

    def _select_info(self) -> YoloRuntimeInfo:
        backend, model_path = self._select_backend()
        if not model_path.exists():
            raise RuntimeError(f"找不到 YOLO 模型：{model_path}")
        providers = self._available_providers()
        cuda_ready = (
            self._provider_ready("TensorrtExecutionProvider") if backend == "tensorrt"
            else self._provider_ready("CUDAExecutionProvider") if backend == "onnx"
            else self._torch_cuda_available()
        )
        if self.requested_device in {"cuda", "gpu", "0", "cuda:0"} and not cuda_ready:
            raise RuntimeError(f"已请求 CUDA，但 {backend} 后端不可用；可用 ONNX Provider：{providers or '无'}")
        use_cuda = cuda_ready and self.requested_device not in {"cpu", "0:cpu"}
        device = "0" if use_cuda else "cpu"
        provider = (
            "TensorrtExecutionProvider" if backend == "tensorrt" and use_cuda
            else "CUDAExecutionProvider" if backend == "onnx" and use_cuda
            else "torch-cuda" if backend == "pytorch" and use_cuda
            else "CPUExecutionProvider"
        )
        return YoloRuntimeInfo(backend, str(model_path), self.requested_device, device, provider)

    def load(self) -> Any:
        if self.info.backend in {"onnx", "tensorrt"}:
            if self.session is not None:
                return self.session
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError("ONNX Runtime 未安装，请安装 requirements-yolo-gpu.txt") from exc
            session_options = ort.SessionOptions()
            session_options.log_severity_level = 2
            if self.info.backend == "tensorrt":
                cache_path = self.engine_path.parent / ".trt-cache"
                cache_path.mkdir(parents=True, exist_ok=True)
                providers: list[Any] = [
                    ("TensorrtExecutionProvider", {
                        "trt_fp16_enable": True,
                        "trt_engine_cache_enable": True,
                        "trt_engine_cache_path": str(cache_path),
                    }),
                    ("CUDAExecutionProvider", {}),
                    "CPUExecutionProvider",
                ]
            else:
                providers = [self.info.provider]
                if self.info.provider != "CPUExecutionProvider":
                    providers.append("CPUExecutionProvider")
            self.session = ort.InferenceSession(
                self.info.model_path,
                sess_options=session_options,
                providers=providers,
            )
            actual = self.session.get_providers()[0] if self.session.get_providers() else "unknown"
            if self.info.backend == "tensorrt" and actual != "TensorrtExecutionProvider":
                if self.requested_backend == "auto":
                    self.requested_backend = "onnx"
                    self.info = self._select_info()
                    self.session = None
                    return self.load()
                raise RuntimeError(f"TensorRT Provider 未能加载，实际使用 {actual}")
            if self.info.device == "0" and actual != self.info.provider:
                raise RuntimeError(f"CUDA Provider 未能加载，实际使用 {actual}")
            self.input_name = self.session.get_inputs()[0].name
            return self.session
        if self.model is not None:
            return self.model
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("未安装 ultralytics，请安装 ai-service/requirements-yolo.txt") from exc
        self.model = YOLO(self.info.model_path)
        return self.model

    def predict(self, image: Any, confidence: float, image_size: int = 640) -> Any:
        if self.info.backend in {"onnx", "tensorrt"}:
            import cv2
            import numpy as np

            session = self.load()
            height, width = image.shape[:2]
            scale = min(image_size / width, image_size / height)
            resized_width = max(1, round(width * scale))
            resized_height = max(1, round(height * scale))
            resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
            canvas = np.full((image_size, image_size, 3), 114, dtype=np.uint8)
            pad_x = (image_size - resized_width) // 2
            pad_y = (image_size - resized_height) // 2
            canvas[pad_y:pad_y + resized_height, pad_x:pad_x + resized_width] = resized
            rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
            tensor = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
            return session.run(None, {self.input_name: tensor})[0], scale, pad_x, pad_y, width, height, confidence
        model = self.load()
        return model.predict(
            source=image,
            conf=confidence,
            imgsz=image_size,
            device=self.info.device,
            verbose=False,
        )[0]

    def detect(self, image: Any, confidence: float) -> list[dict[str, Any]]:
        """返回统一的检测字典，避免 ONNX 后端依赖 Ultralytics 的 ORT 探测。"""
        if self.info.backend in {"onnx", "tensorrt"}:
            output, scale, pad_x, pad_y, width, height, threshold = self.predict(image, confidence)
            return self._decode_onnx_output(output, scale, pad_x, pad_y, width, height, threshold)
        result = self.predict(image, confidence)
        names = getattr(self.model, "names", {})
        detections = []
        if result.boxes is not None:
            for box in result.boxes:
                class_id = int(box.cls[0])
                coords = [int(round(value)) for value in box.xyxy[0].tolist()]
                detections.append({
                    "className": str(names[class_id]),
                    "confidence": round(float(box.conf[0]), 3),
                    "x1": coords[0],
                    "y1": coords[1],
                    "x2": coords[2],
                    "y2": coords[3],
                })
        return detections

    @staticmethod
    def _decode_onnx_output(
        output: Any,
        scale: float,
        pad_x: int,
        pad_y: int,
        width: int,
        height: int,
        threshold: float,
    ) -> list[dict[str, Any]]:
        """解析带 NMS 的 [N,6] 或 TensorRT 友好的原始 [4+C,anchors] 输出。"""
        import numpy as np

        array = np.asarray(output)
        rows: list[tuple[float, float, float, float, float, int]] = []
        if array.ndim == 3 and array.shape[1] <= 128 and array.shape[2] > array.shape[1]:
            raw = array[0].T
            class_scores = raw[:, 4:]
            class_ids = class_scores.argmax(axis=1)
            scores = class_scores.max(axis=1)
            for box, score, class_id in zip(raw[:, :4], scores, class_ids):
                if float(score) < threshold:
                    continue
                cx, cy, box_width, box_height = [float(value) for value in box]
                rows.append((cx - box_width / 2, cy - box_height / 2, cx + box_width / 2, cy + box_height / 2, float(score), int(class_id)))
            rows.sort(key=lambda item: item[4], reverse=True)
            kept: list[tuple[float, float, float, float, float, int]] = []
            for candidate in rows:
                if len(kept) >= 300:
                    break
                overlaps = False
                for previous in kept:
                    if candidate[5] != previous[5]:
                        continue
                    left = max(candidate[0], previous[0])
                    top = max(candidate[1], previous[1])
                    right = min(candidate[2], previous[2])
                    bottom = min(candidate[3], previous[3])
                    intersection = max(0.0, right - left) * max(0.0, bottom - top)
                    area_a = max(0.0, candidate[2] - candidate[0]) * max(0.0, candidate[3] - candidate[1])
                    area_b = max(0.0, previous[2] - previous[0]) * max(0.0, previous[3] - previous[1])
                    union = area_a + area_b - intersection
                    if union > 0 and intersection / union > 0.45:
                        overlaps = True
                        break
                if not overlaps:
                    kept.append(candidate)
            rows = kept
        else:
            rows = [
                (float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), int(round(float(row[5]))))
                for row in array[0]
                if float(row[4]) >= threshold
            ]
        return [
            {
                "className": PCB_CLASS_NAMES[class_id] if 0 <= class_id < len(PCB_CLASS_NAMES) else str(class_id),
                "confidence": round(score, 3),
                "x1": max(0, min(width, round((x1 - pad_x) / scale))),
                "y1": max(0, min(height, round((y1 - pad_y) / scale))),
                "x2": max(0, min(width, round((x2 - pad_x) / scale))),
                "y2": max(0, min(height, round((y2 - pad_y) / scale))),
            }
            for x1, y1, x2, y2, score, class_id in rows
        ]

    def health(self) -> dict[str, Any]:
        info = self.info
        return {
            "backend": info.backend,
            "provider": info.provider,
            "device": info.device,
            "requestedDevice": info.requested_device,
            "model": info.model_path,
            "modelExists": Path(info.model_path).exists(),
            "engine": str(self.engine_path),
            "engineExists": self.engine_path.exists(),
            "trtOnnx": str(self.trt_onnx_path),
            "trtOnnxExists": self.trt_onnx_path.exists(),
            "loaded": self.model is not None or self.session is not None,
            "onnxRuntimeProviders": self._available_providers(),
        }
