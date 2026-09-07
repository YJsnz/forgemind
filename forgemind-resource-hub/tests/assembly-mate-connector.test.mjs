import test from "node:test";
import assert from "node:assert/strict";
import { mateConnectorFrameFromGeometry, transformMateConnectorFrame } from "../core/assembly/MateConnector.ts";
import { quaternionFromEulerDegrees } from "../core/assembly/RigidTransform.ts";

const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const length=(v)=>Math.hypot(v.x,v.y,v.z);

test("Mate Connector derives an orthonormal frame from exact planar geometry",()=>{
  const frame=mateConnectorFrameFromGeometry({kind:"plane",pointMm:{x:10,y:20,z:30},normal:{x:0,y:0,z:1}});
  assert.deepEqual(frame.originMm,{x:10,y:20,z:30});
  assert.ok(Math.abs(length(frame.primaryAxis)-1)<1e-12);
  assert.ok(Math.abs(dot(frame.primaryAxis,frame.secondaryAxis))<1e-12);
  assert.ok(Math.abs(dot(frame.primaryAxis,frame.tertiaryAxis))<1e-12);
});

test("Mate Connector cylinder primary axis follows analytic cylinder axis and component placement",()=>{
  const local=mateConnectorFrameFromGeometry({kind:"cylinder",axisOriginMm:{x:0,y:0,z:5},axisDirection:{x:0,y:0,z:1},radiusMm:10});
  const world=transformMateConnectorFrame(local,{translationMm:{x:100,y:20,z:0},rotation:quaternionFromEulerDegrees(0,90,0)});
  assert.ok(Math.abs(world.originMm.x-105)<1e-9);
  assert.ok(Math.abs(world.originMm.y-20)<1e-9);
  assert.ok(Math.abs(world.primaryAxis.x-1)<1e-9);
  assert.ok(Math.abs(world.primaryAxis.z)<1e-9);
});
