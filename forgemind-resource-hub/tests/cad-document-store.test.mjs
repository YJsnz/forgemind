import test from "node:test";
import assert from "node:assert/strict";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { listCadDocumentHandoffs, loadCadDocumentHandoff, pruneObsoleteResourceCadDocuments, saveCadDocumentHandoff } from "../core/cad/CadDocumentStore.ts";

const memoryStorage = () => {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    dump: () => [...map.values()].join("\n"),
  };
};

test("today-mainline CAD handoff stores design data and restores by resource id", () => {
  const storage = memoryStorage();
  const body = { ...createCadBody("Body01", "Fixture"), runtimeShapeId: "shape-runtime-only", engineering: { material: "6061", densityKgM3: 2700 }, sourceResource: { resourceId: "fixture", resourceCode: "FIX-01", resourceTitle: "Fixture" } };
  const document = createCadDocument({ id: "doc-01", name: "Fixture CAD", bodies: { Body01: body }, activeBodyId: "Body01" });
  saveCadDocumentHandoff(storage, document, { sourceResourceId: "fixture" });
  assert.doesNotMatch(storage.dump(), /shape-runtime-only/);
  const restored = loadCadDocumentHandoff(storage, { resourceId: "fixture" });
  assert.equal(restored?.document.name, "Fixture CAD");
  assert.equal(restored?.document.bodies.Body01.engineering?.material, "6061");
  assert.equal(restored?.document.bodies.Body01.sourceResource?.resourceCode, "FIX-01");
  assert.equal("runtimeShapeId" in restored.document.bodies.Body01, false);
});

test("a pre-copied template does not replace the user's latest project", () => {
  const storage = memoryStorage();
  const current = createCadDocument({ id: "current-project", name: "当前工装" });
  const template = createCadDocument({ id: "cad-resource-cnc-precision-v2", name: "CNC 精细模板" });
  saveCadDocumentHandoff(storage, current);
  saveCadDocumentHandoff(storage, template, { sourceResourceId: "cnc", markLatest: false });
  assert.equal(loadCadDocumentHandoff(storage, { latest: true })?.document.id, current.id);
  assert.equal(loadCadDocumentHandoff(storage, { resourceId: "cnc" })?.document.id, template.id);
});

test("obsolete built-in resource documents are pruned without removing custom projects", () => {
  const storage = memoryStorage();
  saveCadDocumentHandoff(storage, createCadDocument({ id: "cad-resource-robot-legacy", name: "旧机器人" }), { sourceResourceId: "robot" });
  saveCadDocumentHandoff(storage, createCadDocument({ id: "bridge-cnc-01", name: "VMC-850 立式加工中心 · B-Rep" }));
  saveCadDocumentHandoff(storage, createCadDocument({ id: "bridge-pack-01", name: "资源组合自由建模 · 2 项" }));
  saveCadDocumentHandoff(storage, createCadDocument({ id: "cad-resource-robot-precision-v2", name: "精细机器人" }), { sourceResourceId: "robot" });
  saveCadDocumentHandoff(storage, createCadDocument({ id: "my-fixture", name: "用户工装" }));
  assert.equal(pruneObsoleteResourceCadDocuments(storage, { robot: "cad-resource-robot-precision-v2" }), 3);
  assert.deepEqual(listCadDocumentHandoffs(storage).map((entry) => entry.id).sort(), ["cad-resource-robot-precision-v2", "my-fixture"]);
});

test("obsolete resource and latest aliases are removed together with an old model", () => {
  const storage = memoryStorage();
  const oldPress = createCadDocument({ id: "cad-resource-press-v1", name: "液压冲压机构单元 · B-Rep" });
  saveCadDocumentHandoff(storage, oldPress, { sourceResourceId: "press" });
  assert.equal(pruneObsoleteResourceCadDocuments(storage, { press: "cad-resource-press-precision-v2" }), 3);
  assert.equal(loadCadDocumentHandoff(storage, { documentId: oldPress.id }), undefined);
  assert.equal(loadCadDocumentHandoff(storage, { resourceId: "press" }), undefined);
  assert.equal(loadCadDocumentHandoff(storage, { latest: true }), undefined);
});
