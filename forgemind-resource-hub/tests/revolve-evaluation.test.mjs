import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCadDocument, toSerializableCadDocument } from "../core/cad/CadDocument.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, recordFeatureEvaluationResult, replaceFeatureShape } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { KernelReferenceError, KernelValidationError } from "../core/kernel/KernelErrors.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const testWasmUrl = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const plane = { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
const circleProfile = { id: "circle-profile", outer: [{ type: "circle", center: [30, 0], radius: 10 }], holes: [] };
const dProfile = { id: "arc-profile", outer: [
  { type: "line", start: [30, -10], end: [30, 10] },
  { type: "arc", center: [30, 0], radius: 10, startAngleDeg: 90, endAngleDeg: 270 },
], holes: [] };

const circleSketch = () => ({
  id: "Sketch01", name: "Sketch01", plane: { type: "XY", offset: 0 },
  entities: { circle: { id: "circle", type: "circle", center: { x: 30, y: 0 }, radius: 10, construction: false } },
  entityOrder: ["circle"], constraints: {}, dimensions: {},
});

const dSketch = () => ({
  id: "Sketch01", name: "Sketch01", plane: { type: "XY", offset: 0 },
  entities: {
    line: { id: "line", type: "line", start: { x: 30, y: -10 }, end: { x: 30, y: 10 }, construction: false },
    arc: { id: "arc", type: "arc", center: { x: 30, y: 0 }, radius: 10, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5, construction: false },
  },
  entityOrder: ["line", "arc"], constraints: {}, dimensions: {},
});

const revolveFeature = ({ angleDeg = 360, operation = "new", axis = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } } } = {}) => ({
  id: "Revolve01", name: "Revolve01", type: "revolve", sketchId: "Sketch01", axis, angleDeg, operation, enabled: true, state: "clean", dependencies: [],
});

const revolveDocument = ({ sketch = circleSketch(), feature = revolveFeature() } = {}) => createCadDocument({
  id: "revolve-document", name: "Revolve Document", sketches: { Sketch01: sketch }, features: { Revolve01: feature }, featureOrder: ["Revolve01"],
});

let kernel;
const contextFor = (document, runtime) => ({ document, kernel, runtime, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles });
const success = (result) => { assert.equal(result.status, "success", result.status === "failed" ? result.error.message : ""); return result; };

before(async () => { kernel = new OcctKernel({ wasm: testWasmUrl }); await kernel.init(); });
after(async () => { await kernel?.dispose(); });

test("Circle is a standalone exact Circle profile, not a polyline loop", () => {
  const profile = buildSketchProfiles(circleSketch()).profiles[0];
  assert.equal(profile.outer.length, 1);
  assert.deepEqual(profile.outer[0], { type: "circle", center: [30, 0], radius: 10 });
});

test("Line and Arc form one closed exact curved profile", () => {
  const profile = buildSketchProfiles(dSketch()).profiles[0];
  assert.equal(profile.outer.length, 2);
  assert.deepEqual(profile.outer.map((segment) => segment.type), ["line", "arc"]);
});

test("Exact Circle Profile extrudes through OCCT without line approximation", async () => {
  const shape = await kernel.extrude({ profile: circleProfile, plane }, { distanceMm: 20, direction: "positive" });
  try {
    assert.ok(Math.abs((await kernel.getShapeProperties(shape)).volumeMm3 - Math.PI * 100 * 20) < .01);
    assert.equal((await kernel.validate(shape)).valid, true);
  } finally { await kernel.disposeShape(shape); }
});

test("Exact Arc Profile extrudes through OCCT as a valid curved B-Rep", async () => {
  const shape = await kernel.extrude({ profile: dProfile, plane }, { distanceMm: 20, direction: "positive" });
  try {
    assert.ok((await kernel.getShapeProperties(shape)).volumeMm3 > 3000);
    assert.equal((await kernel.validate(shape)).valid, true);
  } finally { await kernel.disposeShape(shape); }
});

test("Circle Profile full Revolve produces a real torus solid", async () => {
  const shape = await kernel.revolve({ profile: circleProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 360 });
  try {
    const properties = await kernel.getShapeProperties(shape);
    assert.ok(Math.abs(properties.volumeMm3 - 2 * Math.PI ** 2 * 30 * 10 ** 2) < .1);
    assert.equal((await kernel.validate(shape)).valid, true);
  } finally { await kernel.disposeShape(shape); }
});

test("Arc Profile full Revolve produces a real valid solid", async () => {
  const shape = await kernel.revolve({ profile: dProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 360 });
  try {
    assert.ok((await kernel.getShapeProperties(shape)).volumeMm3 > 25000);
    assert.equal((await kernel.validate(shape)).valid, true);
  } finally { await kernel.disposeShape(shape); }
});

test("Revolve rejects zero, over-360, and invalid-axis input", async () => {
  await assert.rejects(() => kernel.revolve({ profile: circleProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 0 }), KernelValidationError);
  await assert.rejects(() => kernel.revolve({ profile: circleProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 361 }), KernelValidationError);
  await assert.rejects(() => kernel.revolve({ profile: circleProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } }, angleDeg: 360 }), KernelValidationError);
});

test("RevolveFeature evaluates Circle sketch to a validated B-Rep and mapped tessellation", async () => {
  const runtime = createCadRuntimeState();
  try {
    const result = success(await evaluateFeature("Revolve01", contextFor(revolveDocument(), runtime)));
    recordFeatureEvaluationResult(runtime, result);
    await replaceFeatureShape(runtime, kernel, result.featureId, result.shape);
    const mesh = await kernel.tessellate(result.shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 });
    assert.equal(result.validation.valid, true);
    assert.equal(mesh.indices.length / 3, mesh.triangleFaceIndices.length);
    assert.ok(mesh.faces.length > 0);
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});

test("RevolveFeature uses the existing feature runtime replacement lifecycle", async () => {
  const runtime = createCadRuntimeState();
  try {
    const first = success(await evaluateFeature("Revolve01", contextFor(revolveDocument(), runtime)));
    await replaceFeatureShape(runtime, kernel, first.featureId, first.shape);
    const second = success(await evaluateFeature("Revolve01", contextFor(revolveDocument({ feature: revolveFeature({ angleDeg: 180 }) }), runtime)));
    await replaceFeatureShape(runtime, kernel, second.featureId, second.shape);
    assert.equal(first.featureId, second.featureId);
    assert.notEqual(first.shape.id, second.shape.id);
    await assert.rejects(() => kernel.validate(first.shape), KernelReferenceError);
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});

test("Revolve Boolean operation requires an explicit target and leaves CadDocument unchanged", async () => {
  const document = revolveDocument({ feature: revolveFeature({ operation: "add" }) });
  const before = JSON.stringify(toSerializableCadDocument(document));
  const runtime = createCadRuntimeState();
  try {
    const result = await evaluateFeature("Revolve01", contextFor(document, runtime));
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "FEATURE_DEPENDENCY_MISSING");
    assert.equal(JSON.stringify(toSerializableCadDocument(document)), before);
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});
