import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import "./bspline-control-net.test.mjs";

import { createCadDocument, toSerializableCadDocument } from "../core/cad/CadDocument.ts";
import { adaptLegacyFeatures, adaptLegacyProjectToForgeMindCadDocument, legacyFeatureToDomain } from "../core/features/LegacyFeatureAdapter.ts";
import { canMoveHistoryFeature, deleteHistoryFeatureCascade, featureHistoryRelations, moveHistoryFeature, renameHistoryFeature, rollbackHistoryToFeature, setHistoryFeatureSuppressed } from "../core/history/FeatureHistoryManagement.ts";
import { legacySketchToDomain } from "../core/sketch/LegacySketchAdapter.ts";

const outlinePoints = [
  { x: .4, y: .4 }, { x: .6, y: .4 }, { x: .6, y: .6 }, { x: .4, y: .6 }, { x: .4, y: .4 },
];

const extrude = {
  id: "base-sketch", plane: "top", kind: "rectangle", points: outlinePoints,
  feature: { operation: "extrude", depth: .02, bevel: .001, enabled: true },
};
const pocket = {
  id: "pocket-sketch", plane: "top", kind: "circle", points: outlinePoints,
  feature: { operation: "pocket", depth: .02, bevel: 0, enabled: true, targetId: "base-sketch", patternCount: 3, patternMode: "linear", patternSpacing: .1 },
};
const revolve = {
  id: "revolve-sketch", plane: "front", kind: "rectangle", points: outlinePoints,
  feature: { operation: "revolve", depth: .1, bevel: 0, enabled: true, angle: 180 },
};

test("Legacy Extrude becomes an ExtrudeFeature", () => {
  assert.equal(legacyFeatureToDomain(extrude).type, "extrude");
});

test("Extrude ID is deterministic", () => {
  assert.equal(legacyFeatureToDomain(extrude).id, "base-sketch:extrude");
});

test("Extrude preserves its sketch ID", () => {
  const feature = legacyFeatureToDomain(extrude);
  assert.equal(feature.type, "extrude");
  assert.equal(feature.sketchId, extrude.id);
});

test("Extrude distance converts metres to millimetres", () => {
  const feature = legacyFeatureToDomain(extrude);
  assert.equal(feature.type, "extrude");
  assert.equal(feature.distance, 20);
});

test("Legacy Pocket becomes an independent PocketFeature", () => {
  assert.equal(legacyFeatureToDomain(pocket).type, "pocket");
});

test("Pocket explicitly depends on its target ExtrudeFeature", () => {
  const feature = legacyFeatureToDomain(pocket);
  assert.equal(feature.type, "pocket");
  assert.deepEqual(feature.dependencies, ["base-sketch:extrude"]);
  assert.equal(feature.targetFeatureId, "base-sketch:extrude");
});

test("Legacy Pocket retains through-all semantics", () => {
  const feature = legacyFeatureToDomain(pocket);
  assert.equal(feature.type, "pocket");
  assert.deepEqual(feature.depth, { type: "throughAll" });
});

test("Legacy Revolve becomes a RevolveFeature", () => {
  assert.equal(legacyFeatureToDomain(revolve).type, "revolve");
});

test("Revolve has an explicit world-Y axis", () => {
  const feature = legacyFeatureToDomain(revolve);
  assert.equal(feature.type, "revolve");
  assert.deepEqual(feature.axis, { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } });
});

test("Revolve angle remains in degrees", () => {
  const feature = legacyFeatureToDomain(revolve);
  assert.equal(feature.type, "revolve");
  assert.equal(feature.angleDeg, 180);
});

test("Legacy Pocket pattern becomes PatternFeature", () => {
  assert.equal(adaptLegacyFeatures([pocket]).features["pocket-sketch:pocket:pattern"].type, "pattern");
});

test("Pattern source dependency is explicit and spacing converts to mm", () => {
  const pattern = adaptLegacyFeatures([pocket]).features["pocket-sketch:pocket:pattern"];
  assert.equal(pattern.type, "pattern");
  assert.deepEqual(pattern.dependencies, ["pocket-sketch:pocket"]);
  assert.equal(pattern.definition.type, "linear");
  assert.equal(pattern.definition.spacing, 100);
});

