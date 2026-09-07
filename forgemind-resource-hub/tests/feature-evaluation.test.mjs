import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import { createCadDocument, toSerializableCadDocument } from "../core/cad/CadDocument.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, recordFeatureEvaluationResult, replaceFeatureShape } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { sketchPlaneToKernelFrame } from "../core/evaluation/SketchPlaneFrame.ts";
import { KernelOperationError, KernelReferenceError } from "../core/kernel/KernelErrors.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const testWasmUrl = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const evaluationDirectory = new URL("../core/evaluation/", import.meta.url);

const rectangleSketch = ({ id = "Sketch01", width = 100, height = 60, plane = { type: "XY", offset: 0 }, construction = false } = {}) => ({
  id,
  name: id,
  plane,
  entities: {
    [`${id}-1`]: { id: `${id}-1`, type: "line", start: { x: 0, y: 0 }, end: { x: width, y: 0 }, construction },
    [`${id}-2`]: { id: `${id}-2`, type: "line", start: { x: width, y: 0 }, end: { x: width, y: height }, construction },
    [`${id}-3`]: { id: `${id}-3`, type: "line", start: { x: width, y: height }, end: { x: 0, y: height }, construction },
    [`${id}-4`]: { id: `${id}-4`, type: "line", start: { x: 0, y: height }, end: { x: 0, y: 0 }, construction },
  },
  entityOrder: [`${id}-1`, `${id}-2`, `${id}-3`, `${id}-4`],
  constraints: {},
  dimensions: {},
});

const extrudeFeature = ({ id = "Extrude01", sketchId = "Sketch01", distance = 20, operation = "new", direction = "positive" } = {}) => ({
  id, name: id, type: "extrude", sketchId, distance, direction, operation, enabled: true, state: "clean", dependencies: [],
});

const createDocument = ({ sketch = rectangleSketch(), feature = extrudeFeature() } = {}) => createCadDocument({
  id: "evaluation-document", name: "Evaluation Document", sketches: { [sketch.id]: sketch }, features: { [feature.id]: feature }, featureOrder: [feature.id],
});

let kernel;

const evaluate = (document, featureId = "Extrude01", activeKernel = kernel) => evaluateFeature(featureId, {
  document, kernel: activeKernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles,
});

const assertSuccess = (result) => {
  assert.equal(result.status, "success", result.status === "failed" ? result.error.message : "");
  return result;
};

before(async () => {
  kernel = new OcctKernel({ wasm: testWasmUrl });
  await kernel.init();
});

after(async () => {
  await kernel?.dispose();
});

test("Feature Evaluation layer has no Three.js dependency", async () => {
  const files = await readdir(evaluationDirectory);
  const contents = await Promise.all(files.map((file) => readFile(new URL(`../core/evaluation/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/from\s+["']three|THREE\./.test(content)));
});

test("Feature Evaluation layer has no React dependency", async () => {
  const files = await readdir(evaluationDirectory);
  const contents = await Promise.all(files.map((file) => readFile(new URL(`../core/evaluation/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/from\s+["']react/.test(content)));
});

test("ExtrudeFeature finds its Sketch", async () => {
  assert.equal((await evaluate(createDocument())).status, "success");
});

test("missing Sketch returns a structured failure", async () => {
  const document = createCadDocument({ id: "missing-sketch", name: "Missing", features: { Extrude01: extrudeFeature({ sketchId: "MissingSketch" }) } });
  assert.equal((await evaluate(document)).error.code, "SKETCH_NOT_FOUND");
});

test("rectangle Profile evaluates to a real ExtrudeFeature result", async () => {
  const result = assertSuccess(await evaluate(createDocument()));
  assert.equal(result.featureId, "Extrude01");
  assert.match(result.shape.id, /^shape-\d+$/);
});

test("100 by 60 by 20 evaluation has volume 120000", async () => {
  const result = assertSuccess(await evaluate(createDocument()));
  assert.equal((await kernel.getShapeProperties(result.shape)).volumeMm3, 120000);
});

test("100 by 60 by 20 evaluation has area 18400", async () => {
  const result = assertSuccess(await evaluate(createDocument()));
  assert.equal((await kernel.getShapeProperties(result.shape)).surfaceAreaMm2, 18400);
});

test("evaluation result contains a valid B-Rep", async () => {
  const result = assertSuccess(await evaluate(createDocument()));
  assert.deepEqual(result.validation, { valid: true, issues: [] });
});

test("width re-evaluation derives geometry from the modified document", async () => {
  const original = assertSuccess(await evaluate(createDocument()));
  const modified = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ width: 150 }) })));
  assert.equal((await kernel.getShapeProperties(original.shape)).volumeMm3, 120000);
  assert.equal((await kernel.getShapeProperties(modified.shape)).volumeMm3, 180000);
});

