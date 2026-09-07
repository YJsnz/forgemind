import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { changeRationalBSplineSectionDirection, createDefaultRationalBSplineSections, reconcileRationalBSplineSections, validateRationalBSplineSections } from "../core/surface/RationalBSplineSections.ts";
import { evaluateBSplineSurfaceFeature } from "../core/evaluation/SurfaceFeatureEvaluator.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const controlNet = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => ({
  x: col * 20,
  y: row * 20,
  z: (row === 1 || row === 2) && (col === 1 || col === 2) ? 15 : 0,
})));
let kernel;

before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => { await kernel?.dispose(); });

test("V15 creates a clamped rational section contract with exact knot arithmetic", () => {
  const definition = createDefaultRationalBSplineSections(controlNet, "u", 3);
  assert.equal(definition.degree, 3);
  assert.deepEqual(definition.knots, [0, 1]);
  assert.deepEqual(definition.multiplicities, [4, 4]);
  assert.equal(definition.multiplicities.reduce((sum, value) => sum + value, 0), controlNet[0].length + definition.degree + 1);
  assert.deepEqual(validateRationalBSplineSections(controlNet, definition), { valid: true, issues: [] });
});

test("V15 rejects weight grids that the native smooth loft cannot honor", () => {
  const definition = createDefaultRationalBSplineSections(controlNet);
  definition.weights[1][1] = 2;
  const validation = validateRationalBSplineSections(controlNet, definition);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join(" "), /相同的权重分布/);
});

test("V15 resamples a saved weight profile when boundary following changes control-net density", () => {
  const definition = createDefaultRationalBSplineSections(controlNet);
  definition.weights = definition.weights.map((row) => row.map((value, col) => col === 1 ? 3 : value));
  const refined = controlNet.map((row) => [...row.slice(0, 2), { x: 30, y: row[0].y, z: 12 }, ...row.slice(2)]);
  const reconciled = reconcileRationalBSplineSections(refined, definition);
  assert.deepEqual(validateRationalBSplineSections(refined, reconciled), { valid: true, issues: [] });
  assert.equal(reconciled.weights[0].length, 5);
  assert.deepEqual(reconciled.weights[0], reconciled.weights[3]);
});

test("V15 preserves authored knots until the section pole count actually changes", () => {
  const definition = createDefaultRationalBSplineSections(controlNet, "u", 2);
  definition.knots = [0, .4, 1]; definition.multiplicities = [3, 1, 3];
  const extraTransverseSection = [...controlNet, controlNet.at(-1).map((point) => ({ ...point, y: point.y + 20 }))];
  const transverse = reconcileRationalBSplineSections(extraTransverseSection, definition);
  assert.deepEqual(transverse.knots, [0, .4, 1]);
  assert.deepEqual(transverse.multiplicities, [3, 1, 3]);
  const extraPole = controlNet.map((row) => [...row.slice(0, 2), { x: 30, y: row[0].y, z: 8 }, ...row.slice(2)]);
  const alongSection = reconcileRationalBSplineSections(extraPole, definition);
  assert.notDeepEqual(alongSection.knots, definition.knots);
  assert.deepEqual(validateRationalBSplineSections(extraPole, alongSection), { valid: true, issues: [] });
});

test("V15 changes U/V section direction without carrying an invalid weight profile", () => {
  const definition = createDefaultRationalBSplineSections(controlNet, "u", 3);
  definition.weights = definition.weights.map((row) => row.map((value, col) => col === 1 ? 4 : value));
  const changed = changeRationalBSplineSectionDirection(controlNet, definition, "v");
  assert.equal(changed.direction, "v");
  assert.ok(changed.weights.flat().every((weight) => weight === 1));
  assert.deepEqual(validateRationalBSplineSections(controlNet, changed), { valid: true, issues: [] });
});

test("V15 builds and validates a real OCCT surface from rational B-Spline sections", async () => {
  const unit = createDefaultRationalBSplineSections(controlNet);
  const weighted = structuredClone(unit);
  weighted.weights = weighted.weights.map((row) => row.map((value, col) => col === 1 ? 3 : col === 2 ? 2 : value));
  const plainShape = await kernel.bsplineSurface({ controlNet, rationalSections: unit });
  const weightedShape = await kernel.bsplineSurface({ controlNet, rationalSections: weighted });
  assert.deepEqual(await kernel.validate(weightedShape), { valid: true, issues: [] });
  const plain = await kernel.getShapeProperties(plainShape);
  const changed = await kernel.getShapeProperties(weightedShape);
  assert.ok(Math.abs((plain.surfaceAreaMm2 ?? 0) - (changed.surfaceAreaMm2 ?? 0)) > 1, "weights must change native geometry");
  await kernel.disposeShape(weightedShape);
  await kernel.disposeShape(plainShape);
});

