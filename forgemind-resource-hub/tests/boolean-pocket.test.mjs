import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCadDocument, toSerializableCadDocument } from "../core/cad/CadDocument.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, recordFeatureEvaluationResult, replaceFeatureShape } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { KernelOperationError, KernelReferenceError, KernelValidationError } from "../core/kernel/KernelErrors.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const testWasmUrl = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const frameFor = (plane = "XY") => plane === "XY"
  ? { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } }
  : plane === "XZ"
    ? { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 0, z: 1 }, normal: { x: 0, y: -1, z: 0 } }
    : { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 0, y: 1, z: 0 }, yAxis: { x: 0, y: 0, z: 1 }, normal: { x: 1, y: 0, z: 0 } };

const closedRectangle = (width, height, x = 0, y = 0) => ({
  id: `profile-${x}-${y}-${width}-${height}`,
  outer: [
    { type: "line", start: [x, y], end: [x + width, y] },
    { type: "line", start: [x + width, y], end: [x + width, y + height] },
    { type: "line", start: [x + width, y + height], end: [x, y + height] },
    { type: "line", start: [x, y + height], end: [x, y] },
  ],
  holes: [],
});

const sketch = (id, width, height, x = 0, y = 0, plane = "XY") => ({
  id, name: id, plane: { type: plane, offset: 0 },
  entities: {
    [`${id}-1`]: { id: `${id}-1`, type: "line", start: { x, y }, end: { x: x + width, y }, construction: false },
    [`${id}-2`]: { id: `${id}-2`, type: "line", start: { x: x + width, y }, end: { x: x + width, y: y + height }, construction: false },
    [`${id}-3`]: { id: `${id}-3`, type: "line", start: { x: x + width, y: y + height }, end: { x, y: y + height }, construction: false },
    [`${id}-4`]: { id: `${id}-4`, type: "line", start: { x, y: y + height }, end: { x, y }, construction: false },
  },
  entityOrder: [`${id}-1`, `${id}-2`, `${id}-3`, `${id}-4`], constraints: {}, dimensions: {},
});

const makePocketDocument = ({ plane = "XY", baseWidth = 100, baseHeight = 60, pocketWidth = 20, pocketHeight = 20, pocketX = 40, pocketY = 20, depth = { type: "throughAll" } } = {}) => createCadDocument({
  id: "pocket-document", name: "Pocket Document",
  sketches: {
    Sketch01: sketch("Sketch01", baseWidth, baseHeight, 0, 0, plane),
    Sketch02: sketch("Sketch02", pocketWidth, pocketHeight, pocketX, pocketY, plane),
  },
  features: {
    Extrude01: { id: "Extrude01", name: "Extrude01", type: "extrude", sketchId: "Sketch01", distance: 20, direction: "positive", operation: "new", enabled: true, state: "clean", dependencies: [] },
    Pocket01: { id: "Pocket01", name: "Pocket01", type: "pocket", sketchId: "Sketch02", targetFeatureId: "Extrude01", depth, direction: "positive", enabled: true, state: "clean", dependencies: ["Extrude01"] },
  },
  featureOrder: ["Extrude01", "Pocket01"],
});

let kernel;

const contextFor = (document, runtime, activeKernel = kernel) => ({
  document, kernel: activeKernel, runtime, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles,
});

const success = (result) => {
  assert.equal(result.status, "success", result.status === "failed" ? result.error.message : "");
  return result;
};

const evaluateExtrude = async (document, runtime, activeKernel = kernel) => {
  const result = success(await evaluateFeature("Extrude01", contextFor(document, runtime, activeKernel)));
  recordFeatureEvaluationResult(runtime, result);
  await replaceFeatureShape(runtime, activeKernel, result.featureId, result.shape);
  return result;
};

const evaluatePocket = async (document, runtime, activeKernel = kernel) => {
  const result = await evaluateFeature("Pocket01", contextFor(document, runtime, activeKernel));
  recordFeatureEvaluationResult(runtime, result);
  if (result.status === "success") await replaceFeatureShape(runtime, activeKernel, result.featureId, result.shape);
  return result;
};

const close = async (...shapes) => Promise.all(shapes.filter(Boolean).map((shape) => kernel.disposeShape(shape)));

before(async () => {
  kernel = new OcctKernel({ wasm: testWasmUrl });
  await kernel.init();
});

after(async () => {
  await kernel?.dispose();
});

test("OCCT boolean capabilities are enabled", async () => {
  const capabilities = await kernel.getCapabilities();
  assert.equal(capabilities.booleanUnion, true);
  assert.equal(capabilities.booleanCut, true);
  assert.equal(capabilities.booleanIntersect, true);
});

