import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  bsplineControlNetFairness,
  matchBSplineControlNetBoundary,
  refineBSplineControlNet,
  smoothBSplineControlNet,
  resampleBSplineControlNet,
} from "../core/surface/BSplineControlNet.ts";
import { resolveBSplineFeatureControlNet } from "../core/surface/BSplineFeatureControlNet.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";

const grid = (rows, cols, point) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => point(r, c)));

test("B-Spline control-net refinement preserves boundaries and inserts uniform midpoint rows", () => {
  const source = grid(2, 2, (r, c) => ({ x: c * 10, y: r * 10, z: r + c }));
  const refinedU = refineBSplineControlNet(source, "u");
  const refinedV = refineBSplineControlNet(source, "v");
  assert.equal(refinedU.length, 2);
  assert.equal(refinedU[0].length, 3);
  assert.deepEqual(refinedU[0][1], { x: 5, y: 0, z: .5 });
  assert.equal(refinedV.length, 3);
  assert.deepEqual(refinedV[1][0], { x: 0, y: 5, z: .5 });
});

test("B-Spline fairness pass reduces a local spike while preserving locked boundaries", () => {
  const source = grid(3, 3, (r, c) => ({ x: c, y: r, z: r === 1 && c === 1 ? 10 : 0 }));
  const before = bsplineControlNetFairness(source);
  const smoothed = smoothBSplineControlNet(source, { strength: .5, iterations: 1, preserveBoundary: true });
  assert.equal(smoothed[0][0].z, 0);
  assert.equal(smoothed[1][1].z, 5);
  assert.ok(bsplineControlNetFairness(smoothed) < before);
  const fallback = smoothBSplineControlNet(source, { strength: Number.NaN, iterations: Number.NaN, preserveBoundary: true });
  assert.ok(fallback.flat().every((point) => [point.x, point.y, point.z].every(Number.isFinite)));
});

test("B-Spline net resampling and boundary matching align different pole counts", () => {
  const source = grid(4, 3, (r, c) => ({ x: c, y: r * 2, z: r + c }));
  const target = grid(3, 3, (r, c) => ({ x: 10 + c, y: r * 3, z: 5 }));
  const resampled = resampleBSplineControlNet(target, 4, 3);
  assert.equal(resampled.length, 4);
  assert.deepEqual(resampled[0][0], target[0][0]);
  assert.deepEqual(resampled[3][2], target[2][2]);
  const matched = matchBSplineControlNetBoundary(source, target, { sourceEdge: "uMax", targetEdge: "uMin", continuity: "G1", adaptTargetBoundaryCount: true });
  assert.equal(matched.length, 4);
  for (let row = 0; row < 4; row += 1) assert.deepEqual(matched[row][0], source[row][2]);
});

test("G2 control-net matching aligns boundary, tangent and second difference", () => {
  const source = grid(3, 3, (r, c) => ({ x: c, y: r, z: r * .25 }));
  const target = grid(3, 3, (r, c) => ({ x: 10 + c, y: r, z: 5 }));
  const matched = matchBSplineControlNetBoundary(source, target, {
    sourceEdge: "uMax",
    targetEdge: "uMin",
    continuity: "G2",
  });
  for (let r = 0; r < 3; r += 1) {
    assert.deepEqual(matched[r][0], source[r][2]);
    assert.equal(matched[r][1].x, 3);
    assert.equal(matched[r][2].x, 4);
  }
});

test("G2 matching applies squared reparameterization to the second derivative", () => {
  const source = grid(3, 3, (r, c) => ({ x: c * c, y: r, z: 0 }));
  const target = grid(3, 3, (r, c) => ({ x: 20 + c, y: r, z: 0 }));
  const matched = matchBSplineControlNetBoundary(source, target, { sourceEdge: "uMax", targetEdge: "uMin", continuity: "G2", tangentScale: 2 });
  assert.equal(matched[1][0].x, 4);
  assert.equal(matched[1][1].x, 10);
  assert.equal(matched[1][2].x, 24);
});

test("B-Spline boundary relation participates in the graph and rebuilds from the latest source net", () => {
  const sourceNet = grid(3, 3, (r, c) => ({ x: c, y: r, z: r + c }));
  const targetNet = grid(3, 3, (r, c) => ({ x: 10 + c, y: r, z: 0 }));
  const source = { id: "surface-a", name: "A", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: sourceNet };
  const target = { id: "surface-b", name: "B", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [source.id], controlNet: targetNet, boundaryMatch: { sourceFeatureId: source.id, sourceEdge: "uMax", targetEdge: "uMin", continuity: "G1", adaptTargetBoundaryCount: true } };
  const document = createCadDocument({ id: "surface-doc", name: "surface", features: { [source.id]: source, [target.id]: target }, featureOrder: [source.id, target.id] });
  assert.deepEqual([...buildFeatureGraph(document).dependencies.get(target.id)], [source.id]);
  const first = resolveBSplineFeatureControlNet(document, target.id);
  document.features[source.id].controlNet[1][2].z = 99;
  const second = resolveBSplineFeatureControlNet(document, target.id);
  assert.notEqual(first[1][0].z, second[1][0].z);
  assert.equal(second[1][0].z, 99);
});

test("legacy one-time B-Spline match dependencies migrate without breaking the saved shape", () => {
  const net = grid(3, 3, (r, c) => ({ x: c, y: r, z: 0 }));
  const legacy = createCadDocument({ id: "legacy-surface", name: "legacy", features: {
    a: { id: "a", name: "A", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: net },
    b: { id: "b", name: "B", type: "bsplineSurface", enabled: true, state: "clean", dependencies: ["a"], controlNet: net },
  }, featureOrder: ["a", "b"] });
  const loaded = deserializeCadDocument(legacy);
  assert.deepEqual(loaded.features.b.dependencies, []);
  assert.deepEqual(loaded.features.b.controlNet, net);
});

test("B-Spline persistence rejects a boundary relation whose dependency contract is inconsistent", () => {
  const net = grid(3, 3, (r, c) => ({ x: c, y: r, z: 0 }));
  const invalid = createCadDocument({ id: "invalid-surface", name: "invalid", features: {
    a: { id: "a", name: "A", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: net },
    b: { id: "b", name: "B", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: net, boundaryMatch: { sourceFeatureId: "a", sourceEdge: "uMax", targetEdge: "uMin", continuity: "G1" } },
  }, featureOrder: ["a", "b"] });
  assert.throws(() => deserializeCadDocument(invalid), /dependencies do not match/);
});

test("B-Spline editor exposes refinement, fairness and adjacent-surface matching without fake knot controls", async () => {
  const source = await readFile(new URL("../app/cad/BSplineSurfaceEditor.tsx", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../app/kernel-debug/OcctKernelDebug.tsx", import.meta.url), "utf8");
  assert.match(source, /U 向加密/);
  assert.match(source, /控制网光顺/);
  assert.match(source, /锁定四周边界/);
  assert.match(source, /撤销控制网编辑/);
  assert.match(source, /自动对齐边界控制点数量/);
  assert.match(source, /取消跟随/);
  assert.match(source, /与相邻曲面匹配/);
  assert.match(source, /G0/);
  assert.match(source, /G1/);
  assert.match(source, /G2/);
  assert.doesNotMatch(source, /节点矢量|权重编辑/);
  assert.match(workbench, /boundaryMatch/);
  assert.match(workbench, /循环依赖/);
});
