import test from "node:test";
import assert from "node:assert/strict";
import { createCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { buildPlanarFaceProfile, PlanarPushPullError } from "../core/direct-edit/PlanarPushPull.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";

const target={id:"shape-target",revision:1};
const topology=(kind,localId)=>({shapeId:target.id,shapeRevision:1,kind,localId});
const face={
  topology:topology("face","f-top"), surfaceType:"plane", centerMm:{x:0,y:0,z:10}, normal:{x:0,y:0,z:1}, areaMm2:400,
  boundaryEdgeCount:4, boundaryEdgeIds:["e1","e2","e3","e4"], adjacentSurfaceTypes:["plane","plane","plane","plane"],
};
const lines={
  e1:{type:"line",startMm:{x:-10,y:-10,z:10},endMm:{x:10,y:-10,z:10}},
  e2:{type:"line",startMm:{x:10,y:-10,z:10},endMm:{x:10,y:10,z:10}},
  e3:{type:"line",startMm:{x:10,y:10,z:10},endMm:{x:-10,y:10,z:10}},
  e4:{type:"line",startMm:{x:-10,y:10,z:10},endMm:{x:-10,y:-10,z:10}},
};
const properties={boundingBox:{min:{x:-10,y:-10,z:-10},max:{x:10,y:10,z:10}},surfaceAreaMm2:2400,volumeMm3:8000};
const faceRef={version:2,sourceFeatureId:"Imported01",kind:"face",signature:{kind:"face",surfaceType:"plane",normal:{x:0,y:0,z:1},normalizedCenter:{x:.5,y:.5,z:1},areaRatio:400/2400,boundaryEdgeCount:4,adjacentSurfaceTypes:["plane","plane","plane","plane"]}};

const document=createCadDocument({id:"doc",name:"Direct Edit V2",features:{
  Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body01",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{volumeMm3:8000,boundingBox:properties.boundingBox},enabled:true,state:"clean",dependencies:[]},
  PushPull01:{id:"PushPull01",name:"Push/Pull",type:"planarPushPull",bodyId:"Body01",targetFeatureId:"Imported01",planarFace:faceRef,distanceMm:5,enabled:true,state:"clean",dependencies:["Imported01"]},
  OffsetBody01:{id:"OffsetBody01",name:"Offset",type:"offsetBody",bodyId:"Body01",targetFeatureId:"PushPull01",distanceMm:1,enabled:true,state:"clean",dependencies:["PushPull01"]},
},featureOrder:["Imported01","PushPull01","OffsetBody01"],bodies:{Body01:{id:"Body01",name:"Body",backend:"brep",visible:true}},activeBodyId:"Body01"});

test("exact planar boundary reconstructs a single closed push/pull profile",async()=>{
  const kernel={async getEdgeGeometry(edge){return lines[edge.localId];}};
  const result=await buildPlanarFaceProfile(face,kernel);
  assert.equal(result.profile.outer.length,4);
  assert.deepEqual(result.profile.outer[0].start,result.profile.outer.at(-1).end);
  assert.equal(result.input.plane.normal.z,1);
});

test("unsupported spline boundary is refused instead of tessellated",async()=>{
  const kernel={async getEdgeGeometry(edge){return edge.localId==="e2"?{type:"unsupported",curveType:"bspline"}:lines[edge.localId];}};
  await assert.rejects(()=>buildPlanarFaceProfile(face,kernel),(error)=>error instanceof PlanarPushPullError && error.code==="PUSH_PULL_UNSUPPORTED_BOUNDARY");
});

test("exact circular planar face becomes a true circle profile",async()=>{
  const circularFace={...face,boundaryEdgeCount:1,boundaryEdgeIds:["c1"],areaMm2:Math.PI*100};
  const kernel={async getEdgeGeometry(){return {type:"circle",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},radiusMm:10};}};
  const result=await buildPlanarFaceProfile(circularFace,kernel);
  assert.equal(result.profile.outer.length,1);
  assert.equal(result.profile.outer[0].type,"circle");
  assert.equal(result.profile.outer[0].radius,10);
  assert.equal(result.loopInputs.length,1);
});

test("annular planar face reconstructs outer and hole loops without mesh approximation",async()=>{
  const annularFace={...face,boundaryEdgeCount:2,boundaryEdgeIds:["outer","inner"],areaMm2:Math.PI*(100-16)};
  const kernel={async getEdgeGeometry(edge){return edge.localId==="outer"
    ? {type:"circle",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},radiusMm:10}
    : {type:"circle",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},radiusMm:4};}};
  const result=await buildPlanarFaceProfile(annularFace,kernel);
  assert.equal(result.profile.outer[0].radius,10);
  assert.equal(result.profile.holes.length,1);
  assert.equal(result.profile.holes[0][0].radius,4);
  assert.equal(result.loopInputs.length,2);
});

