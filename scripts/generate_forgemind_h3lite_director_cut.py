import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(r"D:\Minimax\ComfyUI\user\default\workflows\h3_w4a8_t2v_set_a_compat_api.json")
PROMPTS_PATH = Path(__file__).resolve().parents[1] / "video" / "forgemind-h3lite-director-cut-prompts.json"


def api(path, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def submit(item, workflow):
    graph = json.loads(json.dumps(workflow))
    graph["6"]["inputs"]["prompt"] = item["prompt"]
    graph["10"]["inputs"]["noise_seed"] = item["seed"]
    graph["15"]["inputs"]["filename_prefix"] = item["prefix"]
    payload = {"prompt": graph, "client_id": str(uuid.uuid4())}
    result = api("/prompt", payload, timeout=30)
    return result["prompt_id"]


def wait_for(prompt_id, label):
    started = time.time()
    while True:
        try:
            history = api(f"/history/{prompt_id}", None, timeout=10)
            record = history.get(prompt_id)
            if record and record.get("status", {}).get("completed"):
                outputs = record.get("outputs", {})
                print(json.dumps({"id": label, "prompt_id": prompt_id, "outputs": outputs}, ensure_ascii=False))
                return True
            if record and record.get("status", {}).get("status_str") == "error":
                print(json.dumps({"id": label, "prompt_id": prompt_id, "error": record}, ensure_ascii=False))
                return False
        except Exception as exc:
            print(f"poll warning for {label}: {exc}", file=sys.stderr)
        elapsed = int(time.time() - started)
        print(f"[H3Lite] {label}: {elapsed}s", flush=True)
        time.sleep(5)


def main():
    if not WORKFLOW_PATH.exists():
        raise SystemExit(f"workflow not found: {WORKFLOW_PATH}")
    if not PROMPTS_PATH.exists():
        raise SystemExit(f"prompt list not found: {PROMPTS_PATH}")
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    only = set(sys.argv[1:])
    if only:
        prompts = [item for item in prompts if item["id"] in only]
    print(f"queued={len(prompts)} workflow={WORKFLOW_PATH}", flush=True)
    for item in prompts:
        prompt_id = submit(item, workflow)
        print(json.dumps({"submitted": item["id"], "prompt_id": prompt_id}, ensure_ascii=False), flush=True)
        if not wait_for(prompt_id, item["id"]):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
