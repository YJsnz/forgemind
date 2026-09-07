import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  extendBSplineControlNet,
  moveBSplineControlPointSoft,
  reduceBSplineControlNet,
  solveBSplineSurfaceNetwork,
  translateBSplineIsoLine,
} from "../core/surface/BSplineControlNet.ts";
import { applyLoftEndConditions } from "../core/evaluation/LoftEndConditions.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, replaceFeatureShape } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { loftClosedProfiles } from "../core/evaluation/ProfileSolidConstruction.ts";
import { resolveBSplineFeatureControlNet } from "../core/surface/BSplineFeatureControlNet.ts";
import { verifyBSplineSurfaceBoundaries } from "../core/surface/BSplineBoundaryVerification.ts";
import { createDefaultTensorProductNurbs } from "../core/surface/TensorProductNurbs.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const wasmUrl = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const plane = { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
const rectangle = { id: "box", outer: [{ type: "line", start: [0, 0], end: [80, 0] }, { type: "line", start: [80, 0], end: [80, 50] }, { type: "line", start: [80, 50], end: [0, 50] }, { type: "line", start: [0, 50], end: [0, 0] }], holes: [] };
const net = (x0, step) => Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => ({ x: x0 + col * step, y: row * 12, z: row * row * .25 + col * .1 })));
let kernel;
before(async () => { kernel = new OcctKernel({ wasm: wasmUrl }); await kernel.init(); });
after(async () => { await kernel?.dispose(); });

test("V25 active surface network solving preserves two G2 support bands and creates interior freedom", () => {
  const left = net(-40, 10), right = net(60, 10), seed = net(0, 15);
  const solved = solveBSplineSurfaceNetwork(seed, [
    { sourceControlNet: left, options: { sourceEdge: "uMax", targetEdge: "uMin", continuity: "G2", adaptTargetBoundaryCount: true } },
    { sourceControlNet: right, options: { sourceEdge: "uMin", targetEdge: "uMax", continuity: "G2", adaptTargetBoundaryCount: true } },
  ], { fairnessStrength: .3, iterations: 8 });
  assert.ok(solved[0].length >= 7, "opposite G2 derivative bands need a free interior column");
  for (let row = 0; row < 5; row += 1) {
    assert.deepEqual(solved[row][0], left[row][4]);
    assert.deepEqual(solved[row].at(-1), right[row][0]);
  }
});

test("V25 local surface tools provide soft selection, isoparametric movement, natural extension and reduction", () => {
  const source = net(0, 10);
  const soft = moveBSplineControlPointSoft(source, 2, 2, { x: 0, y: 0, z: 10 }, 2);
  assert.equal(soft[2][2].z, source[2][2].z + 10);
  assert.ok(soft[2][1].z > source[2][1].z && soft[0][0].z === source[0][0].z);
  const iso = translateBSplineIsoLine(source, "u", 2, { x: 3, y: 0, z: 0 });
  assert.equal(iso[4][2].x, source[4][2].x + 3); assert.equal(iso[4][1].x, source[4][1].x);
  const extended = extendBSplineControlNet(source, "uMax", 1);
  assert.equal(extended[0].length, 6);
  assert.equal(extended[0][5].x - extended[0][4].x, extended[0][4].x - extended[0][3].x);
  assert.equal(reduceBSplineControlNet(extended, "u", 2)[0].length, 5);
});

test("V25 Loft end conditions insert ordered G1/G2 guide sections without changing authored profiles", () => {
  const profile = { id: "p", outer: [], holes: [] };
  const sections = [{ profile, plane }, { profile, plane: { ...plane, origin: { x: 0, y: 0, z: 100 } } }];
  const prepared = applyLoftEndConditions(sections, { continuity: "G2", lengthMm: 20 }, { continuity: "G1", lengthMm: 15 });
  assert.equal(prepared.length, 5);
  assert.deepEqual(prepared.map((section) => section.plane.origin.z), [0, 10, 20, 85, 100]);
  assert.equal(prepared.every((section) => section.profile === profile), true);
});

test("V25 variable fillet is gated until the browser kernel can preserve subsequent B-Rep work", async () => {
  const box = await kernel.extrude({ profile: rectangle, plane }, { distanceMm: 30, direction: "positive" });
  try {
    const edge = (await kernel.getEdges(box)).find((entry) => entry.curveType === "line" && (entry.lengthMm ?? 0) > 29);
    assert.ok(edge);
    await assert.rejects(() => kernel.filletVariable(box, edge.topology, 1.5, 5), /暂时关闭/);
    assert.equal((await kernel.validate(box)).valid, true);
  } finally { await kernel.disposeShape(box); }
});

test("V25 Loft rejects overlapping guides, invalid directions and incompatible modes before constructing geometry", () => {
  const sections = [{ plane }, { plane: { ...plane, origin: { x: 0, y: 0, z: 30 } } }];
  const start = { continuity: "G2", lengthMm: 20 };
  assert.throws(() => applyLoftEndConditions(sections, start, start), /重叠/);
  assert.throws(() => applyLoftEndConditions(sections, { ...start, lengthMm: 40 }), /越界/);
  assert.throws(() => applyLoftEndConditions(sections, { ...start, direction: { x: 1, y: 0, z: 0 } }), /方向/);
  assert.throws(() => applyLoftEndConditions(sections, { ...start, direction: { x: 0, y: 0, z: 0 } }), /不能为零/);
  for (const options of [{ ruled: true }, { closed: true }]) assert.throws(() => applyLoftEndConditions(sections, start, undefined, options), /开放的平滑放样/);
  assert.deepEqual(applyLoftEndConditions(sections, undefined, undefined, { ruled: true }), sections);
  const reversed = [...sections].reverse();
  assert.deepEqual(applyLoftEndConditions(reversed, { ...start, lengthMm: 10 }).map((section) => section.plane.origin.z), [30, 25, 20, 0]);
});

