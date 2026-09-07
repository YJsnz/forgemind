import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { computeCadDocumentFingerprint } from "../core/cad/CadDocumentPersistence.ts";
import { createBody, deleteBody, renameBody, setActiveBody, setBodyVisibility, CadBodyOperationError } from "../core/cad/CadBodyOperations.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { createCadHistory, commitCadHistory, undoCadHistory, redoCadHistory } from "../core/history/CadHistory.ts";
import { capturePersistentTopologyRef } from "../core/topology/TopologyResolver.ts";

let kernel;
const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const close = (actual, expected, tolerance = .25) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const rect = (id, x, y, width, height) => ({ id, name: id, plane: { type: "XY", offset: 0 }, entities: { a: { id: "a", type: "line", start: { x, y }, end: { x: x + width, y }, construction: false }, b: { id: "b", type: "line", start: { x: x + width, y }, end: { x: x + width, y: y + height }, construction: false }, c: { id: "c", type: "line", start: { x: x + width, y: y + height }, end: { x, y: y + height }, construction: false }, d: { id: "d", type: "line", start: { x, y: y + height }, end: { x, y }, construction: false } }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {} });
const multi = (operation) => createCadDocument({ id: `multi-${operation}`, name: "Multi body", sketches: { A: rect("A", 0, 0, 100, 60), B: rect("B", 75, 10, 50, 40) }, bodies: { Body01: createCadBody("Body01"), Body02: createCadBody("Body02") }, activeBodyId: "Body01", features: { A: { id: "A", name: "A", type: "extrude", bodyId: "Body01", sketchId: "A", distance: 20, direction: "positive", operation: "new", enabled: true, state: "clean", dependencies: [] }, B: { id: "B", name: "B", type: "extrude", bodyId: "Body02", sketchId: "B", distance: 20, direction: "positive", operation: "new", enabled: true, state: "clean", dependencies: [] }, Boolean: { id: "Boolean", name: "Boolean", type: "bodyBoolean", bodyId: "Body01", operation, target: { bodyId: "Body01", featureId: "A" }, tools: [{ bodyId: "Body02", featureId: "B" }], keepToolBody: true, enabled: true, state: "clean", dependencies: ["A", "B"] } }, featureOrder: ["A", "B", "Boolean"] });
const context = (document, runtime, rebuildRuntime) => ({ document, runtime, rebuildRuntime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles });

before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => kernel?.dispose());

test("P2-M6 body container operations retain identity and enforce in-use deletion", () => {
  let document = createCadDocument({ id: "body-ops", name: "Body Ops" });
  document = createBody(document, "Body01", "Base"); document = createBody(document, "Body02", "Tool");
  assert.equal(document.activeBodyId, "Body02"); document = renameBody(document, "Body02", "Cylinder"); document = setBodyVisibility(document, "Body02", false); document = setActiveBody(document, "Body01");
  assert.equal(document.bodies.Body02.id, "Body02"); assert.equal(document.bodies.Body02.name, "Cylinder"); assert.equal(document.bodies.Body02.visible, false);
  document = deleteBody(document, "Body02"); assert.equal(document.activeBodyId, "Body01");
  const used = createCadDocument({ id: "used", name: "Used", bodies: { Body01: createCadBody("Body01") }, features: { A: { id: "A", name: "A", type: "extrude", bodyId: "Body01", sketchId: "missing", distance: 1, operation: "new", enabled: true, state: "clean", dependencies: [] } }, featureOrder: ["A"] });
  assert.throws(() => deleteBody(used, "Body01"), (error) => error instanceof CadBodyOperationError && error.code === "BODY_IN_USE");
});

for (const [operation, expected] of [["union", 140000], ["cut", 100000], ["intersect", 20000]]) test(`P2-M6 ${operation} retains independent Bodies and exact analytical volume`, async () => {
  const document = multi(operation); const runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState();
  const result = await rebuildDocument(context(document, runtime, rebuildRuntime), { full: true }); assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(runtime.bodyShapes.size, 2); assert.notEqual(runtime.bodyShapes.get("Body01").id, runtime.bodyShapes.get("Body02").id);
  const properties = await kernel.getShapeProperties(runtime.bodyShapes.get("Body01")); close(properties.volumeMm3, expected); assert.equal((await kernel.validate(runtime.bodyShapes.get("Body01"))).valid, true);
  await disposeCadRuntimeState(runtime, kernel);
});

