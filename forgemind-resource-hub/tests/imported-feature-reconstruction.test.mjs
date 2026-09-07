import test from "node:test";
import assert from "node:assert/strict";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { createImportedEdgeTreatmentPreview, completeImportedEdgeTreatmentReconstruction, createImportedHolePreview, completeImportedHoleReconstruction, intersectAxisWithPlane } from "../core/direct-edit/ImportedFeatureReconstruction.ts";

const face=(sourceFeatureId,id)=>({version:2,sourceFeatureId,kind:"face",signature:{kind:"face",surfaceType:"cylinder",normalizedCenter:{x:id,y:0,z:0},boundaryEdgeCount:4}});
const edge=(sourceFeatureId)=>({version:2,sourceFeatureId,kind:"edge",signature:{kind:"edge",curveType:"line",normalizedMidpoint:{x:0,y:0,z:0},boundaryRole:"interior"}});
const makeDoc=()=>createCadDocument({id:"doc",name:"Imported",bodies:{Body1:{...createCadBody("Body1"),tipFeatureId:"Imported01"}},activeBodyId:"Body1",features:{Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body1",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{sizeBytes:4,hash32:"abcd"},enabled:true,state:"clean",dependencies:[]}},featureOrder:["Imported01"]});

test("fillet reconstruction is a defeature preview followed by native fillet",()=>{
  const preview=createImportedEdgeTreatmentPreview({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",faces:[face("Imported01",1),face("Imported01",2)],kind:"fillet",sourceLabel:"R5 group"});
  const remove=preview.document.features[preview.defeatureFeatureId];
  assert.equal(remove.type,"deleteFace"); assert.equal(remove.faces.length,2); assert.deepEqual(remove.dependencies,["Imported01"]);
  const final=completeImportedEdgeTreatmentReconstruction({preview,edge:edge(preview.defeatureFeatureId),valueMm:8});
  const fillet=final.document.features[final.reconstructedFeatureId];
  assert.equal(fillet.type,"fillet"); assert.equal(fillet.radiusMm,8); assert.equal(fillet.targetFeatureId,preview.defeatureFeatureId); assert.equal(fillet.edges[0].sourceFeatureId,preview.defeatureFeatureId);
  assert.deepEqual(final.document.featureOrder,["Imported01",preview.defeatureFeatureId,final.reconstructedFeatureId]);
});

test("chamfer reconstruction keeps the healed edge as a persistent dependency",()=>{
  const preview=createImportedEdgeTreatmentPreview({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",faces:[face("Imported01",1)],kind:"chamfer",sourceLabel:"cone group"});
  const final=completeImportedEdgeTreatmentReconstruction({preview,edge:edge(preview.defeatureFeatureId),valueMm:2.5});
  const chamfer=final.document.features[final.reconstructedFeatureId];
  assert.equal(chamfer.type,"chamfer"); assert.equal(chamfer.distanceMm,2.5); assert.deepEqual(chamfer.dependencies,[preview.defeatureFeatureId]);
});

test("reconstruction rejects stale edges and invalid values",()=>{
  const preview=createImportedEdgeTreatmentPreview({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",faces:[face("Imported01",1)],kind:"fillet",sourceLabel:"R3"});
  assert.throws(()=>completeImportedEdgeTreatmentReconstruction({preview,edge:edge("Imported01"),valueMm:4}),/healed Defeature preview/);
  assert.throws(()=>completeImportedEdgeTreatmentReconstruction({preview,edge:edge(preview.defeatureFeatureId),valueMm:0}),/positive/);
});

test("hole reconstruction is RemoveHole preview followed by a native Hole",()=>{
  const preview=createImportedHolePreview({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",cylindricalFace:face("Imported01",1),sourceLabel:"Ø10",diameterMm:10,axialLengthMm:20});
  assert.equal(preview.document.features[preview.removeHoleFeatureId].type,"removeHole");
  const planar={version:2,sourceFeatureId:preview.removeHoleFeatureId,kind:"face",signature:{kind:"face",surfaceType:"plane",normalizedCenter:{x:0,y:0,z:1}}};
  const final=completeImportedHoleReconstruction({preview,targetFace:planar,center:{x:4,y:-2},diameterMm:12,depth:{type:"blind",valueMm:18}});
  const hole=final.document.features[final.reconstructedFeatureId];
  assert.equal(hole.type,"hole"); assert.equal(hole.diameterMm,12); assert.deepEqual(hole.center,{x:4,y:-2}); assert.deepEqual(hole.depth,{type:"blind",valueMm:18}); assert.equal(hole.targetFeatureId,preview.removeHoleFeatureId);
});

test("axis-plane intersection restores a deterministic hole center plane point",()=>{
  assert.deepEqual(intersectAxisWithPlane({x:5,y:7,z:-10},{x:0,y:0,z:1},{origin:{x:0,y:0,z:20},normal:{x:0,y:0,z:1}}),{x:5,y:7,z:20});
  assert.throws(()=>intersectAxisWithPlane({x:0,y:0,z:0},{x:1,y:0,z:0},{origin:{x:0,y:0,z:2},normal:{x:0,y:0,z:1}}),/parallel/);
});
