import test from "node:test";
import assert from "node:assert/strict";
import { recognizeImportedHolePatterns } from "../core/direct-edit/ImportedPatternRecognition.ts";
import { buildImportedFeatureReconstructionReport } from "../core/direct-edit/ImportedFeatureReconstructionReport.ts";

const hole=(id,x,y,diameter=10)=>({
  kind:"hole",
  face:{topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:id},surfaceType:"cylinder",centerMm:{x:x+diameter/2,y,z:5},normal:{x:-1,y:0,z:0},areaMm2:Math.PI*diameter*20,cylindricalFrame:{axisOriginMm:{x,y,z:0},axisDirection:{x:0,y:0,z:1},radiusMm:diameter/2}},
  diameterMm:diameter,axialLengthMm:20,confidence:.95,reason:"synthetic exact analytic cylinder"
});

test("V8 recognizes an equal-spacing linear hole pattern from exact axes",()=>{
  const holes=[0,30,60,90].map((x,index)=>hole(`h${index}`,x,0));
  const patterns=recognizeImportedHolePatterns(holes);
  const linear=patterns.find((entry)=>entry.kind==="linear-hole-pattern");
  assert.ok(linear);
  assert.equal(linear.count,4);
  assert.ok(Math.abs(linear.spacingMm-30)<1e-6);
  assert.deepEqual(linear.memberFaceLocalIds,["h0","h1","h2","h3"]);
  assert.ok(linear.confidence>.85);
});

test("V8 recognizes a full circular hole pattern from exact axes",()=>{
  const radius=50;
  const holes=Array.from({length:6},(_,index)=>{const a=index/6*Math.PI*2;return hole(`c${index}`,Math.cos(a)*radius,Math.sin(a)*radius);});
  const patterns=recognizeImportedHolePatterns(holes);
  const circular=patterns.find((entry)=>entry.kind==="circular-hole-pattern");
  assert.ok(circular);
  assert.equal(circular.count,6);
  assert.ok(Math.abs(circular.radiusMm-radius)<1e-6);
  assert.equal(circular.angleDeg,360);
  assert.ok(circular.confidence>.85);
});

test("V8 refuses irregular hole positions as a parametric pattern",()=>{
  const holes=[hole("a",0,0),hole("b",30,0),hole("c",67,4),hole("d",100,0)];
  const patterns=recognizeImportedHolePatterns(holes);
  assert.equal(patterns.length,0);
});

test("V8 reconstruction report marks proven pattern geometry as user-confirmation instead of auto-history",()=>{
  const holes=[0,25,50].map((x,index)=>hole(`r${index}`,x,0));
  const patterns=recognizeImportedHolePatterns(holes);
  const report=buildImportedFeatureReconstructionReport({holes:[],rounds:[],cones:[],prisms:[],patterns,planarFaces:[],cylindricalFaces:[],conicalFaces:[]});
  const item=report.items.find((entry)=>entry.kind==="pattern");
  assert.ok(item);
  assert.equal(item.readiness,"user-confirmation");
  assert.match(item.blockingReason,/healed planar entrance Face/i);
});