test("P2-M6 Body Transform is an exact design feature without cumulative drift", async () => {
  const document = multi("union"); delete document.features.Boolean; document.featureOrder.pop();
  document.features.MoveB = { id: "MoveB", name: "MoveB", type: "bodyTransform", bodyId: "Body02", inputFeatureId: "B", translationMm: { x: 100, y: 0, z: 0 }, rotation: { axis: "Z", angleDeg: 90 }, enabled: true, state: "clean", dependencies: ["B"] }; document.featureOrder.push("MoveB");
  const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true);
  let properties = await kernel.getShapeProperties(runtime.bodyShapes.get("Body02")); close(properties.volumeMm3, 40000); close(properties.boundingBox.min.x, -50); close(properties.boundingBox.max.x, -10);
  document.features.MoveB.translationMm.x = 9.9; document.features.MoveB.rotation.angleDeg = 0; assert.equal((await rebuildDocument(context(document, runtime, state), { changedFeatureIds: ["MoveB"] })).success, true);
  properties = await kernel.getShapeProperties(runtime.bodyShapes.get("Body02")); close(properties.boundingBox.min.x, 84.9, .01); document.features.MoveB.translationMm.x = 9.9; assert.equal((await rebuildDocument(context(document, runtime, state), { changedFeatureIds: ["MoveB"] })).success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body02"))).boundingBox.min.x, 84.9, .01);
  await disposeCadRuntimeState(runtime, kernel);
});

test("P2-M6 Body Boolean blocks self and future-state references", async () => {
  const document = multi("union"); document.features.Boolean.tools = [{ bodyId: "Body01", featureId: "A" }]; document.features.Boolean.dependencies = ["A"]; const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); const self = await rebuildDocument(context(document, runtime, state), { full: true }); assert.equal(self.success, false); assert.match(self.errors[0].message, /Body cannot Boolean against itself/); await disposeCadRuntimeState(runtime, kernel);
  const future = multi("union"); future.features.Boolean.tools = [{ bodyId: "Body02", featureId: "Move" }]; future.features.Boolean.dependencies = ["A", "Move"]; future.features.Move = { id: "Move", name: "Move", type: "bodyTransform", bodyId: "Body02", inputFeatureId: "B", translationMm: { x: 0, y: 0, z: 0 }, enabled: true, state: "clean", dependencies: ["B"] }; future.featureOrder.push("Move"); const futureRuntime = createCadRuntimeState(); const futureResult = await rebuildDocument(context(future, futureRuntime, createRebuildRuntimeState()), { full: true }); assert.equal(futureResult.success, false); assert.match(futureResult.errors[0].message, /future Body state/); await disposeCadRuntimeState(futureRuntime, kernel);
});

test("P2-M6 persistence migrates legacy single-body documents canonically", () => {
  const legacy = { schemaVersion: 2, id: "legacy", name: "Legacy", unit: "mm", sketches: {}, features: {}, featureOrder: [], updatedAt: 1 };
  const empty = deserializeCadDocument(legacy); assert.deepEqual(empty.bodies, {});
  const withFeature = deserializeCadDocument({ ...legacy, sketches: { S: rect("S", 0, 0, 1, 1) }, features: { E: { id: "E", name: "E", type: "extrude", sketchId: "S", distance: 1, operation: "new", enabled: true, state: "clean", dependencies: [] } }, featureOrder: ["E"] });
  assert.equal(withFeature.bodies.Body01.id, "Body01"); assert.equal(withFeature.features.E.bodyId, "Body01"); const roundTrip = deserializeCadDocument(serializeCadDocument(withFeature)); assert.deepEqual(serializeCadDocument(roundTrip), serializeCadDocument(withFeature));
});

test("P2-M6 Body metadata and Boolean references survive history plus save/destroy/load rebuild", async () => {
  const original = multi("union"); let history = createCadHistory(original); let edited = renameBody(original, "Body02", "Cylinder Tool"); edited = setBodyVisibility(edited, "Body02", false); history = commitCadHistory(history, edited); const undone = undoCadHistory(history); assert.ok(undone); assert.equal(undone.document.bodies.Body02.name, "Body02"); const redone = redoCadHistory(undone.history); assert.ok(redone); assert.equal(redone.document.bodies.Body02.visible, false); assert.equal(JSON.stringify(redone.history).includes("runtimeShapeId"), false);
  const restored = deserializeCadDocument(serializeCadDocument(redone.document)); const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); assert.equal((await rebuildDocument(context(restored, runtime, state), { full: true })).success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body01"))).volumeMm3, 140000); assert.equal(runtime.bodyShapes.has("Body02"), true); await disposeCadRuntimeState(runtime, kernel);
});

test("P2-M6 Boolean and transform suppression restore their upstream Body result", async () => {
  const document = multi("cut"); const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body01"))).volumeMm3, 100000); document.features.Boolean.enabled = false; document.features.Boolean.state = "suppressed"; assert.equal((await rebuildDocument(context(document, runtime, state), { changedFeatureIds: ["Boolean"] })).success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body01"))).volumeMm3, 120000);
  document.features.Move = { id: "Move", name: "Move", type: "bodyTransform", bodyId: "Body02", inputFeatureId: "B", translationMm: { x: 20, y: 0, z: 0 }, enabled: true, state: "clean", dependencies: ["B"] }; document.featureOrder = ["A", "B", "Move", "Boolean"]; document.features.Boolean.enabled = true; document.features.Boolean.state = "clean"; document.features.Boolean.tools = [{ bodyId: "Body02", featureId: "Move" }]; document.features.Boolean.dependencies = ["A", "Move"]; assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); document.features.Move.enabled = false; document.features.Move.state = "suppressed"; assert.equal((await rebuildDocument(context(document, runtime, state), { changedFeatureIds: ["Move"] })).success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body02"))).volumeMm3, 40000); await disposeCadRuntimeState(runtime, kernel);
});

