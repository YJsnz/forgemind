import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { closestNurbsCurvePoint2D, compileNurbsCurve2D } from "../core/curve/NurbsCurve.ts";
import { solveSketch } from "../core/sketch/solver/SketchSolver.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { resolvePersistentTopologyRefV2 } from "../core/topology/TopologyResolver.ts";

const quarter={id:"ExternalNurbs",type:"external-bspline",degree:2,rational:true,periodic:false,knots:[0,1],multiplicities:[3,3],controlPoints:[{x:1,y:0},{x:1,y:1},{x:0,y:1}],weights:[1,Math.SQRT1_2,1],firstParameter:0,lastParameter:1,construction:true,sourceFeatureId:"Source",sourceEdge:{version:2,sourceFeatureId:"Source",kind:"edge",signature:{kind:"edge",curveType:"bspline",normalizedMidpoint:{x:.5,y:.5,z:.5}}},projectionMode:"coplanar",referenceStatus:"current"};

test("V19 evaluates an analytic rational NURBS tangent and closest persistent parameter",()=>{
  const compiled=compileNurbsCurve2D(quarter);const tangent=compiled.evaluateTangent(.5);const length=Math.hypot(tangent.x,tangent.y);
  assert.ok(Math.abs(tangent.x/length+Math.SQRT1_2)<1e-12);assert.ok(Math.abs(tangent.y/length-Math.SQRT1_2)<1e-12);
  const closest=closestNurbsCurvePoint2D(quarter,{x:.72,y:.69});assert.ok(Math.abs(closest.parameter-.5)<.03);assert.ok(closest.distance<.03);
});

test("V19 solves and persists coincidence at an arbitrary trimmed NURBS parameter",()=>{
  const parameter=.37,point=compileNurbsCurve2D(quarter).evaluate(parameter);
  const sketch={id:"S",name:"S",plane:{type:"XY",offset:0},entities:{ExternalNurbs:quarter,Point:{id:"Point",type:"point",position:{x:9,y:-4},construction:false}},entityOrder:["ExternalNurbs","Point"],constraints:{C:{id:"C",type:"coincident",entityIds:["Point","ExternalNurbs"],pointRefs:[{entityId:"Point",role:"position"},{entityId:"ExternalNurbs",role:"curve",parameter}],enabled:true}},dimensions:{}};
  const solved=solveSketch(sketch);assert.equal(solved.status,"fully-constrained",JSON.stringify(solved.diagnostics));assert.ok(Math.hypot(solved.entities.Point.position.x-point.x,solved.entities.Point.position.y-point.y)<1e-8);
  const document=createCadDocument({id:"V19",name:"V19",sketches:{S:sketch}});const restored=deserializeCadDocument(serializeCadDocument(document));assert.equal(restored.sketches.S.constraints.C.pointRefs[1].parameter,parameter);
  const invalid=structuredClone(serializeCadDocument(document));invalid.sketches.S.constraints.C.pointRefs[1].parameter=2;assert.throws(()=>deserializeCadDocument(invalid),/outside the trimmed NURBS edge/);
});

test("V19 constrains an editable line to the exact NURBS tangent at a stored parameter",()=>{
  const parameter=.5;const sketch={id:"T",name:"T",plane:{type:"XY",offset:0},entities:{ExternalNurbs:quarter,Line:{id:"Line",type:"line",start:{x:0,y:0},end:{x:1,y:0},construction:false}},entityOrder:["ExternalNurbs","Line"],constraints:{Tangent:{id:"Tangent",type:"tangent",entityIds:["Line","ExternalNurbs"],pointRefs:[{entityId:"ExternalNurbs",role:"curve",parameter}],enabled:true}},dimensions:{}};
  const solved=solveSketch(sketch);assert.notEqual(solved.status,"failed",JSON.stringify(solved.diagnostics));const line=solved.entities.Line,tangent=compileNurbsCurve2D(quarter).evaluateTangent(parameter),direction={x:line.end.x-line.start.x,y:line.end.y-line.start.y};assert.ok(Math.abs(direction.x*tangent.y-direction.y*tangent.x)/(Math.hypot(direction.x,direction.y)*Math.hypot(tangent.x,tangent.y))<1e-7);
});

test("V19 NURBS fingerprint resolves otherwise ambiguous spline edges",async()=>{
  const shape={id:"shape",revision:1};const runtime={featureShapes:new Map([["Source",shape]]),featureAliases:new Map(),bodyShapes:new Map(),featureResults:new Map()};
  const topology=(localId)=>({shapeId:"shape",shapeRevision:1,kind:"edge",localId});const edge=(localId)=>({topology:topology(localId),curveType:"bspline",startMm:{x:0,y:0,z:0},endMm:{x:10,y:0,z:0},lengthMm:12});
  const geometry=(height)=>({type:"bspline",degree:2,rational:false,periodic:false,knots:[0,1],multiplicities:[3,3],polesMm:[{x:0,y:0,z:0},{x:5,y:height,z:0},{x:10,y:0,z:0}],weights:[1,1,1],firstParameter:0,lastParameter:1});
  const fake={async getShapeProperties(){return{boundingBox:{min:{x:0,y:0,z:0},max:{x:10,y:10,z:1}},surfaceAreaMm2:100};},async getEdges(){return[edge("B"),edge("A")];},async getEdgeGeometry(ref){return geometry(ref.localId==="A"?8:2);}};
  const fingerprint={degree:2,rational:false,periodic:false,poleCount:3,normalizedKnots:[0,1],multiplicities:[3,3],normalizedPoles:[{x:0,y:0,z:0},{x:.5,y:.8,z:0},{x:1,y:0,z:0}]};
  const ref={version:2,sourceFeatureId:"Source",kind:"edge",signature:{kind:"edge",curveType:"bspline",normalizedMidpoint:{x:.5,y:0,z:0},nurbsFingerprint:fingerprint}};
  assert.equal((await resolvePersistentTopologyRefV2({...ref,signature:{...ref.signature,nurbsFingerprint:undefined}},runtime,fake)).status,"ambiguous");
  const resolved=await resolvePersistentTopologyRefV2(ref,runtime,fake);assert.equal(resolved.status,"resolved");assert.equal(resolved.topology.localId,"A");
});

test("V19 workbench exposes curve snapping, parameter markers and exact NURBS tangency",async()=>{
  const source=await readFile(new URL("../app/cad/UnifiedSketchEditor.tsx",import.meta.url),"utf8");
  for(const token of ["closestNurbsCurvePoint2D","role:\"curve\"","selectedCurveMarkers","精确 NURBS 参数位置"])assert.match(source,new RegExp(token));
});