test("enabled=false maps to suppressed state", () => {
  const feature = legacyFeatureToDomain({ ...extrude, id: "suppressed", feature: { ...extrude.feature, enabled: false } });
  assert.equal(feature.enabled, false);
  assert.equal(feature.state, "suppressed");
});

test("Domain Feature contains a sketch reference but no sketch geometry", () => {
  const feature = legacyFeatureToDomain(extrude);
  const serialised = JSON.stringify(feature);
  assert.match(serialised, /sketchId/);
  assert.doesNotMatch(serialised, /"points"|"entities"|"controlPoints"/);
});

test("Domain Sketch contains no embedded Feature data", () => {
  assert.doesNotMatch(JSON.stringify(legacySketchToDomain(extrude)), /"feature"|"depth"|"bevel"/);
});

test("Feature adapter never mutates a Legacy project", () => {
  const legacy = [extrude, pocket, revolve];
  const before = JSON.stringify(legacy);
  adaptLegacyFeatures(legacy);
  assert.equal(JSON.stringify(legacy), before);
});

test("Repeated adaptation produces stable Feature IDs", () => {
  const first = adaptLegacyFeatures([extrude, pocket, revolve]);
  const second = adaptLegacyFeatures([extrude, pocket, revolve]);
  assert.deepEqual(Object.keys(first.features), Object.keys(second.features));
});

test("Repeated adaptation produces stable Feature order", () => {
  const first = adaptLegacyFeatures([extrude, pocket, revolve]);
  const second = adaptLegacyFeatures([extrude, pocket, revolve]);
  assert.deepEqual(first.featureOrder, second.featureOrder);
});

