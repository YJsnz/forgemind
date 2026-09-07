import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import { KernelReferenceError, KernelValidationError } from "../core/kernel/KernelErrors.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { MM_PER_WORLD_UNIT, mmToWorld } from "../core/viewport/KernelMeshAdapter.ts";

const testWasmUrl = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const rectangleProfile = {
  id: "test-rectangle",
  outer: [
    { type: "line", start: [0, 0], end: [100, 0] },
    { type: "line", start: [100, 0], end: [100, 60] },
    { type: "line", start: [100, 60], end: [0, 60] },
    { type: "line", start: [0, 60], end: [0, 0] },
  ],
  holes: [],
};
const plane = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
};

let kernel;
let shape;
let tessellation;

before(async () => {
  kernel = new OcctKernel({ wasm: testWasmUrl });
  await kernel.init();
  shape = await kernel.extrude({ profile: rectangleProfile, plane }, { distanceMm: 20, direction: "positive" });
  tessellation = await kernel.tessellate(shape, { linearDeflectionMm: .05, angularDeflectionDeg: .2 });
});

after(async () => {
  await kernel?.dispose();
});

test("OcctKernel init succeeds", () => assert.ok(kernel));

test("repeated init is safe", async () => {
  await kernel.init();
  assert.ok(kernel);
});

test("rectangle profile creates a B-Rep extrusion", () => assert.match(shape.id, /^shape-\d+$/));

test("100 by 60 by 20 extrusion has the expected bounding box", async () => {
  const properties = await kernel.getShapeProperties(shape);
  assert.deepEqual(properties.boundingBox, {
    min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 60, z: 20 },
  });
});

test("extrusion volume is 120000 cubic millimetres", async () => {
  const properties = await kernel.getShapeProperties(shape);
  assert.ok(Math.abs(properties.volumeMm3 - 120000) < .001);
});

test("extrusion surface area is valid", async () => {
  const properties = await kernel.getShapeProperties(shape);
  assert.ok(Math.abs(properties.surfaceAreaMm2 - 18400) < .001);
});

test("B-Rep validation reports a valid solid", async () => {
  assert.deepEqual(await kernel.validate(shape), { valid: true, issues: [] });
});

test("tessellation has position data", () => assert.ok(tessellation.positions.length > 0));
test("tessellation has index data", () => assert.ok(tessellation.indices.length > 0));
test("tessellation triangle count matches its index buffer", () => assert.equal(tessellation.indices.length / 3, tessellation.triangleFaceIndices.length));
test("every tessellated triangle maps to a valid face", () => {
  assert.ok(Array.from(tessellation.triangleFaceIndices).every((faceIndex) => faceIndex < tessellation.faces.length));
});

test("disposeShape is idempotent", async () => {
  const disposable = await kernel.extrude({ profile: rectangleProfile, plane }, { distanceMm: 1, direction: "positive" });
  await kernel.disposeShape(disposable);
  await kernel.disposeShape(disposable);
});

test("released shapes fail with KernelReferenceError", async () => {
  const disposable = await kernel.extrude({ profile: rectangleProfile, plane }, { distanceMm: 1, direction: "positive" });
  await kernel.disposeShape(disposable);
  await assert.rejects(() => kernel.validate(disposable), KernelReferenceError);
});

test("zero distance extrusion is rejected before OCCT", async () => {
  await assert.rejects(
    () => kernel.extrude({ profile: rectangleProfile, plane }, { distanceMm: 0, direction: "positive" }),
    KernelValidationError,
  );
});

test("open profiles are rejected before OCCT", async () => {
  const openProfile = { ...rectangleProfile, outer: rectangleProfile.outer.slice(0, 3) };
  await assert.rejects(
    () => kernel.extrude({ profile: openProfile, plane }, { distanceMm: 20, direction: "positive" }),
    KernelValidationError,
  );
});

test("kernel tessellation remains in millimetres", () => assert.equal(Math.max(...tessellation.positions), 100));
test("viewport adapter maps 1000 mm to one world unit", () => {
  assert.equal(MM_PER_WORLD_UNIT, 1000);
  assert.equal(mmToWorld(1000), 1);
});

test("OcctKernel keeps Three.js out of core/kernel", async () => {
  const source = await readFile(new URL("../core/kernel/OcctKernel.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']three|THREE\./);
});

test("Feature Domain still has no kernel import", async () => {
  const source = await readFile(new URL("../core/features/LegacyFeatureAdapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /core\/kernel|OcctKernel|CadKernel/);
});
