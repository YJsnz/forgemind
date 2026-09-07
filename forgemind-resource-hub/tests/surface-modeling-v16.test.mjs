import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { createDefaultTensorProductNurbs, reconcileTensorProductNurbs, validateTensorProductNurbs } from "../core/surface/TensorProductNurbs.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const controlNet = Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, col) => ({
  x: col * 20, y: row * 20, z: row > 0 && row < 3 && col > 0 && col < 4 ? 12 : 0,
})));
let kernel;

before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => { await kernel?.dispose(); });

test("V16 validates independent U/V bases and a full per-pole weight grid", () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 3);
  definition.u = { degree: 2, knots: [0, .35, .8, 1], multiplicities: [3, 1, 1, 3] };
  definition.v = { degree: 2, knots: [0, .45, 1], multiplicities: [3, 1, 3] };
  definition.weights[1][1] = 2.5; definition.weights[2][3] = 1.7;
  assert.deepEqual(validateTensorProductNurbs(controlNet, definition), { valid: true, issues: [] });
  assert.notEqual(definition.weights[1][1], definition.weights[1][3]);
});

test("V16 rejects malformed knot arithmetic and non-positive individual weights", () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 3);
  definition.u.multiplicities = [3, 3]; definition.weights[2][2] = 0;
  const issues = validateTensorProductNurbs(controlNet, definition).issues.join(" ");
  assert.match(issues, /节点与重数|重数总和/); assert.match(issues, /全部大于 0/);
});

test("V16 builds a valid native OCCT tensor-product NURBS and honors isolated weights", async () => {
  const plain = createDefaultTensorProductNurbs(controlNet, 3);
  const weighted = structuredClone(plain); weighted.weights[1][1] = 3.2; weighted.weights[2][3] = 1.8;
  const plainShape = await kernel.bsplineSurface({ controlNet, tensorNurbs: plain });
  const weightedShape = await kernel.bsplineSurface({ controlNet, tensorNurbs: weighted });
  assert.deepEqual(await kernel.validate(plainShape), { valid: true, issues: [] });
  assert.deepEqual(await kernel.validate(weightedShape), { valid: true, issues: [] });
  const plainArea = (await kernel.getShapeProperties(plainShape)).surfaceAreaMm2;
  const weightedArea = (await kernel.getShapeProperties(weightedShape)).surfaceAreaMm2;
  assert.ok(Math.abs(plainArea - weightedArea) > 1, "one control-point weight must change native geometry");
  await kernel.disposeShape(weightedShape); await kernel.disposeShape(plainShape);
});

test("V16 accepts manually authored non-uniform U/V knots in native geometry", async () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 2);
  definition.u = { degree: 2, knots: [0, .2, .75, 1], multiplicities: [3, 1, 1, 3] };
  definition.v = { degree: 2, knots: [0, .6, 1], multiplicities: [3, 1, 3] };
  const shape = await kernel.bsplineSurface({ controlNet, tensorNurbs: definition });
  assert.deepEqual(await kernel.validate(shape), { valid: true, issues: [] });
  assert.ok((await kernel.getShapeProperties(shape)).surfaceAreaMm2 > 4000);
  await kernel.disposeShape(shape);
});

test("V16 reconciles weights after control-net refinement while preserving compatible axes", () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 2);
  definition.v = { degree: 2, knots: [0, .4, 1], multiplicities: [3, 1, 3] };
  definition.weights[1][2] = 4;
  const refined = controlNet.map((row) => [...row.slice(0, 2), { x: 30, y: row[0].y, z: 10 }, ...row.slice(2)]);
  const reconciled = reconcileTensorProductNurbs(refined, definition);
  assert.deepEqual(reconciled.v, definition.v);
  assert.equal(reconciled.weights.length, 4); assert.equal(reconciled.weights[0].length, 6);
  assert.deepEqual(validateTensorProductNurbs(refined, reconciled), { valid: true, issues: [] });
});

test("V16 persists complete NURBS design intent and rejects conflicting legacy data", () => {
  const tensorNurbs = createDefaultTensorProductNurbs(controlNet, 3); tensorNurbs.weights[1][2] = 2.4;
  const feature = { id: "Nurbs01", name: "Full NURBS", type: "bsplineSurface", controlNet, tensorNurbs, enabled: true, state: "clean", dependencies: [] };
  const document = createCadDocument({ id: "tensor-nurbs", name: "Tensor NURBS", features: { Nurbs01: feature }, featureOrder: ["Nurbs01"] });
  const restored = deserializeCadDocument(serializeCadDocument(document));
  assert.deepEqual(restored.features.Nurbs01.tensorNurbs, tensorNurbs);
  const malformed = structuredClone(serializeCadDocument(document)); malformed.features.Nurbs01.rationalSections = { direction: "u", degree: 3, knots: [0, 1], multiplicities: [4, 6], weights: tensorNurbs.weights };
  assert.throws(() => deserializeCadDocument(malformed), /cannot contain both|invalid rational/i);
});

test("V16 exposes manual knot, multiplicity, degree and point-weight editing", async () => {
  const source = await readFile(new URL("../app/cad/BSplineSurfaceEditor.tsx", import.meta.url), "utf8");
  for (const label of ["完整 U/V NURBS", "向节点", "向重数", "该控制点权重", "applyTensorAxis", "updateTensorDegree", "updateTensorWeight"]) assert.match(source, new RegExp(label));
});