test("core features contain no Three.js dependency", async () => {
  const files = await readdir(new URL("../core/features/", import.meta.url));
  const contents = await Promise.all(files.filter((file) => file.endsWith(".ts")).map((file) => readFile(new URL(`../core/features/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/from\s+["']three|THREE\./.test(content)));
});

test("core features contain no React dependency", async () => {
  const files = await readdir(new URL("../core/features/", import.meta.url));
  const contents = await Promise.all(files.filter((file) => file.endsWith(".ts")).map((file) => readFile(new URL(`../core/features/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/from\s+["']react/.test(content)));
});

test("CadDocument can carry domain sketches and Features", () => {
  const sketch = legacySketchToDomain(extrude);
  const features = adaptLegacyFeatures([extrude]).features;
  const document = createCadDocument({ id: "feature-document", name: "Feature document", sketches: { [sketch.id]: sketch }, features });
  assert.equal(document.features["base-sketch:extrude"].type, "extrude");
});

test("serialization removes runtime body references while retaining Feature parameters", () => {
  const feature = legacyFeatureToDomain(extrude);
  const document = createCadDocument({
    id: "serializable-feature-document", name: "Serializable", features: { [feature.id]: feature },
    bodies: { body: { id: "body", name: "Body", backend: "brep", visible: true, runtimeShapeId: "runtime-only" } },
  });
  const serialised = toSerializableCadDocument(document);
  assert.equal("runtimeShapeId" in serialised.bodies.body, false);
  assert.equal(serialised.features[feature.id].type, "extrude");
  assert.equal(serialised.features[feature.id].distance, 20);
});

test("Legacy project with no Features adapts to an empty Feature list", () => {
  const document = adaptLegacyProjectToForgeMindCadDocument({
    id: "empty-feature-project", name: "Empty", parts: [],
    strokes: [{ id: "open-line", plane: "top", kind: "line", points: [{ x: .2, y: .2 }, { x: .6, y: .2 }] }],
  });
  assert.deepEqual(document.features, {});
  assert.deepEqual(document.featureOrder, []);
});

const historyFeature = (id, inputFeatureId) => inputFeatureId ? ({
  id, name: id, type: "bodyTransform", enabled: true, state: "clean",
  dependencies: [inputFeatureId], inputFeatureId,
  translationMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
}) : ({
  id, name: id, type: "extrude", enabled: true, state: "clean", dependencies: [],
  sketchId: `${id}-sketch`, distance: 10, direction: "positive", operation: "new",
});

const historyDocument = () => createCadDocument({
  id: "history-management",
  name: "History management",
  features: {
    base: historyFeature("base"),
    cut: historyFeature("cut", "base"),
    finish: historyFeature("finish", "cut"),
    note: historyFeature("note"),
  },
  featureOrder: ["base", "cut", "finish", "note"],
});

test("feature history renaming preserves identity and rejects an empty name", () => {
  const document = historyDocument();
  const renamed = renameHistoryFeature(document, "cut", "  精加工切除  ");
  assert.equal(renamed.features.cut.name, "精加工切除");
  assert.equal(document.features.cut.name, "cut");
  assert.equal(renameHistoryFeature(document, "cut", "cut"), document);
  assert.throws(() => renameHistoryFeature(document, "cut", "   "), /名称不能为空/);
});

test("suppressing a feature cascades downstream and restoration brings required inputs back", () => {
  const suppressed = setHistoryFeatureSuppressed(historyDocument(), "cut", true);
  assert.deepEqual(suppressed.affectedFeatureIds, ["cut", "finish"]);
  assert.equal(suppressed.document.features.base.enabled, true);
  assert.equal(suppressed.document.features.cut.enabled, false);
  assert.equal(suppressed.document.features.finish.state, "suppressed");

  const restored = setHistoryFeatureSuppressed(suppressed.document, "finish", false);
  assert.deepEqual(restored.affectedFeatureIds, ["cut", "finish"]);
  assert.equal(restored.document.features.base.enabled, true);
  assert.equal(restored.document.features.cut.enabled, true);
  assert.equal(restored.document.features.finish.state, "clean");
});

test("feature history deletion removes all dependents without leaving broken references", () => {
  const result = deleteHistoryFeatureCascade(historyDocument(), "cut");
  assert.deepEqual(result.deletedFeatureIds, ["cut", "finish"]);
  assert.deepEqual(result.document.featureOrder, ["base", "note"]);
  assert.equal(result.document.features.cut, undefined);
  assert.deepEqual(featureHistoryRelations(result.document, "base"), { dependencies: [], dependents: [], upstream: [], downstream: [] });
});

test("feature history deletion repairs a Body tip to the latest surviving feature", () => {
  const document = historyDocument();
  for (const id of ["base", "cut", "finish"]) document.features[id].bodyId = "Body01";
  document.bodies.Body01 = { id: "Body01", name: "Body 01", backend: "brep", visible: true, tipFeatureId: "finish" };
  const result = deleteHistoryFeatureCascade(document, "cut");
  assert.equal(result.document.bodies.Body01.tipFeatureId, "base");
});

test("feature history reordering permits independent features but blocks dependency inversion", () => {
  const document = historyDocument();
  assert.equal(canMoveHistoryFeature(document, "note", "up"), true);
  assert.equal(canMoveHistoryFeature(document, "finish", "up"), false);
  assert.deepEqual(moveHistoryFeature(document, "note", "up").featureOrder, ["base", "cut", "note", "finish"]);
  assert.throws(() => moveHistoryFeature(document, "finish", "up"), /不能把特征移动到它所依赖的内容之前/);
});

test("feature history relations include ordered transitive impact", () => {
  assert.deepEqual(featureHistoryRelations(historyDocument(), "cut"), {
    dependencies: ["base"], dependents: ["finish"], upstream: ["base"], downstream: ["finish"],
  });
});

test("rolling history back to one node suppresses only later active nodes", () => {
  const result = rollbackHistoryToFeature(historyDocument(), "cut");
  assert.deepEqual(result.affectedFeatureIds, ["finish", "note"]);
  assert.equal(result.document.features.base.enabled, true);
  assert.equal(result.document.features.cut.enabled, true);
  assert.equal(result.document.features.finish.enabled, false);
  assert.equal(result.document.features.note.state, "suppressed");
});
