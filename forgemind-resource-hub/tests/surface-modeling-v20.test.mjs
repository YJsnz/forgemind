import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { matchBSplineControlNetBoundaries } from "../core/surface/BSplineControlNet.ts";
import { resolveBSplineFeatureControlNet } from "../core/surface/BSplineFeatureControlNet.ts";

const grid = (rows, cols, point) => Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => point(row, col)));
const relation = (sourceFeatureId, sourceEdge, targetEdge, continuity = "G0") => ({ sourceFeatureId, sourceEdge, targetEdge, continuity, adaptTargetBoundaryCount: true });

test("V20 combines two compatible boundary relations and adapts both target dimensions once", () => {
  const sourceU = grid(3, 3, (row, col) => col === 2 ? { x: 0, y: row * 10, z: row } : { x: col - 2, y: row * 10, z: row });
  const sourceV = grid(3, 4, (row, col) => row === 2 ? { x: col * 10, y: 0, z: col } : { x: col * 10, y: row - 2, z: col });
  const target = grid(2, 2, (row, col) => ({ x: 20 + col, y: 20 + row, z: 5 }));
  const matched = matchBSplineControlNetBoundaries(target, [
    { sourceControlNet: sourceU, options: relation("source-u", "uMax", "uMin") },
    { sourceControlNet: sourceV, options: relation("source-v", "vMax", "vMin") },
  ]);
  assert.equal(matched.length, 3);
  assert.equal(matched[0].length, 4);
  for (let row = 0; row < 3; row += 1) assert.deepEqual(matched[row][0], sourceU[row][2]);
  for (let col = 0; col < 4; col += 1) assert.deepEqual(matched[0][col], sourceV[2][col]);
});

test("V20 rejects incompatible corner and duplicate target-edge relations", () => {
  const sourceA = grid(3, 3, (row, col) => ({ x: col, y: row, z: 0 }));
  const sourceB = grid(3, 3, (row, col) => ({ x: 100 + col, y: row, z: 0 }));
  const target = grid(3, 3, (row, col) => ({ x: 20 + col, y: 20 + row, z: 5 }));
  assert.throws(() => matchBSplineControlNetBoundaries(target, [
    { sourceControlNet: sourceA, options: relation("a", "uMax", "uMin") },
    { sourceControlNet: sourceB, options: relation("b", "vMax", "vMin") },
  ]), /产生冲突/);
  assert.throws(() => matchBSplineControlNetBoundaries(target, [
    { sourceControlNet: sourceA, options: relation("a", "uMax", "uMin") },
    { sourceControlNet: sourceA, options: relation("a", "uMax", "uMin") },
  ]), /已有边界关联/);
});

test("V20 accepts two mathematically compatible G2 boundary control bands", () => {
  const sourceU = grid(3, 3, (row, col) => ({ x: col - 2, y: row, z: 0 }));
  const sourceV = grid(3, 3, (row, col) => ({ x: col, y: row - 2, z: 0 }));
  const target = grid(3, 3, (row, col) => ({ x: 10 + col, y: 10 + row, z: 5 }));
  const matched = matchBSplineControlNetBoundaries(target, [
    { sourceControlNet: sourceU, options: relation("source-u", "uMax", "uMin", "G2") },
    { sourceControlNet: sourceV, options: relation("source-v", "vMax", "vMin", "G2") },
  ]);
  assert.deepEqual(matched, grid(3, 3, (row, col) => ({ x: col, y: row, z: 0 })));
});

test("V20 refuses G2 matching across incompatible normal parameterizations", () => {
  const source = grid(3, 3, (row, col) => ({ x: col, y: row, z: 0 }));
  const target = grid(3, 4, (row, col) => ({ x: col, y: row, z: 0 }));
  assert.throws(() => matchBSplineControlNetBoundaries(target, [
    { sourceControlNet: source, options: relation("source", "uMax", "uMin", "G2") },
  ]), /相同数量的控制点/);
});

test("V20 feature graph and rebuild follow two upstream surface edits", () => {
  const sourceU = { id: "source-u", name: "U", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: grid(3, 3, (row, col) => ({ x: col, y: row, z: row })) };
  const sourceV = { id: "source-v", name: "V", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: grid(3, 3, (row, col) => ({ x: col, y: row, z: col })) };
  sourceU.controlNet[0][2] = { x: 2, y: 0, z: 2 };
  sourceV.controlNet[2][0] = { x: 2, y: 0, z: 2 };
  const target = { id: "target", name: "Target", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [sourceU.id, sourceV.id], controlNet: grid(3, 3, (row, col) => ({ x: 20 + col, y: 20 + row, z: 0 })), boundaryMatches: [relation(sourceU.id, "uMax", "uMin"), relation(sourceV.id, "vMax", "vMin")] };
  const document = createCadDocument({ id: "v20", name: "v20", features: { [sourceU.id]: sourceU, [sourceV.id]: sourceV, [target.id]: target }, featureOrder: [sourceU.id, sourceV.id, target.id] });
  assert.deepEqual([...buildFeatureGraph(document).dependencies.get(target.id)].sort(), [sourceU.id, sourceV.id]);
  const first = resolveBSplineFeatureControlNet(document, target.id);
  document.features[sourceU.id].controlNet[1][2].z = 22;
  const second = resolveBSplineFeatureControlNet(document, target.id);
  assert.notEqual(first[1][0].z, second[1][0].z);
  assert.equal(second[1][0].z, 22);
});

test("V20 persists multi-edge relations and rejects duplicate driven edges", () => {
  const net = grid(3, 3, (row, col) => ({ x: col, y: row, z: 0 }));
  const makeDocument = (matches) => createCadDocument({ id: "persist-v20", name: "persist", features: {
    a: { id: "a", name: "A", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: net },
    b: { id: "b", name: "B", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [], controlNet: net },
    target: { id: "target", name: "Target", type: "bsplineSurface", enabled: true, state: "clean", dependencies: [...new Set(matches.map((match) => match.sourceFeatureId))], controlNet: net, boundaryMatches: matches },
  }, featureOrder: ["a", "b", "target"] });
  const valid = makeDocument([relation("a", "uMax", "uMin"), relation("b", "vMax", "vMin")]);
  assert.equal(deserializeCadDocument(serializeCadDocument(valid)).features.target.boundaryMatches.length, 2);
  assert.throws(() => deserializeCadDocument(makeDocument([relation("a", "uMax", "uMin"), relation("b", "vMax", "uMin")])), /same B-spline target edge/);
});

test("V20 editor exposes clear multi-edge association controls", async () => {
  const editor = await readFile(new URL("../app/cad/BSplineSurfaceEditor.tsx", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../app/kernel-debug/OcctKernelDebug.tsx", import.meta.url), "utf8");
  for (const token of ["boundaryMatches", "当前共有", "解除", "受影响的边界关联", "solveBSplineSurfaceNetwork"]) assert.match(editor, new RegExp(token));
  assert.match(editor, /match\.continuity === "G0"/);
  assert.match(workbench, /initialBoundaryMatches/);
  assert.match(workbench, /每条当前边只能建立一条关联/);
});
