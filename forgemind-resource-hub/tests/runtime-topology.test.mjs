import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCadSelectionState, withCadSelection, withSelectionMode } from "../core/selection/SelectionState.ts";
import { edgeSelectionFromPolyline, faceSelectionFromTriangle } from "../core/selection/ViewportSelection.ts";
import { KernelReferenceError } from "../core/kernel/KernelErrors.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";

const testWasmUrl = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const plane = { origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
const rectangleProfile = { id: "topology-rectangle", outer: [
  { type: "line", start: [0, 0], end: [100, 0] }, { type: "line", start: [100, 0], end: [100, 60] },
  { type: "line", start: [100, 60], end: [0, 60] }, { type: "line", start: [0, 60], end: [0, 0] },
], holes: [] };
const circleProfile = { id: "topology-circle", outer: [{ type: "circle", center: [30, 0], radius: 10 }], holes: [] };

let kernel;
const box = async () => kernel.extrude({ profile: rectangleProfile, plane }, { distanceMm: 20, direction: "positive" });

before(async () => { kernel = new OcctKernel({ wasm: testWasmUrl }); await kernel.init(); });
after(async () => { await kernel?.dispose(); });

test("M7 partial 180 degree Revolve produces a real valid B-Rep", async () => {
  const shape = await kernel.revolve({ profile: circleProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 180 });
  try {
    assert.ok(Math.abs((await kernel.getShapeProperties(shape)).volumeMm3 - Math.PI ** 2 * 30 * 10 ** 2) < .1);
    assert.equal((await kernel.validate(shape)).valid, true);
  } finally { await kernel.disposeShape(shape); }
});

test("M7 non-default diagonal axis Revolve produces a real valid B-Rep", async () => {
  const shape = await kernel.revolve({ profile: circleProfile, plane }, { axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 1, z: 0 } }, angleDeg: 360 });
  try {
    assert.ok(Math.abs((await kernel.getShapeProperties(shape)).volumeMm3 - 2 * Math.PI ** 2 * (30 / Math.SQRT2) * 10 ** 2) < .1);
    assert.equal((await kernel.validate(shape)).valid, true);
  } finally { await kernel.disposeShape(shape); }
});

test("Faces are owned runtime descriptors with revision-aware ForgeMind IDs", async () => {
  const shape = await box();
  try {
    const faces = await kernel.getFaces(shape);
    assert.equal(faces.length, 6);
    assert.ok(faces.every((face) => face.topology.shapeId === shape.id && face.topology.shapeRevision === shape.revision && face.topology.kind === "face"));
    assert.ok(faces.every((face) => /^face-\d+$/.test(face.topology.localId)));
    assert.ok(faces.every((face) => Number.isFinite(face.areaMm2) && Number.isFinite(face.centerMm?.x)));
    assert.deepEqual(await kernel.getFaces(shape), faces);
  } finally { await kernel.disposeShape(shape); }
});

test("Face normals use the effective outward OCCT orientation", async () => {
  const shape = await box();
  try {
    const faces = await kernel.getFaces(shape);
    const top = faces.find((face) => face.centerMm.z > 19.9);
    const bottom = faces.find((face) => face.centerMm.z < .1);
    assert.ok(top && bottom);
    assert.ok(Math.abs(Math.hypot(top.normal.x, top.normal.y, top.normal.z) - 1) < 1e-8);
    assert.ok(top.normal.z > 0);
    assert.ok(bottom.normal.z < 0);
    assert.equal(top.planarFrame, undefined);
  } finally { await kernel.disposeShape(shape); }
});

test("Edges expose exact runtime descriptors and viewport-only polylines", async () => {
  const shape = await box();
  try {
    const edges = await kernel.getEdges(shape);
    const polylines = await kernel.getEdgePolylines(shape);
    assert.equal(edges.length, 12);
    assert.ok(edges.every((edge) => edge.topology.kind === "edge" && /^edge-\d+$/.test(edge.topology.localId)));
    assert.ok(edges.some((edge) => edge.curveType === "line" && edge.lengthMm === 100));
    assert.equal(polylines.length, edges.length);
    assert.ok(polylines.every((polyline) => polyline.topology.kind === "edge" && polyline.positions.length >= 6 && polyline.positions.length % 3 === 0));
    assert.deepEqual(await kernel.getEdgePolylines(shape), polylines);
  } finally { await kernel.disposeShape(shape); }
});

test("Triangle-to-face mapping resolves to the actual cached runtime Face", async () => {
  const shape = await box();
  try {
    const tessellation = await kernel.tessellate(shape, { linearDeflectionMm: .05, angularDeflectionDeg: .2 });
    assert.equal(tessellation.triangleFaceIndices.length, tessellation.indices.length / 3);
    for (const index of tessellation.triangleFaceIndices) assert.ok(index >= 0 && index < tessellation.faces.length);
    const selected = faceSelectionFromTriangle(tessellation, 0);
    const face = await kernel.getFaceInfo(selected.topology);
    assert.equal(selected.topology.kind, "face");
    assert.equal(face.topology.localId, selected.topology.localId);
  } finally { await kernel.disposeShape(shape); }
});

test("Edge viewport selection resolves to the actual cached runtime Edge", async () => {
  const shape = await box();
  try {
    const polyline = (await kernel.getEdgePolylines(shape))[0];
    const selected = edgeSelectionFromPolyline(polyline);
    const edge = await kernel.getEdgeInfo(selected.topology);
    assert.equal(selected.topology.kind, "edge");
    assert.equal(edge.topology.localId, selected.topology.localId);
  } finally { await kernel.disposeShape(shape); }
});

test("Stale topology cannot bind to a replacement Shape", async () => {
  const first = await box();
  const stale = (await kernel.getFaces(first))[0].topology;
  await kernel.disposeShape(first);
  const replacement = await box();
  try {
    await assert.rejects(() => kernel.getFaceInfo(stale), KernelReferenceError);
    assert.notEqual((await kernel.getFaces(replacement))[0].topology.shapeId, stale.shapeId);
  } finally { await kernel.disposeShape(replacement); }
});

test("Selection domain is runtime-only, typed, and framework-free", () => {
  const shape = { id: "shape-1", revision: 1 };
  const topology = { shapeId: "shape-1", shapeRevision: 1, kind: "face", localId: "face-1" };
  const initial = createCadSelectionState("face");
  const selected = withCadSelection(initial, { kind: "face", topology });
  assert.deepEqual(selected, { mode: "face", selection: { kind: "face", topology } });
  assert.deepEqual(withSelectionMode(selected, "edge"), { mode: "edge" });
  assert.equal(withCadSelection(createCadSelectionState("body"), { kind: "body", shape }).selection.kind, "body");
});
