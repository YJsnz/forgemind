import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createCadDocument, toSerializableCadDocument } from "../core/cad/CadDocument.ts";
import { deserializeCadDocument } from "../core/cad/CadDocumentPersistence.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { buildFeatureGraph } from "../core/rebuild/FeatureGraph.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { capturePersistentTopologyRef } from "../core/topology/TopologyResolver.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url); let kernel;
const close = (actual, expected, tolerance = .25) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const baseDocument = () => createCadDocument({
  id: "p2-m3", name: "P2-M3 Feature Pattern", sketches: {
    Base: { id: "Base", name: "Base", plane: { type: "XY", offset: 0 }, entities: {
      a:{id:"a",type:"line",start:{x:-100,y:-100},end:{x:100,y:-100},construction:false}, b:{id:"b",type:"line",start:{x:100,y:-100},end:{x:100,y:100},construction:false}, c:{id:"c",type:"line",start:{x:100,y:100},end:{x:-100,y:100},construction:false}, d:{id:"d",type:"line",start:{x:-100,y:100},end:{x:-100,y:-100},construction:false},
    }, entityOrder:["a","b","c","d"], constraints:{}, dimensions:{} },
    PocketSketch: { id: "PocketSketch", name: "PocketSketch", plane: { type: "XY", offset: 0 }, entities: {
      a:{id:"a",type:"line",start:{x:40,y:-10},end:{x:60,y:-10},construction:false}, b:{id:"b",type:"line",start:{x:60,y:-10},end:{x:60,y:10},construction:false}, c:{id:"c",type:"line",start:{x:60,y:10},end:{x:40,y:10},construction:false}, d:{id:"d",type:"line",start:{x:40,y:10},end:{x:40,y:-10},construction:false},
    }, entityOrder:["a","b","c","d"], constraints:{}, dimensions:{} },
  }, features: { Extrude01:{id:"Extrude01",name:"Extrude01",type:"extrude",sketchId:"Base",distance:20,direction:"positive",operation:"new",enabled:true,state:"clean",dependencies:[]} }, featureOrder:["Extrude01"],
});
const context = (document, runtime, state) => ({ document, runtime, rebuildRuntime: state, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles });
const topFace = async (shape) => (await kernel.getFaces(shape)).find((face) => face.surfaceType === "plane" && (face.normal?.z ?? 0) > .999);
const withTopRef = async (document, runtime) => capturePersistentTopologyRef("Extrude01", (await topFace(runtime.featureShapes.get("Extrude01"))).topology, runtime, kernel);
const rebuild = async (document, runtime, state, request={full:true}) => { const result=await rebuildDocument(context(document,runtime,state),request); assert.equal(result.success,true,JSON.stringify(result.errors)); return result; };

before(async()=>{kernel=new OcctKernel({wasm});await kernel.init();}); after(async()=>kernel?.dispose());

test("P2-M3 linear Hole pattern creates six real B-Rep holes and rebuilds count/spacing", async()=>{
  const document=baseDocument(),runtime=createCadRuntimeState(),state=createRebuildRuntimeState(); await rebuild(document,runtime,state); const ref=await withTopRef(document,runtime);
  document.features.Hole01={id:"Hole01",name:"Hole01",type:"hole",targetFeatureId:"Extrude01",targetFace:ref,center:{x:0,y:0},diameterMm:10,depth:{type:"throughAll"},enabled:true,state:"clean",dependencies:["Extrude01"]};
  document.features.Linear01={id:"Linear01",name:"Linear01",type:"linearPattern",targetFeatureId:"Extrude01",seedFeatureIds:["Hole01"],direction:"X",count:6,spacingMm:30,symmetric:true,enabled:true,state:"clean",dependencies:["Extrude01","Hole01"]}; document.featureOrder.push("Hole01","Linear01");
  await rebuild(document,runtime,state); close((await kernel.getShapeProperties(runtime.featureShapes.get("Linear01"))).volumeMm3,800000-6*500*Math.PI);
  document.features.Linear01={...document.features.Linear01,count:4,spacingMm:40}; const result=await rebuild(document,runtime,state,{changedFeatureIds:["Linear01"]}); assert.deepEqual(result.evaluatedFeatureIds,["Linear01"]); close((await kernel.getShapeProperties(runtime.featureShapes.get("Linear01"))).volumeMm3,800000-4*500*Math.PI); await disposeCadRuntimeState(runtime,kernel);
});

test("P2-M3 circular Hole pattern uses a full 360 degree, non-duplicated six-instance contract", async()=>{
  const document=baseDocument(),runtime=createCadRuntimeState(),state=createRebuildRuntimeState(); await rebuild(document,runtime,state); const ref=await withTopRef(document,runtime);
  document.features.Hole01={id:"Hole01",name:"Hole01",type:"hole",targetFeatureId:"Extrude01",targetFace:ref,center:{x:60,y:0},diameterMm:10,depth:{type:"throughAll"},enabled:true,state:"clean",dependencies:["Extrude01"]};
  document.features.Circular01={id:"Circular01",name:"Circular01",type:"circularPattern",targetFeatureId:"Extrude01",seedFeatureIds:["Hole01"],axis:{origin:{x:0,y:0,z:0},direction:{x:0,y:0,z:1}},count:6,angleDeg:360,enabled:true,state:"clean",dependencies:["Extrude01","Hole01"]}; document.featureOrder.push("Hole01","Circular01");
  await rebuild(document,runtime,state); close((await kernel.getShapeProperties(runtime.featureShapes.get("Circular01"))).volumeMm3,800000-6*500*Math.PI); await disposeCadRuntimeState(runtime,kernel);
});