test("depth re-evaluation derives geometry from the modified Feature", async () => {
  const modified = assertSuccess(await evaluate(createDocument({ feature: extrudeFeature({ distance: 30 }) })));
  const properties = await kernel.getShapeProperties(modified.shape);
  assert.equal(properties.boundingBox.max.z, 30);
  assert.equal(properties.volumeMm3, 180000);
});

test("negative direction is evaluated by the same real kernel path", async () => {
  const result = assertSuccess(await evaluate(createDocument({ feature: extrudeFeature({ direction: "negative" }) })));
  assert.deepEqual((await kernel.getShapeProperties(result.shape)).boundingBox, { min: { x: 0, y: 0, z: -20 }, max: { x: 100, y: 60, z: 0 } });
});

test("Feature ID remains stable while its runtime shape changes", async () => {
  const first = assertSuccess(await evaluate(createDocument()));
  const second = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ width: 150 }) })));
  assert.equal(first.featureId, second.featureId);
  assert.notEqual(first.shape.id, second.shape.id);
});

test("Runtime state replaces and releases the previous Feature shape", async () => {
  const state = createCadRuntimeState();
  const first = assertSuccess(await evaluate(createDocument()));
  await replaceFeatureShape(state, kernel, first.featureId, first.shape);
  const second = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ width: 150 }) })));
  await replaceFeatureShape(state, kernel, second.featureId, second.shape);
  await assert.rejects(() => kernel.validate(first.shape), KernelReferenceError);
  assert.equal(state.featureShapes.get("Extrude01").id, second.shape.id);
  await disposeCadRuntimeState(state, kernel);
});

test("evaluation does not mutate serializable document data", async () => {
  const document = createDocument();
  const before = JSON.stringify(toSerializableCadDocument(document));
  await evaluate(document);
  assert.equal(JSON.stringify(toSerializableCadDocument(document)), before);
});

test("runtime state and shape references never enter document serialization", async () => {
  const document = createDocument();
  const state = createCadRuntimeState();
  const result = assertSuccess(await evaluate(document));
  recordFeatureEvaluationResult(state, result);
  await replaceFeatureShape(state, kernel, result.featureId, result.shape);
  const serialized = JSON.stringify(toSerializableCadDocument(document));
  assert.doesNotMatch(serialized, /shape-|runtimeShapeId|OCCT/i);
  await disposeCadRuntimeState(state, kernel);
});

test("open Profile returns PROFILE_OPEN", async () => {
  const sketch = rectangleSketch();
  sketch.entityOrder.pop();
  const result = await evaluate(createDocument({ sketch }));
  assert.equal(result.error.code, "PROFILE_OPEN");
});

test("spline Profile returns explicit unsupported failure", async () => {
  const sketch = { id: "Sketch01", name: "Sketch01", plane: { type: "XY", offset: 0 }, entities: { spline: { id: "spline", type: "spline", controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: true, construction: false } }, entityOrder: ["spline"], constraints: {}, dimensions: {} };
  assert.equal((await evaluate(createDocument({ sketch }))).error.code, "PROFILE_UNSUPPORTED");
});

test("construction-only geometry does not form an Extrude Profile", async () => {
  assert.equal((await evaluate(createDocument({ sketch: rectangleSketch({ construction: true }) }))).error.code, "PROFILE_INVALID");
});

