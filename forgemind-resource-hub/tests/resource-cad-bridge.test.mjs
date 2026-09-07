import test from "node:test";
import assert from "node:assert/strict";
import { buildCadDocumentFromResourceTemplate, buildCadDocumentFromResourceTemplates } from "../core/resource/ResourceCadBridge.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { COMPREHENSIVE_DEMO_RESOURCE_ID, comprehensiveDemoAssemblyModules, comprehensiveDemoLogicalParts, comprehensiveDemoTemplate, createComprehensiveDemoAssembly, createComprehensiveDemoCadDocument } from "../core/demo/ComprehensiveDemoProject.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { solveAssembly } from "../core/assembly/AssemblySolver.ts";

const template = {
  resourceId: "fixture",
  resourceCode: "FIX-01",
  resourceTitle: "B-Rep 工装",
  projectName: "B-Rep 工装项目",
  materialSpec: "铝合金 / 6061",
  density: 2700,
  tolerance: 0.02,
  process: "精加工",
  parts: [
    { id: "base", type: "box", label: "底座", x: 0, y: 0.1, z: 0, width: 1, height: 0.2, depth: 0.6, color: "#999999", metalness: 0.5, roughness: 0.3 },
    { id: "post", type: "cylinder", label: "立柱", x: 0.25, y: 0.7, z: 0, rotationZ: Math.PI / 2, width: 0.2, height: 1, depth: 0.2, color: "#888888", metalness: 0.6, roughness: 0.2 },
  ],
};

test("Today mainline resource templates become true multi-body CadDocuments", () => {
  const result = buildCadDocumentFromResourceTemplate(template, { documentId: "resource-test" });
  assert.equal(result.document.id, "resource-test");
  assert.equal(Object.keys(result.document.bodies).length, 2);
  assert.equal(Object.keys(result.document.sketches).length, 2);
  assert.ok(result.document.featureOrder.length >= 4);
  const baseBody = result.document.bodies[result.sourcePartToBody.base];
  assert.equal(baseBody.backend, "brep");
  assert.equal(baseBody.engineering?.material, "铝合金 / 6061");
  assert.equal(baseBody.sourceResource?.resourceCode, "FIX-01");
  assert.equal(baseBody.appearance?.color, "#999999");
});

test("Today mainline resource bridge converts meters to millimetres and keeps placement as design features", () => {
  const result = buildCadDocumentFromResourceTemplate(template, { documentId: "units-test" });
  const boxFeature = result.document.features["fixture-base-base"];
  assert.equal(boxFeature.type, "extrude");
  assert.equal(boxFeature.distance, 200);
  const positionFeature = result.document.features["fixture-base-base-position"];
  assert.equal(positionFeature.type, "bodyTransform");
  assert.deepEqual(positionFeature.translationMm, { x: 0, y: 100, z: 0 });
  const rotate = result.document.features["fixture-post-base-rotate-z"];
  assert.equal(rotate.type, "bodyTransform");
  assert.ok(Math.abs(rotate.rotation.angleDeg - 90) < 1e-9);
});

test("Today mainline body resource metadata survives CAD save/load while runtime ids remain absent", () => {
  const built = buildCadDocumentFromResourceTemplate(template, { documentId: "persist-test" });
  const serialized = serializeCadDocument(built.document);
  const restored = deserializeCadDocument(serialized);
  const body = restored.bodies[built.sourcePartToBody.base];
  assert.equal(body.sourceResource?.resourceId, "fixture");
  assert.equal(body.engineering?.densityKgM3, 2700);
  assert.equal(body.appearance?.metalness, 0.5);
  assert.equal("runtimeShapeId" in body, false);
});


test("V10 resource queues become one real multi-body CadDocument without legacy Mesh fallback", () => {
  const second = { ...template, resourceId: "fixture2", resourceCode: "FIX-02", resourceTitle: "第二工装", projectName: "第二工装项目", parts: template.parts.map((part) => ({ ...part, id: `b-${part.id}` })) };
  const result = buildCadDocumentFromResourceTemplates([template, second], { documentId: "queue-cad", spacingMm: 300 });
  assert.equal(result.document.id, "queue-cad");
  assert.equal(Object.keys(result.document.bodies).length, 4);
  assert.equal(Object.keys(result.document.sketches).length, 4);
  assert.ok(result.document.featureOrder.some((id) => id.includes("queue-position")));
  assert.ok(Object.values(result.document.bodies).every((body) => body.backend === "brep"));
  assert.equal(JSON.stringify(result.document).includes("THREE"), false);
});

