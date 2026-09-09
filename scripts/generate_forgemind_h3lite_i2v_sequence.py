import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(r"D:\Minimax\ComfyUI\user\default\workflows\h3_w4a8_i2v_set_a_compat_api.json")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROMPTS_PATH = PROJECT_ROOT / "video" / "forgemind-h3lite-v8-continuity-prompts.json"
OUTPUT_DIR = PROJECT_ROOT / "video" / "generated-v8"
COMFY_OUTPUT_DIR = Path(r"D:\Minimax\ComfyUI\output")


def api(path, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(
        BASE + path,
        data=body,
        headers=headers,
        method="POST" if body is not None else "GET",
    )
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def upload_image(path):
    path = Path(path).resolve()
    content = path.read_bytes()
    boundary = f"----ForgeMind{uuid.uuid4().hex}"
    parts = []

    def add_field(name, value):
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode("utf-8")
        )

    add_field("type", "input")
    add_field("overwrite", "true")
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
            "Content-Type: image/png\r\n\r\n"
        ).encode("utf-8")
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    request = Request(
        BASE + "/upload/image",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    name = result["name"]
    if result.get("subfolder"):
        name = f"{result['subfolder']}/{name}"
    return name


def submit(item, workflow, first_frame_name):
    graph = json.loads(json.dumps(workflow))
    graph["6"]["inputs"]["prompt"] = item["prompt"]
    graph["6"]["inputs"]["length"] = item.get("length", 192)
    graph["6"]["inputs"]["width"] = item.get("width", 640)
    graph["6"]["inputs"]["height"] = item.get("height", 352)
    graph["20"]["inputs"]["image"] = first_frame_name
    graph["10"]["inputs"]["noise_seed"] = item["seed"]
    graph["15"]["inputs"]["filename_prefix"] = item["prefix"]
    payload = {"prompt": graph, "client_id": str(uuid.uuid4())}
    result = api("/prompt", payload, timeout=30)
    return result["prompt_id"]


def wait_for(prompt_id, label):
    started = time.time()
    while True:
        history = api(f"/history/{quote(prompt_id, safe='')}", None, timeout=10)
        record = history.get(prompt_id)
        if record and record.get("status", {}).get("completed"):
            outputs = record.get("outputs", {})
            print(json.dumps({"id": label, "prompt_id": prompt_id, "outputs": outputs}, ensure_ascii=False), flush=True)
            return outputs
        if record and record.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"H3Lite failed for {label}: {record}")
        elapsed = int(time.time() - started)
        print(f"[H3Lite I2V] {label}: {elapsed}s", flush=True)
        time.sleep(5)


def resolve_output(outputs):
    images = outputs.get("15", {}).get("images", [])
    if not images:
        raise RuntimeError("ComfyUI completed without a video output")
    item = images[0]
    source = COMFY_OUTPUT_DIR / item.get("subfolder", "") / item["filename"]
    if not source.exists():
        raise FileNotFoundError(source)
    return source


def extract_last_frame(video_path, frame_path):
    frame_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-sseof",
        "-0.2",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        str(frame_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not frame_path.exists():
        raise RuntimeError(f"Unable to extract last frame from {video_path}: {result.stderr}")


def main():
    prompt_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT_PROMPTS_PATH
    only = {arg for arg in sys.argv[1:] if not arg.startswith("--") and Path(arg).suffix != ".json"}
    if not WORKFLOW_PATH.exists():
        raise SystemExit(f"I2V workflow not found: {WORKFLOW_PATH}")
    if not prompt_path.exists():
        raise SystemExit(f"Prompt file not found: {prompt_path}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    items = json.loads(prompt_path.read_text(encoding="utf-8"))
    if only:
        items = [item for item in items if item["id"] in only]
    print(f"queued={len(items)} workflow={WORKFLOW_PATH}", flush=True)
    previous_frame = None
    for item in items:
        if item.get("chain_from_previous"):
            if previous_frame is None:
                if not item.get("first_frame"):
                    raise RuntimeError(f"{item['id']} requests chaining but no previous output exists")
                frame_path = (PROJECT_ROOT / item["first_frame"]).resolve()
            else:
                frame_path = previous_frame
        else:
            frame_path = (PROJECT_ROOT / item["first_frame"]).resolve()
        if not frame_path.exists():
            raise FileNotFoundError(frame_path)
        uploaded_name = upload_image(frame_path)
        prompt_id = submit(item, workflow, uploaded_name)
        print(json.dumps({"submitted": item["id"], "prompt_id": prompt_id}, ensure_ascii=False), flush=True)
        outputs = wait_for(prompt_id, item["id"])
        source = resolve_output(outputs)
        destination = OUTPUT_DIR / f"{item['prefix']}_00001_.mp4"
        shutil.copy2(source, destination)
        previous_frame = OUTPUT_DIR / f"{item['prefix']}_last.png"
        extract_last_frame(destination, previous_frame)
        print(json.dumps({"saved": str(destination), "last_frame": str(previous_frame)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
