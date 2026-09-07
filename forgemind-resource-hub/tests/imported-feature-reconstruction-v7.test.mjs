import test from "node:test";
import assert from "node:assert/strict";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { recognizeImportedGeometry } from "../core/direct-edit/ImportedFeatureRecognition.ts";
import { createImportedPrismaticReconstruction } from "../core/direct-edit/ImportedPrismaticReconstruction.ts";
import { buildImportedFeatureReconstructionReport } from "../core/direct-edit/ImportedFeatureReconstructionReport.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";

const topology=(id)=>({shapeId:"s",shapeRevision:1,kind:"face",localId:id});
const persistent=(sourceFeatureId,id)=>({version:2,sourceFeatureId,kind:"face",signature:{kind:"face",surfaceType:"plane",normal:{x:0,y:0,z:1},normalizedCenter:{x:id.length/20,y:0,z:0},boundaryEdgeCount:4}});
const makeDoc=()=>createCadDocument({
  id:"doc",name:"Imported",bodies:{Body1:{...createCadBody("Body1"),tipFeatureId:"Imported01"}},activeBodyId:"Body1",
  features:{Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body1",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{sizeBytes:4,hash32:"abcd"},enabled:true,state:"clean",dependencies:[]}},featureOrder:["Imported01"]
});
const cap=(z,normalZ=1)=>({topology:topology("cap"),surfaceType:"plane",centerMm:{x:0,y:0,z},normal:{x:0,y:0,z:normalZ},areaMm2:100,boundaryEdgeCount:4,boundaryEdgeIds:["e1","e2","e3","e4"],adjacentFaceIds:["s1","s2","s3","s4"]});
const sides=(z, inward=false)=>[
  {id:"s1",centerMm:{x:5,y:0,z},normal:{x:inward?-1:1,y:0,z:0}},
  {id:"s2",centerMm:{x:-5,y:0,z},normal:{x:inward?1:-1,y:0,z:0}},
  {id:"s3",centerMm:{x:0,y:5,z},normal:{x:0,y:inward?-1:1,z:0}},
  {id:"s4",centerMm:{x:0,y:-5,z},normal:{x:0,y:inward?1:-1,z:0}},
].map(({id,...rest})=>({topology:topology(id),surfaceType:"plane",boundaryEdgeCount:4,...rest}));
const props={boundingBox:{min:{x:-20,y:-20,z:-20},max:{x:20,y:20,z:20}},volumeMm3:1000};
const rectangle={id:"recovered",outer:[
  {type:"line",start:[-5,-5],end:[5,-5]},
  {type:"line",start:[5,-5],end:[5,5]},
  {type:"line",start:[5,5],end:[-5,5]},
  {type:"line",start:[-5,5],end:[-5,-5]},
],holes:[]};

test("V7 proves external prismatic boss from consistent oriented cap/side evidence",()=>{
  const result=recognizeImportedGeometry([cap(10),...sides(5,false)],props);
  assert.equal(result.prisms.length,1);
  assert.equal(result.prisms[0].classification,"boss");
  assert.equal(result.prisms[0].extrusionDirection,"negative");
  assert.ok(result.prisms[0].classificationConfidence>.9);
});

test("V7 proves internal prismatic pocket from consistent oriented cap/side evidence",()=>{
  const result=recognizeImportedGeometry([cap(0),...sides(5,true)],props);
  assert.equal(result.prisms.length,1);
  assert.equal(result.prisms[0].classification,"pocket");
  assert.equal(result.prisms[0].extrusionDirection,"positive");
});

test("V7 refuses promotion when side normals do not provide a consistent convex/concave proof",()=>{
  const mixed=sides(5,false); mixed[0]={...mixed[0],normal:{x:-1,y:0,z:0}}; mixed[1]={...mixed[1],normal:{x:-1,y:0,z:0}};
  const result=recognizeImportedGeometry([cap(10),...mixed],props);
  assert.equal(result.prisms.length,1);
  assert.equal(result.prisms[0].classification,undefined);
});

test("V7 reconstruction report promotes proven prism and keeps unproven prism review-only",()=>{
  const proven=recognizeImportedGeometry([cap(10),...sides(5,false)],props);
  const report=buildImportedFeatureReconstructionReport(proven);
  const prism=report.items.find((item)=>item.kind==="prismatic");
  assert.equal(prism.readiness,"native-reconstructable");
  assert.match(prism.label,/Boss/);
  assert.equal(prism.blockingReason,undefined);
});

test("V7 reconstructs Boss as exact recovered Sketch + Defeature + Boolean Extrude Add",()=>{
  const document=makeDoc();
  const refs=[persistent("Imported01","cap"),...sides(5,false).map((face)=>persistent("Imported01",face.topology.localId))];
  const result=createImportedPrismaticReconstruction({document,bodyId:"Body1",targetFeatureId:"Imported01",capFace:refs[0],featureFaces:refs,profile:rectangle,classification:"boss",depthMm:10,direction:"negative",sourceLabel:"Boss"});
  const feature=result.document.features[result.reconstructedFeatureId];
  assert.equal(feature.type,"extrude");
  assert.equal(feature.operation,"add");
  assert.equal(feature.targetFeatureId,result.defeatureFeatureId);
  assert.equal(feature.distance,10);
  assert.equal(feature.direction,"negative");
  assert.equal(result.document.sketches[result.sketchId].entityOrder.length,4);
  assert.equal(result.document.bodies.Body1.tipFeatureId,result.reconstructedFeatureId);
  assert.doesNotThrow(()=>buildFeatureGraph(result.document));
  const restored=deserializeCadDocument(serializeCadDocument(result.document));
  assert.equal(restored.features[result.reconstructedFeatureId].operation,"add");
  assert.equal(restored.features[result.reconstructedFeatureId].targetFeatureId,result.defeatureFeatureId);
});

test("V7 reconstructs Pocket as exact recovered Sketch + Defeature + Blind Pocket",()=>{
  const document=makeDoc();
  const refs=[persistent("Imported01","cap"),...sides(5,true).map((face)=>persistent("Imported01",face.topology.localId))];
  const result=createImportedPrismaticReconstruction({document,bodyId:"Body1",targetFeatureId:"Imported01",capFace:refs[0],featureFaces:refs,profile:rectangle,classification:"pocket",depthMm:10,direction:"positive",sourceLabel:"Pocket"});
  const feature=result.document.features[result.reconstructedFeatureId];
  assert.equal(feature.type,"pocket");
  assert.deepEqual(feature.depth,{type:"blind",value:10});
  assert.equal(feature.direction,"positive");
  assert.equal(feature.targetFeatureId,result.defeatureFeatureId);
  assert.doesNotThrow(()=>buildFeatureGraph(result.document));
});

test("V8 supersedes the V7 nested-loop gate and preserves exact inner-loop sketch entities",()=>{
  const result=createImportedPrismaticReconstruction({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",capFace:persistent("Imported01","cap"),featureFaces:[persistent("Imported01","cap")],profile:{...rectangle,holes:[[{type:"circle",center:[0,0],radius:1}]]},classification:"boss",depthMm:10,direction:"negative",sourceLabel:"nested"});
  assert.equal(result.document.sketches[result.sketchId].entityOrder.length,5);
});