test("Boolean Cut creates a valid 112000 mm3 solid without changing input shapes", async () => {
  const target = await kernel.extrude({ profile: closedRectangle(100, 60), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const tool = await kernel.extrude({ profile: closedRectangle(20, 20, 40, 20), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const result = await kernel.booleanCut(target, [tool]);
  assert.equal((await kernel.getShapeProperties(result)).volumeMm3, 112000);
  assert.equal((await kernel.validate(result)).valid, true);
  assert.equal((await kernel.validate(target)).valid, true);
  assert.equal((await kernel.validate(tool)).valid, true);
  await close(target, tool, result);
});

test("Boolean Union and Intersect return expected real B-Rep volumes", async () => {
  const left = await kernel.extrude({ profile: closedRectangle(100, 60), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const right = await kernel.extrude({ profile: closedRectangle(100, 60, 50), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const union = await kernel.booleanUnion(left, [right]);
  const intersection = await kernel.booleanIntersect(left, [right]);
  assert.ok(Math.abs((await kernel.getShapeProperties(union)).volumeMm3 - 180000) < 1e-6);
  assert.ok(Math.abs((await kernel.getShapeProperties(intersection)).volumeMm3 - 60000) < 1e-6);
  assert.equal((await kernel.validate(left)).valid, true);
  assert.equal((await kernel.validate(right)).valid, true);
  await close(left, right, union, intersection);
});

test("A compound Boolean result with multiple solids is rejected explicitly", async () => {
  const left = await kernel.extrude({ profile: closedRectangle(20, 20), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const right = await kernel.extrude({ profile: closedRectangle(20, 20, 40), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  await assert.rejects(
    () => kernel.booleanUnion(left, [right]),
    (error) => error instanceof KernelOperationError && error.code === "BOOLEAN_COMPOUND_MULTIPLE_SOLIDS",
  );
  assert.equal((await kernel.validate(left)).valid, true);
  assert.equal((await kernel.validate(right)).valid, true);
  await close(left, right);
});

test("Boolean tools cannot be empty and released inputs remain rejected", async () => {
  const target = await kernel.extrude({ profile: closedRectangle(10, 10), plane: frameFor() }, { distanceMm: 10, direction: "positive" });
  await assert.rejects(() => kernel.booleanCut(target, []), KernelValidationError);
  await kernel.disposeShape(target);
  await assert.rejects(() => kernel.booleanUnion(target, [target]), KernelReferenceError);
});

test("Boolean result tessellation maps every triangle to a final B-Rep face", async () => {
  const target = await kernel.extrude({ profile: closedRectangle(100, 60), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const tool = await kernel.extrude({ profile: closedRectangle(20, 20, 40, 20), plane: frameFor() }, { distanceMm: 20, direction: "positive" });
  const result = await kernel.booleanCut(target, [tool]);
  const mesh = await kernel.tessellate(result, { linearDeflectionMm: .05, angularDeflectionDeg: .2 });
  assert.equal(mesh.triangleFaceIndices.length, mesh.indices.length / 3);
  assert.ok(mesh.faces.length >= 6);
  await close(target, tool, result);
});

test("Through All Pocket subtracts 20 by 20 from 100 by 60 by 20 and preserves its bbox", async () => {
  const document = makePocketDocument();
  const runtime = createCadRuntimeState();
  try {
    const extrude = await evaluateExtrude(document, runtime);
    const pocket = success(await evaluatePocket(document, runtime));
    assert.equal((await kernel.getShapeProperties(extrude.shape)).volumeMm3, 120000);
    const properties = await kernel.getShapeProperties(pocket.shape);
    assert.equal(properties.volumeMm3, 112000);
    assert.deepEqual(properties.boundingBox, { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 60, z: 20 } });
    assert.equal((await kernel.validate(extrude.shape)).valid, true);
    assert.equal((await kernel.validate(pocket.shape)).valid, true);
  } finally {
    await disposeCadRuntimeState(runtime, kernel);
  }
});

test("Through All Pocket works on XY, XZ, and YZ datum planes", async () => {
  for (const plane of ["XY", "XZ", "YZ"]) {
    const runtime = createCadRuntimeState();
    try {
      const document = makePocketDocument({ plane });
      await evaluateExtrude(document, runtime);
      const pocket = success(await evaluatePocket(document, runtime));
      assert.ok(Math.abs((await kernel.getShapeProperties(pocket.shape)).volumeMm3 - 112000) < 1e-6, plane);
    } finally {
      await disposeCadRuntimeState(runtime, kernel);
    }
  }
});

test("Pocket requires a retained, already-evaluated target Feature", async () => {
  const document = makePocketDocument();
  const runtime = createCadRuntimeState();
  const result = await evaluatePocket(document, runtime);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TARGET_FEATURE_NOT_EVALUATED");
});

test("Pocket supports a Blind depth without changing the runtime target", async () => {
  const document = makePocketDocument({ depth: { type: "blind", value: 5 } });
  const runtime = createCadRuntimeState();
  try {
    const extrude = await evaluateExtrude(document, runtime);
    const result = success(await evaluatePocket(document, runtime));
    assert.ok(Math.abs((await kernel.getShapeProperties(result.shape)).volumeMm3 - 118000) < 1e-6);
    assert.notEqual(result.shape.id, extrude.shape.id);
    assert.equal(runtime.featureShapes.get("Extrude01").id, extrude.shape.id);
  } finally {
    await disposeCadRuntimeState(runtime, kernel);
  }
});

test("Pocket reports no intersection and complete removal as structured failures", async () => {
  const outsideRuntime = createCadRuntimeState();
  try {
    const outside = makePocketDocument({ pocketX: 200 });
    await evaluateExtrude(outside, outsideRuntime);
    const result = await evaluatePocket(outside, outsideRuntime);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "POCKET_NO_INTERSECTION");
  } finally {
    await disposeCadRuntimeState(outsideRuntime, kernel);
  }
  const fullRuntime = createCadRuntimeState();
  try {
    const full = makePocketDocument({ pocketWidth: 100, pocketHeight: 60, pocketX: 0, pocketY: 0 });
    await evaluateExtrude(full, fullRuntime);
    const result = await evaluatePocket(full, fullRuntime);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "POCKET_REMOVES_ENTIRE_BODY");
  } finally {
    await disposeCadRuntimeState(fullRuntime, kernel);
  }
});

test("Pocket re-evaluation keeps its Feature ID, replaces only its downstream runtime shape, and retains Extrude", async () => {
  const runtime = createCadRuntimeState();
  try {
    const firstDocument = makePocketDocument();
    const extrude = await evaluateExtrude(firstDocument, runtime);
    const first = success(await evaluatePocket(firstDocument, runtime));
    const secondDocument = makePocketDocument({ pocketWidth: 30 });
    const second = success(await evaluatePocket(secondDocument, runtime));
    assert.equal(first.featureId, second.featureId);
    assert.equal((await kernel.getShapeProperties(second.shape)).volumeMm3, 108000);
    assert.equal(runtime.featureShapes.get("Extrude01").id, extrude.shape.id);
    await assert.rejects(() => kernel.validate(first.shape), KernelReferenceError);
  } finally {
    await disposeCadRuntimeState(runtime, kernel);
  }
});

test("Pocket consumes the latest upstream Extrude result after upstream re-evaluation", async () => {
  const runtime = createCadRuntimeState();
  try {
    const initial = makePocketDocument();
    const firstExtrude = await evaluateExtrude(initial, runtime);
    success(await evaluatePocket(initial, runtime));
    const changed = makePocketDocument({ baseWidth: 150 });
    const latestExtrude = await evaluateExtrude(changed, runtime);
    const latestPocket = success(await evaluatePocket(changed, runtime));
    assert.ok(Math.abs((await kernel.getShapeProperties(latestPocket.shape)).volumeMm3 - 172000) < 1e-6);
    assert.equal(runtime.featureShapes.get("Extrude01").id, latestExtrude.shape.id);
    await assert.rejects(() => kernel.validate(firstExtrude.shape), KernelReferenceError);
  } finally {
    await disposeCadRuntimeState(runtime, kernel);
  }
});

test("Pocket tool Shape is disposed while upstream and result shapes stay retained", async () => {
  const calls = [];
  const tracingKernel = {
    getShapeProperties: (...args) => kernel.getShapeProperties(...args),
    extrude: (...args) => kernel.extrude(...args),
    booleanCut: (...args) => kernel.booleanCut(...args),
    validate: (...args) => kernel.validate(...args),
    disposeShape: async (shape) => {
      calls.push(shape.id);
      return kernel.disposeShape(shape);
    },
  };
  const runtime = createCadRuntimeState();
  try {
    const document = makePocketDocument();
    const extrude = await evaluateExtrude(document, runtime, tracingKernel);
    const pocket = success(await evaluatePocket(document, runtime, tracingKernel));
    assert.ok(calls.length >= 1);
    assert.ok(!calls.includes(extrude.shape.id));
    assert.ok(!calls.includes(pocket.shape.id));
  } finally {
    await disposeCadRuntimeState(runtime, tracingKernel);
  }
});

test("Pocket evaluation is runtime-only and does not mutate document serialization", async () => {
  const document = makePocketDocument();
  const before = JSON.stringify(toSerializableCadDocument(document));
  const runtime = createCadRuntimeState();
  try {
    await evaluateExtrude(document, runtime);
    await evaluatePocket(document, runtime);
    assert.equal(JSON.stringify(toSerializableCadDocument(document)), before);
    assert.doesNotMatch(before, /shape-|runtimeShapeId|OCCT/i);
  } finally {
    await disposeCadRuntimeState(runtime, kernel);
  }
});