const bspline = (id, controlNet, extra = {}) => ({ id, name: id, type: "bsplineSurface", controlNet, enabled: true, state: "clean", dependencies: [], ...extra });

test("V25 saving a solved surface repeatedly does not smooth its interior again", () => {
  const source = net(-40, 10);
  const relation = { sourceFeatureId: "A", sourceEdge: "uMax", targetEdge: "uMin", continuity: "G1", adaptTargetBoundaryCount: true };
  const solved = solveBSplineSurfaceNetwork(net(0, 15), [{ sourceControlNet: source, options: relation }]);
  let document = createCadDocument({ id: "no-drift", name: "no-drift", features: { A: bspline("A", source), B: bspline("B", solved, { boundaryMatches: [relation], dependencies: ["A"] }) }, featureOrder: ["A", "B"] });
  for (let i = 0; i < 10; i += 1) {
    document = deserializeCadDocument(serializeCadDocument(document));
    const rebuilt = resolveBSplineFeatureControlNet(document, "B");
    assert.deepEqual(rebuilt, solved);
    document.features.B.controlNet = rebuilt;
  }
  document.features.A.controlNet[2][4].z += 3;
  assert.equal(resolveBSplineFeatureControlNet(document, "B")[2][0].z, solved[2][0].z + 3);
});

test("V25 curved tensor surfaces pass actual OCCT G2 boundary sampling after project restoration", async () => {
  const a = net(-40, 10), b = net(60, 10);
  const matches = [
    { sourceFeatureId: "A", sourceEdge: "uMax", targetEdge: "uMin", continuity: "G2", adaptTargetBoundaryCount: true },
    { sourceFeatureId: "B", sourceEdge: "uMin", targetEdge: "uMax", continuity: "G2", adaptTargetBoundaryCount: true },
  ];
  const solved = solveBSplineSurfaceNetwork(net(0, 15), matches.map((options, i) => ({ sourceControlNet: i ? b : a, options })));
  const tensor = (points) => createDefaultTensorProductNurbs(points, Math.max(points.length, points[0].length) - 1);
  const doc = createCadDocument({ id: "native-network", name: "native-network", features: {
    A: bspline("A", a, { tensorNurbs: tensor(a) }), B: bspline("B", b, { tensorNurbs: tensor(b) }),
    T: bspline("T", solved, { tensorNurbs: tensor(solved), boundaryMatches: matches, dependencies: ["A", "B"] }),
  }, featureOrder: ["A", "B", "T"] });
  const document = deserializeCadDocument(serializeCadDocument(doc));
  const runtime = createCadRuntimeState();
  try {
    for (const id of document.featureOrder) {
      const result = await evaluateFeature(id, { document, runtime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles });
      assert.equal(result.status, "success", result.error?.message);
      await replaceFeatureShape(runtime, kernel, id, result.shape);
    }
    // The net still has matching boundary coordinates, but a weight change
    // changes the real edge curve. Geometry verification must reject it.
    const wrong = structuredClone(document.features.T.tensorNurbs);
    wrong.weights[2][0] = 5;
    const shape = await kernel.bsplineSurface({ controlNet: solved, tensorNurbs: wrong });
    try { await assert.rejects(() => verifyBSplineSurfaceBoundaries(kernel, shape, [{ shape: runtime.featureShapes.get("A"), relation: matches[0] }], 1e-6), /未通过/); }
    finally { await kernel.disposeShape(shape); }
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});

test("V25 failed inner loft releases the previously created outer solid", async () => {
  const released = []; let calls = 0;
  const fake = { loft: async () => { if (++calls === 2) throw new Error("inner loft failed"); return { id: "outer", revision: 1 }; }, disposeShape: async (shape) => { released.push(shape.id); } };
  const profile = { ...rectangle, holes: [rectangle.outer] };
  await assert.rejects(() => loftClosedProfiles(fake, [{ profile, plane }, { profile, plane: { ...plane, origin: { x: 0, y: 0, z: 20 } } }], { ruled: false }), /inner loft failed/);
  assert.deepEqual(released, ["outer"]);
});

test("V25 variable fillet rejects an edge from a different solid without changing either solid", async () => {
  const a = await kernel.extrude({ profile: rectangle, plane }, { distanceMm: 30, direction: "positive" });
  const b = await kernel.extrude({ profile: rectangle, plane }, { distanceMm: 40, direction: "positive" });
  try {
    const edge = (await kernel.getEdges(b))[0].topology;
    await assert.rejects(() => kernel.filletVariable(a, edge, 2, 5), /不属于当前实体/);
    assert.ok((await kernel.validate(a)).valid && (await kernel.validate(b)).valid);
  } finally { await kernel.disposeShape(a); await kernel.disposeShape(b); }
});

test("V25 invalid local surface input is rejected without changing the source grid", () => {
  const points = net(0, 10), original = structuredClone(points);
  assert.throws(() => moveBSplineControlPointSoft(points, 1, 1, { x: NaN, y: 0, z: 0 }), /有效/);
  assert.throws(() => translateBSplineIsoLine(points, "u", 1.5, { x: 1, y: 0, z: 0 }), /无效/);
  assert.throws(() => extendBSplineControlNet(points, "uMax", -1), /比例/);
  assert.throws(() => reduceBSplineControlNet(points, "v", 0), /内部/);
  assert.deepEqual(points, original);
  assert.deepEqual(solveBSplineSurfaceNetwork(points, []), original);
});
