import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { gradeSurfaceContinuity } from "../core/surface/SurfaceContinuity.ts";

const text = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const edge = (sourceFeatureId, n=0) => ({version:2,sourceFeatureId,kind:"edge",signature:{kind:"edge",curveType:"line",normalizedMidpoint:{x:n,y:0,z:0},boundaryRole:"boundary"}});
const controlNet = Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>({x:c*20,y:r*20,z:(r===1||r===2)&&(c===1||c===2)?12:0})));

const doc = () => createCadDocument({
  id:"surface-v12",name:"Surface V12",
  sketches:{},
  bodies:{
    Source:{...createCadBody("Source","Source","surface"),tipFeatureId:"SourcePatch"},
    Nurbs:{...createCadBody("Nurbs","B-Spline","surface"),tipFeatureId:"BSpline01"},
    Boundary:{...createCadBody("Boundary","Boundary","surface"),tipFeatureId:"Boundary01"},
  },activeBodyId:"Boundary",
  features:{
    SourcePatch:{id:"SourcePatch",name:"Source",type:"bsplineSurface",bodyId:"Source",controlNet,enabled:true,state:"clean",dependencies:[]},
    BSpline01:{id:"BSpline01",name:"Control Net",type:"bsplineSurface",bodyId:"Nurbs",controlNet,enabled:true,state:"clean",dependencies:[]},
    Boundary01:{id:"Boundary01",name:"Boundary G0",type:"boundarySurface",bodyId:"Boundary",boundaryEdges:[edge("SourcePatch",0),edge("SourcePatch",1),edge("SourcePatch",2),edge("SourcePatch",3)],continuity:"G0",toleranceMm:1e-6,enabled:true,state:"clean",dependencies:["SourcePatch"]},
  },featureOrder:["SourcePatch","BSpline01","Boundary01"],
});

test("V12 persists exact B-Spline control nets and Boundary G0 design data",()=>{
  const restored=deserializeCadDocument(serializeCadDocument(doc()));
  assert.equal(restored.features.BSpline01.type,"bsplineSurface");
  assert.deepEqual(restored.features.BSpline01.controlNet,controlNet);
  assert.equal(restored.features.Boundary01.type,"boundarySurface");
  assert.equal(restored.features.Boundary01.continuity,"G0");
  assert.equal(restored.features.Boundary01.boundaryEdges.length,4);
});

test("V12 Boundary Surface participates in FeatureGraph through persistent source edges",()=>{
  const graph=buildFeatureGraph(doc());
  assert.deepEqual([...graph.dependencies.get("Boundary01")],["SourcePatch"]);
  assert.ok(graph.order.indexOf("Boundary01")>graph.order.indexOf("SourcePatch"));
});

