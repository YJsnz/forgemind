import test from "node:test";
import assert from "node:assert/strict";
import { createCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { serializeCadDocument, deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";

const shape={id:"shape-target",revision:1};
const cylinderFace={
  topology:{shapeId:shape.id,shapeRevision:1,kind:"face",localId:"f-cylinder"},
  surfaceType:"cylinder",
  centerMm:{x:0,y:0,z:10},
  areaMm2:2*Math.PI*5*20,
  cylindricalFrame:{axisOriginMm:{x:0,y:0,z:0},axisDirection:{x:0,y:0,z:1},radiusMm:5},
  boundaryEdgeCount:2,
  adjacentSurfaceTypes:["plane","plane"],
};
const reference={version:2,sourceFeatureId:"Imported01",kind:"face",signature:{kind:"face",surfaceType:"cylinder",normalizedCenter:{x:.5,y:.5,z:.5},areaRatio:.1,boundaryEdgeCount:2,adjacentSurfaceTypes:["plane","plane"]}};

const document=createCadDocument({id:"doc",name:"Direct Edit",features:{
  Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body01",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{volumeMm3:1000,boundingBox:{min:{x:-10,y:-10,z:0},max:{x:10,y:10,z:20}}},enabled:true,state:"clean",dependencies:[]},
  RemoveHole01:{id:"RemoveHole01",name:"Remove Hole",type:"removeHole",bodyId:"Body01",targetFeatureId:"Imported01",cylindricalFace:reference,enabled:true,state:"clean",dependencies:["Imported01"]}
},featureOrder:["Imported01","RemoveHole01"],bodies:{Body01:{id:"Body01",name:"Body",backend:"brep",visible:true}},activeBodyId:"Body01"});

test("RemoveHoleFeature participates in dependency graph and persistence",()=>{
  const graph=buildFeatureGraph(document);
  assert.deepEqual([...graph.dependencies.get("RemoveHole01")],["Imported01"]);
  const loaded=deserializeCadDocument(serializeCadDocument(document));
  assert.equal(loaded.features.RemoveHole01.type,"removeHole");
  assert.equal(loaded.features.RemoveHole01.cylindricalFace.version,2);
});

test("RemoveHole evaluator reconstructs an analytic filler and unions it",async()=>{
  const runtime=createCadRuntimeState(); runtime.featureShapes.set("Imported01",shape);
  let toolOptions; let unionCalled=false;
  const kernel={
    async getShapeProperties(){return {boundingBox:{min:{x:-10,y:-10,z:0},max:{x:10,y:10,z:20}},surfaceAreaMm2:cylinderFace.areaMm2*10,volumeMm3:1000};},
    async getFaces(){return [cylinderFace];},
    async getEdges(){return [];},
    async getFaceInfo(){return cylinderFace;},
    async cylindricalTool(options){toolOptions=options; return {id:"filler",revision:1};},
    async booleanUnion(target,tools){assert.equal(target,shape); assert.equal(tools[0].id,"filler"); unionCalled=true; return {id:"filled",revision:1};},
    async validate(){return {valid:true,errors:[],warnings:[]};},
    async disposeShape(){},
  };
  const result=await evaluateFeature("RemoveHole01",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:()=>[]});
  assert.equal(result.status,"success"); assert.equal(unionCalled,true); assert.ok(toolOptions.radiusMm>5); assert.ok(toolOptions.heightMm>20);
});
