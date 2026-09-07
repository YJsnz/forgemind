import assert from "node:assert/strict";
import test from "node:test";
import "./cad-document-subset.test.mjs";

import {
  createCadDocument,
  toSerializableCadDocument,
} from "../core/cad/CadDocument.ts";
import { adaptLegacyProjectToCadDocument, legacyPartToCadBody } from "../core/cad/LegacyCadAdapter.ts";
import { DEFAULT_CAD_TOLERANCE, isCadToleranceValid } from "../core/cad/Tolerance.ts";

test("CAD domain creates an empty millimetre document", () => {
  const document = createCadDocument({ id: "document-1", name: "空白 CAD 文档", updatedAt: 1 });

  assert.equal(document.schemaVersion, 2);
  assert.equal(document.unit, "mm");
  assert.deepEqual(document.sketches, {});
  assert.deepEqual(document.features, {});
  assert.deepEqual(document.bodies, {});
});

test("CAD bodies support both migration backends", () => {
  assert.equal(legacyPartToCadBody({ id: "legacy", label: "旧部件" }).backend, "legacy-mesh");
  assert.equal(legacyPartToCadBody({ id: "brep", label: "新 CAD 部件", backend: "brep" }).backend, "brep");
});

test("runtime shape references never enter serializable CAD data", () => {
  const document = createCadDocument({
    id: "document-2",
    name: "运行时形体",
    updatedAt: 2,
    bodies: {
      body: {
        id: "body",
        name: "实体",
        backend: "brep",
        visible: true,
        runtimeShapeId: "occt-runtime-only",
      },
    },
  });

  const serialized = toSerializableCadDocument(document);
  assert.equal("runtimeShapeId" in serialized.bodies.body, false);
  assert.doesNotMatch(JSON.stringify(serialized), /occt-runtime-only/);
});

test("legacy projects without a backend adapt to legacy-mesh bodies", () => {
  const document = adaptLegacyProjectToCadDocument({
    id: "legacy-project",
    name: "旧项目",
    parts: [{ id: "part-1", label: "旧参数部件", hidden: false }],
    activePartId: "part-1",
    updatedAt: 3,
  });

  assert.equal(document.bodies["part-1"].backend, "legacy-mesh");
  assert.equal(document.bodies["part-1"].visible, true);
  assert.equal(document.activeBodyId, "part-1");
});

test("default CAD tolerances are finite positive numerical settings", () => {
  assert.equal(DEFAULT_CAD_TOLERANCE.modelUnit, "mm");
  assert.equal(isCadToleranceValid(DEFAULT_CAD_TOLERANCE), true);
});
