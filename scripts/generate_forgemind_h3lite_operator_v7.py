import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(r"D:\Minimax\ComfyUI\user\default\workflows\h3_w4a8_t2v_set_a_compat_api.json")
PROMPTS_PATH = Path(__file__).resolve().parents[1] / "video" / "forgemind-h3lite-operator-v7-prompts.json"
OUTPUT_PREFIX = os.getenv("FORGEMIND_H3_PREFIX", "forgemind_operator_v7")
CHARACTER_SUFFIX = (
    "统一操作员角色：年轻东亚女性小伊，22到25岁，短栗色bob头，右侧青绿色小发夹，"
    "圆框透明护目镜，黑青色轻量工装，ForgeMind黄色细线和抽象黄色徽章，可爱、聪明、专业；"
    "需要人物时保持同一外观，不做口型同步，不说话。"
)


def api(path, payload=None, timeout=60):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for(prompt_id, label):
    started = time.time()
    while True:
        record = api(f"/history/{prompt_id}").get(prompt_id)
        if record and record.get("status", {}).get("completed"):
            print(json.dumps({"id": label, "outputs": record.get("outputs", {})}, ensure_ascii=False), flush=True)
            return
        if record and record.get("status", {}).get("status_str") == "error":
            raise RuntimeError(f"H3Lite failed for {label}: {record}")
        print(f"[H3Lite operator V7] {label}: {int(time.time() - started)}s", flush=True)
        time.sleep(8)


def main():
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    wanted = set(sys.argv[1:])
    if wanted:
        prompts = [item for item in prompts if item["id"] in wanted]
    print(f"queued={len(prompts)}", flush=True)
    for index, item in enumerate(prompts, 1):
        graph = json.loads(json.dumps(workflow))
        graph["6"]["inputs"]["prompt"] = item["prompt"] + " " + CHARACTER_SUFFIX
        graph["10"]["inputs"]["noise_seed"] = 51000 + index
        graph["15"]["inputs"]["filename_prefix"] = f"{OUTPUT_PREFIX}/{item['id']}"
        result = api("/prompt", {"prompt": graph, "client_id": str(uuid.uuid4())})
        print(json.dumps({"submitted": item["id"], "prompt_id": result["prompt_id"]}, ensure_ascii=False), flush=True)
        wait_for(result["prompt_id"], item["id"])


if __name__ == "__main__":
    main()
