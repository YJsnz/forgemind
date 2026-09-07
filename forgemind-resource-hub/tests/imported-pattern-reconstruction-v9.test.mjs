import test from "node:test";
import assert from "node:assert/strict";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { createImportedHolePatternPreview, completeImportedHolePatternReconstruction } from "../core/direct-edit/ImportedPatternReconstruction.ts";

const face=(id,sourceFeatureId="Base")=>({version:2,kind:"face",sourceFeatureId,signature:{surfaceType:"cylinder",centerMm:{x:0,y:0,z:5},normal:{x:-1,y:0,z:0},areaMm2:628.318,boundaryEdgeCount:2,adjacentSurfaceTypes:["plane"]},semanticHint:`pattern-${id}`});
const planeFace=(sourceFeatureId)=>({version:2,kind:"face",sourceFeatureId,signature:{surfaceType:"plane",centerMm:{x:0,y:0,z:20},normal:{x:0,y:0,z:1},areaMm2:10000,boundaryEdgeCount:4,adjacentSurfaceTypes:["plane"]},semanticHint:"healed-entry"});
const document=()=>createCadDocument({id:"v9",name:"V9",bodies:{Body:createCadBody("Body","Body")},activeBodyId:"Body",sketches:{Sketch:{id:"Sketch",name:"Sketch",plane:{type:"XY",offset:0},entities:{a:{id:"a",type:"circle",center:{x:0,y:0},radius:50,construction:false}},entityOrder:["a"],constraints:{},dimensions:{}}},features:{Base:{id:"Base",name:"Base",type:"extrude",bodyId:"Body",sketchId:"Sketch",distance:20,direction:"positive",operation:"new",enabled:true,state:"clean",dependencies:[]}},featureOrder:["Base"]});

test("V9 reconstructs a linear imported hole pattern as Heal -> Native Seed Hole -> Native Pattern",()=>{
  const base=document();
  const pattern={kind:"linear-hole-pattern",memberFaceLocalIds:["h0","h1","h2","h3"],count:4,diameterMm:10,direction:{x:Math.SQRT1_2,y:Math.SQRT1_2,z:0},spacingMm:30,confidence:.96,reason:"exact line"};
  const preview=createImportedHolePatternPreview({document:base,bodyId:"Body",targetFeatureId:"Base",sourceLabel:"4× Ø10",pattern,memberFaces:[face("h0"),face("h1"),face("h2"),face("h3")],seedMemberIndex:1});
  assert.equal(preview.document.features[preview.healFeatureId].type,"healHolePattern");
  const result=completeImportedHolePatternReconstruction({preview,targetFace:planeFace(preview.healFeatureId),center:{x:10,y:20},depth:{type:"throughAll"}});
  const seed=result.document.features[result.seedFeatureId];
  const native=result.document.features[result.patternFeatureId];
  assert.equal(seed.type,"hole");assert.equal(native.type,"linearPattern");assert.equal(native.seedIndex,1);
  assert.deepEqual(native.direction,pattern.direction);assert.deepEqual(native.seedFeatureIds,[result.seedFeatureId]);
  assert.deepEqual(native.dependencies,[preview.healFeatureId,result.seedFeatureId]);
  assert.doesNotThrow(()=>buildFeatureGraph(result.document));
  const restored=deserializeCadDocument(serializeCadDocument(result.document));
  assert.equal(restored.features[preview.healFeatureId].type,"healHolePattern");
  assert.equal(restored.features[result.patternFeatureId].seedIndex,1);
});

test("V9 reconstructs a circular imported hole pattern with exact recovered axis",()=>{
  const base=document();
  const pattern={kind:"circular-hole-pattern",memberFaceLocalIds:["c0","c1","c2","c3","c4","c5"],count:6,diameterMm:8,axis:{origin:{x:25,y:10,z:0},direction:{x:0,y:0,z:1}},radiusMm:50,angleDeg:360,confidence:.97,reason:"exact circle"};
  const preview=createImportedHolePatternPreview({document:base,bodyId:"Body",targetFeatureId:"Base",sourceLabel:"6× Ø8",pattern,memberFaces:pattern.memberFaceLocalIds.map((id)=>face(id)),seedMemberIndex:4});
  const result=completeImportedHolePatternReconstruction({preview,targetFace:planeFace(preview.healFeatureId),center:{x:50,y:0},depth:{type:"blind",valueMm:12}});
  const native=result.document.features[result.patternFeatureId];
  assert.equal(native.type,"circularPattern");assert.deepEqual(native.axis,pattern.axis);assert.equal(native.count,6);assert.equal(native.angleDeg,360);
  assert.doesNotThrow(()=>buildFeatureGraph(result.document));
});

test("V9 rejects stale member references and stale healed target faces",()=>{
  const base=document();const pattern={kind:"linear-hole-pattern",memberFaceLocalIds:["a","b","c"],count:3,diameterMm:6,direction:{x:1,y:0,z:0},spacingMm:20,confidence:.9,reason:"exact"};
  assert.throws(()=>createImportedHolePatternPreview({document:base,bodyId:"Body",targetFeatureId:"Base",sourceLabel:"bad",pattern,memberFaces:[face("a"),face("b","Other"),face("c")]}),/same source Feature/);
  const preview=createImportedHolePatternPreview({document:base,bodyId:"Body",targetFeatureId:"Base",sourceLabel:"ok",pattern,memberFaces:[face("a"),face("b"),face("c")]});
  assert.throws(()=>completeImportedHolePatternReconstruction({preview,targetFace:planeFace("Base"),center:{x:0,y:0},depth:{type:"throughAll"}}),/healed preview/);
});
