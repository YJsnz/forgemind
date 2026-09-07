import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { createCadBody } from "../core/cad/CadBodies.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { createCadRuntimeState, disposeCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { buildCadDocumentFromResourceTemplate } from "../core/resource/ResourceCadBridge.ts";
import { createLocalCadAgentPlan } from "../core/agent/LocalCadModelingAgent.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
let kernel;
before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => kernel?.dispose());

const details = {
  Thread: { kind: "externalThread", majorDiameterMm: 12, pitchMm: 2, lengthMm: 32, threadDepthMm: .8 },
  Gear: { kind: "spurGear", moduleMm: 2, teeth: 18, pressureAngleDeg: 20, thicknessMm: 10, boreDiameterMm: 8 },
  Bearing: { kind: "bearing", outerDiameterMm: 42, innerDiameterMm: 20, widthMm: 12, ballCount: 10 },
  Cable: { kind: "cableSweep", diameterMm: 5, pathPointsMm: [{ x: 0, y: 0, z: 0 }, { x: 35, y: 0, z: 8 }, { x: 60, y: 20, z: 20 }] },
};

test("V22 exact mechanical details produce valid tessellated B-Rep shapes", async () => {
  for (const [name, detail] of Object.entries(details)) {
    let shape;
    try { shape = await kernel.createMechanicalDetail({ detail }); }
    catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    const [validation, properties, tessellation] = await Promise.all([
      kernel.validate(shape), kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: .25, angularDeflectionDeg: 8 }),
    ]);
    assert.equal(validation.valid, true, `${name} should be valid`);
    assert.ok((properties.volumeMm3 ?? 0) > 0, `${name} should have volume`);
    assert.ok(tessellation.indices.length > 0, `${name} should tessellate`);
    await kernel.disposeShape(shape);
  }
});

test("V22 mechanical feature persists and rebuilds from engineering parameters", async () => {
  const feature = { id: "Gear01", name: "驱动齿轮", type: "mechanicalDetail", bodyId: "Body01", detail: details.Gear, enabled: true, state: "clean", dependencies: [] };
  const source = createCadDocument({ id: "mechanical-v22", name: "Mechanical V22", sketches: {}, features: { Gear01: feature }, featureOrder: ["Gear01"], bodies: { Body01: { ...createCadBody("Body01", "驱动齿轮"), tipFeatureId: "Gear01" } }, activeBodyId: "Body01" });
  const document = deserializeCadDocument(serializeCadDocument(source));
  assert.deepEqual(document.features.Gear01.detail, details.Gear);
  const runtime = createCadRuntimeState();
  try {
    const rebuilt = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
    assert.equal(rebuilt.success, true, rebuilt.errors.map((entry) => entry.message).join("; "));
    assert.ok(runtime.featureShapes.get("Gear01"));
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});

test("V22 CAD Agent sends real thread, gear and bearing intent through the resource bridge", () => {
  const plan = createLocalCadAgentPlan("建立 4500×900×850 mm 滚筒输送线", { planId: "mechanical-v22-agent" });
  const kinds = new Set(plan.template.parts.map((part) => part.mechanicalDetail?.kind).filter(Boolean));
  assert.ok(kinds.has("externalThread")); assert.ok(kinds.has("spurGear")); assert.ok(kinds.has("bearing")); assert.ok(kinds.has("cableSweep"));
  const built = buildCadDocumentFromResourceTemplate(plan.template, { documentId: "mechanical-v22-agent" });
  const features = Object.values(built.document.features).filter((feature) => feature.type === "mechanicalDetail");
  assert.ok(features.length >= 3);
  assert.ok(features.every((feature) => feature.dependencies.length === 0));
});

test("V23 repeated standard parts reuse one immutable kernel master without sharing runtime identity",async()=>{
  const before=kernel.getMechanicalDetailCacheSize();
  const detail={kind:"spurGear",moduleMm:1.5,teeth:31,pressureAngleDeg:20,thicknessMm:9,boreDiameterMm:7};
  const first=await kernel.createMechanicalDetail({detail});
  const afterFirst=kernel.getMechanicalDetailCacheSize();
  const second=await kernel.createMechanicalDetail({detail});
  assert.equal(afterFirst,before+1); assert.equal(kernel.getMechanicalDetailCacheSize(),afterFirst); assert.notEqual(first.id,second.id);
  await kernel.disposeShape(first); await kernel.disposeShape(second);
});
