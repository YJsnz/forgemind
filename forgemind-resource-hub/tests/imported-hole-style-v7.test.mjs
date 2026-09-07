import test from "node:test";
import assert from "node:assert/strict";
import { recognizeImportedHoleStyles } from "../core/direct-edit/ImportedHoleStyleRecognition.ts";
import { createImportedHolePreview, completeImportedHoleReconstruction } from "../core/direct-edit/ImportedFeatureReconstruction.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";

const topo=(id,kind="face")=>({shapeId:"shape",shapeRevision:1,kind,localId:id});
const cylinder=(id,radius,axisOrigin,zLength,adjacentFaceIds=[])=>({
  topology:topo(id),surfaceType:"cylinder",centerMm:{x:radius,y:0,z:zLength/2},normal:{x:-1,y:0,z:0},areaMm2:2*Math.PI*radius*zLength,
  cylindricalFrame:{axisOriginMm:axisOrigin,axisDirection:{x:0,y:0,z:1},radiusMm:radius},adjacentFaceIds
});
const persistent=(source,id,type="cylinder")=>({version:2,sourceFeatureId:source,kind:"face",signature:{kind:"face",surfaceType:type,normal:{x:0,y:0,z:1},normalizedCenter:{x:id.length/20,y:0,z:0},boundaryEdgeCount:2}});
const doc=()=>createCadDocument({id:"d",name:"d",bodies:{Body1:{...createCadBody("Body1"),tipFeatureId:"Imported01"}},activeBodyId:"Body1",features:{Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body1",stepAssetId:"a",solidOrdinal:0,sourceSignature:{sizeBytes:1,hash32:"a"},enabled:true,state:"clean",dependencies:[]}},featureOrder:["Imported01"]});

test("V7 recognizes counterbore only from coaxial concave cylinders connected by one planar shoulder",async()=>{
  const small=cylinder("small",5,{x:0,y:0,z:0},20,["shoulder"]);
  const large=cylinder("large",10,{x:0,y:0,z:0},6,["shoulder"]);
  const shoulder={topology:topo("shoulder"),surfaceType:"plane",adjacentFaceIds:["small","large"],centerMm:{x:0,y:0,z:6},normal:{x:0,y:0,z:1}};
  const holes=[
    {kind:"hole",face:small,diameterMm:10,axialLengthMm:20,confidence:.95,reason:"small"},
    {kind:"hole",face:large,diameterMm:20,axialLengthMm:6,confidence:.94,reason:"large"},
  ];
  const recognized=await recognizeImportedHoleStyles(holes,[small,large,shoulder],{getEdgeGeometry:async()=>({type:"unsupported",curveType:"other"})});
  assert.equal(recognized.length,1);
  assert.deepEqual(recognized[0].style,{type:"counterbore",diameterMm:20,depthMm:6});
  assert.equal(recognized[0].diameterMm,10);
  assert.deepEqual(recognized[0].relatedFaceLocalIds,["small","large","shoulder"]);
});

test("V7 recognizes countersink angle and diameter from exact circular cone boundaries",async()=>{
  const bore=cylinder("bore",5,{x:0,y:0,z:0},20,["cone"]);
  const cone={topology:topo("cone"),surfaceType:"cone",adjacentFaceIds:["bore"],boundaryEdgeIds:["c1","c2"],centerMm:{x:0,y:0,z:1},normal:{x:0,y:0,z:1}};
  const kernel={getEdgeGeometry:async(ref)=>ref.localId==="c1"?{type:"circle",centerMm:{x:0,y:0,z:0},normal:{x:0,y:0,z:1},radiusMm:5}:{type:"circle",centerMm:{x:0,y:0,z:5},normal:{x:0,y:0,z:1},radiusMm:10}};
  const recognized=await recognizeImportedHoleStyles([{kind:"hole",face:bore,diameterMm:10,axialLengthMm:20,confidence:.95,reason:"bore"}],[bore,cone],kernel);
  assert.equal(recognized.length,1);
  assert.equal(recognized[0].style.type,"countersink");
  assert.equal(recognized[0].style.diameterMm,20);
  assert.ok(Math.abs(recognized[0].style.includedAngleDeg-90)<1e-9);
});

test("V7 advanced-hole preview uses multi-face Defeature and reconstructs native Hole style",()=>{
  const faces=[persistent("Imported01","bore"),persistent("Imported01","cone","cone")];
  const preview=createImportedHolePreview({document:doc(),bodyId:"Body1",targetFeatureId:"Imported01",cylindricalFace:faces[0],featureFaces:faces,style:{type:"countersink",diameterMm:20,includedAngleDeg:90},sourceLabel:"CSK",diameterMm:10,axialLengthMm:20});
  assert.equal(preview.document.features[preview.removeHoleFeatureId].type,"deleteFace");
  const targetFace={version:2,sourceFeatureId:preview.removeHoleFeatureId,kind:"face",signature:{kind:"face",surfaceType:"plane",normal:{x:0,y:0,z:1},normalizedCenter:{x:.5,y:.5,z:.5},boundaryEdgeCount:4}};
  const complete=completeImportedHoleReconstruction({preview,targetFace,center:{x:0,y:0},diameterMm:10,depth:{type:"throughAll"}});
  const feature=complete.document.features[complete.reconstructedFeatureId];
  assert.equal(feature.type,"hole");
  assert.deepEqual(feature.style,{type:"countersink",diameterMm:20,includedAngleDeg:90});
});