test("circle Profile now evaluates through the exact OCCT curve path", async () => {
  const sketch = { id: "Sketch01", name: "Sketch01", plane: { type: "XY", offset: 0 }, entities: { circle: { id: "circle", type: "circle", center: { x: 50, y: 30 }, radius: 20, construction: false } }, entityOrder: ["circle"], constraints: {}, dimensions: {} };
  const result = assertSuccess(await evaluate(createDocument({ sketch })));
  assert.ok(Math.abs((await kernel.getShapeProperties(result.shape)).volumeMm3 - Math.PI * 20 ** 2 * 20) < .01);
});

test("operation add requires an explicit target dependency", async () => {
  assert.equal((await evaluate(createDocument({ feature: extrudeFeature({ operation: "add" }) }))).error.code, "FEATURE_DEPENDENCY_MISSING");
});

test("operation remove requires an explicit target dependency", async () => {
  assert.equal((await evaluate(createDocument({ feature: extrudeFeature({ operation: "remove" }) }))).error.code, "FEATURE_DEPENDENCY_MISSING");
});

test("XY Plane produces the expected dimensions", async () => {
  const result = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ plane: { type: "XY", offset: 0 } }) })));
  assert.deepEqual((await kernel.getShapeProperties(result.shape)).boundingBox, { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 60, z: 20 } });
});

test("XZ Plane produces the expected dimensions", async () => {
  const result = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ plane: { type: "XZ", offset: 0 } }) })));
  assert.deepEqual((await kernel.getShapeProperties(result.shape)).boundingBox, { min: { x: 0, y: -20, z: 0 }, max: { x: 100, y: 0, z: 60 } });
});

test("YZ Plane produces the expected dimensions", async () => {
  const result = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ plane: { type: "YZ", offset: 0 } }) })));
  assert.deepEqual((await kernel.getShapeProperties(result.shape)).boundingBox, { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 100, z: 60 } });
});

test("plane offsets apply along the plane normal", async () => {
  const result = assertSuccess(await evaluate(createDocument({ sketch: rectangleSketch({ plane: { type: "XY", offset: 50 } }) })));
  const boundingBox = (await kernel.getShapeProperties(result.shape)).boundingBox;
  assert.equal(boundingBox.min.z, 50);
  assert.equal(boundingBox.max.z, 70);
});

test("base Plane frames are right-handed", () => {
  const cross = (frame) => ({
    x: frame.xAxis.y * frame.yAxis.z - frame.xAxis.z * frame.yAxis.y,
    y: frame.xAxis.z * frame.yAxis.x - frame.xAxis.x * frame.yAxis.z,
    z: frame.xAxis.x * frame.yAxis.y - frame.xAxis.y * frame.yAxis.x,
  });
  for (const type of ["XY", "XZ", "YZ"]) {
    const frame = sketchPlaneToKernelFrame({ type, offset: 0 });
    assert.deepEqual(cross(frame), frame.normal);
  }
});

test("zero distance is blocked before entering the kernel", async () => {
  assert.equal((await evaluate(createDocument({ feature: extrudeFeature({ distance: 0 }) }))).error.code, "INVALID_INPUT");
});

test("face-attached planes are explicitly unsupported", async () => {
  const facePlane = { type: "face", face: { id: "face", kind: "face", sourceFeatureId: "source", persistentName: "temporary" } };
  assert.equal((await evaluate(createDocument({ sketch: rectangleSketch({ plane: facePlane }) }))).error.code, "PLANE_UNSUPPORTED");
});

test("nested closed Profiles evaluate as an outer loop with an exact inner hole", async () => {
  const primary = rectangleSketch();
  const secondary = rectangleSketch({ id: "Other", width: 20, height: 20 });
  const sketch = { ...primary, entities: { ...primary.entities, ...secondary.entities }, entityOrder: [...primary.entityOrder, ...secondary.entityOrder] };
  const result = assertSuccess(await evaluate(createDocument({ sketch })));
  assert.equal((await kernel.getShapeProperties(result.shape)).volumeMm3, 112000);
});

test("kernel failures are converted to structured evaluation failures", async () => {
  const failingKernel = { extrude: async () => { throw new KernelOperationError("extrude", "intentional test failure", "TEST_KERNEL_FAILURE"); } };
  const result = await evaluate(createDocument(), "Extrude01", failingKernel);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "KERNEL_FAILURE");
  assert.equal(result.error.kernelCode, "TEST_KERNEL_FAILURE");
});
