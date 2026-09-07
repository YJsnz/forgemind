import test from "node:test";
import assert from "node:assert/strict";
import { buildImportedFeatureReconstructionReport } from "../core/direct-edit/ImportedFeatureReconstructionReport.ts";

const topology=(id)=>({shapeId:"s",shapeRevision:1,kind:"face",localId:id});
const baseFace=(id)=>({topology:topology(id)});

test("V6 reconstruction report separates auto, confirmation, and review-only candidates",()=>{
  const report=buildImportedFeatureReconstructionReport({
    holes:[{kind:"hole",face:{...baseFace("h"),cylindricalFrame:{axisOriginMm:{x:0,y:0,z:0},axisDirection:{x:0,y:0,z:1},radiusMm:5}},diameterMm:10,axialLengthMm:20,confidence:.95,reason:"concave cylinder"}],
    rounds:[{kind:"round",face:baseFace("r"),radiusMm:3,relatedFaceLocalIds:["r","r2"],confidence:.8,reason:"convex chain"}],
    cones:[],
    prisms:[{kind:"prismatic",capFace:baseFace("p"),sideFaceLocalIds:["s1","s2","s3","s4"],profileEdgeLocalIds:["e1","e2","e3","e4"],estimatedDepthMm:12,confidence:.7,reason:"planar cap"}],
    planarFaces:[],cylindricalFaces:[],conicalFaces:[]
  });
  assert.equal(report.counts["native-reconstructable"],1);
  assert.equal(report.counts["user-confirmation"],1);
  assert.equal(report.counts["candidate-only"],1);
  assert.match(report.items.find((item)=>item.kind==="prismatic").blockingReason,/convex-concave proof/);
  assert.match(report.summary,/3 candidate/);
});
