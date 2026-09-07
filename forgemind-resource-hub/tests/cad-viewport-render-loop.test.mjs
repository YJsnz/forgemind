import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createCadViewportRenderLoop } from "../app/kernel-debug/CadViewportRenderLoop.ts";

const createManualScheduler = () => {
  let nextHandle = 1;
  const callbacks = new Map();
  return {
    scheduler: {
      request(callback) { const handle = nextHandle++; callbacks.set(handle, callback); return handle; },
      cancel(handle) { callbacks.delete(handle); },
    },
    get pending() { return callbacks.size; },
    flush() {
      const entry = callbacks.entries().next().value;
      if (!entry) return false;
      const [handle, callback] = entry;
      callbacks.delete(handle);
      callback(0);
      return true;
    },
  };
};

test("viewport render loop coalesces repeated invalidations into one frame", () => {
  const manual = createManualScheduler();
  let renders = 0;
  const loop = createCadViewportRenderLoop({ render: () => { renders += 1; }, updateControls: () => false, scheduler: manual.scheduler });
  loop.requestRender(); loop.requestRender(); loop.requestRender();
  assert.equal(manual.pending, 1);
  manual.flush();
  assert.equal(renders, 1);
  assert.equal(manual.pending, 0);
});

test("viewport render loop continues through orbit interaction and damping", () => {
  const manual = createManualScheduler();
  const updates = [true, true, false];
  let renders = 0;
  const loop = createCadViewportRenderLoop({ render: () => { renders += 1; }, updateControls: () => updates.shift() ?? false, scheduler: manual.scheduler });
  loop.setInteracting(true);
  manual.flush();
  assert.equal(manual.pending, 1);
  loop.setInteracting(false);
  manual.flush();
  assert.equal(manual.pending, 1, "damping keeps one more frame scheduled");
  manual.flush();
  assert.equal(manual.pending, 0);
  assert.equal(renders, 2);
});

test("disposing the viewport cancels pending frames and blocks future work", () => {
  const manual = createManualScheduler();
  let renders = 0;
  const loop = createCadViewportRenderLoop({ render: () => { renders += 1; }, updateControls: () => true, scheduler: manual.scheduler });
  loop.requestRender();
  assert.equal(manual.pending, 1);
  loop.dispose();
  assert.equal(manual.pending, 0);
  loop.requestRender(); loop.setInteracting(true);
  assert.equal(manual.pending, 0);
  assert.equal(renders, 0);
});

test("professional workbench rejects stale asynchronous viewport builds", async () => {
  const source = await readFile(new URL("../app/kernel-debug/OcctKernelDebug.tsx", import.meta.url), "utf8");
  assert.match(source, /const viewportBuildId = \+\+viewportBuildIdRef\.current/);
  assert.match(source, /renderStateRef\.current = \{ dispose: disposeViewport \}/);
  assert.match(source, /disposed \|\| viewportBuildId !== viewportBuildIdRef\.current/);
  assert.match(source, /renderer\.domElement\.parentElement === host/);
});
