import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { runAdaptiveBrepRecovery } from "../core/evaluation/AdaptiveBrepRecovery.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { constrainCadControlPointDrag } from "../core/viewport/CadControlPointDrag.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const plane = { origin:{x:0,y:0,z:0}, xAxis:{x:1,y:0,z:0}, yAxis:{x:0,y:1,z:0}, normal:{x:0,y:0,z:1} };
let kernel;
before(async()=>{kernel=new OcctKernel({wasm});await kernel.init();});
after(async()=>{await kernel?.dispose();});

const exactClosedNurbs = {
  id:"curve",type:"bspline",closed:true,construction:false,
  fitPoints:[{x:-30,y:-18},{x:0,y:-28},{x:32,y:-12},{x:28,y:18},{x:0,y:30},{x:-32,y:14}],
  nurbs:{degree:3,periodic:true,knots:[0,1,2,3,4,5,6],multiplicities:[1,1,1,1,1,1,1],weights:[1,.72,1.25,.82,1.18,.9],firstParameter:0,lastParameter:6},
};

test("V21 preserves an editable rational NURBS profile and extrudes it as native OCCT geometry",async()=>{
  const sketch={id:"N",name:"NURBS",plane:{type:"XY",offset:0},entities:{curve:exactClosedNurbs},entityOrder:["curve"],constraints:{},dimensions:{}};
  const document=createCadDocument({id:"V21",name:"V21",sketches:{N:sketch}});
  const restored=deserializeCadDocument(serializeCadDocument(document));
  assert.deepEqual(restored.sketches.N.entities.curve.nurbs.weights,exactClosedNurbs.nurbs.weights);
  const built=buildSketchProfiles(restored.sketches.N);assert.equal(built.profiles.length,1);assert.equal(built.profiles[0].outer[0].nurbs.degree,3);
  const shape=await kernel.extrude({profile:built.profiles[0],plane},{distanceMm:16,direction:"positive"});
  assert.deepEqual(await kernel.validate(shape),{valid:true,issues:[]});assert.ok((await kernel.getShapeProperties(shape)).volumeMm3>1000);await kernel.disposeShape(shape);
});

test("V21 creates exact selectable intersection edges between two B-Rep surfaces",async()=>{
  const profile=(id)=>({id,outer:[{type:"line",start:[-20,-20],end:[20,-20]},{type:"line",start:[20,-20],end:[20,20]},{type:"line",start:[20,20],end:[-20,20]},{type:"line",start:[-20,20],end:[-20,-20]}],holes:[]});
  const horizontal=await kernel.surfacePatch({profile:profile("H"),plane});
  const vertical=await kernel.surfacePatch({profile:profile("V"),plane:{origin:{x:0,y:0,z:0},xAxis:{x:0,y:1,z:0},yAxis:{x:0,y:0,z:1},normal:{x:1,y:0,z:0}}});
  const intersection=await kernel.surfaceIntersection(horizontal,vertical,1e-6);const edges=await kernel.getEdges(intersection);
  assert.ok(edges.length>=1);assert.ok(edges.some((edge)=>(edge.lengthMm??0)>30));
  await kernel.disposeShape(intersection);await kernel.disposeShape(vertical);await kernel.disposeShape(horizontal);
});

test("V21 surface intersection is persisted and participates in dependency rebuild",()=>{
  const surface=(id)=>({id,name:id,type:"bsplineSurface",controlNet:[[{x:0,y:0,z:0},{x:1,y:0,z:0}],[{x:0,y:1,z:0},{x:1,y:1,z:0}]],enabled:true,state:"clean",dependencies:[]});
  const document=createCadDocument({id:"graph",name:"graph",bodies:{Curve01:createCadBody("Curve01","交线","curve")},features:{A:surface("A"),B:surface("B"),I:{id:"I",name:"交线",type:"surfaceIntersection",bodyId:"Curve01",sourceFeatureIds:["A","B"],toleranceMm:1e-6,enabled:true,state:"clean",dependencies:["A","B"]}},featureOrder:["A","B","I"]});
  assert.deepEqual([...buildFeatureGraph(document).dependencies.get("I")].sort(),["A","B"]);const restored=deserializeCadDocument(serializeCadDocument(document));assert.equal(restored.features.I.type,"surfaceIntersection");assert.equal(restored.bodies.Curve01.bodyType,"curve");
});

test("V21 adaptive modifier recovery heals the source but never changes design dimensions",async()=>{
  const calls=[];const fake={async validate(){return{valid:true,issues:[]};},async heal(){calls.push("heal");return{id:"healed",revision:1};},async disposeShape(shape){calls.push(`dispose:${shape.id}`);}};
  const result=await runAdaptiveBrepRecovery(fake,{id:"source",revision:1},"加厚",[{label:"原始几何",run:async(input)=>{calls.push(`run:${input.id}:3mm`);if(input.id==="source")throw new Error("sewing gap");return{id:"result",revision:1};}}]);
  assert.equal(result.shape.id,"result");assert.deepEqual(calls,["run:source:3mm","heal","run:healed:3mm","dispose:healed"]);assert.match(result.warnings.join(""),/原设计尺寸/);
});

test("V21 direct control-point drag locks one axis and snaps without moving locked coordinates",()=>{
  const start={x:10.2,y:-3.3,z:7.7};
  assert.deepEqual(constrainCadControlPointDrag(start,{x:14.74,y:-2.9,z:7.9},{axisLock:true,snapMm:.5}),{x:14.5,y:-3.3,z:7.7});
  assert.deepEqual(constrainCadControlPointDrag(start,{x:10.34,y:-2.76,z:7.63},{axisLock:false,snapMm:.5}),{x:10.5,y:-3,z:7.5});
});

test("V21 workbench exposes exact NURBS weights, intersection curves, adaptive repair and direct 3D poles",async()=>{
  const files=await Promise.all(["../app/cad/UnifiedSketchEditor.tsx","../app/kernel-debug/OcctKernelDebug.tsx","../app/kernel-debug/CadViewportControlNet.ts","../core/evaluation/AdaptiveBrepRecovery.ts","../core/evaluation/ShellEvaluator.ts"].map((path)=>readFile(new URL(path,import.meta.url),"utf8")));
  const source=files.join("\n");for(const token of ["启用精确 NURBS 权重","生成交线","cad-control-net-overlay","updateBoundLines","pointercancel","operationWarnings","原设计尺寸保持不变"])assert.match(source,new RegExp(token));
});
