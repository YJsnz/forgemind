import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { KernelInitializationError, KernelOperationError, KernelReferenceError, KernelValidationError } from "../core/kernel/KernelErrors.ts";
import { clearCadKernel, getCadKernel, hasCadKernel, setCadKernel } from "../core/kernel/KernelManager.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const featureDirectory = new URL("../core/kernel/", import.meta.url);

test("Kernel profile circles are explicit and free of full-arc ambiguity", () => {
  const sketch = {
    id: "circle-sketch", name: "Circle", plane: { type: "XY", offset: 0 },
    entities: { circle: { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 10, construction: false } },
    entityOrder: ["circle"], constraints: {}, dimensions: {},
  };
  const profile = buildSketchProfiles(sketch).profiles[0].outer[0];
  assert.equal(profile.type, "circle");
  assert.equal(profile.radius, 10);
});

test("CadKernel boundary declares asynchronous lifecycle and geometry operations", async () => {
  const source = await readFile(new URL("../core/kernel/CadKernel.ts", import.meta.url), "utf8");
  for (const method of ["init", "dispose", "extrude", "revolve", "booleanUnion", "booleanCut", "booleanIntersect", "fillet", "chamfer", "shell", "validate", "heal", "tessellate"]) {
    assert.match(source, new RegExp(`${method}\\([\\s\\S]*?Promise<`));
  }
});

test("Kernel contract names millimetres and degrees at its boundary", async () => {
  const source = await readFile(new URL("../core/kernel/KernelTypes.ts", import.meta.url), "utf8");
  assert.match(source, /distanceMm/);
  assert.match(source, /angleDeg/);
  assert.match(source, /linearDeflectionMm/);
  assert.match(source, /angularDeflectionDeg/);
});

test("KernelShapeRef is an opaque id and revision", async () => {
  const source = await readFile(new URL("../core/kernel/KernelTypes.ts", import.meta.url), "utf8");
  assert.match(source, /interface KernelShapeRef[\s\S]*?id: KernelShapeId;[\s\S]*?revision: number/);
  assert.doesNotMatch(source, /TopoDS|WASM|BufferGeometry|Mesh/);
});

test("Kernel topology references are explicitly ephemeral", async () => {
  const source = await readFile(new URL("../core/kernel/KernelTypes.ts", import.meta.url), "utf8");
  assert.match(source, /interface KernelTopologyRef[\s\S]*?shapeId: KernelShapeId;[\s\S]*?localId: string/);
  assert.match(source, /Ephemeral topology reference/);
});

test("Kernel tessellation is typed-array data without viewport geometry", async () => {
  const source = await readFile(new URL("../core/kernel/KernelTypes.ts", import.meta.url), "utf8");
  assert.match(source, /positions: Float32Array \| Float64Array/);
  assert.match(source, /triangleFaceIndices: Uint32Array/);
  assert.doesNotMatch(source, /BufferGeometry|THREE\./);
});

test("Kernel manager exposes a kernel only through the boundary", () => {
  clearCadKernel();
  const kernel = { label: "test-kernel" };
  setCadKernel(kernel);
  assert.equal(hasCadKernel(), true);
  assert.equal(getCadKernel(), kernel);
  clearCadKernel();
  assert.equal(hasCadKernel(), false);
});

test("Kernel manager returns a typed initialization error when empty", () => {
  clearCadKernel();
  assert.throws(() => getCadKernel(), (error) => error instanceof KernelInitializationError && error.code === "KERNEL_NOT_REGISTERED");
});

test("Kernel error types retain code and operation", () => {
  const operation = new KernelOperationError("extrude", "failed", "EXTRUDE_FAILED");
  const validation = new KernelValidationError("booleanCut", "tools required", "EMPTY_TOOLS");
  const reference = new KernelReferenceError("fillet", "edge required", "NOT_EDGE");
  assert.deepEqual([operation.code, operation.operation, validation.code, reference.operation], ["EXTRUDE_FAILED", "extrude", "EMPTY_TOOLS", "fillet"]);
});

test("core kernel keeps Three.js and React outside the kernel boundary", async () => {
  const files = await readdir(featureDirectory);
  const contents = await Promise.all(files.filter((file) => file.endsWith(".ts")).map((file) => readFile(new URL(`../core/kernel/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/from\s+["']three|THREE\.|from\s+["']react/.test(content)));
});

test("Kernel boundary has no legacy geometry evaluator", async () => {
  const files = await readdir(featureDirectory);
  const contents = await Promise.all(files.filter((file) => file.endsWith(".ts")).map((file) => readFile(new URL(`../core/kernel/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/new\s+THREE|ExtrudeGeometry|LatheGeometry|evaluateExtrude/.test(content)));
});

test("page runtime does not initialize or retain a CadKernel", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /CadKernel|setCadKernel|getCadKernel|useState<[^>]*CadDocument/);
});

test("existing Legacy Three.js geometry entry points remain outside the kernel", async () => {
  const [workbench, page] = await Promise.all([
    readFile(new URL("../app/ThreeWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(workbench, /new THREE\.ExtrudeGeometry/);
  assert.match(page, /new THREE\.LatheGeometry/);
});
