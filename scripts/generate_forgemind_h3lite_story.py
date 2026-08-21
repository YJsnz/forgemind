import json
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(r"D:\Minimax\ComfyUI\user\default\workflows\h3_w4a8_t2v_set_a_compat_api.json")
PROMPTS_PATH = Path(__file__).resolve().parents[1] / "video" / "forgemind-h3lite-story-remake-prompts.json"


def api(path, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def submit(item, workflow, index):
    graph = json.loads(json.dumps(workflow))
    graph["6"]["inputs"]["prompt"] = item["prompt"]
    graph["10"]["inputs"]["noise_seed"] = 31000 + index
    graph["15"]["inputs"]["filename_prefix"] = f"forgemind_story/{item['id']}"
    return api("/prompt", {"prompt": graph, "client_id": str(uuid.uuid4())})["prompt_id"]


def wait_for(prompt_id, label):
    started = time.time()
    while True:
        history = api(f"/history/{prompt_id}", None, timeout=10)
        record = history.get(prompt_id)
        if record and record.get("status", {}).get("completed"):
            print(json.dumps({"id": label, "prompt_id": prompt_id, "outputs": record.get("outputs", {})}, ensure_ascii=False), flush=True)
            return
        if record and record.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"H3Lite failed for {label}: {record}")
        print(f"[H3Lite story] {label}: {int(time.time() - started)}s", flush=True)
        time.sleep(5)


def main():
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    wanted = set(sys.argv[1:])
    if wanted:
        prompts = [item for item in prompts if item["id"] in wanted]
    print(f"queued={len(prompts)}", flush=True)
    for index, item in enumerate(prompts, 1):
        prompt_id = submit(item, workflow, index)
        print(json.dumps({"submitted": item["id"], "prompt_id": prompt_id}, ensure_ascii=False), flush=True)
        wait_for(prompt_id, item["id"])


if __name__ == "__main__":
    main()
