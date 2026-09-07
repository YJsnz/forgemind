import test from "node:test";
import assert from "node:assert/strict";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { loadCadDocumentHandoff, saveCadDocumentHandoff } from "../core/cad/CadDocumentStore.ts";

const memoryStorage = () => {
  const map = new Map();
  return {
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