test("V12 CadKernel exposes B-Spline, Boundary G0 and continuity analysis without Three.js",async()=>{
  const source=await text("../core/kernel/CadKernel.ts");
  for(const op of ["bsplineSurface","boundarySurface","analyzeSurfaceContinuity"]) assert.match(source,new RegExp(`${op}\\(`));
  assert.doesNotMatch(source,/from\s+["']three|THREE\./);
});

test("V12 OCCT adapter uses the real B-spline and exact surface-analysis APIs",async()=>{
  const source=await text("../core/kernel/OcctKernel.ts");
  assert.equal((source.match(/async bsplineSurface\(/g)??[]).length,1,"one canonical B-Spline adapter should exist");
  assert.match(source,/runtime\.bsplineSurface\(/);
  assert.match(source,/runtime\.surfaceNormal\(/);
  assert.match(source,/runtime\.surfaceCurvature\(/);
  assert.match(source,/runtime\.uvFromPoint\(/);
  assert.match(source,/boundaryEdgeIds/);
});

test("V13 Boundary evaluator forwards G0/G1/G2 to strict kernel verification",async()=>{
  const source=await text("../core/evaluation/SurfaceFeatureEvaluator.ts");
  assert.doesNotMatch(source,/feature\.continuity !== "G0"/);
  assert.match(source,/continuity: feature\.continuity/);
  assert.match(source,/context\.kernel\.boundarySurface/);
});

test("V12 continuity grading is conservative across disconnected/G0/G1/G2",()=>{
  const base={sharedEdgeCount:1,g1ToleranceDeg:.5,g2Tolerance:1e-3};
  assert.equal(gradeSurfaceContinuity({...base,connected:false,samples:[]}).grade,"disconnected");
  assert.equal(gradeSurfaceContinuity({...base,connected:true,samples:[{pointMm:{x:0,y:0,z:0},normalAngleDeg:3,curvatureDelta:0}]}).grade,"G0");
  assert.equal(gradeSurfaceContinuity({...base,connected:true,samples:[{pointMm:{x:0,y:0,z:0},normalAngleDeg:.1,curvatureDelta:.1}]}).grade,"G1");
  assert.equal(gradeSurfaceContinuity({...base,connected:true,samples:[{pointMm:{x:0,y:0,z:0},normalAngleDeg:.1,curvatureDelta:1e-5}]}).grade,"G2");
});

test("V13 Part Studio exposes control-net authoring, selectable Boundary continuity and diagnostics",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for(const label of ["B-Spline/NURBS 控制网","G1 切向验收","G2 曲率验收","分析连续性"]) assert.match(source,new RegExp(label.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")));
  assert.match(source,/createBSplineSurface/);
  assert.match(source,/createBoundarySurface/);
  assert.match(source,/analyzeSelectedSurfaceContinuity/);
});

test("V12 control-net editor authors design coordinates, not a Three.js deformation mesh",async()=>{
  const source=await text("../app/cad/BSplineSurfaceEditor.tsx");
  assert.match(source,/Array\.from\(\{ length: 4 \}/);
  assert.match(source,/控制点为 Part-local mm/);
  assert.match(source,/onCreate\(controlNet\)/);
  assert.doesNotMatch(source,/THREE\.|from\s+["']three/);
});


test("V12 B-Spline history remains editable after creation",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  const editor=await text("../app/cad/BSplineSurfaceEditor.tsx");
  assert.match(source,/updateBSplineSurface/);
  assert.match(source,/initialControlNet=\{selectedFeature\.controlNet\}/);
  assert.match(source,/应用控制网并重建/);
  assert.match(editor,/initialControlNet/);
});

test("V12 exposes exact curvature and adjacent-edge quality diagnostics",async()=>{
  const kernel=await text("../core/kernel/OcctKernel.ts");
  const ui=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(kernel,/async analyzeSurface\(/);
  assert.match(kernel,/async analyzeEdgeContinuity\(/);
  assert.match(kernel,/surfaceCurvature/);
  assert.match(ui,/分析当前 Face \/ Edge 曲率质量/);
  assert.match(ui,/continuityLevel\(analysis\)/);
});


test("V12 Surface Split and conservative Replace Face are exact B-Rep operations",async()=>{
  const kernel=await text("../core/kernel/OcctKernel.ts");
  const evaluator=await text("../core/evaluation/SurfaceFeatureEvaluator.ts");
  assert.match(kernel,/async splitSurface\(/);
  assert.match(kernel,/runtime\.split\(/);
  assert.match(kernel,/async replaceFace\(/);
  assert.match(kernel,/runtime\.sew\(/);
  assert.match(kernel,/runtime\.makeSolid\(/);
  assert.match(evaluator,/context\.kernel\.splitSurface/);
  assert.match(evaluator,/context\.kernel\.replaceFace/);
});

test("V12 Part Studio exposes Surface Split and conservative Replace Face workflow",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for(const label of ["Surface Split · Surface / Surface","Split / 互切分片","Replace Face · Conservative Sew","Replace + Sew + Solidify"]) assert.ok(source.includes(label),`missing ${label}`);
  assert.match(source,/splitSelectedSurface/);
  assert.match(source,/applyReplaceFace/);
  assert.match(source,/Persistent Face Reference/);
});
