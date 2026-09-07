import test from "node:test";
import assert from "node:assert/strict";
import { createCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";

const target={id:"shape-target",revision:1};
const face={topology:{shapeId:target.id,shapeRevision:1,kind:"face",localId:"f-feature"},surfaceType:"plane",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},areaMm2:100,boundaryEdgeCount:4,adjacentSurfaceTypes:["plane"]};
const properties={boundingBox:{min:{x:-10,y:-10,z:-10},max:{x:10,y:10,z:10}},surfaceAreaMm2:1000,volumeMm3:8000};
const ref={version:2,sourceFeatureId:"Imported01",kind:"face",signature:{kind:"face",surfaceType:"plane",normal:{x:0,y:0,z:1},normalizedCenter:{x:.5,y:.5,z:1},areaRatio:.1,boundaryEdgeCount:4,adjacentSurfaceTypes:["plane"]}};
const document=createCadDocument({id:"doc",name:"Defeature",features:{
  Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body01",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{volumeMm3:8000,boundingBox:properties.boundingBox},enabled:true,state:"clean",dependencies:[]},
  DeleteFace01:{id:"DeleteFace01",name:"Delete Face",type:"deleteFace",bodyId:"Body01",targetFeatureId:"Imported01",faces:[ref],toleranceMm:0,enabled:true,state:"clean",dependencies:["Imported01"]},
},featureOrder:["Imported01","DeleteFace01"],bodies:{Body01:{id:"Body01",name:"Body",backend:"brep",visible:true}},activeBodyId:"Body01"});

test("DeleteFace / Defeature participates in dependency graph and persistence",()=>{
  const graph=buildFeatureGraph(document);
  assert.deepEqual([...graph.dependencies.get("DeleteFace01")],["Imported01"]);
  const loaded=deserializeCadDocument(serializeCadDocument(document));
  assert.equal(loaded.features.DeleteFace01.type,"deleteFace");
  assert.equal(loaded.features.DeleteFace01.faces[0].version,2);
  assert.equal(loaded.features.DeleteFace01.toleranceMm,0);
});

test("DeleteFace evaluator resolves PersistentTopology and delegates healing to kernel.defeature",async()=>{
  const runtime=createCadRuntimeState(); runtime.featureShapes.set("Imported01",target);
  let called;
  const kernel={
    async getShapeProperties(){return properties;}, async getFaces(){return [face];}, async getEdges(){return [];}, async getFaceInfo(){return face;},
    async defeature(shape,faces,tolerance){called={shape,faces,tolerance};return {id:"healed",revision:1};},
    async validate(){return {valid:true,errors:[],warnings:[]};}, async disposeShape(){},
  };
  const result=await evaluateFeature("DeleteFace01",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:()=>[]});
  assert.equal(result.status,"success");
  assert.equal(called.shape,target); assert.equal(called.faces[0].localId,"f-feature"); assert.equal(called.tolerance,0);
});

test("DeleteFace failure is explicit and never reported as a successful edit",async()=>{
  const runtime=createCadRuntimeState(); runtime.featureShapes.set("Imported01",target);
  const kernel={
    async getShapeProperties(){return properties;}, async getFaces(){return [face];}, async getEdges(){return [];}, async getFaceInfo(){return face;},
    async defeature(){throw new Error("feature cannot be healed");}, async validate(){return {valid:true,errors:[],warnings:[]};}, async disposeShape(){},
  };
  const result=await evaluateFeature("DeleteFace01",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:()=>[]});
  assert.equal(result.status,"failed"); assert.match(result.error.message,/cannot be healed/);
});
