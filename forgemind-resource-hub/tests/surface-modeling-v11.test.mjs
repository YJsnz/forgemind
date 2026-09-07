import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";

const text = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const rect = (id, offset=0) => ({
  id, name:id, plane:{type:"XY",offset},
  entities:{
    a:{id:"a",type:"line",start:{x:0,y:0},end:{x:40,y:0},construction:false},
    b:{id:"b",type:"line",start:{x:40,y:0},end:{x:40,y:30},construction:false},
    c:{id:"c",type:"line",start:{x:40,y:30},end:{x:0,y:30},construction:false},
    d:{id:"d",type:"line",start:{x:0,y:30},end:{x:0,y:0},construction:false},
  }, entityOrder:["a","b","c","d"], constraints:{}, dimensions:{},
});

const surfaceDoc = () => createCadDocument({
  id:"surface-v11", name:"Surface V11",
  sketches:{S1:rect("S1",0),S2:rect("S2",40)},
  bodies:{
    Surface01:{...createCadBody("Surface01","Patch A","surface"),tipFeatureId:"Patch01"},
    Surface02:{...createCadBody("Surface02","Patch B","surface"),tipFeatureId:"Patch02"},
    Surface03:{...createCadBody("Surface03","Sewn","surface"),tipFeatureId:"Sew01"},
    Body01:{...createCadBody("Body01","Thickened","solid"),tipFeatureId:"Thicken01"},
  }, activeBodyId:"Body01",
  features:{
    Patch01:{id:"Patch01",name:"Patch A",type:"surfacePatch",bodyId:"Surface01",sketchId:"S1",enabled:true,state:"clean",dependencies:[]},
    Patch02:{id:"Patch02",name:"Patch B",type:"surfacePatch",bodyId:"Surface02",sketchId:"S2",enabled:true,state:"clean",dependencies:[]},
    Sew01:{id:"Sew01",name:"Sew",type:"sewSurface",bodyId:"Surface03",sourceFeatureIds:["Patch01","Patch02"],toleranceMm:1e-6,enabled:true,state:"clean",dependencies:["Patch01","Patch02"]},
    Thicken01:{id:"Thicken01",name:"Thicken",type:"thickenSurface",bodyId:"Body01",targetFeatureId:"Sew01",thicknessMm:2,toleranceMm:1e-6,enabled:true,state:"clean",dependencies:["Sew01"]},
  }, featureOrder:["Patch01","Patch02","Sew01","Thicken01"],
});

test("V11 persists Surface/Solid Body categories and surface Feature history", () => {
  const restored=deserializeCadDocument(serializeCadDocument(surfaceDoc()));
  assert.equal(restored.bodies.Surface01.bodyType,"surface");
  assert.equal(restored.bodies.Body01.bodyType,"solid");
  assert.equal(restored.features.Sew01.type,"sewSurface");
  assert.equal(restored.features.Thicken01.type,"thickenSurface");
});

test("V11 FeatureGraph tracks Surface sketch consumers and cross-body dependencies", () => {
  const graph=buildFeatureGraph(surfaceDoc());
  assert.deepEqual([...graph.sketchConsumers.get("S1")],["Patch01"]);
  assert.deepEqual([...graph.dependencies.get("Sew01")],["Patch01","Patch02"]);
  assert.deepEqual([...graph.dependencies.get("Thicken01")],["Sew01"]);
  assert.ok(graph.order.indexOf("Sew01")>graph.order.indexOf("Patch02"));
  assert.ok(graph.order.indexOf("Thicken01")>graph.order.indexOf("Sew01"));
});

test("V11 Feature union exposes exact surface authoring and conversion Features", async()=>{
  const source=await text("../core/features/Feature.ts");
  for(const name of ["SurfacePatchFeature","SurfaceExtrudeFeature","SurfaceRevolveFeature","SurfaceSweepFeature","SurfaceLoftFeature","ExtractSurfaceFeature","OffsetSurfaceFeature","SewSurfaceFeature","ThickenSurfaceFeature","EncloseSurfaceFeature","FillSurfaceFeature","TrimSurfaceFeature"]) assert.match(source,new RegExp(name));
});

