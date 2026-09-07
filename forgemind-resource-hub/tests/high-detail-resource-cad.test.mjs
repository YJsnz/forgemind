import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { createHighDetailResourceCadDocument, highDetailResourceIds } from "../core/resource/HighDetailResourceCad.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

let kernel;
const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);

before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => kernel?.dispose());

test("every legacy equipment and product resource now opens a feature-driven precision document", () => {
  assert.deepEqual(new Set(highDetailResourceIds), new Set(["cnc", "robot", "press", "conveyor", "housing", "motor", "buffer", "router-box"]));
  for (const resourceId of highDetailResourceIds) {
    const document = createHighDetailResourceCadDocument(resourceId);
    assert.ok(document, resourceId);
    assert.match(document.name, /精细可编辑模型/);
    assert.ok(Object.keys(document.bodies).length >= 2, `${resourceId} should be a meaningful multi-body model`);
    assert.ok(document.featureOrder.length >= Object.keys(document.bodies).length, `${resourceId} should preserve editable history`);
    assert.ok(Object.values(document.bodies).every((body) => body.sourceResource?.resourceId === resourceId), `${resourceId} should preserve its Resource Hub identity`);
  }
  assert.equal(createHighDetailResourceCadDocument("steel"), undefined);
  assert.equal(createHighDetailResourceCadDocument("aluminum"), undefined);
});

test("precision templates are deep-copied so cached model access cannot share edits", () => {
  const first = createHighDetailResourceCadDocument("cnc");
  const second = createHighDetailResourceCadDocument("cnc");
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.notEqual(first.bodies, second.bodies);
  const bodyId = Object.keys(first.bodies)[0];
  const originalName = second.bodies[bodyId].name;
  first.bodies[bodyId].name = "仅修改当前副本";
  assert.equal(second.bodies[bodyId].name, originalName);
});

test("legacy showcase models use curves, transitions, cuts and mechanical details instead of structural box stacking", () => {
  const expected = {
    cnc: ["loft", "mechanicalDetail", "extrude"],
    robot: ["loft", "mechanicalDetail", "extrude"],
    press: ["loft", "mechanicalDetail", "extrude"],
    conveyor: ["mechanicalDetail", "extrude"],
    housing: ["extrude"],
    motor: ["revolve", "loft", "extrude"],
    buffer: ["loft", "extrude"],
    "router-box": ["loft", "extrude"],
  };
  for (const [resourceId, featureTypes] of Object.entries(expected)) {
    const document = createHighDetailResourceCadDocument(resourceId);
    const types = new Set(Object.values(document.features).map((feature) => feature.type));
    for (const featureType of featureTypes) assert.ok(types.has(featureType), `${resourceId} should contain ${featureType}`);
  }
  for (const resourceId of ["press", "housing", "motor", "buffer", "router-box"]) {
    const document = createHighDetailResourceCadDocument(resourceId);
    assert.ok(Object.values(document.features).some((feature) => feature.type === "extrude" && feature.operation === "remove"), `${resourceId} should contain real material-removal features`);
  }
});

test("newly rebuilt legacy model families produce valid OCCT B-Reps", async () => {
  for (const resourceId of ["press", "housing", "motor", "buffer", "router-box"]) {
    const document = createHighDetailResourceCadDocument(resourceId);
    const runtime = createCadRuntimeState();
    try {
      const result = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
      assert.equal(result.success, true, `${resourceId}: ${result.errors.map((entry) => `${entry.featureId}: ${entry.message}`).join("; ")}`);
      const visibleBodies = Object.values(document.bodies).filter((body) => body.visible !== false);
      assert.ok(visibleBodies.length >= 2);
      for (const body of visibleBodies) {
        const shape = runtime.bodyShapes.get(body.id);
        assert.ok(shape, `${resourceId}/${body.name} should rebuild`);
        assert.equal((await kernel.validate(shape)).valid, true, `${resourceId}/${body.name} should be valid`);
      }
    } finally {
      await disposeCadRuntimeState(runtime, kernel);
    }
  }
});
