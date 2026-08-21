import json
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(r"D:\Minimax\ComfyUI\user\default\workflows\h3_w4a8_t2v_set_a_compat_api.json")
PROMPTS_PATH = Path(__file__).resolve().parents[1] / "video" / "forgemind-h3lite-v5-long-prompts.json"
TARGET_FRAMES = 288  # H3 aligns this to 294 frames on its 17k+5 temporal grid (~12.25s at 24fps).
SCALE_PREFIX = (
    "大型三层智能制造工厂，明确只有三层：L1、L2、L3，没有地下层、夹层或第四层；"
    "三层属于同一座巨大的连续工业厂房，每层都有很高的厂房层高、长距离主通道、深远的透视消失点、"
    "多组设备岛、长输送线、宽阔地面网格和远端缓存区，画面必须有明显的大尺度生产空间和纵深，"
    "不要小房间，不要小型实验室，不要单间工作室，不要局促的展示柜，不要把工厂缩成几台设备。"
)


def api(path, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def submit(item, workflow):
    graph = json.loads(json.dumps(workflow))
    graph["6"]["inputs"]["prompt"] = SCALE_PREFIX + item["prompt"]
    graph["6"]["inputs"]["length"] = item.get("length_frames", TARGET_FRAMES)
    graph["10"]["inputs"]["noise_seed"] = item["seed"]
    graph["15"]["inputs"]["filename_prefix"] = item["prefix"]
    payload = {"prompt": graph, "client_id": str(uuid.uuid4())}
    result = api("/prompt", payload, timeout=30)
    return result["prompt_id"]


def wait_for(prompt_id, label):
    started = time.time()
    while True:
        history = api(f"/history/{prompt_id}", None, timeout=10)
        record = history.get(prompt_id)
        if record and record.get("status", {}).get("completed"):
            outputs = record.get("outputs", {})
            print(json.dumps({"id": label, "prompt_id": prompt_id, "outputs": outputs}, ensure_ascii=False), flush=True)
            return
        if record and record.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"H3Lite V5 failed for {label}: {record}")
        print(f"[H3Lite V5 / 12s] {label}: {int(time.time() - started)}s", flush=True)
        time.sleep(5)


def main():
    if not WORKFLOW_PATH.exists():
        raise SystemExit(f"workflow not found: {WORKFLOW_PATH}")
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    requested = set(sys.argv[1:])
    if requested:
        prompts = [item for item in prompts if item["id"] in requested]
    if not prompts:
        raise SystemExit("no matching V5 prompts")
    print(f"queued={len(prompts)} requested_frames={TARGET_FRAMES} workflow={WORKFLOW_PATH}", flush=True)
    for item in prompts:
        prompt_id = submit(item, workflow)
        print(json.dumps({"submitted": item["id"], "prompt_id": prompt_id, "requested_frames": TARGET_FRAMES}, ensure_ascii=False), flush=True)
        wait_for(prompt_id, item["id"])


if __name__ == "__main__":
    main()
