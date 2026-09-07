import test from "node:test";
import assert from "node:assert/strict";

import { createPartDefinitionFromCadDocument } from "../core/assembly/PartDefinitions.ts";
import { createCadAssetStore } from "../core/cad/CadAssets.ts";
import { extractCadDocumentPart } from "../core/cad/CadDocumentSubset.ts";
import { deserializeCadProjectBundle } from "../core/cad/CadProjectBundle.ts";
import { createComprehensiveDemoCadDocument } from "../core/demo/ComprehensiveDemoProject.ts";

test("assembly Part extraction retains hidden upstream surface dependencies", () => {
  const source = createComprehensiveDemoCadDocument();
  const frame = extractCadDocumentPart(source, {
    id: "DemoFramePart",
    name: "精密检测台机架",
    sourcePartIds: ["base", "nurbs-cover"],
  });

  assert.ok(frame.features["smart-cell-nurbs-cover-thicken"]);
  assert.ok(frame.features["smart-cell-nurbs-surface"]);
  assert.equal(frame.bodies["smart-cell-nurbs-surface-body"].visible, false);
  assert.equal(
    frame.features["smart-cell-nurbs-cover-thicken"].dependencies[0],
    "smart-cell-nurbs-surface",
  );

  const definition = createPartDefinitionFromCadDocument("Frame", "Frame", frame, createCadAssetStore());
  const restored = deserializeCadProjectBundle(definition.project).document;
  assert.deepEqual(restored.featureOrder, frame.featureOrder);
});
