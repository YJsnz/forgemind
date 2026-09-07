import test from "node:test";
import assert from "node:assert/strict";
import { cylindricalNormalSense, recognizeImportedGeometry } from "../core/direct-edit/ImportedFeatureRecognition.ts";

const cylinder=(id,normal)=>({
  topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:id},surfaceType:"cylinder",areaMm2:2*Math.PI*5*20,
  centerMm:{x:5,y:0,z:10},normal,cylindricalFrame:{axisOriginMm:{x:0,y:0,z:0},axisDirection:{x:0,y:0,z:1},radiusMm:5},
  adjacentSurfaceTypes:["plane","plane"],boundaryEdgeCount:2,
});

test("P2 Direct Edit recognition separates concave holes from convex shaft/round cylinders",()=>{
  const internal=cylinder("hole",{x:-1,y:0,z:0});
  const external=cylinder("shaft",{x:1,y:0,z:0});
  const faces=[internal,external,{topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:"plane"},surfaceType:"plane",areaMm2:100}];
  assert.ok(cylindricalNormalSense(internal)<-.99);
  assert.ok(cylindricalNormalSense(external)>.99);
  const r=recognizeImportedGeometry(faces,{boundingBox:{min:{x:-50,y:-50,z:0},max:{x:50,y:50,z:20}}});
  assert.equal(r.holes.length,1); assert.equal(r.holes[0].face.topology.localId,"hole");
  assert.ok(Math.abs(r.holes[0].diameterMm-10)<1e-9); assert.ok(Math.abs(r.holes[0].axialLengthMm-20)<1e-9); assert.ok(r.holes[0].confidence>.8);
  assert.equal(r.rounds.length,1); assert.equal(r.rounds[0].face.topology.localId,"shaft");
});

test("unknown cylinder sense is not falsely promoted to Remove Hole",()=>{
  const ambiguous={...cylinder("ambiguous",{x:-1,y:0,z:0}),centerMm:undefined,normal:undefined};
  const r=recognizeImportedGeometry([ambiguous]);
  assert.equal(r.holes.length,0); assert.equal(r.rounds.length,0);
});

test("exact conical faces are surfaced as confirmation-only candidates",()=>{
  const cone={topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:"cone"},surfaceType:"cone",areaMm2:30,adjacentSurfaceTypes:["plane","cylinder"]};
  const r=recognizeImportedGeometry([cone]);
  assert.equal(r.cones.length,1); assert.ok(r.cones[0].confidence>.7); assert.match(r.cones[0].reason,/user confirmation/);
});