test("V11 CadKernel boundary exposes Surface operations without Three.js", async()=>{
  const source=await text("../core/kernel/CadKernel.ts");
  for(const op of ["surfacePatch","surfaceExtrude","surfaceRevolve","surfaceSweep","surfaceLoft","extractSurface","offsetSurface","sewSurfaces","thickenSurface","encloseSurfaces","fillSurface","trimSurface"]) assert.match(source,new RegExp(`${op}\\(`));
  assert.doesNotMatch(source,/from\s+["']three|THREE\./);
});

test("V11 OcctKernel adapts surface operations to actual occt-wasm runtime calls", async()=>{
  const source=await text("../core/kernel/OcctKernel.ts");
  assert.match(source,/runtime\.addHolesInFace/);
  assert.match(source,/runtime\.extrude/);
  assert.match(source,/runtime\.revolve/);
  assert.match(source,/runtime\.sweep/);
  assert.match(source,/runtime\.loft/);
  assert.match(source,/runtime\.offset/);
  assert.match(source,/runtime\.sew/);
  assert.match(source,/runtime\.thicken/);
  assert.match(source,/runtime\.makeSolid/);
  assert.match(source,/runtime\.makeNonPlanarFace/);
  assert.match(source,/target\.runtime\.common|runtime\.common/);
});

test("V11 surface evaluation remains kernel-owned and dependency-aware", async()=>{
  const source=await text("../core/evaluation/SurfaceFeatureEvaluator.ts");
  assert.match(source,/resolvePersistentTopologyRef/);
  assert.match(source,/resolveSketchPlaneFrame/);
  assert.match(source,/surfacePatch/);
  assert.match(source,/thickenSurface/);
  assert.match(source,/encloseSurfaces/);
  assert.doesNotMatch(source,/THREE\.|from\s+["']three/);
});

test("V11 Part Studio exposes a unified Surface toolset", async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for(const label of ["曲面片","曲面拉伸","曲面旋转","曲面扫掠","曲面放样","直纹曲面","提取所选 Face → Surface","偏移所选 Surface","加厚 Surface → Solid","Sew / 缝合","Enclose → Solid","Fill / 填充","Trim Surface · 实体工具裁剪"]) assert.match(source,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(source,/body\.bodyType === "surface" \? "◇" : "◆"/);
});

test("V11 Surface tools commit through the same transactional history path", async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/createSurfaceFromSelectedSketch/);
  assert.match(source,/createSurfaceFromSketchSet/);
  assert.match(source,/extractSelectedFaceSurface/);
  assert.match(source,/offsetSelectedSurface/);
  assert.match(source,/thickenSelectedSurface/);
  assert.match(source,/combineSelectedSurfaces/);
  assert.match(source,/commitCandidateDocument\(current, candidate/);
});

test("V11 Surface body is distinct from legacy mesh and persisted as B-Rep design data", async()=>{
  const types=await text("../core/cad/CadTypes.ts");
  const bodies=await text("../core/cad/CadBodies.ts");
  assert.match(types,/CadBodyType = "solid" \| "surface"/);
  assert.match(bodies,/bodyType: "solid" \| "surface" = "solid"/);
  assert.doesNotMatch(types,/THREE\.Mesh/);
});

test("V11/V12 keep advanced surfacing on the OCCT B-Rep path instead of mesh fallbacks", async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/B-Spline\/NURBS 控制网/);
  assert.match(source,/Boundary G0/);
  assert.match(source,/都走 OCCT Face\/Shell/);
  assert.doesNotMatch(source,/THREE\.(ShapeGeometry|ParametricGeometry|PlaneGeometry).*Surface/);
});
