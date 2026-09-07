import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { compileNurbsCurve2D, evaluateNurbsCurve2D, sampleNurbsCurve2D, validateNurbsCurve2D } from "../core/curve/NurbsCurve.ts";
import { createDefaultTensorProductNurbs } from "../core/surface/TensorProductNurbs.ts";
import { createCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { projectEdgeToSketch, refreshProjectedSketchGeometry } from "../core/sketch/ProjectedGeometry.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { solveSketch } from "../core/sketch/solver/SketchSolver.ts";
import { capturePersistentTopologyRef } from "../core/topology/TopologyResolver.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const frame = { origin:{x:0,y:0,z:0}, xAxis:{x:1,y:0,z:0}, yAxis:{x:0,y:1,z:0}, normal:{x:0,y:0,z:1} };
const sourceReference = { version:2, sourceFeatureId:"Source", kind:"edge", signature:{kind:"edge",curveType:"bspline",normalizedMidpoint:{x:.5,y:0,z:.5}} };
const sourceEdge = { index:0, topology:{shapeId:"shape",shapeRevision:1,kind:"edge",localId:"edge-1"}, curveType:"bspline", startMm:{x:0,y:0,z:0}, endMm:{x:20,y:0,z:0}, lengthMm:25 };
const curveGeometry = (middleY=10) => ({ type:"bspline",degree:2,rational:true,periodic:false,knots:[0,1],multiplicities:[3,3],polesMm:[{x:0,y:0,z:0},{x:10,y:middleY,z:0},{x:20,y:0,z:0}],weights:[1,Math.SQRT1_2,1],firstParameter:.2,lastParameter:.8 });
let kernel;

before(async()=>{kernel=new OcctKernel({wasm});await kernel.init();});
after(async()=>{await kernel?.dispose();});

test("V18 evaluates exact rational NURBS curves in homogeneous coordinates",()=>{
  const quarter={degree:2,periodic:false,knots:[0,1],multiplicities:[3,3],controlPoints:[{x:1,y:0},{x:1,y:1},{x:0,y:1}],weights:[1,Math.SQRT1_2,1],firstParameter:0,lastParameter:1};
  const midpoint=evaluateNurbsCurve2D(quarter,.5);
  assert.ok(Math.abs(midpoint.x-Math.SQRT1_2)<1e-12);
  assert.ok(Math.abs(midpoint.y-Math.SQRT1_2)<1e-12);
});

test("V18 compiles once for reusable evaluation and adaptively refines curved display spans",()=>{
  const curve={degree:2,rational:true,periodic:false,knots:[0,1],multiplicities:[3,3],controlPoints:[{x:1,y:0},{x:1,y:1},{x:0,y:1}],weights:[1,Math.SQRT1_2,1],firstParameter:0,lastParameter:1};
  const compiled=compileNurbsCurve2D(curve);
  for(let index=0;index<=100;index+=1){const parameter=index/100;assert.deepEqual(compiled.evaluate(parameter),evaluateNurbsCurve2D(curve,parameter));}
  const loose=sampleNurbsCurve2D(curve,{chordTolerance:.2,minSegments:2});
  const tight=sampleNurbsCurve2D(curve,{chordTolerance:.0001,minSegments:2});
  assert.ok(tight.length>loose.length);assert.deepEqual(tight[0],{x:1,y:0});assert.ok(Math.hypot(tight.at(-1).x,tight.at(-1).y-1)<1e-12);
});

test("V18 rejects degenerate domains, inconsistent rational flags and excessive multiplicities",()=>{
  const valid={degree:2,rational:true,periodic:false,knots:[0,1],multiplicities:[3,3],controlPoints:[{x:0,y:0},{x:1,y:1},{x:2,y:0}],weights:[1,1.2,1],firstParameter:0,lastParameter:1};
  assert.throws(()=>validateNurbsCurve2D({...valid,lastParameter:0}),/positive span/);
  assert.throws(()=>validateNurbsCurve2D({...valid,rational:false}),/unit weights/);
  assert.throws(()=>validateNurbsCurve2D({...valid,knots:[0,.5,1],multiplicities:[3,3,1]}),/multiplicity/);
});

test("V18 evaluates OCCT periodic knot conventions without opening the seam",()=>{
  const curve={degree:3,periodic:true,knots:[0,10,18.246211251235323,29.016540865504332,41.18206592610077],multiplicities:[2,1,1,1,2],controlPoints:[{x:-5.226964751181052,y:4.314812121465799},{x:4.29653855887482,y:-3.5467537159092895},{x:10.535870680440853,y:-1.8385963120597442},{x:14.44589022000869,y:9.742885788075347},{x:.28500951226426047,y:15.775634921056538}],weights:[1,1,1,1,1],firstParameter:0,lastParameter:41.18206592610077};
  const expected=[[0,{x:0,y:0}],[10,{x:10,y:0}],[18.246211251235323,{x:12,y:8}],[29.016540865504332,{x:2,y:12}],[41.18206592610077,{x:0,y:0}]];
  for(const [parameter,point] of expected){const actual=evaluateNurbsCurve2D(curve,parameter);assert.ok(Math.hypot(actual.x-point.x,actual.y-point.y)<1e-10);}
});

test("V18 extracts exact degree, knots, poles and normalized weights from real OCCT surface edges",async()=>{
  const net=Array.from({length:4},(_,row)=>Array.from({length:4},(_,column)=>({x:column*20,y:row*18,z:0})));
  const definition=createDefaultTensorProductNurbs(net,3);
  definition.weights[0]=[1,2.2,1.4,1];
  const shape=await kernel.bsplineSurface({controlNet:net,tensorNurbs:definition});
  const edges=await kernel.getEdges(shape);
  const geometries=await Promise.all(edges.map(async(edge)=>({edge,geometry:await kernel.getEdgeGeometry(edge.topology)})));
  const rationalEntry=geometries.find((entry)=>entry.geometry.type==="bspline"&&entry.geometry.rational);
  const rational=rationalEntry?.geometry;
  assert.ok(rational,"one weighted surface boundary must remain rational");
  assert.equal(rational.degree,3);
  assert.deepEqual(rational.knots,[0,1]);
  assert.deepEqual(rational.multiplicities,[4,4]);
  assert.equal(rational.polesMm.length,4);
  assert.deepEqual(rational.weights,[1,2.2,1.4,1]);
  assert.deepEqual([rational.firstParameter,rational.lastParameter],[0,1]);
  const runtime=createCadRuntimeState();runtime.featureShapes.set("Source",shape);
  const reference=await capturePersistentTopologyRef("Source",rationalEntry.edge.topology,runtime,kernel);
  const projected=await projectEdgeToSketch("RealExternalNurbs","Source",reference,frame,runtime,kernel);
  assert.equal(projected.type,"external-bspline");assert.deepEqual(projected.weights,[1,2.2,1.4,1]);
  await kernel.disposeShape(shape);
});

test("V18 projects and refreshes a trimmed NURBS edge without polyline downgrade",async()=>{
  const runtime=createCadRuntimeState();runtime.featureShapes.set("Source",{id:"shape",revision:1});
  const fake={async getShapeProperties(){return{boundingBox:{min:{x:0,y:0,z:0},max:{x:20,y:10,z:0}},surfaceAreaMm2:200};},async getEdges(){return[sourceEdge];},async getEdgeGeometry(){return curveGeometry(10);}};
  const projected=await projectEdgeToSketch("ExternalNurbs","Source",sourceReference,frame,runtime,fake);
  assert.equal(projected.type,"external-bspline");
  assert.deepEqual({degree:projected.degree,knots:projected.knots,multiplicities:projected.multiplicities,weights:projected.weights,range:[projected.firstParameter,projected.lastParameter]},{degree:2,knots:[0,1],multiplicities:[3,3],weights:[1,Math.SQRT1_2,1],range:[.2,.8]});
  const sketch={id:"Projection",name:"Projection",plane:{type:"XY",offset:0},entities:{ExternalNurbs:projected},entityOrder:["ExternalNurbs"],constraints:{},dimensions:{}};
  fake.getEdgeGeometry=async()=>curveGeometry(15);
  const refreshed=await refreshProjectedSketchGeometry(sketch,frame,runtime,fake);
  assert.deepEqual(refreshed.refreshedEntityIds,["ExternalNurbs"]);
  assert.equal(refreshed.sketch.entities.ExternalNurbs.controlPoints[1].y,15);
  assert.equal(refreshed.failed.length,0);
});

test("V18 refresh reuses one topology resolution for duplicate projections of the same edge",async()=>{
  const runtime=createCadRuntimeState();runtime.featureShapes.set("Source",{id:"shape",revision:1});let geometryCalls=0;
  const fake={async getShapeProperties(){return{boundingBox:{min:{x:0,y:0,z:0},max:{x:20,y:10,z:0}},surfaceAreaMm2:200};},async getEdges(){return[sourceEdge];},async getEdgeGeometry(){geometryCalls+=1;return curveGeometry(10);}};
  const projected=await projectEdgeToSketch("ExternalA","Source",sourceReference,frame,runtime,fake);geometryCalls=0;
  const duplicate={...structuredClone(projected),id:"ExternalB"};
  const sketch={id:"Projection",name:"Projection",plane:{type:"XY",offset:0},entities:{ExternalA:projected,ExternalB:duplicate},entityOrder:["ExternalA","ExternalB"],constraints:{},dimensions:{}};
  const refreshed=await refreshProjectedSketchGeometry(sketch,frame,runtime,fake);
  assert.equal(geometryCalls,1);assert.deepEqual(refreshed.refreshedEntityIds,["ExternalA","ExternalB"]);assert.equal(refreshed.sketch.entities.ExternalB.id,"ExternalB");
});

test("V18 restores external NURBS design data and exposes exact trimmed endpoints to constraints",()=>{
  const entity={id:"ExternalNurbs",type:"external-bspline",degree:2,rational:true,periodic:false,knots:[0,1],multiplicities:[3,3],controlPoints:[{x:0,y:0},{x:10,y:10},{x:20,y:0}],weights:[1,Math.SQRT1_2,1],firstParameter:.2,lastParameter:.8,construction:true,sourceFeatureId:"Source",sourceEdge:sourceReference,projectionMode:"coplanar",referenceStatus:"current"};
  const point=evaluateNurbsCurve2D(entity,entity.firstParameter);
  const sketch={id:"ReferenceSketch",name:"Reference sketch",plane:{type:"XY",offset:0},entities:{ExternalNurbs:entity,Point:{id:"Point",type:"point",position:{x:99,y:99},construction:false}},entityOrder:["ExternalNurbs","Point"],constraints:{Coincident:{id:"Coincident",type:"coincident",entityIds:["Point","ExternalNurbs"],pointRefs:[{entityId:"Point",role:"position"},{entityId:"ExternalNurbs",role:"start"}],enabled:true}},dimensions:{}};
  const document=createCadDocument({id:"v18-document",name:"V18",sketches:{ReferenceSketch:sketch}});
  const restored=deserializeCadDocument(serializeCadDocument(document));
  assert.deepEqual(restored.sketches.ReferenceSketch.entities.ExternalNurbs,entity);
  const solved=solveSketch(restored.sketches.ReferenceSketch);
  assert.ok(Math.hypot(solved.entities.Point.position.x-point.x,solved.entities.Point.position.y-point.y)<1e-7);
  const outsideDomain=structuredClone(serializeCadDocument(document));outsideDomain.sketches.ReferenceSketch.entities.ExternalNurbs.firstParameter=-1;
  assert.throws(()=>deserializeCadDocument(outsideDomain),/invalid exact curve domain/);
  const legacyReference=structuredClone(serializeCadDocument(document));legacyReference.sketches.ReferenceSketch.entities.ExternalNurbs.sourceEdge.version=1;
  assert.equal(deserializeCadDocument(legacyReference).sketches.ReferenceSketch.entities.ExternalNurbs.sourceEdge.version,2);
  const falseRational=structuredClone(serializeCadDocument(document));falseRational.sketches.ReferenceSketch.entities.ExternalNurbs.rational=false;
  assert.throws(()=>deserializeCadDocument(falseRational),/invalid exact curve domain/);
});

test("V18 integrates external NURBS into the kernel, persistence, refresh and sketch display paths",async()=>{
  const kernelSource=await readFile(new URL("../core/kernel/OcctKernel.ts",import.meta.url),"utf8");
  const projectionSource=await readFile(new URL("../core/sketch/ProjectedGeometry.ts",import.meta.url),"utf8");
  const editorSource=await readFile(new URL("../app/cad/UnifiedSketchEditor.tsx",import.meta.url),"utf8");
  assert.match(kernelSource,/getNurbsCurveData/);
  assert.match(projectionSource,/type:"external-bspline"/);
  assert.match(projectionSource,/geometry\.firstParameter/);
  assert.match(editorSource,/sampleNurbsCurve2D/);
  assert.match(editorSource,/externalNurbsPaths/);
  assert.match(editorSource,/保留精确曲线数据和拓扑关联/);
});
