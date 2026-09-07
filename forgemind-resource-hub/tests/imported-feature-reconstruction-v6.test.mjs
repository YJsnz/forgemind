import test from "node:test";
import assert from "node:assert/strict";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { completeImportedEdgeTreatmentReconstruction, createImportedEdgeTreatmentPreview } from "../core/direct-edit/ImportedFeatureReconstruction.ts";
import { recognizeImportedGeometry } from "../core/direct-edit/ImportedFeatureRecognition.ts";

const face=(sourceFeatureId,id)=>({version:2,sourceFeatureId,kind:"face",signature:{kind:"face",surfaceType:"cylinder",normalizedCenter:{x:id,y:0,z:0},boundaryEdgeCount:4}});
const edge=(sourceFeatureId,id)=>({version:2,sourceFeatureId,kind:"edge",signature:{kind:"edge",curveType:"line",normalizedMidpoint:{x:id,y:0,z:0},boundaryRole:"interior"}});
const makeDoc=()=>createCadDocument({id:"doc",name:"Imported",bodies:{Body1:{...createCadBody("Body1"),tipFeatureId:"Imported01"}},activeBodyId:"Body1",features:{Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body1",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{sizeBytes:4,hash32:"abcd"},enabled:true,state:"clean",dependencies:[]}},featureOrder:["Imported01"]});

test("V6 reconstructs one native Fillet from multiple confirmed healed edges",()=>{
  const preview=createImportedEdgeTreatmentPreview({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",faces:[face("Imported01",1),face("Imported01",2)],kind:"fillet",sourceLabel:"R5 chain"});
  const result=completeImportedEdgeTreatmentReconstruction({preview,edges:[edge(preview.defeatureFeatureId,1),edge(preview.defeatureFeatureId,2)],valueMm:7});
  const feature=result.document.features[result.reconstructedFeatureId];
  assert.equal(feature.type,"fillet");
  assert.equal(feature.edges.length,2);
  assert.equal(result.edgeCount,2);
  assert.ok(feature.edges.every((item)=>item.sourceFeatureId===preview.defeatureFeatureId));
});

test("V6 de-duplicates identical confirmed healed edge signatures",()=>{
  const preview=createImportedEdgeTreatmentPreview({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",faces:[face("Imported01",1)],kind:"chamfer",sourceLabel:"chamfer"});
  const same=edge(preview.defeatureFeatureId,3);
  const result=completeImportedEdgeTreatmentReconstruction({preview,edges:[same,structuredClone(same)],valueMm:2});
  assert.equal(result.edgeCount,1);
  assert.equal(result.document.features[result.reconstructedFeatureId].edges.length,1);
});

test("V6 detects conservative prismatic cap/side candidates without guessing Boss vs Pocket",()=>{
  const cap={topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:"cap"},surfaceType:"plane",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},areaMm2:100,boundaryEdgeCount:4,boundaryEdgeIds:["e1","e2","e3","e4"],adjacentFaceIds:["s1","s2","s3","s4"]};
  const sides=[
    {id:"s1",centerMm:{x:5,y:0,z:5},normal:{x:1,y:0,z:0}},
    {id:"s2",centerMm:{x:-5,y:0,z:5},normal:{x:-1,y:0,z:0}},
    {id:"s3",centerMm:{x:0,y:5,z:5},normal:{x:0,y:1,z:0}},
    {id:"s4",centerMm:{x:0,y:-5,z:5},normal:{x:0,y:-1,z:0}},
  ].map(({id,...rest})=>({topology:{shapeId:"s",shapeRevision:1,kind:"face",localId:id},surfaceType:"plane",boundaryEdgeCount:4,...rest}));
  const result=recognizeImportedGeometry([cap,...sides],{boundingBox:{min:{x:-20,y:-20,z:0},max:{x:20,y:20,z:20}},volumeMm3:1000});
  assert.equal(result.prisms.length,1);
  assert.equal(result.prisms[0].capFace.topology.localId,"cap");
  assert.equal(result.prisms[0].sideFaceLocalIds.length,4);
  assert.ok(Math.abs(result.prisms[0].estimatedDepthMm-10)<1e-9);
  assert.equal(result.prisms[0].classification,"boss");
  assert.match(result.prisms[0].reason,/=> boss/);
});
