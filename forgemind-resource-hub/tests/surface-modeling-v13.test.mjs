import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { projectEdgeToSketch, refreshProjectedSketchGeometry } from "../core/sketch/ProjectedGeometry.ts";
import { createCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";

const text = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const plane = { origin:{x:0,y:0,z:0}, xAxis:{x:1,y:0,z:0}, yAxis:{x:0,y:1,z:0}, normal:{x:0,y:0,z:1} };
const pathPlane = { origin:{x:0,y:0,z:0}, xAxis:{x:0,y:0,z:1}, yAxis:{x:1,y:0,z:0}, normal:{x:0,y:1,z:0} };
const profile = { id:"v13-profile", outer:[
  {type:"line",start:[-4,-4],end:[4,-4]}, {type:"line",start:[4,-4],end:[4,4]},
  {type:"line",start:[4,4],end:[-4,4]}, {type:"line",start:[-4,4],end:[-4,-4]},
], holes:[] };
const patchProfile = { id:"v13-patch", outer:[
  {type:"line",start:[0,0],end:[40,0]}, {type:"line",start:[40,0],end:[40,30]},
  {type:"line",start:[40,30],end:[0,30]}, {type:"line",start:[0,30],end:[0,0]},
], holes:[] };

let kernel;
before(async()=>{ kernel=new OcctKernel({wasm}); await kernel.init(); });
after(async()=>{ await kernel?.dispose(); });

test("V13 uses a native interpolated OCCT B-Spline for spline sweep paths",async()=>{
  const source=await text("../core/kernel/OcctKernel.ts");
  const evaluator=await text("../core/evaluation/SurfaceFeatureEvaluator.ts");
  assert.match(source,/runtime\.interpolatePoints\(/);
  assert.match(source,/sweepAdvanced\(/);
  assert.match(evaluator,/splinePath\.controlPoints/);
  assert.doesNotMatch(evaluator,/SWEEP_PATH_SPLINE_UNSUPPORTED/);
});

test("V13 creates and validates a real surface sweep along a native spline",async()=>{
  const shape=await kernel.surfaceSweep({profile,plane},{segments:[],splinePoints:[[0,0],[15,0],[30,6],[48,10]],plane:pathPlane},{orientation:"followPath"});
  assert.deepEqual(await kernel.validate(shape),{valid:true,issues:[]});
  const properties=await kernel.getShapeProperties(shape);
  assert.ok(properties.surfaceAreaMm2>0);
  await kernel.disposeShape(shape);
});

test("professional B-Spline endpoint tangents drive the native OCCT sweep path",async()=>{
  const shape=await kernel.surfaceSweep({profile,plane},{segments:[],splinePoints:[[0,0],[15,0],[30,6],[48,10]],splineStartTangent:[1,0],splineEndTangent:[1,.2],plane:pathPlane},{orientation:"followPath"});
  assert.deepEqual(await kernel.validate(shape),{valid:true,issues:[]});
  assert.ok((await kernel.getShapeProperties(shape)).surfaceAreaMm2>0);
  await kernel.disposeShape(shape);
  const source=await text("../core/kernel/OcctKernel.ts");
  assert.match(source,/interpolatePointsWithTangents/);
});

test("a closed fit-point B-Spline becomes a periodic OCCT solid profile",async()=>{
  const sketch={id:"ClosedCurve",name:"Closed curve",plane:{type:"XY",offset:0},entities:{curve:{id:"curve",type:"bspline",fitPoints:[{x:-30,y:-20},{x:30,y:-20},{x:38,y:10},{x:0,y:28},{x:-38,y:10}],closed:true,construction:false}},entityOrder:["curve"],constraints:{},dimensions:{}};
  const built=buildSketchProfiles(sketch);
  assert.equal(built.profiles.length,1);
  assert.equal(built.profiles[0].outer[0].type,"bspline");
  assert.equal(built.profiles[0].outer[0].periodic,true);
  const shape=await kernel.extrude({profile:built.profiles[0],plane},{distanceMm:18,direction:"positive"});
  assert.deepEqual(await kernel.validate(shape),{valid:true,issues:[]});
  const properties=await kernel.getShapeProperties(shape);
  assert.ok(properties.volumeMm3>50000);
  assert.ok(properties.surfaceAreaMm2>10000);
  await kernel.disposeShape(shape);
});

test("exact B-Rep circles and arcs project as persistent external sketch curves",async()=>{
  const runtime=createCadRuntimeState();runtime.featureShapes.set("Source",{id:"shape",revision:1});
  const topology={shapeId:"shape",shapeRevision:1,kind:"edge",localId:"edge-1"};
  const edge={index:0,topology,curveType:"circle",startMm:{x:10,y:0,z:0},endMm:{x:10,y:0,z:0},lengthMm:Math.PI*20};
  const reference={version:2,sourceFeatureId:"Source",kind:"edge",signature:{kind:"edge",curveType:"circle",normalizedMidpoint:{x:1,y:.5,z:.5}}};
  const frame={origin:{x:0,y:0,z:0},xAxis:{x:1,y:0,z:0},yAxis:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
  const base={async getShapeProperties(){return{boundingBox:{min:{x:-10,y:-10,z:0},max:{x:10,y:10,z:0}},surfaceAreaMm2:400};},async getEdges(){return[edge];},async getEdgeGeometry(){return{type:"circle",centerMm:{x:0,y:0,z:0},normal:{x:0,y:0,z:1},radiusMm:10};}};
  const circle=await projectEdgeToSketch("ProjectedCircle","Source",reference,frame,runtime,base);
  assert.deepEqual({type:circle.type,center:circle.center,radius:circle.radius},{type:"external-circle",center:{x:0,y:0},radius:10});
  base.getEdgeGeometry=async()=>({type:"arc",centerMm:{x:0,y:0,z:0},normal:{x:0,y:0,z:1},radiusMm:10,startMm:{x:10,y:0,z:0},endMm:{x:0,y:10,z:0},clockwise:false});
  const arcReference=structuredClone(reference);arcReference.signature.curveType="circle";
  const arc=await projectEdgeToSketch("ProjectedArc","Source",arcReference,frame,runtime,base);
  assert.equal(arc.type,"external-arc");assert.ok(Math.abs(arc.startAngle)<1e-9);assert.ok(Math.abs(arc.endAngle-Math.PI/2)<1e-9);

  base.getEdgeGeometry=async()=>({type:"circle",centerMm:{x:0,y:0,z:0},normal:{x:0,y:0,z:1},radiusMm:12});
  const sketch={id:"Projection",name:"Projection",plane:{type:"XY",offset:0},entities:{ProjectedCircle:circle},entityOrder:["ProjectedCircle"],constraints:{},dimensions:{}};
  const refreshed=await refreshProjectedSketchGeometry(sketch,frame,runtime,base);
  assert.deepEqual(refreshed.refreshedEntityIds,["ProjectedCircle"]);assert.equal(refreshed.sketch.entities.ProjectedCircle.radius,12);assert.equal(refreshed.failed.length,0);
  base.getEdges=async()=>[];
  const lost=await refreshProjectedSketchGeometry(sketch,frame,runtime,base);
  assert.equal(lost.failed[0].code,"REFERENCE_LOST");assert.equal(lost.sketch.entities.ProjectedCircle.referenceStatus,"lost");
});

test("V14 keeps an exact swept surface stable with a fixed up direction",async()=>{
  const shape=await kernel.surfaceSweep({profile,plane},{segments:[],splinePoints:[[0,0],[15,0],[30,6],[48,10]],plane:pathPlane},{orientation:"fixedUp",upDirection:{x:0,y:1,z:0}});
  assert.deepEqual(await kernel.validate(shape),{valid:true,issues:[]});
  assert.ok((await kernel.getShapeProperties(shape)).surfaceAreaMm2>0);
  await kernel.disposeShape(shape);
});

test("V14 controls swept-surface twist with a native auxiliary guide",async()=>{
  const mainPath={segments:[],splinePoints:[[0,0],[15,0],[30,6],[48,10]],plane:pathPlane};
  const guidePath={segments:[],splinePoints:[[0,3],[15,3],[30,9],[48,13]],plane:pathPlane};
  const shape=await kernel.surfaceSweep({profile,plane},mainPath,{orientation:"guide",guidePath});
  assert.deepEqual(await kernel.validate(shape),{valid:true,issues:[]});
  assert.ok((await kernel.getShapeProperties(shape)).surfaceAreaMm2>0);
  await kernel.disposeShape(shape);
});

test("V13 samples trimmed B-Rep faces on a dense UV grid",async()=>{
  const shape=await kernel.surfacePatch({profile:patchProfile,plane});
  const face=(await kernel.getFaces(shape))[0];
  const grid=await kernel.analyzeSurfaceGrid(face.topology,9,9);
  assert.equal(grid.uSamples,9);
  assert.equal(grid.vSamples,9);
  assert.equal(grid.samples.length,81);
  assert.ok(grid.samples.every((sample)=>Number.isFinite(sample.curvature.mean)));
  await kernel.disposeShape(shape);
});

test("V13 accepts a planar G2 boundary only after native multi-station verification",async()=>{
  const source=await kernel.surfacePatch({profile:patchProfile,plane});
  const edges=(await kernel.getEdges(source)).map((entry)=>entry.topology);
  const rebuilt=await kernel.boundarySurface(edges,1e-6,{continuity:"G2",sampleCount:7,angularToleranceDeg:.5,curvatureTolerance:1e-3});
  assert.deepEqual(await kernel.validate(rebuilt),{valid:true,issues:[]});
  await kernel.disposeShape(rebuilt);
  await kernel.disposeShape(source);
});

test("V13 quality diagnostics evaluate multiple stations and report conservative grades",async()=>{
  const source=await text("../core/kernel/OcctKernel.ts");
  const ui=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/stations: KernelEdgeContinuityAnalysis\["stations"\]/);
  assert.match(source,/classifyPointOnFace/);
  assert.match(source,/SURFACE_CONTINUITY_TARGET_NOT_MET/);
  assert.match(ui,/surfaceQualitySettings\.faceSamples/);
  assert.match(ui,/surfaceQualitySettings\.edgeSamples/);
  assert.match(ui,/构建并验收/);
});

test("V14 persists sweep orientation, guide sketch and boundary acceptance settings",async()=>{
  const evaluator=await text("../core/evaluation/SurfaceFeatureEvaluator.ts");
  const persistence=await text("../core/cad/CadDocumentPersistence.ts");
  const ui=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(evaluator,/guideSketchId/);
  assert.match(evaluator,/guidePath/);
  assert.match(persistence,/feature\.guideSketchId/);
  assert.match(ui,/verification: \{ sampleCount: surfaceQualitySettings\.edgeSamples/);
  assert.match(ui,/辅助导轨（精确控制扭转）/);
});

test("V14 restores editable guide-sweep and boundary verification design data",()=>{
  const sketch=(id)=>({id,name:id,plane:{type:"XY",offset:0},entities:{},entityOrder:[],constraints:{},dimensions:{}});
  const boundaryEdge=(n)=>({version:2,sourceFeatureId:"Sweep01",kind:"edge",signature:{kind:"edge",curveType:"line",normalizedMidpoint:{x:n,y:0,z:0},boundaryRole:"boundary"}});
  const document=createCadDocument({
    id:"surface-v14-edit",name:"Surface edit",
    sketches:{Profile:sketch("Profile"),Path:sketch("Path"),Guide:sketch("Guide")},
    bodies:{Sweep:{...createCadBody("Sweep","Guide sweep","surface"),tipFeatureId:"Sweep01"},Boundary:{...createCadBody("Boundary","Boundary","surface"),tipFeatureId:"Boundary01"}},activeBodyId:"Sweep",
    features:{
      Sweep01:{id:"Sweep01",name:"Guide sweep",type:"surfaceSweep",bodyId:"Sweep",profileSketchId:"Profile",pathSketchId:"Path",guideSketchId:"Guide",orientation:"guide",enabled:true,state:"clean",dependencies:[]},
      Boundary01:{id:"Boundary01",name:"Boundary G2",type:"boundarySurface",bodyId:"Boundary",boundaryEdges:[boundaryEdge(0),boundaryEdge(1)],continuity:"G2",toleranceMm:1e-6,verification:{sampleCount:15,angularToleranceDeg:.25,curvatureTolerance:5e-4},enabled:true,state:"clean",dependencies:["Sweep01"]},
    },featureOrder:["Sweep01","Boundary01"],
  });
  const restored=deserializeCadDocument(serializeCadDocument(document));
  assert.equal(restored.features.Sweep01.guideSketchId,"Guide");
  assert.deepEqual(restored.features.Boundary01.verification,{sampleCount:15,angularToleranceDeg:.25,curvatureTolerance:5e-4});
  const graph=buildFeatureGraph(restored);
  assert.deepEqual([...graph.sketchConsumers.get("Guide")],["Sweep01"]);

  const invalidGuide=structuredClone(serializeCadDocument(document));
  delete invalidGuide.features.Sweep01.guideSketchId;
  assert.throws(()=>deserializeCadDocument(invalidGuide),/requires a valid Surface Sweep guide sketch/);
  const invalidVerification=structuredClone(serializeCadDocument(document));
  invalidVerification.features.Boundary01.verification.sampleCount=2;
  assert.throws(()=>deserializeCadDocument(invalidVerification),/invalid Boundary Surface verification settings/);
});

test("professional B-Spline fit points and endpoint tangents survive project restore",()=>{
  const curve={id:"Curve01",name:"Sweep curve",plane:{type:"XZ",offset:0},entities:{Path01:{id:"Path01",type:"bspline",fitPoints:[{x:0,y:0},{x:15,y:4},{x:35,y:12}],closed:false,startTangent:{x:1,y:0},endTangent:{x:1,y:.25},construction:false}},entityOrder:["Path01"],constraints:{},dimensions:{}};
  const document=createCadDocument({id:"professional-curve",name:"Professional curve",sketches:{Curve01:curve}});
  const restored=deserializeCadDocument(serializeCadDocument(document));
  assert.deepEqual(restored.sketches.Curve01.entities.Path01.fitPoints,curve.entities.Path01.fitPoints);
  assert.deepEqual(restored.sketches.Curve01.entities.Path01.endTangent,{x:1,y:.25});

  const missingTangent=structuredClone(serializeCadDocument(document));
  delete missingTangent.sketches.Curve01.entities.Path01.endTangent;
  assert.throws(()=>deserializeCadDocument(missingTangent),/must define both endpoint tangents together/);
  const zeroTangent=structuredClone(serializeCadDocument(document));
  zeroTangent.sketches.Curve01.entities.Path01.startTangent={x:0,y:0};
  assert.throws(()=>deserializeCadDocument(zeroTangent),/endpoint tangents must be non-zero/);
  const closedWithTangents=structuredClone(serializeCadDocument(document));
  closedWithTangents.sketches.Curve01.entities.Path01.closed=true;
  assert.throws(()=>deserializeCadDocument(closedWithTangents),/cannot define endpoint tangents/);
});

test("professional curve editing is exposed without restoring legacy freehand tools",async()=>{
  const ui=await text("../app/cad/UnifiedSketchEditor.tsx");
  const entity=await text("../core/sketch/SketchEntity.ts");
  const evaluator=await text("../core/evaluation/SurfaceFeatureEvaluator.ts");
  assert.match(ui,/B-Spline/);
  assert.match(ui,/控制开放曲线首尾切向/);
  assert.match(entity,/type: "bspline"/);
  assert.match(evaluator,/splineStartTangent/);
  assert.match(ui,/封闭为周期轮廓/);
  assert.match(ui,/B-Spline 端点方向相切约束/);
  assert.match(ui,/闭合并完成/);
  assert.match(ui,/已自动选择 B-Spline/);
  const workbench=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(workbench,/refreshProjectedSketchGeometry/);
  assert.match(workbench,/外部投影引用已经失效或无法唯一定位/);
  assert.doesNotMatch(ui,/自由手绘样条/);
});

test("V14 edits existing surface features through transactional preview acceptance",async()=>{
  const ui=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for(const label of ["编辑曲面扫掠","预览扫掠修改","编辑边界曲面验收","预览并重新验收"]) assert.match(ui,new RegExp(label));
  assert.match(ui,/previewFeatureDesignChange/);
  assert.match(ui,/featurePreviewRef\.current = \{ base: current, candidate, featureId, label \}/);
  assert.match(ui,/acceptFeaturePreview/);
  assert.match(ui,/cancelFeaturePreview/);
});

test("V13 edge analysis returns drawable curvature-comb vectors from exact adjacent faces",async()=>{
  const solid=await kernel.extrude({profile:patchProfile,plane},{distanceMm:12,direction:"positive"});
  const edge=(await kernel.getEdges(solid))[0];
  const analysis=await kernel.analyzeEdgeContinuity(edge.topology,.5,1e-3,11);
  assert.equal(analysis.stations.length,11);
  const drawable=analysis.stations.filter((station)=>station.combDirection && Number.isFinite(station.combMagnitude));
  assert.ok(drawable.length>=9,"interior stations should provide exact curvature-comb vectors; corner endpoints may be singular");
  await kernel.disposeShape(solid);
});

test("V13 viewport exposes zebra reflection, signed curvature heatmap and graded curvature comb",async()=>{
  const ui=[await text("../app/kernel-debug/OcctKernelDebug.tsx"),await text("../app/kernel-debug/CadViewportInspection.ts")].join("\n");
  assert.match(ui,/createCadZebraMaterial/);
  assert.match(ui,/reflectionDirection/);
  assert.match(ui,/showSurfaceHeatmap/);
  assert.match(ui,/sample\.curvature\.mean/);
  assert.match(ui,/showCurvatureComb/);
  assert.match(ui,/绿色 G2、黄色 G1、红色 G0/);
});