test("P2-M6 Body Boolean output remains a regular Body feature input for Fillet", async () => {
  const document = multi("union"); const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); const edge = (await kernel.getEdges(runtime.featureShapes.get("Boolean"))).find((item) => item.curveType === "line" && (item.lengthMm ?? 0) >= 20); assert.ok(edge); const ref = await capturePersistentTopologyRef("Boolean", edge.topology, runtime, kernel); document.features.Fillet = { id: "Fillet", name: "Fillet", type: "fillet", bodyId: "Body01", targetFeatureId: "Boolean", edges: [ref], radiusMm: 2, enabled: true, state: "clean", dependencies: ["Boolean"] }; document.featureOrder.push("Fillet"); assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); assert.equal((await kernel.validate(runtime.bodyShapes.get("Body01"))).valid, true); await disposeCadRuntimeState(runtime, kernel);
});

test("P2-M6 CadHistory recursively excludes Body runtime contamination and fingerprints remain runtime independent", () => {
  const document = multi("union"); document.bodies.Body01.runtimeShapeId = "shape-101"; document.bodies.Body01.runtimeShape = { id: "shape-101", revision: 7, tessellation: [1, 2, 3] }; const first = computeCadDocumentFingerprint(document); document.bodies.Body01.runtimeShapeId = "shape-987"; document.bodies.Body01.runtimeShape = { id: "shape-987", revision: 99, mesh: { triangles: [9] } }; const second = computeCadDocumentFingerprint(document); assert.equal(first, second); const history = createCadHistory(document); const forbidden = /runtimeShape|shapeRevision|tessellation|triangleFaceIndices|subshape|mesh/i; assert.equal(forbidden.test(JSON.stringify(history)), false);
});

test("P2-M6 history restores create/delete/active/transform/Boolean design then rebuilds from scratch", async () => {
  let document = multi("union"); let history = createCadHistory(document); const body03 = createBody(document, "Body03", "Disposable"); history = commitCadHistory(history, body03); let transition = undoCadHistory(history); assert.ok(transition); assert.equal(transition.document.bodies.Body03, undefined); transition = redoCadHistory(transition.history); assert.ok(transition); const deleted = deleteBody(transition.document, "Body03"); history = commitCadHistory(transition.history, deleted); transition = undoCadHistory(history); assert.ok(transition); assert.equal(transition.document.bodies.Body03.name, "Disposable");
  const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); document = transition.document; assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); const changed = structuredClone(document); changed.features.Boolean.operation = "cut"; const cut = await (await import("../core/history/CadHistoryRebuild.ts")).commitCadHistoryEdit(history, document, changed, context(document, runtime, state)); assert.equal(cut.success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body01"))).volumeMm3, 100000); const restored = await (await import("../core/history/CadHistoryRebuild.ts")).undoCadHistoryRebuild(cut.history, cut.document, context(document, runtime, state)); assert.equal(restored.success, true); close((await kernel.getShapeProperties(runtime.bodyShapes.get("Body01"))).volumeMm3, 140000); await disposeCadRuntimeState(runtime, kernel);
});

test("P2-M6 lifecycle loops keep feature and Body runtime references bounded", async () => {
  let document = multi("union"); const runtime = createCadRuntimeState(); const state = createRebuildRuntimeState(); for (let index = 0; index < 20; index += 1) { document = createBody(document, `Empty${index}`, `Empty${index}`); assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); assert.equal(runtime.bodyShapes.size, 2); document = deleteBody(document, `Empty${index}`); assert.equal((await rebuildDocument(context(document, runtime, state), { full: true })).success, true); document.features.Boolean.operation = index % 2 ? "cut" : "union"; assert.equal((await rebuildDocument(context(document, runtime, state), { changedFeatureIds: ["Boolean"] })).success, true); assert.equal(runtime.featureShapes.size, 3); assert.equal(runtime.bodyShapes.size, 2); }
  const transformed = multi("union"); delete transformed.features.Boolean; transformed.featureOrder.pop(); transformed.features.Move = { id: "Move", name: "Move", type: "bodyTransform", bodyId: "Body02", inputFeatureId: "B", translationMm: { x: 0, y: 0, z: 0 }, enabled: true, state: "clean", dependencies: ["B"] }; transformed.featureOrder.push("Move"); const runtime2 = createCadRuntimeState(); const state2 = createRebuildRuntimeState(); for (let index = 0; index < 100; index += 1) { transformed.features.Move.translationMm.x = index * .1; assert.equal((await rebuildDocument(context(transformed, runtime2, state2), { full: index === 0, changedFeatureIds: index === 0 ? undefined : ["Move"] })).success, true); assert.equal(runtime2.featureShapes.size, 3); } close((await kernel.getShapeProperties(runtime2.bodyShapes.get("Body02"))).boundingBox.min.x, 84.9, .01); await disposeCadRuntimeState(runtime, kernel); await disposeCadRuntimeState(runtime2, kernel);
});