test("P2-M3 Mirror retains seed and mirrors Hole and Through-All Pocket cutters", async()=>{
  const document=baseDocument(),runtime=createCadRuntimeState(),state=createRebuildRuntimeState(); await rebuild(document,runtime,state); const ref=await withTopRef(document,runtime);
  document.features.Hole01={id:"Hole01",name:"Hole01",type:"hole",targetFeatureId:"Extrude01",targetFace:ref,center:{x:50,y:0},diameterMm:10,depth:{type:"throughAll"},enabled:true,state:"clean",dependencies:["Extrude01"]};
  document.features.MirrorHole={id:"MirrorHole",name:"MirrorHole",type:"mirror",targetFeatureId:"Extrude01",seedFeatureIds:["Hole01"],plane:"YZ",enabled:true,state:"clean",dependencies:["Extrude01","Hole01"]}; document.featureOrder.push("Hole01","MirrorHole");
  await rebuild(document,runtime,state); close((await kernel.getShapeProperties(runtime.featureShapes.get("MirrorHole"))).volumeMm3,800000-2*500*Math.PI);
  document.features.Pocket01={id:"Pocket01",name:"Pocket01",type:"pocket",sketchId:"PocketSketch",targetFeatureId:"Extrude01",depth:{type:"throughAll"},enabled:true,state:"clean",dependencies:["Extrude01"]};
  document.features.MirrorPocket={id:"MirrorPocket",name:"MirrorPocket",type:"mirror",targetFeatureId:"Extrude01",seedFeatureIds:["Pocket01"],plane:"YZ",enabled:true,state:"clean",dependencies:["Extrude01","Pocket01"]}; document.featureOrder.push("Pocket01","MirrorPocket");
  const graph=buildFeatureGraph(document); assert.deepEqual(graph.dependencies.get("MirrorPocket")&&[...graph.dependencies.get("MirrorPocket")],["Extrude01","Pocket01"]); await rebuild(document,runtime,state); close((await kernel.getShapeProperties(runtime.featureShapes.get("MirrorPocket"))).volumeMm3,800000-2*20*20*20); await disposeCadRuntimeState(runtime,kernel);
});

test("P2-M3 Mirror fuses an attached additive Boss with its exact reflected B-Rep", async()=>{
  const document=baseDocument(),runtime=createCadRuntimeState(),state=createRebuildRuntimeState(); await rebuild(document,runtime,state); const ref=await withTopRef(document,runtime);
  document.sketches.BossSketch={id:"BossSketch",name:"BossSketch",plane:{type:"face",face:{sourceFeatureId:"Extrude01",persistent:ref}},entities:{circle:{id:"circle",type:"circle",center:{x:50,y:0},radius:10,construction:false}},entityOrder:["circle"],constraints:{},dimensions:{}};
  document.features.Boss01={id:"Boss01",name:"Boss01",type:"extrude",sketchId:"BossSketch",distance:20,direction:"positive",operation:"new",enabled:true,state:"clean",dependencies:[]};
  document.features.MirrorBoss={id:"MirrorBoss",name:"MirrorBoss",type:"mirror",targetFeatureId:"Extrude01",seedFeatureIds:["Boss01"],plane:"YZ",enabled:true,state:"clean",dependencies:["Extrude01","Boss01"]}; document.featureOrder.push("Boss01","MirrorBoss");
  await rebuild(document,runtime,state); close((await kernel.getShapeProperties(runtime.featureShapes.get("MirrorBoss"))).volumeMm3,800000+2*100*Math.PI*20); await disposeCadRuntimeState(runtime,kernel);
});

test("P2-M3 Pattern design data persists without runtime shape references", async()=>{
  const document=baseDocument(); document.features.Hole01={id:"Hole01",name:"Hole01",type:"hole",targetFeatureId:"Extrude01",targetFace:{version:2,kind:"face",sourceFeatureId:"Extrude01",signature:{surfaceType:"plane",centerMm:{x:0,y:0,z:20},normal:{x:0,y:0,z:1},areaMm2:40000,boundaryEdgeCount:4,adjacentSurfaceTypes:["plane"]}},center:{x:0,y:0},diameterMm:10,depth:{type:"throughAll"},enabled:true,state:"clean",dependencies:["Extrude01"]}; document.features.Linear01={id:"Linear01",name:"Linear01",type:"linearPattern",targetFeatureId:"Extrude01",seedFeatureIds:["Hole01"],direction:"X",count:6,spacingMm:30,enabled:true,state:"clean",dependencies:["Extrude01","Hole01"]}; document.featureOrder.push("Hole01","Linear01");
  const serialized=toSerializableCadDocument(document); const text=JSON.stringify(serialized); assert.equal(/runtimeShapeId|shapeRevision|shape-\d/i.test(text),false); const restored=deserializeCadDocument(serialized); assert.equal(restored.features.Linear01.type,"linearPattern"); assert.deepEqual(restored.features.Linear01.seedFeatureIds,["Hole01"]);
});