test("V15 builds the V direction with authored knots and shared rational weights", async () => {
  const definition = createDefaultRationalBSplineSections(controlNet, "v", 2);
  definition.knots = [0, .35, 1]; definition.multiplicities = [3, 1, 3];
  definition.weights = definition.weights.map((row, index) => row.map(() => index === 1 ? 2.5 : 1));
  const shape = await kernel.bsplineSurface({ controlNet, rationalSections: definition });
  assert.deepEqual(await kernel.validate(shape), { valid: true, issues: [] });
  assert.ok((await kernel.getShapeProperties(shape)).surfaceAreaMm2 > 1000);
  await kernel.disposeShape(shape);
});

test("V15 boundary-follow rebuild resamples rational data before entering the kernel", async () => {
  const sourceNet = controlNet.map((row) => [...row, { x: 80, y: row[0].y, z: 0 }]);
  const rationalSections = createDefaultRationalBSplineSections(controlNet, "u", 3);
  rationalSections.weights = rationalSections.weights.map((row) => row.map((weight, col) => col === 1 ? 3 : weight));
  const source = { id: "Source", name: "Source", type: "bsplineSurface", controlNet: sourceNet, enabled: true, state: "clean", dependencies: [] };
  const target = { id: "Target", name: "Target", type: "bsplineSurface", controlNet, rationalSections, boundaryMatch: { sourceFeatureId: "Source", sourceEdge: "vMax", targetEdge: "vMin", continuity: "G1", adaptTargetBoundaryCount: true }, enabled: true, state: "clean", dependencies: ["Source"] };
  const document = createCadDocument({ id: "follow-rational", name: "Follow rational", features: { Source: source, Target: target }, featureOrder: ["Source", "Target"] });
  let captured;
  const fakeShape = { id: "shape-rational", revision: 1 };
  const result = await evaluateBSplineSurfaceFeature(target, { document, kernel: {
    async bsplineSurface(input) { captured = input; return fakeShape; },
    async validate() { return { valid: true, issues: [] }; },
    async disposeShape() {},
  }, tolerance: {}, buildProfiles() { throw new Error("not used"); } });
  assert.equal(result.status, "success");
  assert.match(result.warnings[0] ?? "", /有理截面保留原有边界关系/);
  assert.equal(captured.controlNet[0].length, 5);
  assert.equal(captured.rationalSections.weights[0].length, 5);
  assert.deepEqual(validateRationalBSplineSections(captured.controlNet, captured.rationalSections), { valid: true, issues: [] });
});

test("V15 restores rational surface design data and rejects malformed projects", () => {
  const rationalSections = createDefaultRationalBSplineSections(controlNet, "v", 2);
  rationalSections.weights = rationalSections.weights.map((row, index) => row.map(() => index === 1 ? 2 : 1));
  const body = createCadBody("SurfaceBody", "Rational surface", "surface"); body.tipFeatureId = "Surface01";
  const document = createCadDocument({ id: "rational-surface", name: "Rational surface", bodies: { SurfaceBody: body }, activeBodyId: "SurfaceBody", features: {
    Surface01: { id: "Surface01", name: "Rational section surface", type: "bsplineSurface", bodyId: "SurfaceBody", controlNet, rationalSections, enabled: true, state: "clean", dependencies: [] },
  }, featureOrder: ["Surface01"] });
  const restored = deserializeCadDocument(serializeCadDocument(document));
  assert.deepEqual(restored.features.Surface01.rationalSections, rationalSections);
  const malformed = structuredClone(serializeCadDocument(document));
  malformed.features.Surface01.rationalSections.weights[0][0] = 0;
  assert.throws(() => deserializeCadDocument(malformed), /invalid rational B-spline sections/);
});

test("V15 exposes compact rational controls and sends them through feature rebuild", async () => {
  const editor = await readFile(new URL("../app/cad/BSplineSurfaceEditor.tsx", import.meta.url), "utf8");
  const evaluator = await readFile(new URL("../core/evaluation/SurfaceFeatureEvaluator.ts", import.meta.url), "utf8");
  const kernelSource = await readFile(new URL("../core/kernel/OcctKernel.ts", import.meta.url), "utf8");
  assert.match(editor, /有理截面曲面/);
  assert.match(editor, /权重归一/);
  assert.match(evaluator, /reconcileRationalBSplineSections/);
  assert.match(kernelSource, /makeBSplineEdge/);
  assert.match(kernelSource, /runtime\.loft\(wires, false, false\)/);
});
