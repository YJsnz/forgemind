import json
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(r"D:\Minimax\ComfyUI\user\default\workflows\h3_w4a8_t2v_set_a_compat_api.json")
PROMPTS_PATH = Path(__file__).resolve().parents[1] / "video" / "forgemind-h3lite-v3-prompts.json"


def api(path, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def submit(item, workflow):
    graph = json.loads(json.dumps(workflow))
    graph["6"]["inputs"]["prompt"] = item["prompt"]
    graph["6"]["inputs"]["length"] = item.get("length", 192)
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
            print(json.dumps({"id": label, "prompt_id": prompt_id, "outputs": outputs}, ensure_ascii=False))
            return
        if record and record.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"H3Lite failed for {label}: {record}")
        print(f"[H3Lite V3] {label}: {int(time.time() - started)}s", flush=True)
        time.sleep(5)


def main():
    if not WORKFLOW_PATH.exists():
        raise SystemExit(f"workflow not found: {WORKFLOW_PATH}")
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    requested = set(sys.argv[1:])
    if requested:
        prompts = [item for item in prompts if item["id"] in requested]
    print(f"queued={len(prompts)} workflow={WORKFLOW_PATH}", flush=True)
    for item in prompts:
        prompt_id = submit(item, workflow)
        print(json.dumps({"submitted": item["id"], "prompt_id": prompt_id}, ensure_ascii=False), flush=True)
        wait_for(prompt_id, item["id"])


if __name__ == "__main__":
    main()