test("Comprehensive demo project exposes one editable smart precision cell with solid, surface and mechanical detail workflows", () => {
  const document = createComprehensiveDemoCadDocument();
  const features = Object.values(document.features);
  assert.equal(document.id, "forgemind-smart-precision-cell-demo");
  assert.equal(Object.keys(document.bodies).length, 91);
  assert.equal(Object.values(document.bodies).filter((body) => body.visible).length, 64);
  assert.equal(Object.keys(document.sketches).length, 86);
  assert.equal(document.featureOrder.length, 213);
  assert.ok(features.some((feature) => feature.type === "extrude"));
  assert.ok(features.some((feature) => feature.type === "revolve"));
  assert.ok(features.some((feature) => feature.type === "sweep"));
  assert.ok(features.some((feature) => feature.type === "loft"));
  assert.ok(features.some((feature) => feature.type === "bodyTransform"));
  assert.equal(features.filter((feature) => feature.type === "mechanicalDetail").length, 15);
  assert.equal(features.filter((feature) => feature.type === "loft").length, 3);
  assert.equal(features.filter((feature) => feature.type === "pocket").length, 2);
  assert.equal(features.filter((feature) => feature.type === "linearPattern").length, 1);
  assert.equal(features.filter((feature) => feature.type === "circularPattern").length, 1);
  assert.equal(features.filter((feature) => feature.type === "offsetSurface").length, 1);
  assert.equal(features.filter((feature) => feature.type === "bodyBoolean").length, comprehensiveDemoLogicalParts.length);
  for (const logicalPart of comprehensiveDemoLogicalParts) {
    const target = Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === logicalPart.targetSourcePartId);
    assert.equal(target?.visible, true);
    assert.equal(target?.name, logicalPart.name);
    for (const sourcePartId of logicalPart.toolSourcePartIds) {
      const tool = Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === sourcePartId);
      assert.equal(tool?.visible, false);
      assert.match(tool?.name ?? "", /^构造体 · /);
    }
  }
  assert.deepEqual(new Set(features.filter((feature) => feature.type === "mechanicalDetail").map((feature) => feature.detail.kind)), new Set(["externalThread", "spurGear", "bearing", "cableSweep"]));
  const surface = features.find((feature) => feature.type === "bsplineSurface");
  const surfaceBodyId = surface?.bodyId;
  assert.equal(surfaceBodyId, "smart-cell-nurbs-surface-body");
  assert.equal(document.bodies[surfaceBodyId].bodyType, "surface");
  assert.equal(document.bodies[surfaceBodyId].sourceResource?.resourceId, COMPREHENSIVE_DEMO_RESOURCE_ID);
  const cover = features.find((feature) => feature.type === "thickenSurface");
  assert.equal(cover?.targetFeatureId, surface?.id);
  assert.equal(document.bodies[cover?.bodyId].engineering?.material, "透明聚碳酸酯 / PC");
  assert.ok(new Set(Object.values(document.bodies).map((body) => body.engineering?.group)).size >= 6);
});

test("Comprehensive demo assembly partitions every visible modeled part into one of seven reusable modules", () => {
  const { cad, assembly, definitions } = createComprehensiveDemoAssembly();
  const assigned = comprehensiveDemoAssemblyModules.flatMap((module) => [...module.sourcePartIds]);
  const assignedSet = new Set(assigned);
  const unassignedVisibleBodies = Object.values(cad.bodies).filter((body) => body.visible && !assignedSet.has(body.sourceResource?.sourcePartId));
  assert.equal(new Set(assigned).size, assigned.length);
  assert.equal(assigned.length, comprehensiveDemoTemplate.parts.length + 5); // NURBS cover, solid sweep, camera loft and two robot-member lofts are authored outside the primitive template
  assert.deepEqual(unassignedVisibleBodies.map((body) => body.name), []);
  assert.equal(assembly.componentOrder.length, 7);
  assert.equal(assembly.mateOrder.length, 4);
  assert.equal(Object.values(assembly.components).filter((component) => component.grounded).length, 1);
  assert.equal(definitions.definitions.size, 7);
  assert.ok(assembly.components.RotaryModule && assembly.components.RobotModule && assembly.components.ToolingModule);
});

test("Comprehensive demo assembly opens in a valid partially constrained state for live mate authoring", async () => {
  const { assembly } = createComprehensiveDemoAssembly();
  const unusedGeometry = {
    resolve: async () => assert.fail("The prepared demo only contains fixed mates."),
    resolveConnector: async () => assert.fail("The prepared demo only contains fixed mates."),
  };
  const result = await solveAssembly(assembly, unusedGeometry);
  assert.equal(result.success, true);
  assert.equal(result.status, "under-constrained");
  assert.equal(result.dof, 12);
  assert.equal(result.residualNorm, 0);
});

test("Comprehensive demo project rebuilds all solids and the NURBS surface with OCCT", async () => {
  const kernel = new OcctKernel({ wasm: new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url) });
  const runtime = createCadRuntimeState();
  try {
    await kernel.init();
    const document = createComprehensiveDemoCadDocument();
    const result = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(runtime.bodyShapes.size, 91);
    assert.ok(runtime.bodyShapes.has("smart-cell-nurbs-surface-body"));
    const baseBody = Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === "base");
    assert.ok(baseBody);
    assert.equal((await kernel.validate(runtime.bodyShapes.get(baseBody.id))).valid, true);
    assert.equal((await kernel.validate(runtime.bodyShapes.get("smart-cell-nurbs-cover-body"))).valid, true);
    assert.equal((await kernel.validate(runtime.bodyShapes.get("smart-cell-service-duct-body"))).valid, true);
    assert.equal((await kernel.validate(runtime.bodyShapes.get("smart-cell-camera-hood-body"))).valid, true);
    for (const logicalPart of comprehensiveDemoLogicalParts) {
      const target = Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === logicalPart.targetSourcePartId);
      assert.ok(target?.tipFeatureId);
      assert.equal((await kernel.validate(runtime.bodyShapes.get(target.id))).valid, true);
      assert.equal(document.features[`smart-cell-${logicalPart.id}-union`].type, "bodyBoolean");
      if (["fixture-base", "conveyor-bed"].includes(logicalPart.targetSourcePartId)) assert.match(document.features[target.tipFeatureId].type, /Pattern$/);
      else assert.equal(document.features[target.tipFeatureId].type, "bodyBoolean");
    }
  } finally {
    await disposeCadRuntimeState(runtime, kernel);
    await kernel.dispose();
  }
});
