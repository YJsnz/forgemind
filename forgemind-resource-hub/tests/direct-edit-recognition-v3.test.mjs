import test from "node:test";
import assert from "node:assert/strict";
import { recognizeImportedGeometry } from "../core/direct-edit/ImportedFeatureRecognition.ts";

const cylinder=(id,radius,adjacentFaceIds)=>({
  topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:id},surfaceType:"cylinder",areaMm2:2*Math.PI*radius*20,
  centerMm:{x:radius,y:0,z:10},normal:{x:1,y:0,z:0},cylindricalFrame:{axisOriginMm:{x:0,y:0,z:0},axisDirection:{x:0,y:0,z:1},radiusMm:radius},
  adjacentSurfaceTypes:["plane","cylinder"],adjacentFaceIds,boundaryEdgeCount:4,boundaryEdgeIds:[`${id}-a`,`${id}-b`],
});

test("Direct Edit V3 groups connected same-radius convex cylinders conservatively",()=>{
  const a=cylinder("round-a",5,["round-b"]), b=cylinder("round-b",5,["round-a","round-c"]), c=cylinder("round-c",8,["round-b"]);
  const result=recognizeImportedGeometry([a,b,c],{boundingBox:{min:{x:-50,y:-50,z:0},max:{x:50,y:50,z:20}}});
  const first=result.rounds.find((entry)=>entry.face.topology.localId==="round-a");
  assert.deepEqual(first.relatedFaceLocalIds,["round-a","round-b"]);
  const third=result.rounds.find((entry)=>entry.face.topology.localId==="round-c");
  assert.deepEqual(third.relatedFaceLocalIds,["round-c"]);
});

test("Direct Edit V3 groups connected conical faces as confirmation-only chamfer candidates",()=>{
  const coneA={topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:"cone-a"},surfaceType:"cone",areaMm2:20,adjacentSurfaceTypes:["plane"],adjacentFaceIds:["cone-b"]};
  const coneB={topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:"cone-b"},surfaceType:"cone",areaMm2:20,adjacentSurfaceTypes:["plane"],adjacentFaceIds:["cone-a"]};
  const result=recognizeImportedGeometry([coneA,coneB]);
  assert.equal(result.cones.length,2);
  assert.deepEqual(result.cones[0].relatedFaceLocalIds,["cone-a","cone-b"]);
  assert.match(result.cones[0].reason,/requires user confirmation/);
});