test("Direct Edit V2 features persist and remain dependency ordered",()=>{
  const graph=buildFeatureGraph(document);
  assert.deepEqual([...graph.dependencies.get("PushPull01")],["Imported01"]);
  assert.deepEqual([...graph.dependencies.get("OffsetBody01")],["PushPull01"]);
  const loaded=deserializeCadDocument(serializeCadDocument(document));
  assert.equal(loaded.features.PushPull01.type,"planarPushPull");
  assert.equal(loaded.features.PushPull01.planarFace.version,2);
  assert.equal(loaded.features.OffsetBody01.type,"offsetBody");
  assert.equal(loaded.features.OffsetBody01.distanceMm,1);
});

test("Planar Push/Pull evaluator extrudes exact face profile and unions for positive distance",async()=>{
  const runtime=createCadRuntimeState(); runtime.featureShapes.set("Imported01",target);
  let extrudeOptions; let unionCalled=false;
  const kernel={
    async getShapeProperties(){return properties;}, async getFaces(){return [face];}, async getEdges(){return [];}, async getFaceInfo(){return face;},
    async getEdgeGeometry(edge){return lines[edge.localId];},
    async extrude(_profile,options){extrudeOptions=options; return {id:"tool",revision:1};},
    async booleanUnion(base,tools){assert.equal(base,target); assert.equal(tools[0].id,"tool"); unionCalled=true; return {id:"pushed",revision:1};},
    async booleanCut(){throw new Error("unexpected cut");}, async validate(){return {valid:true,errors:[],warnings:[]};}, async disposeShape(){},
  };
  const single=createCadDocument({...document,features:{Imported01:document.features.Imported01,PushPull01:document.features.PushPull01},featureOrder:["Imported01","PushPull01"]});
  const result=await evaluateFeature("PushPull01",{document:single,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:()=>[]});
  assert.equal(result.status,"success"); assert.equal(unionCalled,true); assert.deepEqual(extrudeOptions,{distanceMm:5,direction:"positive"});
});

test("Offset Body evaluator calls exact kernel offset and validates result",async()=>{
  const runtime=createCadRuntimeState(); runtime.featureShapes.set("PushPull01",{id:"pushed",revision:1});
  let call;
  const kernel={async offset(shape,distance,tolerance){call={shape,distance,tolerance};return {id:"offset",revision:1};},async validate(){return {valid:true,errors:[],warnings:[]};},async disposeShape(){}};
  const result=await evaluateFeature("OffsetBody01",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:()=>[]});
  assert.equal(result.status,"success"); assert.equal(call.distance,1); assert.equal(call.shape.id,"pushed"); assert.ok(call.tolerance>0);
});


test("Planar Push/Pull builds an exact annular tool by subtracting inner loops before union",async()=>{
  const runtime=createCadRuntimeState(); runtime.featureShapes.set("Imported01",target);
  const annularFace={...face,boundaryEdgeCount:2,boundaryEdgeIds:["outer","inner"],areaMm2:Math.PI*(100-16)};
  let extrudeCount=0, cutCount=0, unionToolId;
  const kernel={
    async getShapeProperties(){return properties;}, async getFaces(){return [annularFace];}, async getEdges(){return [];}, async getFaceInfo(){return annularFace;},
    async getEdgeGeometry(edge){return edge.localId==="outer"
      ? {type:"circle",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},radiusMm:10}
      : {type:"circle",centerMm:{x:0,y:0,z:10},normal:{x:0,y:0,z:1},radiusMm:4};},
    async extrude(){extrudeCount+=1; return {id:`loop-${extrudeCount}`,revision:1};},
    async booleanCut(base,tools){cutCount+=1; assert.equal(base.id,"loop-1"); assert.equal(tools[0].id,"loop-2"); return {id:"annular-tool",revision:1};},
    async booleanUnion(base,tools){assert.equal(base,target); unionToolId=tools[0].id; return {id:"pushed-annulus",revision:1};},
    async validate(){return {valid:true,errors:[],warnings:[]};}, async disposeShape(){},
  };
  const annularRef={...faceRef,signature:{...faceRef.signature,areaRatio:annularFace.areaMm2/properties.surfaceAreaMm2,boundaryEdgeCount:2}};
  const push={...document.features.PushPull01,planarFace:annularRef};
  const single=createCadDocument({...document,features:{Imported01:document.features.Imported01,PushPull01:push},featureOrder:["Imported01","PushPull01"]});
  const result=await evaluateFeature("PushPull01",{document:single,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:()=>[]});
  assert.equal(result.status,"success"); assert.equal(extrudeCount,2); assert.equal(cutCount,1); assert.equal(unionToolId,"annular-tool");
});
