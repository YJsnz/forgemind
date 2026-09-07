import test from "node:test";
import assert from "node:assert/strict";
import { recognizeImportedGeometry } from "../core/direct-edit/ImportedFeatureRecognition.ts";

const props={boundingBox:{min:{x:-20,y:-20,z:0},max:{x:20,y:20,z:20}},volumeMm3:32000};
const cylinder=(id,height,centerZ)=>({
  topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:id},surfaceType:"cylinder",
  centerMm:{x:5,y:0,z:centerZ},normal:{x:-1,y:0,z:0},areaMm2:2*Math.PI*5*height,
  cylindricalFrame:{axisOriginMm:{x:0,y:0,z:0},axisDirection:{x:0,y:0,z:1},radiusMm:5},adjacentSurfaceTypes:["plane"],
});

test("V8 recovers Through All when the analytic hole cylinder spans both body projection bounds",()=>{
  const result=recognizeImportedGeometry([cylinder("through",20,10)],props);
  assert.equal(result.holes.length,1);
  assert.equal(result.holes[0].depthCondition?.type,"throughAll");
  assert.ok(result.holes[0].depthCondition.confidence>.9);
});

test("V8 recovers Blind depth when the analytic hole opens on one body boundary and terminates internally",()=>{
  const result=recognizeImportedGeometry([cylinder("blind",10,15)],props);
  assert.equal(result.holes.length,1);
  assert.equal(result.holes[0].depthCondition?.type,"blind");
  assert.ok(Math.abs(result.holes[0].depthCondition.valueMm-10)<1e-6);
  assert.ok(result.holes[0].depthCondition.confidence>.8);
});

test("V8 leaves ambiguous embedded cylinders without an invented depth condition",()=>{
  const result=recognizeImportedGeometry([cylinder("embedded",6,10)],props);
  assert.equal(result.holes.length,1);
  assert.equal(result.holes[0].depthCondition,undefined);
});
